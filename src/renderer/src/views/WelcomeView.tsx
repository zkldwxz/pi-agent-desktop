import { useEffect, useState } from "react";
import type { CatalogItem } from "@shared/types";
import { cn } from "../lib/cn";
import { initialsOf } from "../lib/format";
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
        "flex size-[18px] shrink-0 items-center justify-center rounded-chip",
        on ? "bg-ink text-canvas" : "bg-field text-transparent shadow-hairline",
      )}
      style={{ transition: "background-color 160ms ease-out, color 160ms ease-out" }}
    >
      <CheckIcon size={11} />
    </span>
  );
}

/* ── the boot loader ────────────────────────────────────── */

/* The reference's pixel-grid loader: a 3×3 field whose cells light in a
 * chevron wavefront — the 650ms cycle is shorter than the sweep, so two fronts
 * are always in flight. Paired with a shimmering label and a live elapsed
 * timer in mono tabular figures. */

const DRIVE_DELAYS = Array.from({ length: 9 }, (_, i) => {
  const row = Math.floor(i / 3);
  const column = i % 3;
  return (column + Math.abs(row - 1)) * 90;
});

function LoaderGrid() {
  return (
    <span aria-hidden className="grid shrink-0 grid-cols-[repeat(3,4px)] gap-[1.5px]">
      {DRIVE_DELAYS.map((delay, index) => (
        <span
          key={index}
          className="size-[4px] rounded-[1px] bg-ink"
          style={{ opacity: 0.15, animation: `pixel-on 650ms ease-in-out ${delay}ms infinite` }}
        />
      ))}
    </span>
  );
}

