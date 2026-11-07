import { contextBridge, ipcRenderer, webFrame, webUtils } from "electron";
import type {
  ChannelEdit,
  ChatMessage,
  ContextBreakdown,
  HostState,
  HostSnapshot,
  HostUpdate,
  ModelEdit,
  PlanAction,
  PluginInfo,
  PluginRoots,
  PromptPayload,
  RuntimeSettings,
  UsageStats,
  CatalogItem,
  DesktopConfig,
} from "@shared/types";
import type { DirListing, FileContent, TerminalChunk, TerminalResult } from "@shared/workspace";
import type { AppOpener, GitBranches, GitChanges, GitDiff, GitDiscardFile, GitResult, GitState } from "@shared/workspace";
import type { McpConfigView, McpExposure, McpScope, McpServerConfig } from "@shared/mcp";
import type { PtyData, PtyExit, PtySession, TerminalShell } from "@shared/terminal";
import type { BrowserBounds, BrowserState, DesignPick } from "@shared/browser";
import type { UiAnswer } from "@shared/ui";
import type { WorkspaceInfo, SshProfile, SshProbe, SshConnectInput } from "@shared/workspaces";


export interface PiBridge {
  getState: () => Promise<HostSnapshot>;
  getWorkspace: () => Promise<WorkspaceInfo>;
  listWorkspaces: () => Promise<WorkspaceInfo[]>;
  addWorkspaceFolder: (path?: string) => Promise<WorkspaceInfo>;
  removeWorkspaceFolder: (path: string) => Promise<WorkspaceInfo>;
  renameWorkspace: (name: string) => Promise<WorkspaceInfo>;
  listSsh: () => Promise<SshProfile[]>;
  probeSsh: (host: string, port?: number) => Promise<SshProbe>;
  connectSsh: (input: SshConnectInput) => Promise<WorkspaceInfo>;
  disconnectSsh: (id: string) => Promise<void>;
  removeSsh: (id: string) => Promise<void>;
  pickSshKey: () => Promise<string | undefined>;
  onWorkspaceChange: (listener: () => void) => () => void;
  prompt: (payload: PromptPayload) => Promise<void>;
  abort: () => Promise<void>;
  newSession: () => Promise<void>;
  switchSession: (path: string) => Promise<void>;
  /** switch the active project folder by path */
  setCwd: (cwd: string) => Promise<void>;
  setModel: (provider: string, modelId: string) => Promise<void>;
  setThinking: (level: string) => Promise<void>;
  setName: (name: string) => Promise<void>;
  reload: () => Promise<void>;
  /** interrupt one fleet sub-agent by name, or every running one */
  fleetInterrupt: (name?: string) => Promise<void>;
  /** the session goal (`/goal`) — set a condition, or clear it with null */
  setGoal: (condition: string | null) => Promise<void>;
  /** `/btw`: ask a question on a side session that never enters the transcript */
  asideAsk: (text: string) => Promise<void>;
  asideDismiss: () => Promise<void>;
  /** plan mode: the plugin's subcommands, with the model the build runs on */
  planAction: (payload: PlanAction) => Promise<void>;
  readPlan: () => Promise<FileContent | undefined>;
  updateSettings: (patch: Partial<RuntimeSettings>) => Promise<void>;
  saveModel: (edit: ModelEdit) => Promise<void>;
  deleteModel: (provider: string, modelId: string) => Promise<void>;
  /** one endpoint with one provider entry per key; see ChannelInfo */
  createChannel: (edit: ChannelEdit) => Promise<string[]>;
  removeChannel: (channelId: string) => Promise<void>;
  addChannelKey: (channelId: string, key: string) => Promise<string | undefined>;
  removeChannelKey: (providerId: string) => Promise<void>;
  listAllSessions: () => Promise<HostState["sessions"]>;
  deleteWorkspace: (cwd: string) => Promise<void>;
  setZoomFactor: (factor: number) => void;
  getZoomFactor: () => number;
  steer: (text: string) => Promise<void>;
  followUp: (text: string) => Promise<void>;
  clearQueue: () => Promise<HostState["queue"] & { texts: string[] }>;
  removeQueued: (kind: "steering" | "followUp", index: number) => Promise<void>;
  setQueueMode: (kind: "steering" | "followUp", mode: "all" | "one-at-a-time") => Promise<void>;
  forkAt: (index: number) => Promise<{ cancelled: boolean }>;
  /** step the conversation back to before prompt `index`, and get its text */
  rewindTo: (index: number) => Promise<{ text: string; cancelled: boolean }>;
  respondUi: (answer: UiAnswer) => Promise<void>;
  getDesktopConfig: () => Promise<DesktopConfig>;
  getCatalog: () => Promise<CatalogItem[]>;
  applyCatalog: (ids: string[]) => Promise<{ config: DesktopConfig; installed: string[] }>;
  finishOnboarding: () => Promise<DesktopConfig>;
  /** the account row's name — an empty string clears it back to the OS user */
  setUserName: (name: string) => Promise<DesktopConfig>;
  getPlugins: () => Promise<PluginInfo[]>;
  /** the folders the agent loads extensions / hooks from */
  getPluginRoots: () => Promise<PluginRoots>;
  setPluginEnabled: (path: string, kind: PluginInfo["kind"], enabled: boolean) => Promise<PluginInfo[]>;
  deletePlugin: (path: string, kind: PluginInfo["kind"]) => Promise<PluginInfo[]>;
  /** create a rule stub (global ~/.pi/agent/prompts or project .pi/prompts) and rescan */
  createRule: (scope: "global" | "project", name: string) => Promise<PluginInfo[]>;
  /** the text of one rule / skill / theme file, for the in-app editor */
  readPluginText: (path: string) => Promise<string>;
  /** overwrite that file with the editor's contents */
  writePluginText: (path: string, text: string) => Promise<void>;
  /* MCP servers, from both `mcp.json` files: the agent directory's and the project's */
  getMcpConfig: () => Promise<McpConfigView>;
  /** namespaces whose tools the session registered — i.e. servers that connected */
  getMcpConnected: () => Promise<string[]>;
  mcpFilePath: (scope: McpScope) => Promise<string>;
  writeMcpServer: (scope: McpScope, name: string, config: McpServerConfig) => Promise<McpConfigView>;
  patchMcpServer: (
    scope: McpScope,
    name: string,
    patch: { enabled?: boolean; exposure?: McpExposure },
  ) => Promise<McpConfigView>;
  removeMcpServer: (scope: McpScope, name: string) => Promise<McpConfigView>;
  /** pi's own `/mcp login|logout|reconnect <server>`, run inside the session */
  mcpCommand: (command: "login" | "logout" | "reconnect", name: string) => Promise<void>;
  /** probe a server: initialize POST for http, a real handshake for stdio */
  mcpTest: (scope: McpScope, name: string) => Promise<{ ok: boolean; detail: string }>;
  /** probe a channel's endpoint; the API key never leaves the main process */
  testChannel: (providerId: string) => Promise<{ ok: boolean; latencyMs: number; detail: string }>;
  /** latest release on the public repo versus the running version */
  updateCheck: () => Promise<{ current?: string; latest?: string; newer?: string | null; error?: string }>;
  /** write a sanitized diagnostics bundle to a user-chosen file */
  exportDiagnostics: () => Promise<{ ok: boolean; output?: string; error?: string }>;
  /** persist a pasted image (data URL) into the app's paste dir; returns its path */
  savePasteImage: (dataUrl: string, extension?: string) => Promise<string>;
  /** the absolute path of a File from the clipboard (Electron webUtils) */
  getPathForFile: (file: File) => string;
  getUsage: (days: number) => Promise<UsageStats>;
  /** sizes of what is occupying the context window */
  getContextBreakdown: () => Promise<ContextBreakdown>;
  pickCwd: () => Promise<string | undefined>;
  openPath: (target: string) => Promise<void>;
  showItem: (target: string) => Promise<void>;
  /** OS-level toast — the run finished while you were elsewhere */
  notify: (payload: { title?: string; body?: string }) => Promise<void>;
  listDir: (dirPath: string, showAll: boolean) => Promise<DirListing>;
  /** workspace filenames for the composer's `@` search (bounded walk) */
  searchFiles: () => Promise<{ path: string; modified: number }[]>;
  readFile: (filePath: string) => Promise<FileContent>;
  revealFile: (filePath: string) => Promise<void>;
  /** applications the OS has registered for this file type */
  listOpeners: (filePath: string) => Promise<AppOpener[]>;
  openWith: (filePath: string, openerId: string) => Promise<{ ok: boolean; error?: string }>;
  /* git, for the monitor's environment rows — always the workspace folder */
  gitStatus: () => Promise<GitState>;
  gitBranches: () => Promise<GitBranches>;
  gitCheckout: (name: string) => Promise<GitResult>;
  gitCreateBranch: (name: string) => Promise<GitResult>;
  gitDeleteBranch: (name: string) => Promise<GitResult>;
  gitCommit: (message: string, paths?: string[]) => Promise<GitResult>;
  gitPush: () => Promise<GitResult>;
  /* the source-control panel: file rows, patches, staging verbs */
  gitChanges: () => Promise<GitChanges>;
  gitDiff: (path: string, flags?: { staged?: boolean; untracked?: boolean }) => Promise<GitDiff>;
  gitStage: (paths: string[]) => Promise<GitResult>;
  gitUnstage: (paths: string[]) => Promise<GitResult>;
  gitDiscard: (files: GitDiscardFile[]) => Promise<GitResult>;
  runBash: (command: string) => Promise<TerminalResult>;
  abortBash: () => Promise<void>;
  bashState: () => Promise<{ running: boolean }>;
  onTerminalChunk: (listener: (chunk: TerminalChunk) => void) => () => void;
  /* real terminals — one PTY per tab, owned by the folder that opened it */
  listPtySessions: (cwd: string) => Promise<PtySession[]>;
  /** the shells this machine offers, plus which id the preference resolves to */
  listShells: () => Promise<{ shells: TerminalShell[]; resolvedId: string | null }>;
  /** returns the new session, or `{ error }` when the shell could not start;
   *  shellId omitted = the preference chain, "custom" = the custom path */
  spawnPty: (cwd: string, shellId?: string) => Promise<PtySession | { error: string }>;
  /** output already produced, so a remounted panel catches up */
  replayPty: (id: string) => Promise<string>;
  writePty: (id: string, data: string) => void;
  resizePty: (id: string, cols: number, rows: number) => void;
  killPty: (id: string) => Promise<void>;
  onPtyData: (listener: (payload: PtyData) => void) => () => void;
  onPtyExit: (listener: (payload: PtyExit) => void) => () => void;
  setBrowserBounds: (bounds: BrowserBounds) => Promise<void>;
  setBrowserVisible: (visible: boolean) => Promise<void>;
  /** switch the embedded browser to another project folder's own session */
  setBrowserWorkspace: (cwd: string) => Promise<void>;
  navigateBrowser: (url: string) => Promise<void>;
  browserBack: () => Promise<void>;
  browserForward: () => Promise<void>;
  browserReload: () => Promise<void>;
  browserStop: () => Promise<void>;
  toggleDevTools: () => Promise<void>;
  setDesignMode: (on: boolean) => Promise<void>;
  takeDesignPicks: () => Promise<DesignPick[]>;
  onBrowserState: (listener: (state: BrowserState) => void) => () => void;
  onBrowserPick: (listener: (pick: DesignPick) => void) => () => void;
  minimize: () => Promise<void>;
  maximize: () => Promise<void>;
  close: () => Promise<void>;
  onUpdate: (listener: (payload: HostUpdate) => void) => () => void;
}

