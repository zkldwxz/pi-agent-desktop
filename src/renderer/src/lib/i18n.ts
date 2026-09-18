import { useSyncExternalStore } from "react";

/**
 * UI language.
 *
 * The shell's own chrome ships in Chinese by default — this is a Chinese-
 * first product — while everything the agent writes (thinking, answers, tool
 * output) stays exactly as the model produced it. English is one toggle away
 * for anyone who prefers it.
 *
 * Keys are the English source strings, so an untranslated key degrades to
 * readable English instead of a missing-key placeholder.
 */

export type Locale = "zh" | "en";

const KEY = "pi-locale";

let locale: Locale = (() => {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "en" || saved === "zh") return saved;
  } catch {
    /* private mode, first run */
  }
  return "zh";
})();

const listeners = new Set<() => void>();

export function getLocale(): Locale {
  return locale;
}

export function setLocale(next: Locale): void {
  locale = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* ignore */
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Re-renders the component when the language changes. */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, getLocale, getLocale);
}

const ZH: Record<string, string> = {
  /* ── title bar / chrome ─────────────────────────────── */
  "Show the sidebar": "展开侧边栏",
  "Hide the sidebar": "收起侧边栏",
  "Show the tool panel": "展开工具面板",
  "Hide the tool panel": "收起工具面板",
  "Light mode": "浅色模式",
  "Dark mode": "深色模式",
  "Minimize": "最小化",
  "Maximize": "最大化",
  "Close": "关闭",
  "Back to the conversation": "返回对话",
  "Rescan": "重新扫描",
  "Reload session": "重新加载会话",

  /* ── sidebar ────────────────────────────────────────── */
  "New Agent": "新建会话",
  "Search": "搜索",
  "Customize": "定制",
  "Settings": "设置",
  "Expand sidebar": "展开侧边栏",
  "Collapse sidebar": "收起侧边栏",
  "Workspaces": "工作区",
  "Workspace options": "工作区选项",
  "New chat in this workspace": "在此工作区新建会话",
  "Open another folder": "打开其他文件夹",
  "New chat in {folder}": "在 {folder} 新建会话",
  "this folder": "当前文件夹",
  "RECENT FOLDERS": "最近文件夹",
  "Open another folder…": "打开其他文件夹…",
  "current": "当前",
  "Archived ({count})": "已归档 ({count})",
  "Show {count} more": "再看 {count} 条",
  "Show less": "收起",
  "No sessions yet.": "还没有会话。",
  "Add a folder": "添加文件夹",
  "New chat": "新建会话",
  "Rename": "重命名",
  "Open in IDE": "在 IDE 中打开",
  "Unarchive": "取消归档",
  "Archive workspace": "归档工作区",
  "Click again to delete": "再点一次确认删除",
  "Delete workspace": "删除工作区",
  "Save": "保存",
  "Workspace name": "工作区名称",
  "Drag to resize, double-click to reset": "拖动调整宽度，双击重置",
  "Grouping": "分组",
  "Ordering": "排序",
  "Show": "显示",
  "Status": "状态",
  "Expand All": "全部展开",
  "Collapse All": "全部收起",
  "Mark All as Read": "全部标记为已读",
  "Workspace": "工作区",
  "Date": "日期",
  "Recent": "最近",
  "Name": "名称",
  "All": "全部",
  "chats": "会话",
  "FILTERS": "筛选",
  "Any": "不限",
  "Running": "运行中",
  "Failed": "失败",
  "Completed": "已完成",
  "Empty": "空",
  "Today": "今天",
  "This week": "本周",
  "This month": "本月",
  "Earlier": "更早",
  "New session": "新会话",

  /* ── transcript ─────────────────────────────────────── */
  "Thinking": "思考中",
  "Thought briefly": "短暂思考",
  "Thought for {duration}": "思考 {duration}",
  "Worked for {duration}": "耗时 {duration}",
  "Stopped": "已停止",
  "Copy answer": "复制回答",
  "Copied": "已复制",
  "Retry from here": "从这里重试",
  "Edit this prompt": "编辑这条消息",
  "Fork here": "从此处分支",
  "Show {count} earlier turn": "展开更早的 {count} 条",
  "Show {count} earlier turns": "展开更早的 {count} 条",
  "Jump to latest": "回到最新",
  "Follow the stream": "跟随输出",
  "What should Pi do next?": "接下来做什么？",
  "This window talks to the Pi agent already installed on this machine. Sessions, models, and credentials stay in ~/.pi/agent.":
    "这个窗口连接本机已安装的 Pi agent。会话、模型和凭据都保留在 ~/.pi/agent。",
  "Reading context": "读取上下文",
  "Working": "处理中",

  /* ── composer ───────────────────────────────────────── */
  "Send follow-up…": "继续追问…",
  "Ask Pi to build, analyze or explain anything…": "让 Pi 写代码、分析或解释任何事…",
  "Choose model": "选择模型",
  "Add attachments and sources": "添加附件与来源",
  "Start dictation": "开始语音输入",
  "Stop dictation": "停止语音输入",
  "Send": "发送",
  "Stop": "停止",
  "MODEL": "模型",
  "THINKING": "思考深度",
  "CONTEXT": "上下文",

  /* ── dock ───────────────────────────────────────────── */
  "Files": "文件",
  "Terminal": "终端",
  "Changes": "改动",
  "Browser": "浏览器",
  "Canvas": "画布",
  "Tasks": "任务",
  "Nothing loaded": "尚未加载页面",
  "Design mode": "设计模式",
  "Toggle DevTools": "开发者工具",
  "Return to the dock": "停靠到右侧",
  "Open fullscreen": "全屏打开",
  "Close browser": "关闭浏览器",
  "Go back": "后退",
  "Go forward": "前进",
  "Reload": "重新加载",
  "Show ignored folders": "显示被忽略的文件夹",
  "Hide ignored folders": "隐藏被忽略的文件夹",
  "Refresh": "刷新",
  "Empty folder.": "空文件夹。",
  "No edits yet.": "还没有改动。",
  "Open this file with its diff": "打开该文件并查看改动",

  /* ── settings ───────────────────────────────────────── */
  "Search settings": "搜索设置",
  "General": "通用",
  "Appearance": "外观",
  "Models & thinking": "模型与思考",
  "Browser & network": "浏览器与网络",
  "Data": "数据",
  "Usage & cache": "用量与缓存",
  "Transcript": "会话记录",
  "AGENT": "AGENT",
  "WORKSPACE": "工作区",
  "Written to ~/.pi/agent/settings.json — the Pi CLI reads the same file":
    "写入 ~/.pi/agent/settings.json —— Pi CLI 读取同一份文件",
  "Desktop": "桌面",
  "Completion sound": "完成提示音",
  "a short chime when a run finishes": "任务结束时播放一段短提示音",
  "Windows notification": "Windows 通知",
  "a toast when the run finishes while the window is in the background": "窗口在后台时，任务结束弹出系统通知",
  "Images & output": "图片与输出",
  "Block image input": "禁止图片输入",
  "stops attachments and screenshots from reaching the model": "附件与截图不再发送给模型",
  "Auto-resize images": "自动缩放图片",
  "downscale to 2000×2000 before sending": "发送前缩放到 2000×2000 以内",
  "Hide thinking blocks": "隐藏思考块",
  "only affects rendering inside the Pi TUI": "只影响 Pi TUI 内的渲染",
  "Show cache-miss notices": "显示缓存未命中提示",
  "flag significant prompt-cache misses in the transcript": "在会话里标记明显的缓存未命中",
  "Context & retry": "上下文与重试",
  "Auto compaction": "自动压缩上下文",
  "Auto retry": "自动重试",
  "Startup thinking level": "默认思考深度",
  "used when a session starts without a saved level": "会话开始时使用的思考深度",
  "Thinking token budgets": "思考 token 预算",
  "applies to providers that accept explicit budgets": "仅对支持显式预算的提供方生效",
  "Per-model overrides · inherit follows the startup level": "按模型覆盖 · inherit 表示跟随默认深度",
  "Language": "语言",
  "Interface language for the app chrome; agent output is never translated":
    "应用界面语言；agent 的输出不会被翻译",
  "Interface scale": "界面缩放",
  "Ctrl + / Ctrl - to adjust, Ctrl 0 to reset": "Ctrl +/- 调整，Ctrl 0 重置",
  "Theme": "主题",
  "accent palette — coming later": "主题色 —— 稍后支持",
  "No themes yet. The choice is stored, so whatever ships next will be picked up automatically.":
    "还没有主题。选择会被记住，后续版本会自动生效。",

  /* ── misc ───────────────────────────────────────────── */
  "No matches for “{query}”": "没有匹配 “{query}” 的结果",
  "Type to search sources & files": "输入以搜索来源与文件",
  "Type to search commands": "输入以搜索命令",
  "Compacted": "已压缩",
  "compacted": "已压缩",
  "branch": "分支",
  "Context compacted": "上下文已压缩",
};

/** Translate a UI string. Unknown strings fall through as English. */
export function t(text: string): string {
  if (locale === "en") return text;
  return ZH[text] ?? text;
}

/** Translate with `{name}` placeholders. */
export function tf(text: string, vars: Record<string, string | number>): string {
  const template = t(text);
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => String(vars[key] ?? `{${key}}`));
}
