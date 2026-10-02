import { useMemo } from "react";
import type { ChatMessage } from "@shared/types";
import type { DesignPick } from "@shared/browser";
import ContextCards, { type ContextChunk } from "../beautiful/primitives/ContextCards";
import { t, useLocale } from "../../lib/i18n";
import ChatComposer, { type ChatMessage as ComposerMessage } from "../beautiful/primitives/ChatComposer";
import SelectionActions, { type SelectionActionSet } from "../beautiful/primitives/SelectionActions";
import { PencilIcon } from "../icons";

/** The style keys worth showing, in the order a designer reads them. */
const SHOWN_STYLES = [
  "display",
  "width",
  "height",
  "padding",
  "gap",
  "font-size",
  "font-weight",
  "line-height",
  "color",
  "background-color",
  "border-radius",
  "box-shadow",
] as const;

function chunkFor(pick: DesignPick): ContextChunk[] {
  const chunks: ContextChunk[] = [];

  chunks.push({
    title: `${pick.component ? `${pick.component} · ` : ""}${pick.tag}`,
    chars: `${pick.rect.width} × ${pick.rect.height}`,
    body: pick.selector,
    source: pick.page.url.replace(/^https?:\/\//, ""),
    badge: pick.mode === "region" ? "REGION" : "DOM",
    tone: "bg-accent",
  });

  const styles = SHOWN_STYLES.filter((key) => pick.styles[key])
    .slice(0, 8)
    .map((key) => `${key}: ${pick.styles[key]}`)
    .join("\n");
  if (styles) {
    chunks.push({
      title: t("Computed styles"),
      chars: `${Object.keys(pick.styles).length} properties`,
      body: styles,
      source: "getComputedStyle",
      badge: "CSS",
      tone: "bg-orange",
    });
  }

  if (pick.text) {
    chunks.push({
      title: t("Visible text"),
      chars: `${pick.text.length} characters`,
      body: pick.text,
      source: `${pick.tag} innerText`,
      badge: "TEXT",
      tone: "bg-green",
    });
  }

  const chain = pick.ancestry
    .map((node) => (node.component ? `${node.component}(${node.tag})` : node.tag) + (node.id ? `#${node.id}` : ""))
    .join("  ›  ");
  if (chain) {
    chunks.push({
      title: t("Ancestry"),
      chars: `${pick.ancestry.length} levels`,
      body: chain,
      source: "React fiber walk",
      badge: "TREE",
      tone: "bg-ink-3",
    });
  }

  return chunks;
}

/**
 * The design-mode result.
 *
 * A pick has two exits, and both are here:
 *
 *  · the **action bar** — one click to hand the element to the agent with an
 *    instruction (Explain / Improve / Shorten…), or to drop it into the
 *    conversation as context
 *  · the **context cards** — exactly what the agent will receive, so the user
 *    can see the selector, the computed styles and the ancestry before sending
 *
 * `ChatComposer` sits underneath for an in-place follow-up, which keeps the
 * back-and-forth anchored to the component instead of a separate chat.
 */
export function DesignPickBar({
  pick,
  recent,
  onAction,
  onSend,
  onDismiss,
}: {
  pick: DesignPick;
  /** the agent's replies for this pick, so the mini-chat shows real history */
  recent: ChatMessage[];
  onAction: (action: string, instruction?: string) => void;
  onSend: (text: string) => void;
  onDismiss: () => void;
}) {
  const locale = useLocale();
  const chunks = useMemo(() => chunkFor(pick), [pick, locale]);
  const messages = useMemo<ComposerMessage[]>(
    () =>
      recent.slice(-2).map((message) => ({
        label: message.usage?.model ?? t("agent"),
        sub: message.role === "user" ? t("you") : t("replied"),
        time: "",
        body: message.text.slice(0, 200),
      })),
    [recent, locale],
  );

  const actions = useMemo<SelectionActionSet>(
    () => ({
      primary: [
        { id: t("Add to chat"), icon: <PencilIcon size={13} />, action: "Add to chat" },
        { id: t("Explain"), icon: <PencilIcon size={13} />, action: "Explain this component" },
      ],
      more: [
        { id: t("Improve"), icon: <PencilIcon size={13} />, action: "Improve the layout and spacing", busyLabel: t("Improving") },
        { id: t("Shorten"), icon: <PencilIcon size={13} />, action: "Simpler markup", busyLabel: t("Simplifying") },
        { id: t("Tone"), icon: <PencilIcon size={13} />, action: "Match the surrounding style", busyLabel: t("Matching") },
      ],
    }),
    [locale],
  );

  return (
    <div
      className="pointer-events-none absolute inset-x-3 bottom-3 z-10 flex items-end justify-center"
      style={{ animation: "fade-up 260ms var(--ease-out-strong-css) both" }}
    >
      <div className="pointer-events-auto flex w-full max-w-[600px] flex-col gap-2 rounded-card bg-surface p-2.5 shadow-overlay">
        <div className="flex items-center gap-2">
          {pick.screenshot ? (
            <img
              src={pick.screenshot}
              alt=""
              className="h-10 w-16 shrink-0 rounded-chip object-cover shadow-hairline"
              style={{ animation: "pop-in 220ms var(--ease-out-strong-css) both" }}
            />
          ) : null}
          <div className="min-w-0 flex-1">
            <div className="truncate text-ui-caption font-medium text-ink">
              {pick.component ? `${pick.component} · ` : ""}
              {pick.tag}
              <span className="ml-1.5 font-mono text-ui-xs text-ink-3">
                {pick.rect.width}×{pick.rect.height}
              </span>
            </div>
            <div className="truncate font-mono text-ui-xs text-ink-3">{pick.selector}</div>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className="pressable shrink-0 rounded-chip px-2 py-1 text-ui-sm text-ink-3 hover:bg-hover hover:text-ink-2"
          >
            {t("Dismiss")}
          </button>
        </div>

        {/* what the agent receives */}
        <div className="scrollbar-thin max-h-[190px] overflow-y-auto">
          <ContextCards chunks={chunks} labels={{ header: t("Sent to the agent"), count: String(chunks.length) }} />
        </div>

        {/* one-click instructions */}
        <SelectionActions
          text={{
            lead: t("Selected") + " ",
            original: `${pick.component ?? pick.tag}`,
            rewrite: pick.selector,
          }}
          actions={actions}
          labels={{ keep: t("Send"), discard: t("Cancel"), placeholder: t("Describe the change") }}
          onAction={(action) => {
            if (action === "Add to chat") onAction(action);
            else onAction(action);
          }}
        />

        {/* anchored follow-up */}
        {messages.length ? (
          <ChatComposer
            messages={messages}
            suggestions={[t("Ask")]}
            labels={{ initialPrompt: t("Ask about this component"), placeholder: t("Ask about this component…") }}
            onSend={onSend}
          />
        ) : null}
      </div>
    </div>
  );
}
