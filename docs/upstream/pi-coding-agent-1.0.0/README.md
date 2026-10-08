# pi-coding-agent 1.0.0 — vendored reference

Upstream material copied into this repository so the implementation can be read
here instead of inside `node_modules`. Regenerate with `npm run vendor:upstream`;
the script is idempotent and this `README.md` is never overwritten.

This folder is documentation only. It sits outside both `tsconfig.*.json`
includes and outside electron-builder's `out/**` file list, so it is never
typechecked, bundled or shipped.

## Layout

- `src/` — the package's original TypeScript, 244 files. The npm tarball ships no
  `src/`, but every `dist/**/*.js.map` carries `sourcesContent`, and the extractor
  writes those out verbatim. Import specifiers are the upstream style (`./x.ts`);
  these files are meant to be read, not compiled.
- `docs/` — the 40 markdown pages the package publishes: `mcp.md`, `sdk.md`,
  `extensions.md`, `settings.md`, `models.md`, `cli.md`, `security.md`, …
- `CHANGELOG.md` — every release. The head of the file is the range this app
  crossed: 0.85.1 → 1.0.0.
- `manifest.json` — version and file counts, written by the extractor.

## What this repository already wired up

- `src/main/pi-host.ts` — the session's `extensionFactories` now include
  `createCodemodeExtension()`, `createToolSearchExtension()` and
  `createMcpExtension({ openUrl })`. SDK sessions do not load pi's built-in
  extensions (`src/index.ts` exports only the factories), so without these three
  MCP, codemode and tool search are silently absent. They are injected into the
  main session only; sub-agent sessions built from `SESSION_TOOLS` do not get
  them.
- `src/main/mcp.ts`, `src/shared/mcp.ts` — reading and writing `mcp.json`
  (global + project, add/patch/remove, enable, exposure). Upstream implements all
  of this in `src/extensions/mcp/config.ts`, but `dist/index.d.ts` re-exports only
  the *types* and the extension factory, so the local implementation exists to
  fill that gap. If upstream ever exports `loadMcpConfig` /
  `addMcpServerConfig` / `updateMcpServerConfig` / `removeMcpServerConfig`, the
  local one can be deleted.
- `src/renderer/src/views/McpView.tsx` — the management screen: list, add, edit,
  delete, enable/disable, exposure, and the `defaultTools` switches for
  `codemode` / `tool_search`.
- `scripts/mcp-regression.mjs` — file-level regression for `src/main/mcp.ts`.

## Open questions worth a closer look

- **Project trust.** pi only reads `<project>/.pi/mcp.json` for a trusted project.
  This app lists project entries unconditionally and has no trust UI.
  `loadMcpConfig` takes `projectTrusted`, and extensions can ask
  `ctx.isProjectTrusted()`.
- **Sign-in.** The screen runs pi's `/mcp login|logout|reconnect <server>` through
  the session, so progress arrives as a normal turn. `McpExtensionOptions.openUrl`
  hands the browser window off; there is no dedicated sign-in surface, no cancel,
  and no view of the per-server credentials in `mcp-auth.json`.
- **Tool exposure defaults.** `codemode` (the default) keeps MCP tools out of the
  model's declarations and reaches them from scripts. Whether the screen should
  suggest `direct` for small servers is a product call, not a defect.
- **`mcp.json` fields with no form:** `toolExposure`, `oauth`, `auth.provider`,
  `cwd`. The editor preserves them on save but cannot set them.
- **1.0 capabilities not surfaced yet:** virtual models, classifier models
  (`models.classify()`), image generation (`models.generateImages()`), per-model
  image input limits, `context_with_system`, `ContextEditEntry`, and the extension
  tool API (`exposure`, `namespace`, `annotations`, `outputSchema`,
  `ctx.executeTool()`, `prepareLoadout()`).
- **`models.json` fields with no form:** `samplingParams`, `vllmPriority`,
  `supportsMaxOutputTokens`.

## What the upgrade changed in behaviour

One thing only, so far: a non-zero `bash` exit is an error *result*
(`isError: true`) instead of a thrown error — see `src/core/tools/bash.ts`. The
desktop's cleaning and budget path already handled result-shaped failures, so
only the expectations in `scripts/tool-policy-regression.mjs` moved.
