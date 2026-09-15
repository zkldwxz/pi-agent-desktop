import { Logo } from "./Logo";
import { MinusIcon, MoonIcon, SquareIcon, SunIcon, XIcon } from "./icons";

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
  dark,
  onToggleTheme,
}: {
  dark: boolean;
  onToggleTheme: () => void;
}) {
  return (
    <div className="titlebar-drag flex h-10 shrink-0 items-center gap-2 border-b border-line bg-canvas px-2.5">
      <Logo />
      <div className="text-[12.5px] font-semibold text-ink">Pi Agent</div>
      <div className="flex-1" />

      {/* one knob slides between the two states instead of both repainting */}
      <div className="titlebar-no-drag relative flex h-6 w-14 items-center rounded-full bg-field p-0.5">
        <span
          aria-hidden
          className="pointer-events-none absolute top-0.5 left-0.5 h-5 w-[26px] rounded-full bg-surface shadow-hairline"
          style={{
            transform: dark ? "translateX(26px)" : "translateX(0)",
            transition: "transform 320ms cubic-bezier(0.23,1,0.32,1)",
          }}
        />
        <button
          type="button"
          onClick={() => dark && onToggleTheme()}
          className={`pressable relative z-10 flex h-5 w-[26px] items-center justify-center rounded-full ${
            dark ? "text-ink-3" : "text-ink"
          }`}
          aria-label="Light mode"
        >
          <SunIcon size={12} />
        </button>
        <button
          type="button"
          onClick={() => !dark && onToggleTheme()}
          className={`pressable relative z-10 flex h-5 w-[26px] items-center justify-center rounded-full ${
            dark ? "text-ink" : "text-ink-3"
          }`}
          aria-label="Dark mode"
        >
          <MoonIcon size={12} />
        </button>
      </div>

      <div className="titlebar-no-drag flex items-center gap-0.5 pl-1.5">
        <WindowButton onClick={() => window.pi.minimize()} label="Minimize">
          <MinusIcon size={13} />
        </WindowButton>
        <WindowButton onClick={() => window.pi.maximize()} label="Maximize">
          <SquareIcon size={13} />
        </WindowButton>
        <WindowButton onClick={() => window.pi.close()} label="Close" danger>
          <XIcon size={13} />
        </WindowButton>
      </div>
    </div>
  );
}
