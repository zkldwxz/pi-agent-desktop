import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createAgentBashTool } from "./bash";
import { createAgentGrepTool } from "./grep";
import { createAgentReadTool } from "./read";

/**
 * The desktop's tool-output policy, as one pi extension.
 *
 * Three built-ins are overridden by name — `bash`, `read`, `grep` — and each
 * override is the built-in's own definition with a smaller, cleaned result:
 *
 *   bash   no colour in the child env, ANSI/CR control cleaned, 20KB inline
 *          (6KB head + 14KB tail), full output on disk with its path in the result
 *   read   24KB inline, continued with pi's own `offset`; images untouched
 *   grep   16KB inline, pi's match/line notices kept, continued by narrowing
 *
 * The point is the model's context: a tool result is paid for on every
 * subsequent request, and terminal noise, progress frames and 50KB dumps of
 * repeated build output are the cheapest tokens to stop sending. Nothing is
 * cached, the arguments are the tool's own schema, cancellation flows to pi's
 * backend, and every continuation path points at the full data.
 *
 * Wiring is `SESSION_TOOLS` in `pi-host.ts` — the list the main session and every
 * sub-agent session are provisioned from:
 *
 *     const SESSION_TOOLS: NamedExtensionFactory[] = [
 *       { name: "pi-desktop-web", factory: registerWebTools },
 *       { name: "pi-desktop-agent-tools", factory: registerAgentTools },
 *     ];
 *
 * The `cwd` passed to the definitions is only the fallback pi uses when a tool
 * runs without a context; every call in an agent session carries `ctx.cwd`, so
 * the session's own working directory is what the tools actually use — and each
 * call re-reads pi's settings for that directory (shell path, command prefix,
 * image resize), the way the built-ins it overrides do.
 */
export function registerAgentTools(pi: ExtensionAPI): void {
  const fallbackCwd = process.cwd();
  pi.registerTool(createAgentBashTool(fallbackCwd));
  pi.registerTool(createAgentReadTool(fallbackCwd));
  pi.registerTool(createAgentGrepTool(fallbackCwd));
}
