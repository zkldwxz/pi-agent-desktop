import { useEffect, useState } from "react";
import type { CatalogItem } from "@shared/types";
import { cn } from "../lib/cn";
import { t, tf } from "../lib/i18n";
import { StatusPill } from "../components/beautiful/atoms/StatusPill";
import { CheckIcon, GlobeIcon, LayersIcon, ListChecksIcon, ListIcon, SparkIcon } from "../components/icons";

const ICON: Record<string, React.ReactNode> = {
  "skill:browser-design": <SparkIcon size={16} />,
  "skill:browser-ops": <GlobeIcon size={16} />,
  "skill:plan-with-tasks": <ListIcon size={16} />,
  "extension:plan-mode": <ListChecksIcon size={16} />,
  "capability:browser": <GlobeIcon size={16} />,
  "capability:todos": <LayersIcon size={16} />,
};

function Checkbox({ on }: { on: boolean }) {
  return (
    <span
      className={cn(
        "flex size-[18px] shrink-0 items-center justify-center rounded-[5px]",
        on ? "bg-ink text-canvas" : "bg-field text-transparent shadow-hairline",
      )}
      style={{ transition: "background-color 160ms ease-out, color 160ms ease-out" }}
    >
      <CheckIcon size={11} />
    </span>
  );
}

/**
 * Welcome.
 *
 * Chooses what this desktop turns on for the agent. Two kinds of item:
 *
 *  · **skills** are markdown copied into `~/.pi/agent/skills/`, so the Pi CLI
 *    sees them too, and unchecking removes them again
 *  · **capabilities** are built into this app (the browser tools and the task
 *    list), so their switch is a flag rather than a file
 *
 * The result is written to `~/.pi/agent/desktop.json` and the session is
 * rebuilt, which is what makes the tools appear.
 */
export function WelcomeView({ onDone }: { onDone: () => void }) {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void window.pi.getCatalog().then((catalog) => {
      if (cancelled) return;
      setItems(catalog);
      setPicked(new Set(catalog.map((item) => item.id)));
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = (id: string) => {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const apply = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await window.pi.applyCatalog([...picked]);
      await window.pi.finishOnboarding();
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };

  const extensions = items.filter((item) => item.kind === "extension");
  const skills = items.filter((item) => item.kind === "skill");
  const capabilities = items.filter((item) => item.kind === "capability");

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-page">
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[620px] flex-col gap-6 px-6 py-14">
          <header className="flex flex-col gap-2" style={{ animation: "fade-up 460ms cubic-bezier(0.23,1,0.32,1) both" }}>
            <div className="flex size-9 items-center justify-center rounded-card bg-ink text-canvas">
              <span className="text-[15px] font-semibold">π</span>
            </div>
            <h1 className="text-[22px] font-semibold tracking-[-0.03em] text-ink">{t("Set up Pi Agent Desktop")}</h1>
            <p className="text-[13px] leading-relaxed text-ink-3">
              {t("These attach to the Pi agent already on this machine. Skills are written to")}{" "}
              <span className="font-mono text-ink-2">~/.pi/agent/skills/</span>{" "}
              {t("and capabilities are built into this app. Nothing here is required, and you can change it later in Settings.")}
            </p>
          </header>

          {loading ? (
            <div className="flex flex-col gap-2">
              {[0, 1, 2, 3].map((index) => (
                <div
                  key={index}
                  className="h-[62px] rounded-card bg-hover-2"
                  style={{ animation: `fade-in 300ms ease-out ${index * 50}ms both` }}
                />
              ))}
            </div>
          ) : (
            <>
              <Group title={t("Capabilities")} hint={t("built in — no files copied")}>
                {capabilities.map((item, index) => (
                  <Item key={item.id} item={item} on={picked.has(item.id)} index={index} onToggle={() => toggle(item.id)} />
                ))}
              </Group>

              {skills.length ? (
                <Group title={t("Skills")} hint={t("copied into ~/.pi/agent/skills/")}>
                  {skills.map((item, index) => (
                    <Item key={item.id} item={item} on={picked.has(item.id)} index={index} onToggle={() => toggle(item.id)} />
                  ))}
                </Group>
              ) : null}

              {extensions.length ? (
                <Group title={t("Extensions")} hint={t("copied into ~/.pi/agent/extensions/")}>
                  {extensions.map((item, index) => (
                    <Item key={item.id} item={item} on={picked.has(item.id)} index={index} onToggle={() => toggle(item.id)} />
                  ))}
                </Group>
              ) : null}
            </>
          )}

          {error ? (
            <div className="rounded-card bg-red-tint px-3 py-2 text-[12px] text-red">{error}</div>
          ) : null}

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              disabled={busy || loading}
              onClick={() => void apply()}
              className="pressable-soft pressable h-9 rounded-control bg-ink px-4 text-[13px] font-medium text-canvas disabled:opacity-50"
            >
              {busy ? t("Setting up…") : tf("Continue with {count} selected", { count: picked.size })}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setPicked(new Set());
                void apply();
              }}
              className="pressable h-9 rounded-control px-3 text-[12.5px] text-ink-3 hover:bg-hover hover:text-ink-2"
            >
              {t("Skip for now")}
            </button>
            <span className="flex-1" />
            <span className="text-[10.5px] text-ink-3">{t("Settings → Plugins to change this later")}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Group({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2 px-0.5">
        <h2 className="text-[12.5px] font-medium text-ink">{title}</h2>
        <span className="text-[11px] text-ink-3">{hint}</span>
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

function Item({
  item,
  on,
  index,
  onToggle,
}: {
  item: CatalogItem;
  on: boolean;
  index: number;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{ animation: `fade-up 420ms cubic-bezier(0.23,1,0.32,1) ${index * 45}ms both` }}
      className={cn(
        "pressable-soft pressable flex w-full items-start gap-3 rounded-card p-3 text-left shadow-card",
        on ? "bg-surface" : "bg-surface/60 hover:bg-hover",
      )}
    >
      <Checkbox on={on} />
      <span className="mt-px shrink-0 text-ink-3">{ICON[item.id] ?? <SparkIcon size={16} />}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-[12.5px] font-medium text-ink">{item.name}</span>
          {item.installed ? <StatusPill tone="green">{t("Installed")}</StatusPill> : null}
          {item.kind === "capability" ? <StatusPill tone="accent">{t("Built in")}</StatusPill> : null}
        </span>
        <span className="mt-0.5 block text-[11.5px] leading-snug text-ink-3">{item.description}</span>
      </span>
    </button>
  );
}
