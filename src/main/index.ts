import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PiHost } from "./pi-host";
import { BrowserHost } from "./browser";
import { listDir, readFileForView } from "./fs-browser";
import { listOpeners, openWith } from "./openers";
import { applyCatalog, catalog, markOnboardingDone, readConfig } from "./install";
import type { UiAnswer } from "@shared/ui";
import { collectUsage } from "./usage";
import type { ModelEdit, PluginInfo, PromptPayload, RuntimeSettings } from "@shared/types";
import type { BrowserBounds, DesignPick } from "@shared/browser";

app.setName("Pi Agent Desktop");

function defaultCwd(): string {
  const stored = process.env.PI_DESKTOP_CWD;
  if (stored && existsSync(stored)) return stored;
  const projects = "F:/Projects";
  if (existsSync(projects)) return projects;
  return process.cwd();
}

let host: PiHost | null = null;
let window: BrowserWindow | null = null;
let browser: BrowserHost | null = null;
/** picks collected in design mode, drained by the renderer */
const designPicks: DesignPick[] = [];

function sendHostUpdate(): void {
  if (!window || !host) return;
  window.webContents.send("pi:update", {
    state: host.snapshot(),
    messages: host.messages(),
    tools: host.toolActivity(),
  });
}

function reportError(error: unknown): void {
  if (!window) return;
  window.webContents.send("pi:update", {
    state: {
      ...(host?.snapshot() ?? {
        cwd: defaultCwd(),
        connected: false,
        sessions: [],
        models: [],
        providers: [],
        commands: [],
        settings: null,
        snapshot: null,
        todos: [],
        tools: [],
        queue: { steering: [], followUp: [], steeringMode: "one-at-a-time", followUpMode: "one-at-a-time" },
      }),
      error: error instanceof Error ? error.message : String(error),
    },
    messages: host?.messages() ?? [],
    tools: host?.toolActivity() ?? [],
  });
}

async function createWindow(): Promise<void> {
  window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: "#FAFAFB",
    title: "Pi Agent Desktop",
    frame: false,
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 16, y: 12 },
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    await window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await window.loadFile(join(__dirname, "../renderer/index.html"));
  }

  window.on("closed", () => {
    window = null;
  });

  // Surface renderer failures in the main log — a blank window otherwise says
  // nothing about why.
  window.webContents.on("console-message", (...args: unknown[]) => {
    const first = args[0] as { message?: string; level?: string | number } | undefined;
    const message = typeof first?.message === "string" ? first.message : String(args[2] ?? "");
    const Level = typeof first?.level === "string" ? first.level : String(args[1] ?? "");
    if (!message) return;
    console.log(`[renderer:${Level}] ${message}`);
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    console.error("[renderer] process gone:", details.reason, details.exitCode);
  });
  window.webContents.on("did-fail-load", (_event, code, description, url) => {
    console.error(`[renderer] failed to load ${url}: ${description} (${code})`);
  });
  window.webContents.on("preload-error", (_event, preloadPath, error) => {
    console.error("[renderer] preload error", preloadPath, error);
  });
}

