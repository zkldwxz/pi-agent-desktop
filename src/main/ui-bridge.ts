import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import type { UiAnswer, UiNotification, UiRequest } from "@shared/ui";

/**
 * Bridges pi extension UI calls to the renderer.
 *
 * Extensions call `ctx.ui.confirm(...)` / `select(...)` / `input(...)` and
 * await a result. In the TUI those are terminal dialogs; here they become the
 * `ApprovalCard` in the window. The promise the extension awaits is resolved
 * by whichever renderer reply arrives first, and every request is keyed by id
 * so several can be in flight.
 */
export class UiBridge {
  private pending = new Map<string, (answer: UiAnswer) => void>();
  private notifications: UiNotification[] = [];
  private seq = 0;

  constructor(private readonly emit: (request: UiRequest | null, notifications: UiNotification[]) => void) {}

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${Date.now().toString(36)}-${this.seq}`;
  }

  private ask(request: UiRequest): Promise<UiAnswer> {
    this.emit(request, this.notifications);
    return new Promise<UiAnswer>((resolve) => {
      this.pending.set(request.id, resolve);
    });
  }

  /** Called from IPC when the user answers (or dismisses) a request. */
  answer(answer: UiAnswer): void {
    const resolve = this.pending.get(answer.id);
    if (!resolve) return;
    this.pending.delete(answer.id);
    resolve(answer);
    this.emit(null, this.notifications);
  }

  pendingRequests(): UiRequest[] {
    return [];
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
      // terminal-only affordances: nothing to do in a window
      setStatus: () => {},
      onTerminalInput: () => () => {},
      setWidget: () => {},
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
      getTheme: () => undefined,
      getAllThemes: () => [],
      setThemeByName: () => {},
      getAvailableThemes: () => [],
    } as unknown as ExtensionUIContext;
  }
}
