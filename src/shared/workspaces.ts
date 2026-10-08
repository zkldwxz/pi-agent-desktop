export interface WorkspaceFolder {
  name: string;
  /** Local absolute path, or ssh://<connection id>/<absolute remote path>. */
  path: string;
}

export interface WorkspaceInfo {
  id: string;
  name: string;
  /** Stable local session anchor; remote session history stays on this machine. */
  cwd: string;
  folders: WorkspaceFolder[];
  sshId?: string;
}

/** Safe connection metadata. Passwords and private key contents are never returned. */
export interface SshProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  privateKeyPath?: string;
  fingerprint?: string;
  /** Last connected remote folder, so reconnecting reopens the same workspace anchor. */
  folder?: string;
  status: "disconnected" | "connecting" | "connected" | "error";
  phase?: "connecting" | "authenticating" | "opening-sftp" | "checking-folder" | "ready";
  error?: string;
}

export interface SshConnectInput {
  id?: string;
  name?: string;
  host: string;
  port?: number;
  username: string;
  privateKeyPath?: string;
  password?: string;
  passphrase?: string;
  /** Verify the SHA256 fingerprint observed through probeSsh before authentication. */
  fingerprint: string;
  folder: string;
}

export interface SshProbe { fingerprint: string; algorithm: string }

export function remotePath(id: string, path: string): string {
  return `ssh://${id}${path.startsWith("/") ? "" : "/"}${path.split("/").map(encodeURIComponent).join("/")}`;
}

export function parseRemotePath(path: string): { id: string; path: string } | undefined {
  if (!path.startsWith("ssh://")) return undefined;
  const url = new URL(path);
  if (!url.hostname || url.username || url.password || url.port || url.search || url.hash) throw new Error("Invalid SSH file path.");
  return { id: url.hostname, path: decodeURIComponent(url.pathname) };
}
