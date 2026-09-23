import { Logo } from "./Logo";
import { MinusIcon, SquareIcon, XIcon } from "./icons";
import { t, useLocale } from "../lib/i18n";

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
      className={`pressable flex h-6 w-[26px] items-center justify-center rounded-[5px] ${
        danger ? "text-ink-2 hover:bg-red-tint hover:text-red" : "text-ink-2 hover:bg-hover"
      }`}
    >
      {children}
    </button>
  );
}

export function TitleBar({
  dock,
}: {
  /** right-side chrome ahead of the window controls (the tool dock toggle) */
  dock?: React.ReactNode;
}) {
  useLocale();

  return (
    <div className="titlebar-drag flex h-10 shrink-0 items-center gap-2 border-b border-line bg-canvas px-2.5">
      <Logo />
      <div className="text-[12.5px] font-semibold text-ink">Pi Agent</div>
      <div className="flex-1" />

      {dock ? <div className="titlebar-no-drag flex items-center gap-1 pr-2">{dock}</div> : null}

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
    </div>
  );
}
