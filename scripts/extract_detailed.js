const fs = require('fs');
const path = require('path');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

const files = walk('src/renderer/src').filter(f => f.endsWith('.tsx') && !f.includes('beautiful'));

const catalog = new Map();

function add(text, file, category, desc) {
  text = text.trim();
  if (!text || text.length < 2) return;
  if (/^(=|>|<|{|}|\/|\*|\+|\-|\$|\d|http)/.test(text)) return;
  if (/^(px|rem|ms|s|%|\d+|true|false|null|undefined)$/.test(text)) return;
  if (['id', 'name', 'key', 'type', 'value', 'className', 'style'].includes(text)) return;

  if (!catalog.has(text)) {
    catalog.set(text, {
      english: text,
      category,
      description: desc || '',
      files: new Set()
    });
  }
  catalog.get(text).files.add(file.split(path.sep).join('/').replace('src/renderer/src/', ''));
}

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  const rel = file.split(path.sep).join('/').replace('src/renderer/src/', '');

  // t("...")
  for (const m of content.matchAll(/\bt\("([^"]+)"\)|\btf\("([^"]+)"/g)) {
    add(m[1] || m[2], rel, 'i18n_t', 'Existing t() translation key');
  }

  // Common UI texts in views
  // Look for ViewHeader title/subtitle
  for (const m of content.matchAll(/ViewHeader\s*[^>]*title="([^"]+)"(?:\s*subtitle="([^"]+)")?/g)) {
    add(m[1], rel, 'view_header', 'Page / View Title');
    if (m[2]) add(m[2], rel, 'view_header', 'Page / View Subtitle');
  }

  // Row title/hint
  for (const m of content.matchAll(/<(?:Row|Field|Check)\s*[^>]*label="([^"]+)"(?:\s*hint="([^"]+)")?/g)) {
    add(m[1], rel, 'form_label', 'Form field label');
    if (m[2]) add(m[2], rel, 'form_hint', 'Form field hint');
  }
  for (const m of content.matchAll(/<Row\s*[^>]*title="([^"]+)"(?:\s*hint="([^"]+)")?/g)) {
    add(m[1], rel, 'setting_row', 'Settings row title');
    if (m[2]) add(m[2], rel, 'setting_hint', 'Settings row hint');
  }

  // Section title
  for (const m of content.matchAll(/<Section\s*[^>]*title="([^"]+)"/g)) {
    add(m[1], rel, 'section_title', 'Section group title');
  }

  // EmptyState title/body
  for (const m of content.matchAll(/<EmptyState\s*[^>]*title="([^"]+)"(?:\s*body="([^"]+)")?/g)) {
    add(m[1], rel, 'empty_state', 'Empty state heading');
    if (m[2]) add(m[2], rel, 'empty_state', 'Empty state description');
  }
}

// Specifically check views and components:
// ModelsView, SettingsView, UsageView, WelcomeView, CustomizeView, PluginsView, ExtensionFlow
const viewSpecifics = [
  // Thinking levels
  { english: "off", category: "thinking_level", description: "思考强度关闭" },
  { english: "minimal", category: "thinking_level", description: "极低/微量思考" },
  { english: "low", category: "thinking_level", description: "低思考强度" },
  { english: "medium", category: "thinking_level", description: "中等思考强度" },
  { english: "high", category: "thinking_level", description: "高思考强度" },
  { english: "xhigh", category: "thinking_level", description: "极高思考强度" },
  { english: "max", category: "thinking_level", description: "最高思考强度" },

  // ModelThinkingControl & composer
  { english: "THINKING", category: "composer_control", description: "思考强度标签" },
  { english: "MODEL", category: "composer_control", description: "模型选择标签" },
  { english: "CONTEXT", category: "composer_control", description: "上下文指示标签" },
  { english: "context window", category: "model_attribute", description: "上下文窗口" },
  { english: "max output", category: "model_attribute", description: "最大输出 tokens" },
  { english: "reasoning", category: "model_attribute", description: "推理能力" },
  { english: "vision", category: "model_attribute", description: "视觉识别能力" },
  { english: "override", category: "model_attribute", description: "覆盖/自定义配置" },
  { english: "inherit", category: "thinking_option", description: "继承默认设置" },
  { english: "Waiting for the session…", category: "composer_control", description: "等待会话就绪…" },
  { english: "Estimates from the session's own prompt, tool schemas and skill files.", category: "composer_control", description: "基于会话提示词、工具定义与技能文件的估算值" },
  { english: "This model does not expose thinking levels.", category: "composer_control", description: "该模型不提供思考深度调节" },
];

for (const item of viewSpecifics) {
  if (!catalog.has(item.english)) {
    catalog.set(item.english, {
      english: item.english,
      category: item.category,
      description: item.description,
      files: new Set()
    });
  }
}

// Convert to array
const result = Array.from(catalog.values()).map(item => ({
  english: item.english,
  category: item.category,
  description: item.description,
  files: Array.from(item.files)
}));

fs.writeFileSync('scripts/review_candidates.json', JSON.stringify(result, null, 2));
console.log('Done, candidate count:', result.length);
