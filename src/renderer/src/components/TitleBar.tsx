import { Logo } from "./Logo";
import { MinusIcon, SquareIcon, XIcon } from "./icons";
import { t, useLocale } from "../lib/i18n";
import { IS_MAC } from "../lib/platform";

function WindowButton({
  onClick,
  label,
  danger,
  children,
}: {
  onClick: () => void;
  label: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`pressable flex h-6 w-[26px] items-center justify-center rounded-chip ${
        danger ? "text-ink-2 hover:bg-red-tint hover:text-red" : "text-ink-2 hover:bg-hover"
      }`}
    >
      {children}
    </button>
  );
}

/** Minimise / maximise / close for the frameless window on Windows and Linux.
 *  macOS keeps its native traffic lights, so this renders nothing there. */
export function WindowControls() {
  useLocale();
  if (IS_MAC) return null;
  return (
    <div className="titlebar-no-drag flex items-center gap-0.5 pl-1.5">
      <WindowButton onClick={() => window.pi.minimize()} label={t("Minimize")}>
        <MinusIcon size={13} />
      </WindowButton>
      <WindowButton onClick={() => window.pi.maximize()} label={t("Maximize")}>
        <SquareIcon size={13} />
      </WindowButton>
      <WindowButton onClick={() => window.pi.close()} label={t("Close")} danger>
        <XIcon size={13} />
      </WindowButton>
    </div>
  );
}

/** Room the native macOS traffic lights take at the left of the header
 *  (`trafficLightPosition` x 20 + three 12px lights and their gaps). */
export const TRAFFIC_LIGHTS_WIDTH = IS_MAC ? 78 : 0;

/**
 * The bare title bar, for screens without a shell of their own (onboarding).
 * The working shell draws `AppHeader` instead: one row that is title bar and
 * tool strip at once.
 */
export function TitleBar() {
  useLocale();

  /* macOS has nothing to draw here: the traffic lights own the corner and the
     screen below keeps a grab zone of its own. */
  if (IS_MAC) return null;

  return (
    <div className="titlebar-drag flex h-10 shrink-0 items-center gap-2 border-b border-line bg-canvas px-2.5">
      <Logo />
      <div className="text-ui-caption font-semibold text-ink">Pi Agent</div>
      <div className="flex-1" />
      <WindowControls />
    </div>
  );
}
