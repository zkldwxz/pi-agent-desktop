import { useEffect, useState } from "react";
import type { SshProfile } from "@shared/workspaces";
import { Section, Row } from "../components/panel/SettingsParts";
import WorkspaceDialog from "../components/agent/WorkspaceDialog";
import { cn } from "../lib/cn";
import { t, tf } from "../lib/i18n";
import { PlusIcon, RefreshIcon, TerminalIcon, TrashIcon, XIcon } from "../components/icons";

/**
 * SSH servers — every saved connection in one place.
 *
 * The workspace dialog is still the place that *connects*: a password or a
 * key's passphrase is never persisted, so "reconnect" can only mean opening
 * the form with this row's details filled. What lives here is the inventory —
 * which hosts exist, which are live right now, and which get removed.
 */
export function SshServersSection() {
  const [profiles, setProfiles] = useState<SshProfile[] | null>(null);
  const [error, setError] = useState("");
  const [managing, setManaging] = useState(false);

  const refresh = () => void window.pi.listSsh().then(setProfiles).catch((e) => setError(String(e)));
  useEffect(() => {
    refresh();
    /* the same feed the workspace dialog follows — a connect finishing
       elsewhere flips a row's dot without a manual refresh */
    const unsubscribe = window.pi.onWorkspaceChange(refresh);
    return unsubscribe;
  }, []);

  const run = async (job: () => Promise<unknown>) => {
    setError("");
    try { await job(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    refresh();
  };

  return (
    <>
      <Section title={t("SSH servers")} index={0}>
        {profiles === null ? (
          <div className="px-4 py-3 text-ui-sm text-ink-3">{t("Loading…")}</div>
        ) : profiles.length === 0 ? (
          <div className="px-4 py-3 text-ui-sm text-ink-3">
            {t("No saved connections yet. Add one to open a remote workspace.")}
          </div>
        ) : (
          profiles.map((profile) => (
            <Row
              key={profile.id}
              title={`${profile.username}@${profile.host}:${profile.port}`}
              mono
              hint={
                [
                  profile.jumpHostId ? tf("via {host}", { host: profiles.find((p) => p.id === profile.jumpHostId)?.name ?? profile.jumpHostId }) : null,
                  profile.folder ?? null,
                  profile.error ?? null,
                ].filter(Boolean).join(" · ") || undefined
              }
            >
              <span className="mr-1 flex items-center gap-1.5 text-ui-xs text-ink-3">
                <span
                  className={cn(
                    "size-2 rounded-full",
                    profile.status === "connected" ? "bg-green" : profile.status === "connecting" ? "bg-accent" : profile.status === "error" ? "bg-red" : "bg-line-strong",
                  )}
                />
                {profile.name !== `${profile.username}@${profile.host}` ? profile.name : t(profile.status === "connected" ? "Connected" : "Disconnected")}
              </span>
              {profile.status === "connected" ? (
                <button
                  type="button"
                  title={t("Disconnect")}
                  aria-label={t("Disconnect")}
                  onClick={() => void run(() => window.pi.disconnectSsh(profile.id))}
                  className="pressable flex size-7 items-center justify-center rounded-control border border-line text-ink-3 hover:bg-hover hover:text-ink"
                >
                  <XIcon size={12} />
                </button>
              ) : null}
              <button
                type="button"
                title={t("Reconnect…")}
                aria-label={t("Reconnect…")}
                onClick={() => setManaging(true)}
                className="pressable flex size-7 items-center justify-center rounded-control border border-line text-ink-3 hover:bg-hover hover:text-ink"
              >
                <RefreshIcon size={12} />
              </button>
              <button
                type="button"
                title={t("Remove")}
                aria-label={t("Remove")}
                onClick={() => void run(() => window.pi.removeSsh(profile.id))}
                className="pressable flex size-7 items-center justify-center rounded-control border border-line text-ink-3 hover:bg-hover hover:text-red"
              >
                <TrashIcon size={12} />
              </button>
            </Row>
          ))
        )}
        <div className="px-4 py-2">
          <button
            type="button"
            onClick={() => setManaging(true)}
            className="pressable flex items-center gap-1.5 rounded-control border border-line px-3 py-1.5 text-ui-caption text-ink hover:bg-hover"
          >
            <PlusIcon size={12} />
            {t("Add SSH server")}
          </button>
        </div>
      </Section>
      <p className="px-1 text-ui-sm leading-relaxed text-ink-3">
        <TerminalIcon size={12} className="mr-1.5 inline-block align-[-2px] text-ink-4" />
        {t("Passwords and passphrases are never stored — reconnecting asks for them again. Key paths are kept, so key-based hosts reconnect in one step. A jump host must itself be connected.")}
      </p>
      {error ? <p role="alert" className="px-1 text-ui-sm text-red">{error}</p> : null}
      {managing ? <WorkspaceDialog initialTab="ssh" onClose={() => { setManaging(false); refresh(); }} /> : null}
    </>
  );
}
