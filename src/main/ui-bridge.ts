import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import type { ExtensionSurface } from "@shared/types";
import type { UiAnswer, UiNotification, UiRequest } from "@shared/ui";

/** Terminal colour codes have no meaning in a window; drop them on the way in. */
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

function plain(text: string): string {
  return text.replace(ANSI, "");
}

/**
 * A theme that keeps its words.
 *
 * Extensions reach for `ctx.ui.theme.fg("warning", "⏸ plan")` to colour their
 * status lines. There is no terminal here, but the call still has to work —
 * the styling the extension asked for is what the *window* decides, so every
 * decorator returns the text unchanged and the React layer does the colouring.
 */
const neutralTheme = new Proxy(
  {},
  {
    get: () => (first: unknown, second?: unknown) => (typeof second === "string" ? second : String(first ?? "")),
  },
) as Record<string, (first: unknown, second?: unknown) => string>;

/**
 * Bridges pi extension UI calls to the renderer.
 *
 * Extensions call `ctx.ui.confirm(...)` / `select(...)` / `input(...)` and
 * await a result. In the TUI those are terminal dialogs; here they become the
 * `ApprovalCard` in the window. The promise the extension awaits is resolved by
 * whichever renderer reply arrives first, and every request is keyed by id.
 *
 * Dialogs are serialised through a FIFO. pi has no dialog queue of its own, and
 * a second request while the first is unanswered would otherwise overwrite the
 * card — leaving the first extension awaiting a promise nothing can resolve.
 *
 * `setStatus` / `setWidget` are the TUI's chrome, so in a window they become
 * plain data: they are collected here, ANSI-free, and rendered by the shell.
 * That is what lets an unmodified pi extension put a mode badge and a step list
 * on screen.
 */
export class UiBridge {
  private queue: UiRequest[] = [];
  private current: UiRequest | null = null;
  private pending = new Map<string, (answer: UiAnswer) => void>();
  private notifications: UiNotification[] = [];
  private status = new Map<string, string>();
  private widgets = new Map<string, string[]>();
  private seq = 0;

  constructor(private readonly emit: (request: UiRequest | null, notifications: UiNotification[]) => void) {}

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${Date.now().toString(36)}-${this.seq}`;
  }

  private ask(request: UiRequest): Promise<UiAnswer> {
    this.queue.push(request);
    this.pump();
    return new Promise<UiAnswer>((resolve) => {
      this.pending.set(request.id, resolve);
    });
  }

  /** Show the next unanswered dialog, if the card is free. */
  private pump(): void {
    if (this.current) return;
    const next = this.queue.shift();
    if (!next) {
      this.emit(null, this.notifications);
      return;
    }
    this.current = next;
    this.emit(next, this.notifications);
  }

  /** Called from IPC when the user answers (or dismisses) a request. */
  answer(answer: UiAnswer): void {
    const resolve = this.pending.get(answer.id);
    if (!resolve) return;
    this.pending.delete(answer.id);
    if (this.current?.id === answer.id) this.current = null;
    else this.queue = this.queue.filter((request) => request.id !== answer.id);
    resolve(answer);
    this.pump();
  }

  pendingRequests(): UiRequest[] {
    return this.current ? [this.current, ...this.queue] : [...this.queue];
  }

  /** Status lines and widgets extensions pushed, in insertion order. */
  surfaces(): ExtensionSurface[] {
    const out: ExtensionSurface[] = [];
    for (const [key, text] of this.status) out.push({ key, kind: "status", text });
    for (const [key, lines] of this.widgets) out.push({ key, kind: "widget", text: lines.join("\n"), lines });
    return out;
  }

  drainNotifications(): UiNotification[] {
    const drained = this.notifications;
    this.notifications = [];
    return drained;
  }

  /** Abandon everything — used when the window closes or the session swaps. */
  reset(reason = "The request was cancelled."): void {
    for (const [id, resolve] of this.pending) {
      resolve({ id, cancelled: true, value: undefined });
    }
    this.pending.clear();
    this.queue = [];
    this.current = null;
    this.status.clear();
    this.widgets.clear();
    this.notifications.push({ id: this.nextId("note"), message: reason, type: "info", at: Date.now() });
    this.emit(null, this.notifications);
  }

  /** The object handed to `session.bindExtensions()`. */
  context(source = "extension"): ExtensionUIContext {
    return {
      select: async (title: string, options: string[]) => {
        const answer = await this.ask({
          id: this.nextId("select"),
          kind: "select",
          title,
          options,
          source,
          createdAt: Date.now(),
        });
        return answer.cancelled ? undefined : answer.value;
      },
      confirm: async (title: string, message: string) => {
        const answer = await this.ask({
          id: this.nextId("confirm"),
          kind: "confirm",
          title,
          message,
          source,
          createdAt: Date.now(),
        });
        return answer.cancelled ? false : Boolean(answer.confirmed);
      },
      input: async (title: string, placeholder?: string) => {
        const answer = await this.ask({
          id: this.nextId("input"),
          kind: "input",
          title,
          placeholder,
          source,
          createdAt: Date.now(),
        });
        return answer.cancelled ? undefined : answer.value;
      },
      notify: (message: string, type?: "info" | "warning" | "error") => {
        this.notifications.push({
          id: this.nextId("note"),
          message,
          type: type ?? "info",
          at: Date.now(),
        });
        if (this.notifications.length > 20) this.notifications = this.notifications.slice(-20);
        this.emit(null, this.notifications);
      },
      /* the TUI's chrome, kept as data instead of dropped */
      setStatus: (key: string, text?: string) => {
        if (text === undefined) this.status.delete(key);
        else this.status.set(key, plain(text));
        this.emit(null, this.notifications);
      },
      setWidget: (key: string, content?: string[] | unknown) => {
        if (content === undefined || !Array.isArray(content)) this.widgets.delete(key);
        else this.widgets.set(key, content.map((line) => plain(String(line))));
        this.emit(null, this.notifications);
      },
      theme: neutralTheme,
      getTheme: () => neutralTheme,
      /* terminal-only affordances: nothing to do in a window */
      onTerminalInput: () => () => {},
      setWorkingIndicator: () => {},
      setWorkingMessage: () => {},
      setHiddenThinkingLabel: () => {},
      custom: async () => undefined,
      onAutocomplete: () => () => {},
      addAutocompleteProvider: () => {},
      setEditorComponent: () => {},
      getEditorComponent: () => undefined,
      setEditorText: () => {},
      getEditorText: () => "",
      pasteToEditor: () => {},
      setFooter: () => {},
      setHeader: () => {},
      setTitle: () => {},
      setEditorPlaceholder: () => {},
      setToolsExpanded: () => {},
      getToolsExpanded: () => false,
      setTheme: () => {},
      getAllThemes: () => [],
      setThemeByName: () => {},
      getAvailableThemes: () => [],
    } as unknown as ExtensionUIContext;
  }
}
