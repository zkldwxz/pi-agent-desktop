import { SettingsManager } from "@earendil-works/pi-coding-agent";

/** Cache configuration per extension/cwd, never command or file results. */
export function toolSettings(fallbackCwd: string) {
  let cwd: string | undefined;
  let settings: SettingsManager | undefined;
  return (contextCwd?: string): SettingsManager => {
    const current = contextCwd || fallbackCwd;
    if (!settings || current !== cwd) {
      cwd = current;
      settings = SettingsManager.create(current);
    }
    return settings;
  };
}
