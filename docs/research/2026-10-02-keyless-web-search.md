# 免 key 网页搜索与抓取：调研与实现（2026-10-02）

范围限于 `src/main/web/**`、`scripts/web-regression.mjs`、`scripts/web-smoke.mjs` 与本文件。没有新增依赖，没有改动 package.json、IPC、i18n 与宿主接线。

## 结论

1. **有 `TAVILY_API_KEY` 时 Tavily 优先**（搜索与正文提取）。
2. **无 key 时默认可用**：搜索走「已配置的自托管 SearXNG → Tavily 官方 keyless → DuckDuckGo 无 JS HTML 页」，提取走「本机直接抓取并转 Markdown → Tavily keyless 提取」。
3. 任一提供方失败都会带着错误进入下一个候选；**全部失败就报错**，不生成占位或伪造结果，失败不写入缓存。
4. 工具描述、结果文本格式、缓存 TTL/容量/分页协议不变，模型可见的工具目录跨回合保持稳定。

## 服务调研（均为真实官方资料，2026-10-02 访问）

| 服务 | 接口与凭据 | 官方资料 | 我们依赖什么 | 明确的边界 |
| --- | --- | --- | --- | --- |
| Tavily keyless | HTTPS POST `https://api.tavily.com/search`、`/extract`，请求头 `X-Tavily-Access-Mode: keyless`，无账号无 key | https://docs.tavily.com/documentation/keyless.md | 官方说明 keyless 支持 `/search` 与 `/extract`，免费但限流，成功响应与带 key 完全同构；同时带 key 时 key 优先 | 免费额度与限流由 Tavily 单方面管理，可能变化；不能承诺长期可用 |
| SearXNG（自托管，开源） | `GET/POST /search?q=…&format=json` | https://docs.searxng.org/dev/search_api.html 、https://docs.searxng.org/admin/settings/settings_search.html | JSON 输出必须由实例在 `search.formats` 中启用，未启用时返回 403；用 `SEARXNG_URL` 指向实例 | 公共实例大多关闭 JSON；自托管实例由用户维护，没有 SLA；本轮环境没有实例，未做实网验证 |
| DuckDuckGo 无 JS HTML 页 | `https://html.duckduckgo.com/html/?q=…`，无 key | 无官方网页结果 API 文档。DuckDuckGo 公布的 Instant Answer 接口（`api.duckduckgo.com`）不提供通用网页结果，且本轮抓取其 API 页面失败，未能引用 | 解析 `result__a` / `result-link` 标题锚点、`result__snippet` / `result-snippet` 摘要、`/l/?uddg=` 跳转解码 | **不是公开 API**，可能被 bot 防护（anomaly 页）拦截：无锚点、anomaly、异常状态码一律按失败处理并进入下一候选；不承诺稳定 |
| 本机直接抓取 | Node 内建 `fetch` + 自写 HTML→Markdown | 无第三方依赖 | 无 key、无第三方，正文在本地转换；响应体、跳转次数、输出长度全部有界 | 不执行 JavaScript：SPA/挑战页会失败并给出错误；被 Cloudflare 拦截的页面会报 challenge 而非返回假正文 |

未纳入的服务：Brave Search、Google Programmable Search、Mojeek、Marginalia 等公开搜索接口都需要注册 key，与本轮「无 key 默认可用」目标不符，未展开核实；也没有把任何需要 key 的抓取代理设为默认路径。

## 选择与回退顺序

| 能力 | 有 `TAVILY_API_KEY` | 无 key |
| --- | --- | --- |
| web_search | `tavily`（带 key）→ `searxng`（若配置）→ `duckduckgo` | `searxng`（若配置）→ `tavily`（keyless）→ `duckduckgo` |
| web_fetch | `tavily` → `direct`（本机抓取） | `direct` → `tavily`（keyless） |

- 用户显式配置的 `SEARXNG_URL` 在无 key 时排在最前，尊重自托管的隐私与可控性。
- 连续两次失败的提供方进入 120 秒冷却，避免被墙/限流的端点在之后每次请求都先付一次超时；冷却期结束后重试，一次成功即清除记录。
- 所有请求超时：Tavily 35s、SearXNG 20s、DuckDuckGo 15s、本机抓取 30s。检索是串行回退，不做并行请求，避免额外的外发与计费。

## 缓存、凭据与请求前缀

- `RequestCache` 未改动：搜索 TTL 5 分钟 / 64 项 / 4 MiB，正文 TTL 15 分钟 / 32 项 / 16 MiB，同键并发合并、每个等待者独立取消、最后一个等待者取消才中止传输、错误永不入缓存。
- 缓存键包含提供方配置摘要：Tavily 凭据作用域仍是 key 的 sha256（或 `keyless`）；SearXNG 实例 URL 只以 sha256 前 16 位参与键；`SEARXNG_URL` 改动或 key 轮换都会自然 miss，不会串用另一套配置的数据。
- 任何错误消息、IPC 载荷、日志都不含 key、不含 SearXNG 实例 URL（自托管常带私密路径）；工具 `details` 只新增 `provider` 标识（`tavily` / `searxng` / `duckduckgo` / `direct`）。
- 工具描述是静态字符串，只提及环境变量名，不包含 key 是否存在、当前提供方等会逐回合变化的信息；`scripts/web-regression.mjs` 有测试在改动 `TAVILY_API_KEY` 前后比对描述字节一致。
- 搜索结果文本仍是 `[n] title\nurl\nsnippet`，web_fetch 仍是 `Source/Snapshot/Characters/正文/续读提示`，模型可见格式未变。

