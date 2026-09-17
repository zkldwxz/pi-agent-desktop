import { BrowserWindow, WebContentsView } from "electron";
import type { BrowserBounds, BrowserState, DesignPick } from "@shared/browser";
import { DESIGN_OVERLAY_SCRIPT } from "./design-overlay";

/**
 * The embedded browser.
 *
 * `WebContentsView` rather than `<webview>` or an external Chrome: it is the
 * same Chromium the app already runs, and — the reason it matters here —
 * `capturePage(rect)` can crop to an element's exact box, which is what makes
 * design-mode screenshots possible.
 *
 * The view is a native layer that composites *above* the renderer, so it cannot
 * be styled or overlapped by React. The renderer therefore reports the rect of
 * a placeholder element and the host positions the view to match.
 */
export class BrowserHost {
  private view: WebContentsView | null = null;
  private bounds: BrowserBounds = { x: 0, y: 0, width: 0, height: 0 };
  private visible = false;
  private designMode = false;
  private designToken = 0;

  constructor(
    private readonly getWindow: () => BrowserWindow | null,
    private readonly emit: (state: BrowserState) => void,
    private readonly emitPick: (pick: DesignPick | null) => void,
  ) {}
  private state(extra?: Partial<BrowserState>): BrowserState {
    const wc = this.view?.webContents;
    return {
      url: wc?.getURL() ?? "",
      title: wc?.getTitle() ?? "",
      loading: wc?.isLoading() ?? false,
      canGoBack: wc?.navigationHistory.canGoBack() ?? false,
      canGoForward: wc?.navigationHistory.canGoForward() ?? false,
      devtoolsOpen: wc?.isDevToolsOpened() ?? false,
      designMode: this.designMode,
      ...extra,
    };
  }

  private push(extra?: Partial<BrowserState>): void {
    this.emit(this.state(extra));
  }

  /** Create the view lazily and wire its events exactly once. */
  private ensure(): WebContentsView | null {
    if (this.view) return this.view;
    const win = this.getWindow();
    if (!win) return null;

    const view = new WebContentsView({
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        // its own partition so site logins survive restarts without touching the app session
        partition: "persist:pi-browser",
      },
    });
    win.contentView.addChildView(view);
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    view.setVisible(false);

