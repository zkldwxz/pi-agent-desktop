import type { HTMLAttributes } from "react";

/**
 * App icons — VS Code codicons (the same icon set Cursor ships, designed
 * specifically for IDE chrome), rendered as font glyphs so every size stays
 * crisp and `color` inherits from the parent like the old SVG set did.
 *
 * The component names and the `size` prop are kept from the previous icon
 * module, so every call site stays untouched: `<XIcon size={13} />`.
 * `strokeWidth` is accepted and ignored — font glyphs have no stroke.
 */

type IconProps = HTMLAttributes<HTMLElement> & {
  size?: number;
  /** accepted for compatibility with the old SVG set — font glyphs have no stroke */
  strokeWidth?: number;
};

function Icon({ size = 14, name, className = "", style, strokeWidth, ...props }: IconProps & { name: string }) {
  void strokeWidth;
  return (
    <i
      aria-hidden="true"
      className={`codicon codicon-${name} ${className}`}
      style={{ fontSize: size, lineHeight: 1, display: "inline-block", fontStyle: "normal", ...style }}
      {...props}
    />
  );
}

const make = (name: string) =>
  function Codicon(props: IconProps) {
    return <Icon name={name} {...props} />;
  };

export const SearchIcon = make("search");
export const PlusIcon = make("add");
export const SunIcon = make("color-mode");
export const MoonIcon = make("color-mode");
export const MinusIcon = make("chrome-minimize");
export const SquareIcon = make("chrome-maximize");
export const XIcon = make("close");
export const CheckIcon = make("check");
export const LoaderIcon = make("loading");
export const ChevronDownIcon = make("chevron-down");
export const SettingsIcon = make("gear");
export const PaperclipIcon = make("attach");
export const AtSignIcon = make("mention");
export const SlashIcon = make("symbol-method");
export const MicIcon = make("mic");
export const ArrowUpIcon = make("arrow-up");
export const TerminalIcon = make("terminal");
export const FilePenIcon = make("file-text");
export const GitBranchIcon = make("git-branch");
export const EllipsisIcon = make("ellipsis");
export const ArrowLeftIcon = make("arrow-left");
export const FolderIcon = make("folder");
export const SquareStopIcon = make("primitive-square");
export const GaugeIcon = make("dashboard");
export const PuzzleIcon = make("extensions");
export const LayersIcon = make("layers");
export const ChartBarIcon = make("graph");
export const DatabaseIcon = make("database");
export const TrashIcon = make("trash");
export const PowerIcon = make("debug-disconnect");
export const FolderOpenIcon = make("folder-opened");
export const RefreshIcon = make("refresh");
export const PencilIcon = make("edit");
export const ImageIcon = make("file-media");
export const ClockIcon = make("history");
export const BrainIcon = make("lightbulb");
export const MessageIcon = make("comment");
export const FlameIcon = make("flame");
export const HomeIcon = make("home");
export const PanelRightIcon = make("layout-sidebar-right");
export const PanelLeftIcon = make("layout-sidebar-left");
export const LogOutIcon = make("sign-out");
export const UserPlusIcon = make("account");
export const UsersIcon = make("organization");
export const SparkIcon = make("sparkle");
export const StopCircleIcon = make("stop-circle");
export const CheckCircleIcon = make("pass");
export const AlertIcon = make("warning");
export const EyeIcon = make("eye");
export const WrenchIcon = make("wrench");
export const ListIcon = make("list-unordered");
export const EditIcon = make("edit");
export const GlobeIcon = make("globe");