function registerIpc(): void {
  ipcMain.handle("window:minimize", () => window?.minimize());
  ipcMain.handle("window:maximize", () => {
    if (!window) return;
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
  });
  ipcMain.handle("window:close", () => window?.close());

  ipcMain.handle("pi:getState", () => {
    if (!host) {
      return {
        state: {
          cwd: defaultCwd(),
          connected: false,
          sessions: [],
          models: [],
          providers: [],
          commands: [],
          settings: null,
          snapshot: null,
          todos: [],
          tools: [],
          queue: { steering: [], followUp: [], steeringMode: "one-at-a-time", followUpMode: "one-at-a-time" },
        },
        messages: [],
        tools: [],
      };
    }
    return { state: host.snapshot(), messages: host.messages(), tools: host.toolActivity() };
  });

  ipcMain.handle("pi:prompt", async (_event, payload: PromptPayload) => {
    try {
      await host?.prompt(payload);
    } catch (error) {
      reportError(error);
      throw error;
    }
  });

  ipcMain.handle("pi:abort", async () => {
    await host?.abort();
  });

  ipcMain.handle("pi:newSession", async () => {
    await host?.newSession();
  });

  ipcMain.handle("pi:switchSession", async (_event, path: string) => {
    await host?.switchSession(path);
  });

  /** Switch the active project folder. `pickCwd` opens a dialog; this one takes
   *  a path, which is what the sidebar's workspace list needs. */
  ipcMain.handle("pi:setCwd", async (_event, cwd: string) => {
    await host?.setCwd(cwd);
  });

  ipcMain.handle("pi:setModel", async (_event, provider: string, modelId: string) => {
    try {
      await host?.setModel(provider, modelId);
    } catch (error) {
      reportError(error);
      throw error;
    }
  });

  ipcMain.handle("pi:setThinking", async (_event, level: string) => {
    await host?.setThinkingLevel(level);
  });

  ipcMain.handle("pi:setName", async (_event, name: string) => {
    await host?.setSessionName(name);
  });

  ipcMain.handle("pi:reload", async () => {
    await host?.reload();
  });

  ipcMain.handle("pi:updateSettings", async (_event, patch: Partial<RuntimeSettings>) => {
    try {
      await host?.updateSettings(patch);
    } catch (error) {
      reportError(error);
      throw error;
    }
  });

  ipcMain.handle("pi:saveModel", async (_event, edit: ModelEdit) => {
    try {
      await host?.saveModelEdit(edit);
    } catch (error) {
      reportError(error);
      throw error;
    }
  });

  ipcMain.handle("pi:deleteModel", async (_event, provider: string, modelId: string) => {
    await host?.deleteModel(provider, modelId);
  });

  ipcMain.handle("pi:listAllSessions", async () => (await host?.allSessions()) ?? []);
  ipcMain.handle("pi:deleteWorkspace", async (_event, cwd: string) => {
    await host?.deleteWorkspace(cwd);
  });

  /** Sizes of what is filling the context window, for the model menu. */
  ipcMain.handle("pi:contextBreakdown", () => host?.contextBreakdown() ?? { parts: [], used: null, contextWindow: 0, percent: null });

  ipcMain.handle("pi:queue", () => host?.queueState() ?? { steering: [], followUp: [], steeringMode: "one-at-a-time", followUpMode: "one-at-a-time" });
  ipcMain.handle("pi:steer", async (_event, text: string) => host?.steer(text));
  ipcMain.handle("pi:followUp", async (_event, text: string) => host?.followUp(text));
  ipcMain.handle("pi:clearQueue", () => host?.clearQueue());
  ipcMain.handle("pi:removeQueued", async (_event, kind: "steering" | "followUp", index: number) =>
    host?.removeQueued(kind, index),
  );
  ipcMain.handle("pi:queueMode", (_event, kind: "steering" | "followUp", mode: "all" | "one-at-a-time") =>
    host?.setQueueMode(kind, mode),
  );

  ipcMain.handle("pi:forkTargets", () => host?.forkTargets() ?? []);

  ipcMain.handle("pi:forkAt", async (_event, index: number) => {
    try {
      return (await host?.forkAt(index)) ?? { cancelled: true };
    } catch (error) {
      reportError(error);
      throw error;
    }
  });

  ipcMain.handle("ui:respond", (_event, answer: UiAnswer) => {
    host?.ui.answer(answer);
  });

  ipcMain.handle("desktop:getConfig", () => readConfig());
  ipcMain.handle("desktop:catalog", () => catalog());
  ipcMain.handle("desktop:applyCatalog", async (_event, ids: string[]) => {
    const result = await applyCatalog(ids);
    // capabilities are registered at session build time
    await host?.reload();
    return result;
  });
  ipcMain.handle("desktop:finishOnboarding", async () => {
    const config = await markOnboardingDone();
    await host?.reload();
    return config;
  });

  ipcMain.handle("pi:getPlugins", (): PluginInfo[] => host?.plugins() ?? []);

  ipcMain.handle("pi:setPluginEnabled", async (_event, path: string, kind: PluginInfo["kind"], enabled: boolean) => {
    try {
      return (await host?.setPluginEnabled(path, kind, enabled)) ?? [];
    } catch (error) {
      reportError(error);
      throw error;
    }
  });

  ipcMain.handle("pi:deletePlugin", async (_event, path: string, kind: PluginInfo["kind"]) => {
    try {
      return (await host?.deletePlugin(path, kind)) ?? [];
    } catch (error) {
      reportError(error);
      throw error;
    }
  });

  ipcMain.handle("pi:getUsage", async (_event, days: number) => {
    try {
      return await collectUsage({ days });
    } catch (error) {
      reportError(error);
      throw error;
    }
  });

  ipcMain.handle("pi:pickCwd", async () => {
    const result = await dialog.showOpenDialog({
      title: "Open project folder",
      defaultPath: host?.getCwd() ?? homedir(),
      properties: ["openDirectory"],
    });
    const next = result.filePaths[0];
    if (!next) return host?.getCwd();
    await host?.setCwd(next);
    return next;
  });

  ipcMain.handle("pi:openPath", async (_event, target: string) => {
    await shell.openPath(target);
  });

  /* ── workspace panels: file browser + terminal ─────────── */

  ipcMain.handle("fs:list", async (_event, dirPath: string, showAll: boolean) => {
    const root = host?.getCwd() ?? defaultCwd();
    return listDir(root, dirPath || root, showAll);
  });

  ipcMain.handle("fs:read", async (_event, filePath: string) => {
    const root = host?.getCwd() ?? defaultCwd();
    return readFileForView(root, filePath);
  });

  ipcMain.handle("fs:reveal", async (_event, filePath: string) => {
    shell.showItemInFolder(filePath);
  });

  /* ── "Open with": the applications registered for this file type ── */

  ipcMain.handle("fs:openers", async (_event, filePath: string) => {
    try {
      return await listOpeners(filePath);
    } catch (error) {
      reportError(error);
      return [];
    }
  });

  ipcMain.handle("fs:openWith", async (_event, filePath: string, openerId: string) => {
    try {
      return await openWith(filePath, openerId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: message };
    }
  });

  ipcMain.handle("term:run", async (_event, command: string) => {
    if (!host) throw new Error("Pi agent is not connected yet.");
    return host.runBash(command, (delta) => {
      window?.webContents.send("term:chunk", { runId: "live", delta });
    });
  });

  ipcMain.handle("term:abort", () => {
    host?.abortBash();
  });

  ipcMain.handle("term:state", () => host?.bashState() ?? { running: false });

  /* ── embedded browser ─────────────────────────────────── */

  ipcMain.handle("browser:setBounds", (_event, bounds: BrowserBounds) => {
    browser?.setBounds(bounds);
  });

  ipcMain.handle("browser:setVisible", (_event, visible: boolean) => {
    browser?.setVisible(visible);
  });

  ipcMain.handle("browser:navigate", async (_event, url: string) => {
    await browser?.navigate(url);
  });

  ipcMain.handle("browser:back", () => browser?.back());
  ipcMain.handle("browser:forward", () => browser?.forward());
  ipcMain.handle("browser:reload", () => browser?.reload());
  ipcMain.handle("browser:stop", () => browser?.stop());
  ipcMain.handle("browser:devtools", () => browser?.toggleDevTools());

  ipcMain.handle("browser:design", async (_event, on: boolean) => {
    if (on) await browser?.startDesign();
    else browser?.stopDesign();
  });

  ipcMain.handle("browser:picks", () => designPicks.splice(0, designPicks.length));

  ipcMain.handle("browser:evaluate", async (_event, script: string) => browser?.evaluate(script));

  ipcMain.handle("pi:showItem", async (_event, target: string) => {
    shell.showItemInFolder(target);
  });
}

