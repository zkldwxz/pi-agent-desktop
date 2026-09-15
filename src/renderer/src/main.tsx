import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";

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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
