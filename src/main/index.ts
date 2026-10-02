import { app, BrowserWindow, dialog, ipcMain, nativeTheme, Notification, shell } from "electron";
import { existsSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { PiHost } from "./pi-host";
import { BrowserHost } from "./browser";
import { PtyHost } from "./pty";
import { listDir, readFileForView, searchFiles } from "./fs-browser";
import { listOpeners, openWith } from "./openers";
import { gitBranches, gitCheckout, gitCommit, gitCreateBranch, gitDeleteBranch, gitPush, gitStatus, noRepoBranches, noRepoState } from "./git";
import { applyCatalog, bundledExtensionName, catalog, markOnboardingDone, readConfig, syncBundledExtensions, writeConfig } from "./install";
import { discoverTerminalShells, resolveTerminalShell } from "./shells";
import { pluginRoots } from "./plugins";
import type { UiAnswer } from "@shared/ui";
import { collectUsage } from "./usage";
import type { ChannelEdit, ModelEdit, PlanAction, PluginInfo, PluginRoots, PromptPayload, RuntimeSettings } from "@shared/types";
import type { BrowserBounds, DesignPick } from "@shared/browser";

app.setName("Pi Agent Desktop");

const IS_MAC = process.platform === "darwin";

function defaultCwd(): string {
  const stored = process.env.PI_DESKTOP_CWD;
  if (stored && existsSync(stored)) return stored;
  // Each platform's developer keeps projects under a different root, and neither
  // guess exists on the other — the probe is what makes one binary behave on both.
  const projects = IS_MAC ? join(homedir(), "Projects") : "F:/Projects";
  if (existsSync(projects)) return projects;
  return process.cwd();
}

let host: PiHost | null = null;
let window: BrowserWindow | null = null;
let browser: BrowserHost | null = null;
/** picks collected in design mode, drained by the renderer */
const designPicks: DesignPick[] = [];

/** every project folder's shells; they outlive the panel showing them */
const ptyHost = new PtyHost(
  (id, data) => window?.webContents.send("pty:data", { id, data }),
  (id, exitCode) => window?.webContents.send("pty:exit", { id, exitCode }),
);

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
        homeDir: homedir(),
        connected: false,
        sessions: [],
        models: [],
        providers: [],
        channels: [],
        commands: [],
        settings: null,
        snapshot: null,
        todos: [],
        plan: { phase: "off", steps: [], updatedAt: 0 },
        surfaces: [],
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
  /* show:false + ready-to-show is the difference between a white flash and a
   * window that appears already painted; the background follows the OS theme
   * so dark-mode users do not get a light frame before first paint */
  const dark = nativeTheme.shouldUseDarkColors;
  window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    backgroundColor: dark ? "#16181c" : "#FAFAFB",
    title: "Pi Agent Desktop",
    // `frame: false` on macOS drops the traffic lights along with the title bar,
    // and trafficLightPosition is then ignored — the native frame stays and only
    // the title bar is hidden, so the renderer's drag region takes its place.
    frame: !IS_MAC,
    titleBarStyle: "hidden",
    /* the lights are ~12px tall and the renderer's title bar is 40px, so y=14
     * puts them on the bar's centre line instead of floating at its top edge */
    trafficLightPosition: { x: 20, y: 14 },
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  window.once("ready-to-show", () => window?.show());

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
          homeDir: homedir(),
          connected: false,
          sessions: [],
          models: [],
          providers: [],
          channels: [],
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

  /* Plan mode — the plugin's subcommands, plus the model the build runs on */
  ipcMain.handle("pi:planAction", async (_event, payload: PlanAction) => {
    try {
      await host?.planAction(payload);
    } catch (error) {
      reportError(error);
      throw error;
    }
  });

  ipcMain.handle("pi:reload", async () => {
    await host?.reload();
  });

  /* Fleet interrupts from the panel — one sub-agent by name, or all */
  ipcMain.handle("pi:fleetInterrupt", (_event, name?: string) => {
    host?.fleetInterrupt(name);
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
    try {
      await host?.deleteModel(provider, modelId);
    } catch (error) {
      reportError(error);
      throw error;
    }
  });

  /* ── channels: one endpoint, one provider entry per key ───────────────── */

  ipcMain.handle("pi:createChannel", async (_event, edit: ChannelEdit) => {
    try {
      return (await host?.createChannel(edit)) ?? [];
    } catch (error) {
      reportError(error);
      throw error;
    }
  });

  ipcMain.handle("pi:removeChannel", async (_event, channelId: string) => {
    try {
      await host?.removeChannel(channelId);
    } catch (error) {
      reportError(error);
      throw error;
    }
  });

  ipcMain.handle("pi:addChannelKey", async (_event, channelId: string, key: string) => {
    try {
      return (await host?.addKeyToChannel(channelId, key)) ?? undefined;
    } catch (error) {
      reportError(error);
      throw error;
    }
  });

  ipcMain.handle("pi:removeChannelKey", async (_event, providerId: string) => {
    try {
      await host?.removeKeyFromChannel(providerId);
    } catch (error) {
      reportError(error);
      throw error;
    }
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

  ipcMain.handle("pi:forkAt", async (_event, index: number) => {
    try {
      return (await host?.forkAt(index)) ?? { cancelled: true };
    } catch (error) {
      reportError(error);
      throw error;
    }
  });

  ipcMain.handle("pi:rewindTo", async (_event, index: number) => {
    try {
      return (await host?.rewindTo(index)) ?? { text: "", cancelled: true };
    } catch (error) {
      reportError(error);
      throw error;
    }
  });

  ipcMain.handle("ui:respond", (_event, answer: UiAnswer) => {
    host?.ui.answer(answer);
  });

  /* The account row needs a name on day one, before any onboarding ran — the
   * OS user is the honest default, and onboarding may replace it. */
  ipcMain.handle("desktop:getConfig", async () => {
    const config = await readConfig();
    if (config.userName) return config;
    try {
      return { ...config, userName: userInfo().username };
    } catch {
      return config;
    }
  });
  ipcMain.handle("desktop:setUserName", (_event, name: string) =>
    writeConfig({ userName: String(name ?? "") }),
  );
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

  /** the folders extensions are loaded from, for the 钩子 settings section */
  ipcMain.handle("pi:pluginRoots", (): PluginRoots => pluginRoots(host?.getCwd() ?? defaultCwd()));

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
      const result = (await host?.deletePlugin(path, kind)) ?? [];
      // A deleted bundled extension is a decision, not an accident — record it
      // so the startup sync does not reinstall it behind the user's back.
      const bundled = bundledExtensionName(path);
      if (bundled) {
        const config = await readConfig();
        const removed = config.removedBundledExtensions ?? [];
        if (!removed.includes(bundled)) {
          await writeConfig({ removedBundledExtensions: [...removed, bundled] });
        }
      }
      return result;
    } catch (error) {
      reportError(error);
      throw error;
    }
  });

  ipcMain.handle("pi:createRule", async (_event, scope: "global" | "project", name: string) => {
    try {
      return (await host?.createRule(scope, name)) ?? [];
    } catch (error) {
      reportError(error);
      throw error;
    }
  });

  ipcMain.handle("pi:savePasteImage", async (_event, dataUrl: string, extension?: string) => {
    if (!host) throw new Error("Agent not started.");
    return host.savePasteImage(dataUrl, extension);
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
    if (!next) return undefined;
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

  ipcMain.handle("fs:search", async () => {
    const root = host?.getCwd() ?? defaultCwd();
    return searchFiles(root);
  });

  ipcMain.handle("fs:read", async (_event, filePath: string) => {
    const root = host?.getCwd() ?? defaultCwd();
    return readFileForView(root, filePath);
  });

  ipcMain.handle("fs:reveal", async (_event, filePath: string) => {
    const root = host?.getCwd() ?? defaultCwd();
    /* a diff opened from the changes list carries the path the tool call used,
       which is relative; anything else here is already absolute */
    shell.showItemInFolder(isAbsolute(filePath) ? filePath : resolve(root, filePath));
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

  /* ── git: the monitor panel's environment, argv in and out (no shell) ──
   * The cwd is resolved here rather than sent by the renderer, so the renderer
   * cannot ask for someone else's repository. */

  const gitCwd = (): string => host?.getCwd() ?? defaultCwd();

  ipcMain.handle("git:status", async () => {
    try {
      return await gitStatus(gitCwd());
    } catch {
      return noRepoState();
    }
  });

  ipcMain.handle("git:branches", async () => {
    try {
      return await gitBranches(gitCwd());
    } catch {
      return noRepoBranches();
    }
  });

  ipcMain.handle("git:checkout", (_event, name: string) => gitCheckout(gitCwd(), name));
  ipcMain.handle("git:createBranch", (_event, name: string) => gitCreateBranch(gitCwd(), name));
  ipcMain.handle("git:deleteBranch", (_event, name: string) => gitDeleteBranch(gitCwd(), name));
  ipcMain.handle("git:commit", (_event, message: string) => gitCommit(gitCwd(), message));
  ipcMain.handle("git:push", () => gitPush(gitCwd()));

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

  /* ── real terminals: one PTY per tab, grouped by folder ── */

  /* the shell menu: what this machine actually has, plus how the preference
     resolves right now — probed on demand so a freshly installed WSL distro
     shows up without a restart */
  ipcMain.handle("shells:list", async () => {
    const shells = await discoverTerminalShells();
    const config = await readConfig();
    const resolved = resolveTerminalShell(config.terminal.preferred, config.terminal.customPath, shells);
    const custom = resolveTerminalShell("auto", config.terminal.customPath, []);
    return { shells: custom ? [...shells, custom] : shells, resolvedId: resolved?.id ?? null };
  });

  /* a spawn names its shell: an explicit id from the menu, or nothing for the
     preference chain (custom path → preferred entry → first available) */
  ipcMain.handle("pty:spawn", async (_event, cwd: string, shellId?: string) => {
    const shells = await discoverTerminalShells();
    const config = await readConfig();
    const shell = shellId
      ? (shells.find((entry) => entry.id === shellId && entry.available) ??
        (shellId === "custom" ? resolveTerminalShell("auto", config.terminal.customPath, []) : undefined))
      : resolveTerminalShell(config.terminal.preferred, config.terminal.customPath, shells);
    if (shellId && !shell) return { error: `The selected shell is no longer available: ${shellId}` };
    return ptyHost.spawn(cwd, shell ? { path: shell.path, args: shell.args, name: shell.name } : undefined);
  });

  ipcMain.handle("pty:list", (_event, cwd: string) => ptyHost.list(cwd));

  ipcMain.handle("pty:replay", (_event, id: string) => ptyHost.replay(id));

  /* keystrokes and resizes are one-way: awaiting an acknowledgement for every
     character typed is how a terminal starts to feel laggy */
  ipcMain.on("pty:write", (_event, id: string, data: string) => ptyHost.write(id, data));

  ipcMain.on("pty:resize", (_event, id: string, cols: number, rows: number) => ptyHost.resize(id, cols, rows));

  ipcMain.handle("pty:kill", (_event, id: string) => ptyHost.kill(id));

  /* ── embedded browser ─────────────────────────────────── */

  ipcMain.handle("browser:setBounds", (_event, bounds: BrowserBounds) => {
    browser?.setBounds(bounds);
  });

  ipcMain.handle("browser:setVisible", (_event, visible: boolean) => {
    browser?.setVisible(visible);
  });

  /** Each project folder gets its own browser instance and its own storage. */
  ipcMain.handle("browser:workspace", (_event, cwd: string) => {
    browser?.setWorkspace(cwd);
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

  ipcMain.handle("app:notify", (_event, payload: { title?: string; body?: string }) => {
    if (!Notification.isSupported()) return;
    const window = BrowserWindow.getAllWindows()[0];
    const note = new Notification({
      title: payload?.title ?? "Pi Agent",
      body: payload?.body ?? "",
      silent: true,
    });
    // clicking the toast brings the app back
    note.on("click", () => {
      if (!window) return;
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    });
    note.show();
  });

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
  // Bundled extensions (plan mode, agent team) only ever installed from the
  // onboarding checklist — a machine onboarded before they shipped would never
  // see /plan work. Install what is missing before the runtime loads plugins.
  try {
    const synced = await syncBundledExtensions();
    if (synced.length) console.log(`[pi-desktop] installed bundled extensions: ${synced.join(", ")}`);
  } catch (error) {
    console.error("[pi-desktop] bundled extension sync failed:", error);
  }
  host.onChange((payload) => {
    window?.webContents.send("pi:update", payload);
  });
  await createWindow();
  // pre-create the embedded browser's view once the window is up, so opening
  // the browser dock does not pay for a fresh renderer process
  setTimeout(() => browser?.warm(), 1500);
  try {
    await host.start();
    const snapshot = host.snapshot();
    browser?.setWorkspace(snapshot.cwd);
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
  ptyHost.dispose();
  void host?.dispose();
});
