import { execFile } from "node:child_process";
import { existsSync } from "node:fs";

/**
 * External browser takeover — the desktop drives a real Chrome window.
 *
 * baocode abandoned the embedded browser for this; we keep both: the
 * embedded WebContentsView stays the preview surface, and this is the
 * "show the agent on my real browser" path baocode's Chrome extension
 * provided. The attach model is CDP, not an extension install — Chrome is
 * launched (or already running) with `--remote-debugging-port`, a target
 * is picked up over the DevTools JSON endpoint, and commands ride its
 * WebSocket. Node's built-in WebSocket client is enough; the protocol
 * here is only Page/Runtime, no session multiplexing.
 */

const CDP_PORT = 9222;
const DEBUG_URL = `http://127.0.0.1:${CDP_PORT}`;

const CHROME_CANDIDATES: Record<string, string[]> = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  ],
  win32: [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  ],
  linux: ["google-chrome", "chromium", "chromium-browser", "microsoft-edge"],
};

export interface CdpTarget {
  id: string;
  title: string;
  url: string;
  type: string;
}

interface CdpPage {
  ws: WebSocket;
  seq: number;
  pending: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>;
  targetId: string;
}

export class ExternalBrowser {
  private page: CdpPage | null = null;
  private launching = false;

  /** Is a debuggable Chrome already listening? */
  private async discover(): Promise<CdpTarget[]> {
    try {
      const response = await fetch(`${DEBUG_URL}/json/list`, { signal: AbortSignal.timeout(2000) });
      if (!response.ok) return [];
      const list = (await response.json()) as CdpTarget[];
      return list.filter((target) => target.type === "page");
    } catch {
      return [];
    }
  }

  /** Launch the user's real browser with the debugging port open. */
  async launch(url?: string): Promise<{ ok: boolean; error?: string }> {
    if (this.launching) return { ok: false, error: "launch in progress" };
    const existing = await this.discover();
    if (existing.length) return { ok: true };
    const binary = (CHROME_CANDIDATES[process.platform] ?? CHROME_CANDIDATES.linux).find((candidate) => {
      if (candidate.includes("/") || candidate.includes("\\")) return existsSync(candidate);
      return true; // PATH lookup binaries are tried unconditionally
    });
    if (!binary) return { ok: false, error: "no Chrome-family browser found" };
    this.launching = true;
    try {
      const args = [`--remote-debugging-port=${CDP_PORT}`, "--no-first-run", "--no-default-browser-check"];
      if (url) args.push(url);
      const child = execFile(binary, args, { windowsHide: true }, () => undefined);
      child.unref();
      /* wait for the devtools endpoint to come up */
      for (let i = 0; i < 30; i += 1) {
        await new Promise((done) => setTimeout(done, 400));
        if ((await this.discover()).length) return { ok: true };
      }
      return { ok: false, error: "browser started but the debug endpoint never answered" };
    } finally {
      this.launching = false;
    }
  }

  async targets(): Promise<CdpTarget[]> {
    return this.discover();
  }

  private async connect(targetId?: string): Promise<CdpPage> {
    if (this.page && (!targetId || this.page.targetId === targetId)) return this.page;
    this.detach();
    const list = await this.discover();
    const target = targetId ? list.find((item) => item.id === targetId) : list[0];
    if (!target) throw new Error("No debuggable browser tab — launch Chrome with takeover enabled first.");
    const ws = new WebSocket(`ws://127.0.0.1:${CDP_PORT}/devtools/page/${target.id}`);
    const page: CdpPage = { ws, seq: 0, pending: new Map(), targetId: target.id };
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", () => reject(new Error("DevTools socket refused")), { once: true });
    });
    ws.addEventListener("message", (raw) => {
      try {
        const packet = JSON.parse(String(raw.data)) as { id?: number; result?: unknown; error?: { message?: string } };
        if (packet.id === undefined) return;
        const slot = page.pending.get(packet.id);
        if (!slot) return;
        page.pending.delete(packet.id);
        if (packet.error) slot.reject(new Error(packet.error.message ?? "CDP error"));
        else slot.resolve(packet.result);
      } catch {
        /* a malformed frame kills nothing */
      }
    });
    ws.addEventListener("close", () => {
      if (this.page === page) this.page = null;
    });
    this.page = page;
    return page;
  }

  private async send(method: string, params: Record<string, unknown> = {}, targetId?: string): Promise<unknown> {
    const page = await this.connect(targetId);
    const id = ++page.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        page.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, 15_000);
      page.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      page.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async navigate(url: string, targetId?: string): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.send("Page.enable", {}, targetId);
      await this.send("Page.navigate", { url }, targetId);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Evaluate JS in the live page — the agent's eyes and hands on the real browser. */
  async evaluate(expression: string, targetId?: string): Promise<{ ok: boolean; value?: unknown; error?: string }> {
    try {
      const result = (await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, targetId)) as {
        result?: { value?: unknown };
        exceptionDetails?: { text?: string };
      };
      if (result.exceptionDetails) return { ok: false, error: result.exceptionDetails.text ?? "evaluation threw" };
      return { ok: true, value: result.result?.value };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async screenshot(targetId?: string): Promise<{ ok: boolean; data?: string; error?: string }> {
    try {
      await this.send("Page.enable", {}, targetId);
      const shot = (await this.send("Page.captureScreenshot", { format: "jpeg", quality: 70 }, targetId)) as { data?: string };
      return shot.data ? { ok: true, data: shot.data } : { ok: false, error: "empty capture" };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  detach(): void {
    try { this.page?.ws.close(); } catch { /* ignore */ }
    this.page = null;
  }
}