const api: PiBridge = {
  getState: () => ipcRenderer.invoke("pi:getState"),
  getWorkspace: () => ipcRenderer.invoke("workspace:get"),
  listWorkspaces: () => ipcRenderer.invoke("workspace:list"),
  addWorkspaceFolder: (path) => ipcRenderer.invoke("workspace:addFolder", path),
  removeWorkspaceFolder: (path) => ipcRenderer.invoke("workspace:removeFolder", path),
  renameWorkspace: (name) => ipcRenderer.invoke("workspace:rename", name),
  listSsh: () => ipcRenderer.invoke("ssh:list"),
  probeSsh: (host, port) => ipcRenderer.invoke("ssh:probe", host, port),
  connectSsh: (input) => ipcRenderer.invoke("ssh:connect", input),
  disconnectSsh: (id) => ipcRenderer.invoke("ssh:disconnect", id),
  removeSsh: (id) => ipcRenderer.invoke("ssh:remove", id),
  pickSshKey: () => ipcRenderer.invoke("ssh:pickKey"),
  onWorkspaceChange: (listener) => { const handler = () => listener(); ipcRenderer.on("workspace:changed", handler); return () => ipcRenderer.removeListener("workspace:changed", handler); },
  prompt: (payload) => ipcRenderer.invoke("pi:prompt", payload),
  abort: () => ipcRenderer.invoke("pi:abort"),
  newSession: () => ipcRenderer.invoke("pi:newSession"),
  switchSession: (path) => ipcRenderer.invoke("pi:switchSession", path),
  setCwd: (cwd) => ipcRenderer.invoke("pi:setCwd", cwd),
  setModel: (provider, modelId) => ipcRenderer.invoke("pi:setModel", provider, modelId),
  setThinking: (level) => ipcRenderer.invoke("pi:setThinking", level),
  setName: (name) => ipcRenderer.invoke("pi:setName", name),
  reload: () => ipcRenderer.invoke("pi:reload"),
  fleetInterrupt: (name) => ipcRenderer.invoke("pi:fleetInterrupt", name),
  setGoal: (condition) => ipcRenderer.invoke("pi:setGoal", condition),
  asideAsk: (text) => ipcRenderer.invoke("pi:asideAsk", text),
  asideDismiss: () => ipcRenderer.invoke("pi:asideDismiss"),
  planAction: (payload) => ipcRenderer.invoke("pi:planAction", payload),
  readPlan: () => ipcRenderer.invoke("plan:read"),
  updateSettings: (patch) => ipcRenderer.invoke("pi:updateSettings", patch),
  saveModel: (edit) => ipcRenderer.invoke("pi:saveModel", edit),
  deleteModel: (provider, modelId) => ipcRenderer.invoke("pi:deleteModel", provider, modelId),
  createChannel: (edit) => ipcRenderer.invoke("pi:createChannel", edit),
  removeChannel: (channelId) => ipcRenderer.invoke("pi:removeChannel", channelId),
  addChannelKey: (channelId, key) => ipcRenderer.invoke("pi:addChannelKey", channelId, key),
  removeChannelKey: (providerId) => ipcRenderer.invoke("pi:removeChannelKey", providerId),
  listAllSessions: () => ipcRenderer.invoke("pi:listAllSessions"),
  deleteWorkspace: (cwd) => ipcRenderer.invoke("pi:deleteWorkspace", cwd),
  setZoomFactor: (factor) => webFrame.setZoomFactor(factor),
  getZoomFactor: () => webFrame.getZoomFactor(),
  steer: (text) => ipcRenderer.invoke("pi:steer", text),
  followUp: (text) => ipcRenderer.invoke("pi:followUp", text),
  clearQueue: () => ipcRenderer.invoke("pi:clearQueue"),
  removeQueued: (kind, index) => ipcRenderer.invoke("pi:removeQueued", kind, index),
  setQueueMode: (kind, mode) => ipcRenderer.invoke("pi:queueMode", kind, mode),
  forkAt: (index) => ipcRenderer.invoke("pi:forkAt", index),
  rewindTo: (index) => ipcRenderer.invoke("pi:rewindTo", index),
  respondUi: (answer) => ipcRenderer.invoke("ui:respond", answer),
  getDesktopConfig: () => ipcRenderer.invoke("desktop:getConfig"),
  getCatalog: () => ipcRenderer.invoke("desktop:catalog"),
  applyCatalog: (ids) => ipcRenderer.invoke("desktop:applyCatalog", ids),
  finishOnboarding: () => ipcRenderer.invoke("desktop:finishOnboarding"),
  setUserName: (name) => ipcRenderer.invoke("desktop:setUserName", name),
  getPlugins: () => ipcRenderer.invoke("pi:getPlugins"),
  getPluginRoots: () => ipcRenderer.invoke("pi:pluginRoots"),
  setPluginEnabled: (path, kind, enabled) => ipcRenderer.invoke("pi:setPluginEnabled", path, kind, enabled),
  deletePlugin: (path, kind) => ipcRenderer.invoke("pi:deletePlugin", path, kind),
  createRule: (scope, name) => ipcRenderer.invoke("pi:createRule", scope, name),
  readPluginText: (path) => ipcRenderer.invoke("pi:readPluginText", path),
  writePluginText: (path, text) => ipcRenderer.invoke("pi:writePluginText", path, text),
  getMcpConfig: () => ipcRenderer.invoke("pi:mcpConfig"),
  getMcpConnected: () => ipcRenderer.invoke("pi:mcpConnected"),
  mcpFilePath: (scope) => ipcRenderer.invoke("pi:mcpFilePath", scope),
  writeMcpServer: (scope, name, config) => ipcRenderer.invoke("pi:writeMcpServer", scope, name, config),
  patchMcpServer: (scope, name, patch) => ipcRenderer.invoke("pi:patchMcpServer", scope, name, patch),
  removeMcpServer: (scope, name) => ipcRenderer.invoke("pi:removeMcpServer", scope, name),
  mcpCommand: (command, name) => ipcRenderer.invoke("pi:mcpCommand", command, name),
  mcpTest: (scope, name) => ipcRenderer.invoke("pi:mcpTest", scope, name),
  testChannel: (providerId) => ipcRenderer.invoke("pi:testChannel", providerId),
  updateCheck: () => ipcRenderer.invoke("pi:updateCheck"),
  exportDiagnostics: () => ipcRenderer.invoke("pi:diagnostics"),
  savePasteImage: (dataUrl, extension) => ipcRenderer.invoke("pi:savePasteImage", dataUrl, extension),
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return "";
    }
  },
  getUsage: (days) => ipcRenderer.invoke("pi:getUsage", days),
  getContextBreakdown: () => ipcRenderer.invoke("pi:contextBreakdown"),
  pickCwd: () => ipcRenderer.invoke("pi:pickCwd"),
  openPath: (target) => ipcRenderer.invoke("pi:openPath", target),
  showItem: (target) => ipcRenderer.invoke("pi:showItem", target),
  notify: (payload) => ipcRenderer.invoke("app:notify", payload),
  listDir: (dirPath, showAll) => ipcRenderer.invoke("fs:list", dirPath, showAll),
  searchFiles: () => ipcRenderer.invoke("fs:search"),
  readFile: (filePath) => ipcRenderer.invoke("fs:read", filePath),
  revealFile: (filePath) => ipcRenderer.invoke("fs:reveal", filePath),
  listOpeners: (filePath) => ipcRenderer.invoke("fs:openers", filePath),
  openWith: (filePath, openerId) => ipcRenderer.invoke("fs:openWith", filePath, openerId),
  gitStatus: () => ipcRenderer.invoke("git:status"),
  gitBranches: () => ipcRenderer.invoke("git:branches"),
  gitCheckout: (name) => ipcRenderer.invoke("git:checkout", name),
  gitCreateBranch: (name) => ipcRenderer.invoke("git:createBranch", name),
  gitDeleteBranch: (name) => ipcRenderer.invoke("git:deleteBranch", name),
  gitCommit: (message, paths) => ipcRenderer.invoke("git:commit", message, paths),
  gitPush: () => ipcRenderer.invoke("git:push"),
  gitChanges: () => ipcRenderer.invoke("git:changes"),
  gitDiff: (path, flags) => ipcRenderer.invoke("git:diff", path, flags),
  gitStage: (paths) => ipcRenderer.invoke("git:stage", paths),
  gitUnstage: (paths) => ipcRenderer.invoke("git:unstage", paths),
  gitDiscard: (files) => ipcRenderer.invoke("git:discard", files),
  runBash: (command) => ipcRenderer.invoke("term:run", command),
  abortBash: () => ipcRenderer.invoke("term:abort"),
  bashState: () => ipcRenderer.invoke("term:state"),
  onTerminalChunk: (listener) => {
    const handler = (_event: unknown, payload: TerminalChunk) => listener(payload);
    ipcRenderer.on("term:chunk", handler);
    return () => ipcRenderer.removeListener("term:chunk", handler);
  },
  listPtySessions: (cwd) => ipcRenderer.invoke("pty:list", cwd),
  listShells: () => ipcRenderer.invoke("shells:list"),
  spawnPty: (cwd, shellId) => ipcRenderer.invoke("pty:spawn", cwd, shellId),
  replayPty: (id) => ipcRenderer.invoke("pty:replay", id),
  writePty: (id, data) => ipcRenderer.send("pty:write", id, data),
  resizePty: (id, cols, rows) => ipcRenderer.send("pty:resize", id, cols, rows),
  killPty: (id) => ipcRenderer.invoke("pty:kill", id),
  onPtyData: (listener) => {
    const handler = (_event: unknown, payload: PtyData) => listener(payload);
    ipcRenderer.on("pty:data", handler);
    return () => ipcRenderer.removeListener("pty:data", handler);
  },
  onPtyExit: (listener) => {
    const handler = (_event: unknown, payload: PtyExit) => listener(payload);
    ipcRenderer.on("pty:exit", handler);
    return () => ipcRenderer.removeListener("pty:exit", handler);
  },
  setBrowserBounds: (bounds) => ipcRenderer.invoke("browser:setBounds", bounds),
  setBrowserVisible: (visible) => ipcRenderer.invoke("browser:setVisible", visible),
  setBrowserWorkspace: (cwd) => ipcRenderer.invoke("browser:workspace", cwd),
  navigateBrowser: (url) => ipcRenderer.invoke("browser:navigate", url),
  browserBack: () => ipcRenderer.invoke("browser:back"),
  browserForward: () => ipcRenderer.invoke("browser:forward"),
  browserReload: () => ipcRenderer.invoke("browser:reload"),
  browserStop: () => ipcRenderer.invoke("browser:stop"),
  toggleDevTools: () => ipcRenderer.invoke("browser:devtools"),
  setDesignMode: (on) => ipcRenderer.invoke("browser:design", on),
  takeDesignPicks: () => ipcRenderer.invoke("browser:picks"),
  onBrowserState: (listener) => {
    const handler = (_event: unknown, payload: BrowserState) => listener(payload);
    ipcRenderer.on("browser:state", handler);
    return () => ipcRenderer.removeListener("browser:state", handler);
  },
  onBrowserPick: (listener) => {
    const handler = (_event: unknown, payload: DesignPick) => listener(payload);
    ipcRenderer.on("browser:pick", handler);
    return () => ipcRenderer.removeListener("browser:pick", handler);
  },
  minimize: () => ipcRenderer.invoke("window:minimize"),
  maximize: () => ipcRenderer.invoke("window:maximize"),
  close: () => ipcRenderer.invoke("window:close"),
  onUpdate: (listener) => {
    const handler = (_event: unknown, payload: HostUpdate) => listener(payload);
    ipcRenderer.on("pi:update", handler);
    return () => ipcRenderer.removeListener("pi:update", handler);
  },
};

contextBridge.exposeInMainWorld("pi", api);
