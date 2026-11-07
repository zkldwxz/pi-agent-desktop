import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { applyCodeTheme, getCodeTheme } from "./lib/code-theme";
import { applyAppearance, loadAppearance } from "./lib/appearance-prefs";
import { installInteractionSounds } from "./lib/sound";
import { IS_MAC } from "./lib/platform";
import "./index.css";

/* set before the first paint, or the scrollbars style themselves once and then
   change shape mid-render */
document.documentElement.classList.toggle("os-mac", IS_MAC);

/* the stored code palette applies before first paint, so a code block never
   flashes the default theme on its way to the saved one */
applyCodeTheme(getCodeTheme());
/* same for the code font, ligatures, conversation width and sidebar times */
applyAppearance(loadAppearance());

/**
 * Dev-only: React's duplicate-key warning is the one class of bug that is
 * invisible in production and trivially fixable while it is visible. Renderers
 * here feed the vendored primitives real data (tool output, agent-written task
 * labels) where repeated strings are normal, so surface the offending component
 * instead of the bare key.
 */
if (import.meta.env.DEV) {
  const original = console.error;
  console.error = (...args: unknown[]) => {
    const first = args[0];
    if (typeof first === "string" && first.includes("same key")) {
      const stack = args.find((arg) => typeof arg === "string" && arg.includes("at "));
      original(`[dup-key] key=${String(args[1] ?? "?")}\n${String(stack ?? "").split("\n").slice(0, 12).join("\n")}`);
      return;
    }
    original(...args);
  };
}

/* The preview bridge is loaded lazily and only under DEV: `import.meta.env.DEV`
   folds to `false` in a production build, so the fixture — 32KB of fake sessions
   and a stand-in `window.pi` — is dropped from the bundle instead of shipping to
   users who can never reach it. The render waits for the import so the bridge is
   installed before the first component reads `window.pi`. */
async function boot(): Promise<void> {
  if (import.meta.env.DEV) {
    const { installPreviewBridge } = await import("./lib/preview-bridge");
    installPreviewBridge();
  }
  installInteractionSounds();
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void boot();