## 安全与解析边界

- **SSRF**：`web_fetch` 的 URL 由模型给出，因此每个请求（含每次跳转）先做 `assertPublicHost`：解析主机名并要求全部 DNS 答案都是公网地址；拒绝 loopback、RFC1918、link-local（含云元数据 169.254.169.254）、CGNAT、多播、NAT64/6to4/mapped-IPv4 中嵌入的私网地址；`.local`/`.internal`/`.home.arpa`/`localhost` 后缀直接拒绝；HTTPS→HTTP 降级跳转拒绝；跳转最多 5 次且检测环路。
- **残留风险（如实记录）**：校验用的 DNS 结果与真正连接之间可能存在重绑定窗口（当前用全局 `fetch`，无法把已校验的 IP 钉进连接）。跳转逐跳复检缩小了窗口，但未消除；如需彻底关闭，要在主进程换用自定义 dispatcher/agent。
- **fake-IP 例外**：透明代理（Clash 等）会把公网域名的 DNS 答案映射到 `198.18.0.0/15` 基准测试段。该段对「IP 字面量」仍然拒绝，但对 DNS 答案是允许的，否则这类用户的本机抓取会全部失效。这是权衡，不是漏洞结论。
- **有界解析**：DuckDuckGo HTML ≤ 2 MiB，SearXNG JSON ≤ 5 MiB，本机抓取 ≤ 4 MiB，Tavily 响应 ≤ 5 MiB（原有）；头部 token 化输入 ≤ 2 MiB，输出 ≤ 40 万字符；结果条数在请求上限处截断；解码先按 Content-Type charset，再退回 UTF-8（Node 自带 full ICU，gbk/big5 等可解）。
- **挑战页**：Cloudflare 挑战、DDG anomaly/bot 墙、验证码等标记在 HTML 预检和 `validateContent` 两处都会抛错；结构上「无结果锚点」「结果全非法 URL」也按失败处理。真正查询无结果（DDG `No results.`、SearXNG/Tavily 空数组）才返回空列表。
- **去重**：与之前一致，只合并去掉 fragment 后完全相同的 URL，不合并尾斜杠、查询串、协议或 www 差异；标题截 300、摘要截 1500 字符。

## 验证

离线：`npm run test:web` 19 项通过，覆盖缓存 TTL/LRU/字节预算、并发合并、取消隔离、失败不缓存、回退顺序、冷却与恢复、key 轮换隔离、SearXNG 解析与 403/非 JSON 失败、DDG fixture（含 `uddg` 解码、anomaly、空结果）、HTML→Markdown、SSRF（字面量/DNS/后缀/降级/环路）、抓取超限与非 HTML 类型、工具描述跨环境稳定、分页与快照。

实网 `npm run smoke:web`（2026-10-02，本机，未配置 `TAVILY_API_KEY` 与 `SEARXNG_URL`，exit 0）：

- 三个查询由 Tavily keyless 命中（冷 0.4–1.1 s，热 0.03–0.07 ms），首条正文全部由 `direct` 本机抓取成功：docs.rs 19,233 字符 / 738 ms，react.dev 23,008 字符 / 944 ms，typescriptlang.org 39,337 字符 / 1,158 ms，均含代码围栏与绝对 Markdown 链接。
- 额外探针：DuckDuckGo HTML 实时解析出 3 条结果（1.6 s）；本机抓取 docs.rs 成功（776 ms，19,233 字符）；SearXNG 未配置，跳过。
- 这是单机一次测量，不构成相关性评测，也不宣称任何服务长期免费或可靠。

## 操作方式

- 不配置任何变量：Tavily keyless 搜索 + 本机抓取，默认可用。
- 自托管 SearXNG：设置环境变量 `SEARXNG_URL=https://your-instance.example/`（实例需在 `settings.yml` 打开 `search.formats: [json]`）。
- 更高额度：`TAVILY_API_KEY`（设置后 Tavily 带 key 优先，keyless 次数不受影响）。
- 想让本机抓取优先于 Tavily keyless：现在的默认即如此；有 key 时 Tavily 提取优先，失败自动回退本机抓取。

## 已知限制

- 打包后从 Dock/开始菜单启动时 `process.env` 不继承 shell 环境，`TAVILY_API_KEY` 与新的 `SEARXNG_URL` 都读不到；设置界面暴露属于本任务边界之外，见 `.qa/search-handoff.json`。
- 本机抓取不渲染 JS，动态站点会失败；失败信息会建议改用浏览器工具。
- DuckDuckGo 端点无官方契约，可能随时调整标记或被拦截，只能作为尽力而为的候选。
- 未评测公共 SearXNG 实例；代码按官方 JSON 契约实现，只有用户自己的实例能验证。
- 未做 A/B 相关性对比，也没有与旧版 Tavily-only 行为比较质量或费用。
