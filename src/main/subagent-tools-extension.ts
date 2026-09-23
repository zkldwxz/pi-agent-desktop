import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";

/**
 * What a sub-agent session runs.
 *
 * A sub-agent is a real pi session created inside this process, so it can load
 * the same inline extensions the parent session does — but it must not load
 * anything from disk, or it would bring the team tools with it and nest. Only
 * the host knows which factories those are, so agent-team asks over the shared
 * event bus and this listener answers.
 *
 * The channel name is the whole contract between the two sides: agent-team
 * ships as an ordinary plugin in `~/.pi/agent/extensions/` and cannot import
 * app code, exactly like the plan and fleet state it publishes. Like those, it
 * is duplicated on both sides on purpose.
 */

/** One inline extension, in the shape `extensionFactories` takes. */
export interface NamedExtensionFactory {
  name: string;
  factory: ExtensionFactory;
}

/** agent-team's request for the factories its sub-agent sessions must load. */
const BUS_CONFIGURE_TOOLS = "agent-team:configure-tools";

/**
 * Answer agent-team's request.
 *
 * The bus is synchronous and per session, so the caller's array is filled
 * before its `emit` returns — that is what the request/response shape relies
 * on. A host that registers no listener leaves the list empty, and the
 * sub-agent runs on the built-in tools alone.
 */
export function registerSubagentTools(pi: ExtensionAPI, factories: NamedExtensionFactory[]): void {
  pi.events.on(BUS_CONFIGURE_TOOLS, (data) => {
    const request = data as { factories?: NamedExtensionFactory[] } | null | undefined;
    if (!request || !Array.isArray(request.factories)) return;
    request.factories.push(...factories);
  });
}
