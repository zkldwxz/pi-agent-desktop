import fs from "fs";

const dict = JSON.parse(fs.readFileSync("scripts/translation_dictionary.json", "utf8"));

// Clean target categories
const targets = {
  "思考强度设定 (Thinking Levels)": {},
  "思考与上下文控制条 (Prompt Bar & ModelThinkingControl)": {},
  "设置中心与系统配置 (Settings & Preferences)": {},
  "模型管理与检查器 (Models View & Inspector)": {},
  "全局命令与快捷操作 (Command Palette & Global Actions)": {},
  "用量与统计分析 (Usage & Insights)": {},
  "智能体工具跟踪与状态卡 (Trace & Tool Chips)": {},
  "对话与工具面板 (Chat, Composer & Dock)": {},
  "欢迎页与新手指引 (Welcome & Project Init)": {},
  "定制与扩展插件 (Customize & Extensions)": {}
};

for (const group of dict) {
  let targetKey = "设置中心与系统配置 (Settings & Preferences)";
  if (group.category.includes("Thinking Levels")) targetKey = "思考强度设定 (Thinking Levels)";
  else if (group.category.includes("Prompt Bar")) targetKey = "思考与上下文控制条 (Prompt Bar & ModelThinkingControl)";
  else if (group.category.includes("Models") || group.category.includes("模型")) targetKey = "模型管理与检查器 (Models View & Inspector)";
  else if (group.category.includes("Command") || group.category.includes("命令") || group.category.includes("Palette")) targetKey = "全局命令与快捷操作 (Command Palette & Global Actions)";
  else if (group.category.includes("Usage") || group.category.includes("用量")) targetKey = "用量与统计分析 (Usage & Insights)";
  else if (group.category.includes("Trace") || group.category.includes("Tool Chips") || group.category.includes("工具跟踪")) targetKey = "智能体工具跟踪与状态卡 (Trace & Tool Chips)";
  else if (group.category.includes("Chat") || group.category.includes("Dock") || group.category.includes("对话")) targetKey = "对话与工具面板 (Chat, Composer & Dock)";
  else if (group.category.includes("Welcome") || group.category.includes("欢迎")) targetKey = "欢迎页与新手指引 (Welcome & Project Init)";
  else if (group.category.includes("Customize") || group.category.includes("定制") || group.category.includes("插件")) targetKey = "定制与扩展插件 (Customize & Extensions)";

  for (const [k, v] of Object.entries(group.translations)) {
    // Preserve if already exists or update
    if (!targets[targetKey][k]) {
      targets[targetKey][k] = v;
    }
  }
}

const result = Object.entries(targets).map(([cat, trans]) => ({
  category: cat,
  count: Object.keys(trans).length,
  translations: trans
}));

fs.writeFileSync("scripts/translation_dictionary.json", JSON.stringify(result, null, 2));
console.log("Clean dictionary written, categories:", result.length);
