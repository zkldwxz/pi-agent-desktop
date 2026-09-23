const fs = require('fs');
const path = require('path');

// Read existing dictionary
const existingDict = JSON.parse(fs.readFileSync('scripts/translation_dictionary.json', 'utf8'));
const existingKeys = new Set();
for (const cat of existingDict) {
  for (const k of Object.keys(cat.translations || {})) {
    existingKeys.add(k.trim().toLowerCase());
  }
}

// Read current i18n
const i18nContent = fs.readFileSync('src/renderer/src/lib/i18n.ts', 'utf8');
const i18nKeys = new Set([...i18nContent.matchAll(/"([^"]+)":/g)].map(m => m[1].trim().toLowerCase()));

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

const files = walk('src/renderer/src').filter(f => (f.endsWith('.tsx') || f.endsWith('.ts')) && !f.includes('beautiful') && !f.endsWith('.d.ts'));

const found = new Map();

function addWord(english, file, context) {
  english = (english || '').trim();
  if (!english || english.length < 2) return;
  // filter out css, code identifiers, urls, html colors, pure numbers/units
  if (/^(http|https|var\(|calc\(|rgba?\(|#|currentColor|translate|rotate|flex|grid|absolute|relative|fixed|stagger|font-|text-|bg-|border-|shadow-|rounded-|animate-|opacity-|stroke-)/.test(english)) return;
  if (/^([a-z0-9_-]+:[a-z0-9_-]+)$/.test(english)) return;
  if (/^(\d+(\.\d+)?(px|%|rem|ms|s|vh|vw)?)$/.test(english)) return;
  if (/^[A-Z0-9_-]+$/.test(english) && english.length < 3) return;
  if (/^[0-9.,+−$%/ ]+$/.test(english)) return;
  if (/^[a-z0-9_]+$/.test(english) && english.length < 4) return;
  if (['id', 'key', 'type', 'name', 'value', 'className', 'style', 'title', 'label', 'true', 'false', 'null', 'undefined', 'auto', 'none'].includes(english)) return;

  const lower = english.toLowerCase();
  if (!found.has(lower)) {
    found.set(lower, {
      raw: english,
      files: new Set(),
      contexts: new Set()
    });
  }
  found.get(lower).files.add(file.split(path.sep).join('/').replace('src/renderer/src/', ''));
  found.get(lower).contexts.add(context);
}

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  const rel = file.split(path.sep).join('/').replace('src/renderer/src/', '');

  // 1. Text inside strings in TSX
  for (const m of content.matchAll(/"([A-Za-z][A-Za-z0-9 _,.·'’/?:!–—-]{1,80})"/g)) {
    addWord(m[1], rel, 'string_literal');
  }
  for (const m of content.matchAll(/'([A-Za-z][A-Za-z0-9 _,.·'’/?:!–—-]{1,80})'/g)) {
    addWord(m[1], rel, 'string_literal');
  }

  // 2. JSX text
  for (const m of content.matchAll(/>\s*([A-Za-z][A-Za-z0-9 _,.·'’/?:!–—-]{1,80})\s*</g)) {
    addWord(m[1], rel, 'jsx_text');
  }
}

// Group into categories
const categories = {
  "设置中心与分类导航 (Settings & Navigation)": [
    "General", "Appearance", "Models & thinking", "Terminal", "Browser & network", "Tasks", "Data", "Usage & cache",
    "Back", "Search settings", "Clear search", "Desktop", "Completion sound", "a short chime when a run finishes",
    "Windows notification", "a toast when the run finishes while the window is in the background",
    "Images & output", "Block image input", "stops attachments and screenshots from reaching the model",
    "Auto-resize images", "downscale to 2000×2000 before sending", "Hide thinking blocks", "only affects rendering inside the Pi TUI",
    "Show cache-miss notices", "flag significant prompt-cache misses in the transcript",
    "Context & retry", "Auto compaction", "Auto retry", "Shell", "Shell path", "empty uses the system default",
    "Command prefix", "prepended to every command the agent runs", "npm command", "argv used for package lookups; comma separated",
    "Panel", "the Shell panel runs through the agent's bash tool, so output joins the conversation",
    "Embedded browser", "an isolated Chromium session — site logins persist between runs",
    "Design mode", "Shift+Ctrl+D in the browser panel, or the pencil in its top bar",
    "DevTools", "the terminal button in the browser bar docks them on the right",
    "Agent tools", "registered as a pi extension — seven tools, no MCP layer",
    "Agent task list", "the agent keeps it current through todo_write",
    "Persistence", "written into the session file, so it survives a restart and travels with the session",
    "Active session", "Session tokens", "Cost", "Directory", "this project", "persisted", "not persisted", "this session"
  ],
  "模型管理与检查器 (Models & Inspector)": [
    "Channels", "Provider", "API", "Auth", "Source", "configured", "missing", "built-in",
    "in use", "reasoning", "vision", "overridden", "levels", "No models match", "Clear the search or switch channel.",
    "New model", "written to models.json", "Reasoning model", "enables thinking levels", "Reads images",
    "Accepts screenshots and images", "1M context", "1,000,000 tokens", "Max output tokens", "Thinking levels",
    "Map UI levels to provider parameters, or mark unsupported", "Save override", "Saved", "Remove override",
    "Set as startup model", "an id from models.json", "as the provider spells it", "Close"
  ],
  "用量与统计分析 (Usage & Insights)": [
    "Usage", "Tokens", "Total tokens", "Prompt cache", "Estimated cost", "Sessions recorded",
    "All time", "Last 7 days", "Last 30 days", "Days", "Model", "Cache hit rate", "Input tokens", "Output tokens",
    "Cache read", "Cache write", "Trend snapshot", "High freezer spend", "Spend", "No usage recorded yet",
    "Run some prompts with Pi to see token and cost breakdowns."
  ],
  "欢迎页与新手指引 (Welcome & Project Init)": [
    "Welcome to Pi", "Start a session", "Select a folder to begin coding with Pi",
    "Recent projects", "Choose a folder", "No recent projects", "Get started with",
    "AI-assisted coding, directly on your files.", "Open existing folder"
  ],
  "定制与扩展插件 (Customize & Extensions)": [
    "Customize", "Skills", "Prompts", "Extensions", "Installed", "Available", "Search skills…",
    "Search extensions…", "No skills installed", "No extensions installed", "Install", "Uninstall",
    "Disable", "Enable", "Reload extensions"
  ],
  "对话与工具面板 (Chat, Composer & Dock)": [
    "Files", "Changes", "Tasks", "Browser", "Terminal", "Nothing loaded", "Empty folder.", "No edits yet.",
    "Open this file with its diff", "Send follow-up…", "Ask Pi to build, analyze or explain anything…",
    "Choose model", "Add attachments and sources", "Start dictation", "Stop dictation", "Send", "Stop",
    "Reading context", "Working", "Thought for {duration}", "Thought briefly", "Thinking",
    "Copy answer", "Copied", "Retry from here", "Edit this prompt", "Fork here", "Jump to latest", "Follow the stream"
  ],
  "全局操作与快捷命令 (Global Actions & Palette)": [
    "Command palette", "Type to search commands", "Nothing matches", "Try a command name, a session title, or a model",
    "Actions", "Commands", "Navigate", "Change project folder", "Reload agent resources", "Rescan usage",
    "The run finished.", "needs a decision", "Dismiss"
  ]
};

// Map each word to translation hints
const wordHints = {
  // Settings
  "General": { meaning: "通用设置", proposed: "通用" },
  "Appearance": { meaning: "外观设置（主题、缩放、语言）", proposed: "外观" },
  "Models & thinking": { meaning: "模型选择与思考深度设置", proposed: "模型与思考" },
  "Terminal": { meaning: "终端与Shell配置", proposed: "终端" },
  "Browser & network": { meaning: "内置浏览器与网络能力", proposed: "浏览器与网络" },
  "Tasks": { meaning: "任务跟踪与待办", proposed: "任务" },
  "Data": { meaning: "本地会话与缓存数据概览", proposed: "数据" },
  "Usage & cache": { meaning: "Token用量与缓存命中统计", proposed: "用量与缓存" },
  "Back": { meaning: "返回上一层/返回会话", proposed: "返回工作区" },
  "Search settings": { meaning: "搜索设置输入框", proposed: "搜索设置" },
  "Clear search": { meaning: "清除搜索内容", proposed: "清除搜索" },
  "Desktop": { meaning: "桌面客户端本地体验", proposed: "桌面" },
  "Completion sound": { meaning: "任务完成提示音开关", proposed: "完成提示音" },
  "a short chime when a run finishes": { meaning: "提示音描述", proposed: "任务结束时播放一段短提示音" },
  "Windows notification": { meaning: "Windows 系统通知", proposed: "Windows 通知" },
  "a toast when the run finishes while the window is in the background": { meaning: "通知描述", proposed: "窗口在后台时，任务结束弹出系统通知" },
  "Images & output": { meaning: "图像与模型输出选项", proposed: "图片与输出" },
  "Block image input": { meaning: "禁止发送图片给模型", proposed: "禁止图片输入" },
  "stops attachments and screenshots from reaching the model": { meaning: "禁止图片说明", proposed: "附件与截图不再发送给模型" },
  "Auto-resize images": { meaning: "自动缩小高分辨率图片", proposed: "自动缩放图片" },
  "downscale to 2000×2000 before sending": { meaning: "图片缩放说明", proposed: "发送前缩放到 2000×2000 以内" },
  "Hide thinking blocks": { meaning: "是否在终端输出隐藏思考块", proposed: "隐藏思考块" },
  "only affects rendering inside the Pi TUI": { meaning: "隐藏思考块说明", proposed: "只影响 Pi TUI 内的渲染" },
  "Show cache-miss notices": { meaning: "是否提示缓存未命中", proposed: "显示缓存未命中提示" },
  "flag significant prompt-cache misses in the transcript": { meaning: "缓存未命中说明", proposed: "在会话里标记明显的缓存未命中" },
  "Context & retry": { meaning: "上下文管理与自动重试策略", proposed: "上下文与重试" },
  "Auto compaction": { meaning: "当窗口占满时自动精简压缩", proposed: "自动压缩上下文" },
  "Auto retry": { meaning: "请求失败时自动重试", proposed: "自动重试" },
  "Shell": { meaning: "Shell 执行环境设置", proposed: "Shell" },
  "Shell path": { meaning: "Shell 程序所在路径", proposed: "Shell 路径" },
  "empty uses the system default": { meaning: "留空则使用系统默认", proposed: "留空则使用系统默认" },
  "Command prefix": { meaning: "命令前缀（如加载环境变量别名）", proposed: "命令前缀" },
  "prepended to every command the agent runs": { meaning: "命令前缀说明", proposed: "智能体执行每条命令前自动添加的前缀" },
  "npm command": { meaning: "npm 包管理命令执行体", proposed: "npm 命令" },
  "argv used for package lookups; comma separated": { meaning: "参数说明，逗号分隔", proposed: "用于查询包的命令行参数，逗号分隔" },
  "Panel": { meaning: "面板类型", proposed: "面板" },
  "the Shell panel runs through the agent's bash tool, so output joins the conversation": { meaning: "终端执行说明", proposed: "Shell 面板通过智能体 bash 工具执行，输出将汇入对话" },
  "Embedded browser": { meaning: "内置嵌入式浏览器", proposed: "内置浏览器" },
  "an isolated Chromium session — site logins persist between runs": { meaning: "独立 Chromium 会话说明", proposed: "独立的 Chromium 实例 —— 网站登录状态在运行间持久化保留" },
  "Design mode": { meaning: "前端视觉点选/设计标注模式", proposed: "设计模式" },
  "Shift+Ctrl+D in the browser panel, or the pencil in its top bar": { meaning: "设计模式快捷键说明", proposed: "浏览器面板中按 Shift+Ctrl+D 或点击顶栏画笔进入" },
  "DevTools": { meaning: "Chromium 开发者工具", proposed: "开发者工具" },
  "the terminal button in the browser bar docks them on the right": { meaning: "开发者工具开启说明", proposed: "点击浏览器顶栏右侧终端按钮展开控制台" },
  "Agent tools": { meaning: "浏览器专用智能体工具", proposed: "智能体浏览器工具" },
  "registered as a pi extension — seven tools, no MCP layer": { meaning: "智能体工具说明", proposed: "作为 Pi 扩展注册 —— 包含 7 个原生工具，无 MCP 损耗" },
  "Agent task list": { meaning: "智能体维护的任务清单", proposed: "智能体任务清单" },
  "the agent keeps it current through todo_write": { meaning: "任务更新机制说明", proposed: "智能体通过 todo_write 实时保持最新状态" },
  "Persistence": { meaning: "持久化存储机制", proposed: "持久化" },
  "written into the session file, so it survives a restart and travels with the session": { meaning: "持久化存储说明", proposed: "记录写入会话文件，重启后依然保留并随会话迁移" },
  "Active session": { meaning: "当前活跃的会话", proposed: "当前会话" },
  "Session tokens": { meaning: "本会话累计消耗的 Tokens", proposed: "会话 Tokens" },
  "Cost": { meaning: "成本费用统计", proposed: "预估费用" },
  "Directory": { meaning: "工作目录", proposed: "项目目录" },
  "this project": { meaning: "属于当前项目", proposed: "当前项目" },
  "persisted": { meaning: "已持久化保存在磁盘", proposed: "已持久化" },
  "not persisted": { meaning: "尚未保存在磁盘", proposed: "未持久化" },
  "this session": { meaning: "属于当前会话", proposed: "本会话" },

  // Models
  "Channels": { meaning: "渠道/服务商列表", proposed: "服务渠道" },
  "Provider": { meaning: "模型供应商名称", proposed: "渠道提供商" },
  "API": { meaning: "API 协议类型", proposed: "API 接口" },
  "Auth": { meaning: "鉴权认证状态", proposed: "鉴权状态" },
  "Source": { meaning: "配置来源（内置或配置文件）", proposed: "来源" },
  "configured": { meaning: "已配置 API Key/密钥", proposed: "已配置" },
  "missing": { meaning: "缺失 API Key/未授权", proposed: "未配置" },
  "built-in": { meaning: "系统预设内置", proposed: "内置" },
  "in use": { meaning: "当前会话正在使用的模型", proposed: "当前使用" },
  "reasoning": { meaning: "具备深度思考/推理链能力", proposed: "深度推理" },
  "vision": { meaning: "具备图像/视觉分析能力", proposed: "视觉支持" },
  "overridden": { meaning: "在 models.json 中被用户自定义覆盖", proposed: "已自定义" },
  "levels": { meaning: "档位数量", proposed: "个档位" },
  "No models match": { meaning: "未找到匹配的模型", proposed: "无匹配模型" },
  "Clear the search or switch channel.": { meaning: "搜索无结果提示", proposed: "请清除搜索关键词或切换渠道。" },
  "New model": { meaning: "新增自定义模型", proposed: "新建模型" },
  "written to models.json": { meaning: "保存位置说明", proposed: "将写入 models.json" },
  "Reasoning model": { meaning: "是否为推理模型开关", proposed: "推理模型" },
  "enables thinking levels": { meaning: "开启后支持思考强度调节", proposed: "启用后支持思考强度调节" },
  "Reads images": { meaning: "支持图片输入", proposed: "支持图片输入" },
  "Accepts screenshots and images": { meaning: "可接收截图与图片", proposed: "接收截图与图片附件" },
  "1M context": { meaning: "百万 Token 窗口快捷按钮", proposed: "1M上下文" },
  "1,000,000 tokens": { meaning: "百万 Token 说明", proposed: "1,000,000 tokens" },
  "Max output tokens": { meaning: "最大输出 tokens 上限", proposed: "最大输出 Tokens" },
  "Thinking levels": { meaning: "思考强度参数映射", proposed: "思考强度映射" },
  "Map UI levels to provider parameters, or mark unsupported": { meaning: "映射说明", proposed: "将界面档位映射到底层参数，或标记为不支持" },
  "Save override": { meaning: "保存对模型的自定义更改", proposed: "保存自定义配置" },
  "Saved": { meaning: "保存成功提示", proposed: "已保存" },
  "Remove override": { meaning: "删除自定义并恢复为默认", proposed: "恢复默认设置" },
  "Set as startup model": { meaning: "设为新会话的默认模型", proposed: "设为默认模型" },
  "an id from models.json": { meaning: "models.json 中的 provider id", proposed: "models.json 中的渠道标识" },
  "as the provider spells it": { meaning: "供应商官方给出的真实模型标识符", proposed: "供应商规定的模型标识" },
  "Close": { meaning: "关闭侧边栏/浮层", proposed: "关闭" },

  // Usage
  "Usage": { meaning: "用量仪表盘", proposed: "用量统计" },
  "Tokens": { meaning: "Token 总数", proposed: "Tokens" },
  "Total tokens": { meaning: "总计消耗的 Token", proposed: "Token 总消耗" },
  "Prompt cache": { meaning: "上下文提示缓存统计", proposed: "提示词缓存" },
  "Estimated cost": { meaning: "预估总费用", proposed: "预估总费用" },
  "Sessions recorded": { meaning: "已记录的会话数量", proposed: "记录会话数" },
  "All time": { meaning: "全部历史时间", proposed: "全部历史" },
  "Last 7 days": { meaning: "最近 7 天", proposed: "最近 7 天" },
  "Last 30 days": { meaning: "最近 30 天", proposed: "最近 30 天" },
  "Days": { meaning: "天数分布", proposed: "按天统计" },
  "Model": { meaning: "按模型分布", proposed: "按模型统计" },
  "Cache hit rate": { meaning: "缓存命中率", proposed: "缓存命中率" },
  "Input tokens": { meaning: "输入 Tokens", proposed: "输入 Tokens" },
  "Output tokens": { meaning: "输出 Tokens", proposed: "输出 Tokens" },
  "Cache read": { meaning: "缓存读取 Tokens", proposed: "缓存读取" },
  "Cache write": { meaning: "缓存写入 Tokens", proposed: "缓存写入" },
  "Trend snapshot": { meaning: "趋势快照", proposed: "趋势快照" },
  "No usage recorded yet": { meaning: "尚无记录", proposed: "暂无用量记录" },
  "Run some prompts with Pi to see token and cost breakdowns.": { meaning: "引导提示", proposed: "使用 Pi 进行对话后，此处将展示详细的 Token 和费用明细。" },

  // Welcome
  "Welcome to Pi": { meaning: "欢迎界面标题", proposed: "欢迎使用 Pi" },
  "Start a session": { meaning: "开启新会话", proposed: "开始新会话" },
  "Select a folder to begin coding with Pi": { meaning: "选择文件夹引导", proposed: "选择一个项目文件夹，开始与 Pi 协作编程" },
  "Recent projects": { meaning: "最近打开过的项目", proposed: "最近项目" },
  "Choose a folder": { meaning: "选择文件夹按钮", proposed: "选择文件夹" },
  "No recent projects": { meaning: "暂无最近项目", proposed: "暂无最近项目" },
  "AI-assisted coding, directly on your files.": { meaning: "产品Slogan", proposed: "基于您的本地文件，进行纯粹的 AI 辅助编程。" },
  "Open existing folder": { meaning: "打开现有文件夹", proposed: "打开本地文件夹" },

  // Customize
  "Skills": { meaning: "智能体技能", proposed: "技能库" },
  "Prompts": { meaning: "系统提示词预设", proposed: "提示词" },
  "Extensions": { meaning: "工具与扩展插件", proposed: "扩展插件" },
  "Installed": { meaning: "已安装的", proposed: "已安装" },
  "Available": { meaning: "可用的/推荐的", proposed: "可用列表" },
  "Search skills…": { meaning: "搜索技能占位符", proposed: "搜索技能…" },
  "Search extensions…": { meaning: "搜索扩展占位符", proposed: "搜索扩展…" },
  "No skills installed": { meaning: "尚未安装技能", proposed: "暂无已安装技能" },
  "No extensions installed": { meaning: "尚未安装扩展", proposed: "暂无已安装扩展" },
  "Install": { meaning: "安装按钮", proposed: "安装" },
  "Uninstall": { meaning: "卸载按钮", proposed: "卸载" },
  "Disable": { meaning: "禁用按钮", proposed: "禁用" },
  "Enable": { meaning: "启用按钮", proposed: "启用" },
  "Reload extensions": { meaning: "重新加载扩展", proposed: "重新加载扩展" }
};

const finalStructure = [];

for (const [catName, wordList] of Object.entries(categories)) {
  const group = {
    category: catName,
    translations: {}
  };
  for (const w of wordList) {
    const hint = wordHints[w] || { meaning: w, proposed: w };
    group.translations[w] = {
      meaning: hint.meaning,
      proposed: hint.proposed
    };
  }
  finalStructure.push(group);
}

fs.writeFileSync('scripts/complete_translation_dictionary.json', JSON.stringify(finalStructure, null, 2));
console.log('Complete dictionary generated at scripts/complete_translation_dictionary.json');