app.whenReady().then(async () => {
  registerIpc();
  browser = new BrowserHost(
    () => window,
    (state) => window?.webContents.send("browser:state", state),
    (pick) => {
      if (!pick) return;
      designPicks.push(pick);
      window?.webContents.send("browser:pick", pick);
    },
  );

  // Diagnostic probe: run the usage scanner without opening a window.
  //   PI_DESKTOP_USAGE_PROBE=1 npx electron .
  if (process.env.PI_DESKTOP_USAGE_PROBE) {
    const days = Number(process.env.PI_DESKTOP_USAGE_PROBE) || 0;
    const stats = await collectUsage({ days });
    console.log(
      `[pi-desktop] usage probe days=${days || "all"} files=${stats.scannedFiles} sessions=${stats.sessionCount} tokens=${stats.totals.total} cacheRead=${stats.totals.cacheRead} cacheWrite=${stats.totals.cacheWrite} hitRate=${(stats.cache.hitRate * 100).toFixed(1)}% models=${stats.models.length} channels=${stats.providers.length} buckets=${stats.buckets.length} days=${stats.days.length}`,
    );
    for (const row of stats.cacheByChannel.slice(0, 5)) {
      console.log(
        `  ${row.provider}/${row.model} calls=${row.calls} tokens=${row.tokens} cacheRead=${row.cacheRead} hit=${(row.cacheHitRate * 100).toFixed(1)}%`,
      );
    }
    app.quit();
    return;
  }
  host = new PiHost(defaultCwd(), () => browser);
  host.onChange((payload) => {
    window?.webContents.send("pi:update", payload);
  });
  await createWindow();
  try {
    await host.start();
    const snapshot = host.snapshot();
    const toolNames = host.toolNames();
    const browserTools = toolNames.filter((name) => name.startsWith("browser_"));
    console.log(
      `[pi-desktop] connected cwd=${snapshot.cwd} sessions=${snapshot.sessions.length} models=${snapshot.models.length} providers=${snapshot.providers.length} plugins=${host.plugins().length}`,
    );
    console.log(`[pi-desktop] browser tools: ${browserTools.join(", ") || "(none)"}`);
    console.log(`[pi-desktop] todo tools: ${toolNames.filter((n) => n.startsWith("todo_")).join(", ") || "(none)"}`);
    sendHostUpdate();
  } catch (error) {
    console.error("[pi-desktop] failed to start host:", error);
    reportError(error);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  browser?.destroy();
  void host?.dispose();
});