    const wc = view.webContents;
    const forward = () => this.push();
    // registered one by one: the overloaded `on` signature does not accept a union
    wc.on("did-start-loading", forward);
    wc.on("did-stop-loading", forward);
    wc.on("did-navigate", forward);
    wc.on("did-navigate-in-page", forward);
    wc.on("page-title-updated", forward);
    wc.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
      if (errorCode === -3) return; // aborted, e.g. a redirect
      this.push({ error: `${errorDescription} (${errorCode}) — ${validatedURL}` });
    });
    wc.on("devtools-opened", () => this.push({ devtoolsOpen: true }));
    wc.on("devtools-closed", () => this.push({ devtoolsOpen: false }));
    wc.setWindowOpenHandler(({ url }) => {
      void this.navigate(url);
      return { action: "deny" };
    });

    this.view = view;
    return view;
  }

  /**
   * Create the view (and its renderer process) ahead of the first open.
   *
   * Building a WebContentsView costs a few hundred milliseconds on the main
   * thread, which is exactly what the user felt as stutter the first time the
   * browser dock opened. The view stays hidden at zero bounds until asked for.
   */
  warm(): void {
    this.ensure();
  }

  setBounds(bounds: BrowserBounds): void {
    const view = this.view;
    if (!view) {
      this.bounds = bounds;
      return;
    }
    const next = {
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.max(0, Math.round(bounds.width)),
      height: Math.max(0, Math.round(bounds.height)),
    };
    const current = this.bounds;
    if (
      current.x === next.x &&
      current.y === next.y &&
      current.width === next.width &&
      current.height === next.height
    ) {
      return;
    }
    this.bounds = next;
    view.setBounds(next);
    // a zero-area rect means the panel is closed; hide rather than resize to nothing
    const shouldShow = this.visible && next.width > 0 && next.height > 0;
    view.setVisible(shouldShow);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    const view = this.ensure();
    if (!view) return;
    const show = visible && this.bounds.width > 0 && this.bounds.height > 0;
    view.setVisible(show);
    // showing the panel must not reload the page — the view keeps its own state
    this.push();
  }

  private currentUrl(): string {
    const url = this.view?.webContents.getURL();
    if (!url || url === "about:blank") return "";
    return url;
  }

  async navigate(rawUrl: string): Promise<void> {
    const view = this.ensure();
    if (!view) return;
    const url = normalizeUrl(rawUrl);
    try {
      await view.webContents.loadURL(url);
    } catch (error) {
      this.push({ error: error instanceof Error ? error.message : String(error) });
    }
  }

  back(): void {
    const wc = this.view?.webContents;
    if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  }

  forward(): void {
    const wc = this.view?.webContents;
    if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  }

  reload(): void {
    this.view?.webContents.reload();
  }

  stop(): void {
    this.view?.webContents.stop();
  }

  /** Docked right, matching the reference layout; falls back to a detached window. */
  toggleDevTools(): void {
    const wc = this.ensure()?.webContents;
    if (!wc) return;
    if (wc.isDevToolsOpened()) {
      wc.closeDevTools();
      return;
    }
    try {
      wc.openDevTools({ mode: "right" });
    } catch {
      wc.openDevTools({ mode: "detach" });
    }
  }

  /**
   * Agent-initiated pick: arm the overlay, wait for exactly one selection.
   * Single-shot on purpose — the model asked for one anchor, not a session.
   */
  async pickOne(hint?: string): Promise<DesignPick | null> {
    const view = this.ensure();
    if (!view) return null;
    await this.setVisible(true);
    this.designMode = true;
    if (hint) this.push({ error: `Pick an element: ${hint}` });
    else this.push();
    try {
      const pick = (await view.webContents.executeJavaScript(DESIGN_OVERLAY_SCRIPT, true)) as DesignPick | null;
      if (!pick) return null;
      pick.screenshot = await this.captureElement(pick.rect);
      return pick;
    } catch {
      return null;
    } finally {
      this.designMode = false;
      this.push();
    }
  }

  /** Page screenshot, optionally cropped to a selector. */
  async screenshot(selector?: string): Promise<{ data: string; mimeType: string } | null> {
    const wc = this.view?.webContents;
    if (!wc) return null;
    let rect: { x: number; y: number; width: number; height: number } | undefined;
    if (selector) {
      const box = (await this.evaluate(
        `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`,
      )) as { x: number; y: number; width: number; height: number } | null;
      if (!box) return null;
      rect = box;
    }
    try {
      const image = rect
        ? await wc.capturePage({
            x: Math.max(0, Math.round(rect.x)),
            y: Math.max(0, Math.round(rect.y)),
            width: Math.min(Math.max(1, Math.round(rect.width)), 4096),
            height: Math.min(Math.max(1, Math.round(rect.height)), 4096),
          })
        : await wc.capturePage();
      if (image.isEmpty()) return null;
      const match = /^data:([^;]+);base64,(.+)$/.exec(image.toDataURL());
      return match ? { data: match[2], mimeType: match[1] } : null;
    } catch {
      return null;
    }
  }

  async startDesign(): Promise<void> {
    const view = this.ensure();
    if (!view) return;
    // the overlay runs inside the page — pointless if the view itself is hidden
    this.setVisible(true);
    this.designMode = true;
    this.designToken += 1;
    const token = this.designToken;
    this.push();

    while (this.designMode && token === this.designToken) {
      let pick: DesignPick | null = null;
      try {
        pick = (await view.webContents.executeJavaScript(DESIGN_OVERLAY_SCRIPT, true)) as DesignPick | null;
      } catch (error) {
        this.designMode = false;
        this.push({ error: error instanceof Error ? error.message : String(error) });
        return;
      }
      if (!pick) {
        // cancelled with Escape
        this.designMode = false;
        this.push();
        return;
      }
      pick.screenshot = await this.captureElement(pick.rect);
      this.emitPick(pick);
    }
  }

  stopDesign(): void {
    this.designMode = false;
    this.designToken += 1;
    void this.view?.webContents.executeJavaScript(
      "window.__pi_design__ && (window.__pi_design__.active = false)",
      true,
    );
    this.push();
  }

  /** Crop the page to the element's box. Clamped — capturePage rejects on empty rects. */
  private async captureElement(rect: DesignPick["rect"]): Promise<string | undefined> {
    const wc = this.view?.webContents;
    if (!wc) return undefined;
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    if (width < 2 || height < 2) return undefined;
    try {
      const image = await wc.capturePage({
        x: Math.max(0, Math.round(rect.x)),
        y: Math.max(0, Math.round(rect.y)),
        width: Math.min(width, 4096),
        height: Math.min(height, 4096),
      });
      if (image.isEmpty()) return undefined;
      return image.toDataURL();
    } catch {
      return undefined;
    }
  }

  async evaluate(script: string): Promise<unknown> {
    const wc = this.ensure()?.webContents;
    if (!wc) return undefined;
    try {
      return await wc.executeJavaScript(script, true);
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }

  snapshot(): { url: string; title: string; text: string } {
    const wc = this.view?.webContents;
    return { url: wc?.getURL() ?? "", title: wc?.getTitle() ?? "", text: "" };
  }

  destroy(): void {
    if (!this.view) return;
    try {
      this.getWindow()?.contentView.removeChildView(this.view);
      this.view.webContents.close();
    } catch {
      /* window already gone */
    }
    this.view = null;
    this.visible = false;
  }
}

function normalizeUrl(input: string): string {
  const value = input.trim();
  if (!value) return "about:blank";
  if (/^[a-z]+:\/\//i.test(value) || value.startsWith("about:")) return value;
  if (/^localhost(:\d+)?(\/|$)/i.test(value) || /^\d+\.\d+\.\d+\.\d+(:\d+)?/.test(value)) return `http://${value}`;
  if (/^[\w-]+(\.[\w-]+)+(\/|$)/.test(value)) return `https://${value}`;
  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
}
