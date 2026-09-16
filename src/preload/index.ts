import { contextBridge, ipcRenderer, webFrame } from "electron";
import type {
  ChatMessage,
  ContextBreakdown,
  HostState,
  HostUpdate,
  ModelEdit,
  PluginInfo,
  PromptPayload,
  RuntimeSettings,
  UsageStats,
  CatalogItem,
  DesktopConfig,
} from "@shared/types";
import type { DirListing, FileContent, TerminalChunk, TerminalResult } from "@shared/workspace";
import type { AppOpener } from "@shared/workspace";
import type { BrowserBounds, BrowserState, DesignPick } from "@shared/browser";
import type { UiAnswer } from "@shared/ui";


export interface PiBridge {
  getState: () => Promise<HostUpdate>;
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
  updateSettings: (patch: Partial<RuntimeSettings>) => Promise<void>;
  saveModel: (edit: ModelEdit) => Promise<void>;
  deleteModel: (provider: string, modelId: string) => Promise<void>;
  listAllSessions: () => Promise<HostState["sessions"]>;
  deleteWorkspace: (cwd: string) => Promise<void>;
  setZoomFactor: (factor: number) => void;
  getZoomFactor: () => number;
  steer: (text: string) => Promise<void>;
  followUp: (text: string) => Promise<void>;
  clearQueue: () => Promise<HostState["queue"] & { texts: string[] }>;
  removeQueued: (kind: "steering" | "followUp", index: number) => Promise<void>;
  setQueueMode: (kind: "steering" | "followUp", mode: "all" | "one-at-a-time") => Promise<void>;
  forkTargets: () => Promise<{ entryId: string; text: string }[]>;
  forkAt: (index: number) => Promise<{ cancelled: boolean }>;
  respondUi: (answer: UiAnswer) => Promise<void>;
  getDesktopConfig: () => Promise<DesktopConfig>;
  getCatalog: () => Promise<CatalogItem[]>;
  applyCatalog: (ids: string[]) => Promise<{ config: DesktopConfig; installed: string[] }>;
  finishOnboarding: () => Promise<DesktopConfig>;
  getPlugins: () => Promise<PluginInfo[]>;
  setPluginEnabled: (path: string, kind: PluginInfo["kind"], enabled: boolean) => Promise<PluginInfo[]>;
  deletePlugin: (path: string, kind: PluginInfo["kind"]) => Promise<PluginInfo[]>;
  getUsage: (days: number) => Promise<UsageStats>;
  /** sizes of what is occupying the context window */
  getContextBreakdown: () => Promise<ContextBreakdown>;
  pickCwd: () => Promise<string | undefined>;
  openPath: (target: string) => Promise<void>;
  showItem: (target: string) => Promise<void>;
  listDir: (dirPath: string, showAll: boolean) => Promise<DirListing>;
  readFile: (filePath: string) => Promise<FileContent>;
  revealFile: (filePath: string) => Promise<void>;
  /** applications the OS has registered for this file type */
  listOpeners: (filePath: string) => Promise<AppOpener[]>;
  openWith: (filePath: string, openerId: string) => Promise<{ ok: boolean; error?: string }>;
  runBash: (command: string) => Promise<TerminalResult>;
  abortBash: () => Promise<void>;
  bashState: () => Promise<{ running: boolean }>;
  onTerminalChunk: (listener: (chunk: TerminalChunk) => void) => () => void;
  setBrowserBounds: (bounds: BrowserBounds) => Promise<void>;
  setBrowserVisible: (visible: boolean) => Promise<void>;
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
  prompt: (payload) => ipcRenderer.invoke("pi:prompt", payload),
  abort: () => ipcRenderer.invoke("pi:abort"),
  newSession: () => ipcRenderer.invoke("pi:newSession"),
  switchSession: (path) => ipcRenderer.invoke("pi:switchSession", path),
  setCwd: (cwd) => ipcRenderer.invoke("pi:setCwd", cwd),
  setModel: (provider, modelId) => ipcRenderer.invoke("pi:setModel", provider, modelId),
  setThinking: (level) => ipcRenderer.invoke("pi:setThinking", level),
  setName: (name) => ipcRenderer.invoke("pi:setName", name),
  reload: () => ipcRenderer.invoke("pi:reload"),
  updateSettings: (patch) => ipcRenderer.invoke("pi:updateSettings", patch),
  saveModel: (edit) => ipcRenderer.invoke("pi:saveModel", edit),
  deleteModel: (provider, modelId) => ipcRenderer.invoke("pi:deleteModel", provider, modelId),
  listAllSessions: () => ipcRenderer.invoke("pi:listAllSessions"),
  deleteWorkspace: (cwd) => ipcRenderer.invoke("pi:deleteWorkspace", cwd),
  setZoomFactor: (factor) => webFrame.setZoomFactor(factor),
  getZoomFactor: () => webFrame.getZoomFactor(),
  steer: (text) => ipcRenderer.invoke("pi:steer", text),
  followUp: (text) => ipcRenderer.invoke("pi:followUp", text),
  clearQueue: () => ipcRenderer.invoke("pi:clearQueue"),
  removeQueued: (kind, index) => ipcRenderer.invoke("pi:removeQueued", kind, index),
  setQueueMode: (kind, mode) => ipcRenderer.invoke("pi:queueMode", kind, mode),
  forkTargets: () => ipcRenderer.invoke("pi:forkTargets"),
  forkAt: (index) => ipcRenderer.invoke("pi:forkAt", index),
  respondUi: (answer) => ipcRenderer.invoke("ui:respond", answer),
  getDesktopConfig: () => ipcRenderer.invoke("desktop:getConfig"),
  getCatalog: () => ipcRenderer.invoke("desktop:catalog"),
  applyCatalog: (ids) => ipcRenderer.invoke("desktop:applyCatalog", ids),
  finishOnboarding: () => ipcRenderer.invoke("desktop:finishOnboarding"),
  getPlugins: () => ipcRenderer.invoke("pi:getPlugins"),
  setPluginEnabled: (path, kind, enabled) => ipcRenderer.invoke("pi:setPluginEnabled", path, kind, enabled),
  deletePlugin: (path, kind) => ipcRenderer.invoke("pi:deletePlugin", path, kind),
  getUsage: (days) => ipcRenderer.invoke("pi:getUsage", days),
  getContextBreakdown: () => ipcRenderer.invoke("pi:contextBreakdown"),
  pickCwd: () => ipcRenderer.invoke("pi:pickCwd"),
  openPath: (target) => ipcRenderer.invoke("pi:openPath", target),
  showItem: (target) => ipcRenderer.invoke("pi:showItem", target),
  listDir: (dirPath, showAll) => ipcRenderer.invoke("fs:list", dirPath, showAll),
  readFile: (filePath) => ipcRenderer.invoke("fs:read", filePath),
  revealFile: (filePath) => ipcRenderer.invoke("fs:reveal", filePath),
  listOpeners: (filePath) => ipcRenderer.invoke("fs:openers", filePath),
  openWith: (filePath, openerId) => ipcRenderer.invoke("fs:openWith", filePath, openerId),
  runBash: (command) => ipcRenderer.invoke("term:run", command),
  abortBash: () => ipcRenderer.invoke("term:abort"),
  bashState: () => ipcRenderer.invoke("term:state"),
  onTerminalChunk: (listener) => {
    const handler = (_event: unknown, payload: TerminalChunk) => listener(payload);
    ipcRenderer.on("term:chunk", handler);
    return () => ipcRenderer.removeListener("term:chunk", handler);
  },
  setBrowserBounds: (bounds) => ipcRenderer.invoke("browser:setBounds", bounds),
  setBrowserVisible: (visible) => ipcRenderer.invoke("browser:setVisible", visible),
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
