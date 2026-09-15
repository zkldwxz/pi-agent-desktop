import { useEffect, useState } from "react";
import type { UiNotification, UiRequest } from "@shared/ui";
import ApprovalCard from "../beautiful/primitives/ApprovalCard";
import { cn } from "../../lib/cn";
import { AlertIcon, CheckCircleIcon, XIcon } from "../icons";
import { useFocusTrap } from "../motion";

/**
 * Extension dialogs.
 *
 * pi extensions ask the user things with `ctx.ui.confirm / select / input`, and
 * await the answer. `ApprovalCard` renders those: one question at a time, a
 * paging counter, Skip / Continue, and a free-text "something else" escape.
 *
 * `confirm` and `select` both reduce to a single-choice question; `input` is a
 * plain field, because the card is built for choices.
 */
export function ApprovalPrompt({ request, onAnswer }: { request: UiRequest; onAnswer: (answer: {
  id: string;
  cancelled?: boolean;
  confirmed?: boolean;
  value?: string;
}) => void }) {
  const [value, setValue] = useState("");
  const trapRef = useFocusTrap(true);

  useEffect(() => {
    setValue("");
  }, [request.id]);

  const questions =
    request.kind === "input"
      ? []
      : [
          {
            q: request.kind === "confirm" ? `${request.title}${request.message ? ` — ${request.message}` : ""}` : request.title,
            type: "radio" as const,
            options: request.kind === "confirm" ? ["Yes", "No"] : request.options ?? [],
          },
        ];

  return (
    <div
      ref={trapRef}
      className="fixed inset-0 z-[60] flex items-end justify-center px-4 pb-24"
      role="dialog"
      aria-modal="true"
      aria-label={request.title}
    >
      <div
        className="absolute inset-0 bg-black/20 backdrop-blur-[2px] dark:bg-black/45"
        style={{ animation: "fade-in 180ms ease-out both" }}
        onClick={() => onAnswer({ id: request.id, cancelled: true })}
      />
      <div
        className="relative w-full max-w-[460px]"
        style={{ animation: "pop-in 220ms cubic-bezier(0.23,1,0.32,1) both", transformOrigin: "bottom center" }}
      >
        <div className="mb-1.5 flex items-center gap-2 px-1">
          <span className="inline-flex h-4 items-center rounded-chip bg-ink px-1.5 font-mono text-[9.5px] text-canvas">
            agent
          </span>
          <span className="text-[11px] text-ink-3">needs a decision</span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => onAnswer({ id: request.id, cancelled: true })}
            aria-label="Dismiss"
            className="pressable flex size-5 items-center justify-center rounded-[5px] text-ink-3 hover:bg-hover hover:text-ink"
          >
            <XIcon size={11} />
          </button>
        </div>

        {request.kind === "input" ? (
          <div className="flex flex-col gap-2.5 rounded-card bg-surface p-3 shadow-overlay">
            <div className="text-[13px] font-medium text-ink">{request.title}</div>
            <input
              autoFocus
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  onAnswer({ id: request.id, value });
                }
                if (event.key === "Escape") onAnswer({ id: request.id, cancelled: true });
              }}
              placeholder={request.placeholder ?? ""}
              className="h-7 rounded-control bg-field px-2 font-mono text-[12px] text-ink outline-none placeholder:text-ink-3"
            />
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => onAnswer({ id: request.id, value })}
                className="pressable-soft pressable h-7 rounded-control bg-ink px-3 text-[12px] font-medium text-canvas"
              >
                Send
              </button>
              <button
                type="button"
                onClick={() => onAnswer({ id: request.id, cancelled: true })}
                className="pressable h-7 rounded-control px-2.5 text-[12px] text-ink-3 hover:bg-hover hover:text-ink-2"
              >
                Skip
              </button>
            </div>
          </div>
        ) : (
          <ApprovalCard
            resettable={false}
            questions={questions}
            labels={{ skip: "Skip", continue: "Continue", send: "Send" }}
            onSubmitted={(answers) => {
              const picked = answers[0] ?? [];
              if (!picked.length) {
                onAnswer({ id: request.id, cancelled: true });
                return;
              }
              const chosen = questions[0].options[picked[0]];
              if (request.kind === "confirm") onAnswer({ id: request.id, confirmed: picked[0] === 0, value: chosen });
              else onAnswer({ id: request.id, value: chosen });
            }}
          />
        )}
      </div>
    </div>
  );
}

/** Transient extension notices — `ctx.ui.notify`. */
export function NoticeStack({
  notices,
  onDismiss,
}: {
  notices: UiNotification[];
  onDismiss: (id: string) => void;
}) {
  if (!notices.length) return null;
  return (
    <div className="pointer-events-none fixed right-3 bottom-3 z-[55] flex w-72 flex-col gap-1.5">
      {notices.slice(-4).map((notice, index) => (
        <button
          key={notice.id}
          type="button"
          onClick={() => onDismiss(notice.id)}
          style={{ animation: `pop-in 220ms cubic-bezier(0.23,1,0.32,1) ${index * 40}ms both`, transformOrigin: "bottom right" }}
          className={cn(
            "pointer-events-auto flex items-start gap-2 rounded-card px-2.5 py-2 text-left shadow-overlay",
            notice.type === "error" ? "bg-red-tint text-red" : notice.type === "warning" ? "bg-orange-tint text-orange" : "bg-surface text-ink",
          )}
        >
          {notice.type === "info" ? (
            <CheckCircleIcon size={13} className="mt-px shrink-0 text-ink-3" />
          ) : (
            <AlertIcon size={13} className="mt-px shrink-0" />
          )}
          <span className="min-w-0 flex-1 text-[11.5px] leading-snug">{notice.message}</span>
        </button>
      ))}
    </div>
  );
}