function useElapsed() {
  const [tenths, setTenths] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTenths((value) => value + 1), 100);
    return () => window.clearInterval(timer);
  }, []);
  const seconds = tenths / 10;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}m ${(seconds % 60).toFixed(1)}s`;
}

function BootLoader({ label }: { label: string }) {
  const elapsed = useElapsed();
  return (
    <div role="status" className="flex w-fit items-center gap-2.5">
      <LoaderGrid />
      <span
        className="bg-clip-text text-ui-caption font-medium text-transparent"
        style={{
          backgroundImage: "linear-gradient(90deg, var(--ink-3) 35%, var(--ink) 50%, var(--ink-3) 65%)",
          backgroundSize: "200% 100%",
          animation: "shimmer-text 1.4s linear infinite",
        }}
      >
        {label}
      </span>
      <span className="font-mono text-ui-sm tabular-nums text-ink-3">{elapsed}</span>
    </div>
  );
}

/**
 * Welcome.
 *
 * Three beats, in the order a first run actually needs them:
 *
 *  1. **boot** — the workspace is being read (catalog, config); a pixel-grid
 *     loader with a live timer says the wait is real work, not a hang
 *  2. **name** — who is sitting here. It drives the account row's avatar and
 *     label; the OS user is the prefill, one keystroke to change
 *  3. **plugins** — what this desktop turns on for the agent:
 *
 *     · **skills** are markdown copied into `~/.pi/agent/skills/`, so the Pi
 *       CLI sees them too, and unchecking removes them again
 *     · **capabilities** are built into this app (the browser tools and the
 *       task list), so their switch is a flag rather than a file
 *
 * The result is written to `~/.pi/agent/desktop.json` and the session is
 * rebuilt, which is what makes the tools appear.
 */
export function WelcomeView({ onDone }: { onDone: () => void }) {
  const [stage, setStage] = useState<"boot" | "name" | "plugins">("boot");
  const [name, setName] = useState("");
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  /* the catalog and the default name arrive together; the boot screen holds
   * for a deliberate beat so the entrance reads as an entrance, not a flash */
  useEffect(() => {
    let cancelled = false;
    const ready = window.pi.getCatalog().then((catalog) => {
      if (cancelled) return;
      setItems(catalog);
      setPicked(new Set(catalog.map((item) => item.id)));
    });
    const named = window.pi
      .getDesktopConfig()
      .then((config) => {
        if (cancelled) return;
        setName(config.userName ?? "");
      })
      .catch(() => undefined);
    const beat = new Promise((resolve) => window.setTimeout(resolve, 900));
    void Promise.all([ready, named, beat]).then(() => {
      if (cancelled) return;
      setStage("name");
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
      await window.pi.setUserName(name);
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
      {stage === "boot" ? (
        /* the whole page is the loader: centred, quiet, unmistakably working */
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5">
          <div
            className="flex size-11 items-center justify-center rounded-card bg-ink text-canvas"
            style={{ animation: "pop-in 320ms var(--ease-out-strong-css) both" }}
          >
            <span className="text-ui-lg font-semibold">π</span>
          </div>
          <div style={{ animation: "fade-in 300ms ease-out 120ms both" }}>
            <BootLoader label={t("Preparing your workspace…")} />
          </div>
        </div>
      ) : stage === "name" ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 pb-20">
          <div className="flex w-full max-w-[420px] flex-col items-center gap-6">
            {/* the avatar answers the input live — what you type is what the
                account row will look like */}
            <div
              className="flex size-16 items-center justify-center rounded-full bg-ink text-canvas shadow-card"
              style={{ animation: "pop-in 320ms var(--ease-out-strong-css) both" }}
            >
              <span className="text-ui-lg font-semibold tracking-[0.02em]">{initialsOf(name)}</span>
            </div>
            <div className="flex flex-col items-center gap-1.5 text-center">
              <h1 className="text-ui-display font-semibold tracking-[-0.03em] text-ink">{t("What's your name?")}</h1>
              <p className="text-ui-base leading-relaxed text-ink-3">
                {t("It sits in the corner of the sidebar as your avatar and your name.")}
              </p>
            </div>
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing && name.trim()) {
                  event.preventDefault();
                  setStage("plugins");
                }
              }}
              placeholder={t("Your name")}
              aria-label={t("Your name")}
              className="h-11 w-full rounded-control bg-surface px-3.5 text-center text-ui-lg text-ink shadow-hairline outline-none placeholder:text-ink-4"
              style={{ animation: "fade-up 300ms var(--ease-out-strong-css) 80ms both" }}
            />
            <button
              type="button"
              disabled={!name.trim()}
              onClick={() => setStage("plugins")}
              className="pressable h-9 w-full rounded-control bg-ink px-4 text-ui-base font-medium text-canvas disabled:opacity-40"
              style={{ animation: "fade-up 300ms var(--ease-out-strong-css) 140ms both" }}
            >
              {t("Continue")}
            </button>
          </div>
        </div>
      ) : (
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-[620px] flex-col gap-6 px-6 py-14">
            <header className="flex flex-col gap-2" style={{ animation: "fade-up 460ms var(--ease-out-strong-css) both" }}>
              <h1 className="text-ui-display font-semibold tracking-[-0.03em] text-ink">{t("Set up Pi Agent Desktop")}</h1>
              <p className="text-ui-base leading-relaxed text-ink-3">
                {t("These attach to the Pi agent already on this machine. Skills are written to")}{" "}
                <span className="font-mono text-ink-2">~/.pi/agent/skills/</span>{" "}
                {t("and capabilities are built into this app. Nothing here is required, and you can change it later in Settings.")}
              </p>
            </header>

            {!items.length ? (
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
              <div className="rounded-card bg-red-tint px-3 py-2 text-ui-caption text-red">{error}</div>
            ) : null}

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                disabled={busy || !items.length}
                onClick={() => void apply()}
                className="pressable-soft pressable h-9 rounded-control bg-ink px-4 text-ui-base font-medium text-canvas disabled:opacity-50"
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
                className="pressable h-9 rounded-control px-3 text-ui-caption text-ink-3 hover:bg-hover hover:text-ink-2"
              >
                {t("Skip for now")}
              </button>
              <span className="flex-1" />
              <span className="text-ui-xs text-ink-3">{t("Settings → Plugins to change this later")}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Group({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2 px-0.5">
        <h2 className="text-ui-caption font-medium text-ink">{title}</h2>
        <span className="text-ui-sm text-ink-3">{hint}</span>
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
      style={{ animation: `fade-up 420ms var(--ease-out-strong-css) ${index * 45}ms both` }}
      className={cn(
        "pressable-soft pressable flex w-full items-start gap-3 rounded-card p-3 text-left shadow-card",
        on ? "bg-surface" : "bg-surface/60 hover:bg-hover",
      )}
    >
      <Checkbox on={on} />
      <span className="mt-px shrink-0 text-ink-3">{ICON[item.id] ?? <SparkIcon size={16} />}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-ui-caption font-medium text-ink">{item.name}</span>
          {item.installed ? <StatusPill tone="green">{t("Installed")}</StatusPill> : null}
          {item.kind === "capability" ? <StatusPill tone="accent">{t("Built in")}</StatusPill> : null}
        </span>
        <span className="mt-0.5 block text-ui-sm leading-snug text-ink-3">{item.description}</span>
      </span>
    </button>
  );
}
