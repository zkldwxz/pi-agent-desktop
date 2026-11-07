# AGENT

- 用用户当前的语言回复（本仓库默认中文）。
- 改完代码只跑与改动相关的测试/回归。全量套件慢，别随手跑。
- 必须实际执行 `npm run typecheck` 并报告真实结果；跑不了就如实说，
  不把失败写成通过。

## 项目

Pi Agent Desktop：Electron + TypeScript 的 pi 编码智能体桌面壳
（GPL-3.0）。工程约定读 `AGENTS.md`；视觉契约读 `DESIGN.md`。
功能对齐基线是 `baocode-dev/baocode` 的代码（本地
`~/Projects/baocode`，同为 GPL-3.0）——移植按 `lib/` 里的行为契约
抄实现，不做目录级合并。功能版图与差距矩阵在
`docs/research/2026-11-07-baocode-feature-map.md` 与
`2026-11-07-baocode-parity.md`。

## 已移除（勿恢复）

- **Ultra**：整个功能已彻底删除，不再维护。模型思考层级只用 pi 原生
  level（off/low/medium/high/xhigh/max），不要再合成 `ultra`。
- **`tool_search` 插件**：因噪音问题拆除，`deferred` exposure 随之
  退役（存量配置自动改写为 `codemode`）。
