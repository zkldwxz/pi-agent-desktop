import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { SshProfile, WorkspaceInfo } from "@shared/workspaces";
import { t } from "../../lib/i18n";
import { useFocusTrap } from "../motion";

const fieldClass = "h-8 w-full rounded-control border border-line bg-field px-2 text-ui-base text-ink outline-none focus:border-line-strong";
const buttonClass = "pressable rounded-control border border-line px-3 py-1.5 text-ui-caption text-ink hover:bg-hover disabled:opacity-40";

/** One entry point for workspace membership and remote connection lifecycle. */
export default function WorkspaceDialog({ onClose, initialTab = "folders" }: { onClose: () => void; initialTab?: "folders" | "ssh" }) {
  const ref = useFocusTrap(true);
  const [tab, setTab] = useState(initialTab);
  const [workspace, setWorkspace] = useState<WorkspaceInfo>();
  const [profiles, setProfiles] = useState<SshProfile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [folder, setFolder] = useState("");
  const [name, setName] = useState("");
  const [selected, setSelected] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("22");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [privateKeyPath, setPrivateKeyPath] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [remoteFolder, setRemoteFolder] = useState("~");
  const [jumpHostId, setJumpHostId] = useState("");
  const [fingerprint, setFingerprint] = useState("");
  const [verified, setVerified] = useState(false);
  const [probing, setProbing] = useState(false);
  // Match the connection being authenticated, not an older profile with the
  // same host/user. Status events for duplicate saved endpoints can overlap.
  const progress = selected
    ? profiles.find((profile) => profile.id === selected)
    : profiles.find((profile) => profile.status === "connecting" && profile.host === host.trim() && profile.port === Number(port) && profile.username === username.trim());
  const phases: Record<string, string> = { connecting: "Connecting to host…", authenticating: "Authenticating…", "opening-sftp": "Opening file channel…", "checking-folder": "Checking workspace folder…", ready: "Connection ready" };
  useEffect(() => {
    let active = true;
    const refresh = () => void Promise.all([window.pi.getWorkspace(), window.pi.listSsh()]).then(([next, rows]) => { if (active) { setWorkspace(next); setName(next.name); setProfiles(rows); } }).catch((error) => { if (active) setError(String(error)); });
    refresh();
    const unsubscribe = window.pi.onWorkspaceChange(refresh);
    return () => { active = false; unsubscribe(); };
  }, []);
  useEffect(() => { const handler = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onClose(); }; document.addEventListener("keydown", handler); return () => document.removeEventListener("keydown", handler); }, [busy, onClose]);
  useEffect(() => { setFingerprint(""); setVerified(false); }, [host, port]);
  const run = async (job: () => Promise<void>) => { setBusy(true); setError(""); try { await job(); } catch (error) { setError(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); } };
  const select = (profile: SshProfile | undefined) => {
    setSelected(profile?.id || ""); setHost(profile?.host || ""); setPort(String(profile?.port || 22)); setUsername(profile?.username || ""); setPrivateKeyPath(profile?.privateKeyPath || ""); setPassword(""); setPassphrase(""); setJumpHostId(profile?.jumpHostId || ""); setFingerprint(""); setVerified(false);
    // Reopening the remembered folder keeps the same workspace anchor, so the
    // previous sessions stay reachable instead of silently starting over at ~.
    setRemoteFolder(profile?.folder || "~");
  };
  const refreshProfiles = async () => setProfiles(await window.pi.listSsh());
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/35 p-6" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={t("Workspace and SSH")} className="flex max-h-[85vh] w-full max-w-xl flex-col rounded-window border border-line bg-surface shadow-2xl">
        <div className="flex shrink-0 items-center gap-3 border-b border-line px-5 py-4">
          <h2 className="flex-1 text-ui-lg font-semibold text-ink">{t("Workspace and SSH")}</h2>
          <button type="button" onClick={onClose} disabled={busy} className={buttonClass}>{t("Close")}</button>
        </div>
        <div className="flex shrink-0 gap-1 border-b border-line px-5 py-2">
          <button type="button" onClick={() => setTab("folders")} aria-pressed={tab === "folders"} className={buttonClass}>{t("Workspace folders")}</button>
          <button type="button" onClick={() => setTab("ssh")} aria-pressed={tab === "ssh"} className={buttonClass}>SSH</button>
        </div>
        <div className="scrollbar-thin min-h-0 overflow-y-auto p-5">
          {tab === "folders" ? <div className="space-y-4">
            <label className="block space-y-1 text-ui-caption text-ink-2"><span>{t("Workspace name")}</span><input value={name} onChange={(e) => setName(e.target.value)} className={fieldClass} /></label>
            <button type="button" className={buttonClass} disabled={busy || !name.trim()} onClick={() => void run(async () => setWorkspace(await window.pi.renameWorkspace(name)))}>{t("Save name")}</button>
            <div className="space-y-2">{workspace?.folders.map((row, index) => <div key={row.path} className="flex items-center gap-3 rounded-control border border-line p-3"><div className="min-w-0 flex-1"><div className="text-ui-base text-ink">{row.name}{index === 0 ? ` · ${t("Primary folder")}` : ""}</div><div className="mt-1 break-all font-mono text-ui-xs text-ink-3">{row.path}</div></div>{index > 0 ? <button type="button" disabled={busy} className={buttonClass} onClick={() => void run(async () => setWorkspace(await window.pi.removeWorkspaceFolder(row.path)))}>{t("Remove")}</button> : null}</div>)}</div>
            <p className="text-ui-sm leading-relaxed text-ink-3">{t("All folders share this conversation. Use absolute paths to work across projects.")}</p>
            {workspace?.sshId ? <label className="block space-y-1 text-ui-caption text-ink-2"><span>{t("Remote folder path")}</span><input placeholder="/srv/project" value={folder} onChange={(e) => setFolder(e.target.value)} className={fieldClass} /></label> : null}
            <button type="button" disabled={busy || Boolean(workspace?.sshId && !folder.trim())} className={buttonClass} onClick={() => void run(async () => { setWorkspace(await window.pi.addWorkspaceFolder(workspace?.sshId ? folder : undefined)); setFolder(""); })}>{t("Add folder to workspace")}</button>
          </div> : <div className="space-y-4">
            <label className="block space-y-1 text-ui-caption text-ink-2"><span>{t("Saved SSH connections")}</span><select value={selected} onChange={(e) => select(profiles.find((profile) => profile.id === e.target.value))} className={fieldClass}><option value="">{t("New SSH connection")}</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · {t(profile.status === "connected" ? "Connected" : "Disconnected")}</option>)}</select></label>
            <div className="grid grid-cols-[1fr_80px] gap-3"><label className="space-y-1 text-ui-caption text-ink-2"><span>{t("Host")}</span><input value={host} onChange={(e) => setHost(e.target.value)} autoComplete="off" className={fieldClass} /></label><label className="space-y-1 text-ui-caption text-ink-2"><span>{t("Port")}</span><input value={port} onChange={(e) => setPort(e.target.value)} type="number" min="1" max="65535" className={fieldClass} /></label></div>
            <label className="block space-y-1 text-ui-caption text-ink-2"><span>{t("Username")}</span><input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" className={fieldClass} /></label>
            <label className="block space-y-1 text-ui-caption text-ink-2"><span>{t("Password (not saved)")}</span><input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="new-password" className={fieldClass} /></label>
            <label className="block space-y-1 text-ui-caption text-ink-2"><span>{t("Private key path")}</span><div className="flex gap-2"><input value={privateKeyPath} onChange={(e) => setPrivateKeyPath(e.target.value)} className={fieldClass} /><button type="button" disabled={busy} className={buttonClass} onClick={() => void run(async () => setPrivateKeyPath((await window.pi.pickSshKey()) || privateKeyPath))}>{t("Browse")}</button></div></label>
            {privateKeyPath ? <label className="block space-y-1 text-ui-caption text-ink-2"><span>{t("Key passphrase (not saved)")}</span><input value={passphrase} onChange={(e) => setPassphrase(e.target.value)} type="password" autoComplete="new-password" className={fieldClass} /></label> : null}
            <label className="block space-y-1 text-ui-caption text-ink-2"><span>{t("Remote folder path")}</span><input value={remoteFolder} onChange={(e) => setRemoteFolder(e.target.value)} className={fieldClass} /></label>
            {/* a bastion is another saved connection, and it must be live —
                the hop borrows its channel, not its credentials */}
            <label className="block space-y-1 text-ui-caption text-ink-2"><span>{t("Jump host (optional)")}</span><select value={jumpHostId} onChange={(e) => setJumpHostId(e.target.value)} className={fieldClass}><option value="">{t("Direct connection")}</option>{profiles.filter((profile) => profile.id !== selected && profile.status === "connected").map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>
            <p className="text-ui-sm leading-relaxed text-ink-3">{t("Connect to a Linux or macOS SSH host. Leave authentication fields empty to use your SSH agent. Remote grep/find require ripgrep.")}</p>
            <button type="button" disabled={busy || !host.trim()} className={buttonClass} onClick={() => void run(async () => { setProbing(true); try { const result = await window.pi.probeSsh(host, Number(port)); setFingerprint(result.fingerprint); setVerified(false); } finally { setProbing(false); } })}>{t("Check host fingerprint")}</button>
            {fingerprint ? <div className="space-y-2 rounded-control border border-line bg-field p-3"><code className="block break-all text-ui-xs text-ink">{fingerprint}</code><label className="flex items-center gap-2 text-ui-caption text-ink-2"><input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} />{t("I verified this fingerprint with the server owner")}</label></div> : null}
            {busy ? <p role="status" aria-live="polite" className="rounded-control border border-line bg-field p-3 text-ui-caption text-ink-2">{t(probing ? "Checking host fingerprint…" : phases[progress?.phase || "connecting"])}</p> : null}
            <div className="flex flex-wrap gap-2"><button type="button" disabled={busy || !verified || !username.trim()} className={buttonClass} onClick={() => void run(async () => { const next = await window.pi.connectSsh({ id: selected || undefined, host, port: Number(port), username, password: password || undefined, privateKeyPath: privateKeyPath || undefined, passphrase: passphrase || undefined, fingerprint, folder: remoteFolder, jumpHostId: jumpHostId || undefined }); setWorkspace(next); setPassword(""); setPassphrase(""); await refreshProfiles(); onClose(); })}>{busy ? t("Connecting…") : t("Connect and open workspace")}</button>{selected ? <><button type="button" disabled={busy} className={buttonClass} onClick={() => void run(async () => { await window.pi.disconnectSsh(selected); await refreshProfiles(); })}>{t("Disconnect")}</button><button type="button" disabled={busy} className={buttonClass} onClick={() => void run(async () => { await window.pi.removeSsh(selected); select(undefined); await refreshProfiles(); })}>{t("Remove")}</button></> : null}</div>
          </div>}
          {error ? <p role="alert" className="mt-4 break-words rounded-control border border-red/20 bg-red/5 p-3 text-ui-sm text-red">{error}</p> : null}
        </div>
      </div>
    </div>, document.body,
  );
}
