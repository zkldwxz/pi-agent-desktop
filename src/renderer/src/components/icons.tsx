import type { CSSProperties, HTMLAttributes } from "react";
import {
  Archive,
  ArrowLeft,
  ArrowUp,
  AtSign,
  Brain,
  ChartBar,
  Check,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleSlash,
  CircleStop,
  Copy,
  Database,
  Ellipsis,
  Eye,
  FileCode,
  FilePen,
  Flame,
  Folder,
  FolderOpen,
  Gauge,
  GitBranch,
  Globe,
  Clock,
  Coins,
  History,
  House,
  Keyboard,
  Layers,
  List,
  ListChecks,
  LoaderCircle,
  LogOut,
  MessageSquare,
  MessageSquarePlus,
  Mic,
  Minus,
  Moon,
  PanelLeft,
  PanelRight,
  Paperclip,
  Pencil,
  Plus,
  Puzzle,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Square,
  SquareStop,
  Sun,
  Terminal,
  Trash2,
  TriangleAlert,
  Users,
  UserPlus,
  Wrench,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";

/**
 * App icons — lucide (the same set ZCode renders), as stroked SVGs.
 *
 * The component names and the `size` prop are kept from the previous icon
 * module, so every call site stays untouched: `<XIcon size={13} />`. Stroke
 * width is honoured now that the icons actually have one.
 *
 * The `size` default of 14 matches the UI's base text; ZCode's usages cluster
 * on 12–16, which this default sits inside.
 */

type IconProps = Omit<HTMLAttributes<SVGSVGElement>, "name"> & {
  size?: number;
  strokeWidth?: number;
};

function wrap(Icon: LucideIcon, defaults?: { strokeWidth?: number }) {
  return function Lucide({
    size = 14,
    strokeWidth = defaults?.strokeWidth ?? 2,
    className = "",
    style,
    ...props
  }: IconProps & { name?: string }) {
    void props.name;
    return (
      <Icon
        size={size}
        strokeWidth={strokeWidth}
        aria-hidden="true"
        className={className}
        style={style as CSSProperties}
        {...props}
      />
    );
  };
}

export const SearchIcon = wrap(Search);
export const PlusIcon = wrap(Plus);
export const SunIcon = wrap(Sun);
export const MoonIcon = wrap(Moon);
export const MinusIcon = wrap(Minus);
export const SquareIcon = wrap(Square);
export const XIcon = wrap(X);
export const CheckIcon = wrap(Check);
export const LoaderIcon = wrap(LoaderCircle);
export const ChevronDownIcon = wrap(ChevronDown);
export const ChevronRightIcon = wrap(ChevronRight);
export const SettingsIcon = wrap(Settings);
export const PaperclipIcon = wrap(Paperclip);
export const AtSignIcon = wrap(AtSign);
export const SlashIcon = wrap(Pencil, { strokeWidth: 2 });
export const MicIcon = wrap(Mic);
export const ArrowUpIcon = wrap(ArrowUp);
export const TerminalIcon = wrap(Terminal);
export const FilePenIcon = wrap(FilePen);
export const GitBranchIcon = wrap(GitBranch);
export const EllipsisIcon = wrap(Ellipsis);
export const ArrowLeftIcon = wrap(ArrowLeft);
export const FolderIcon = wrap(Folder);
export const SquareStopIcon = wrap(SquareStop);
export const GaugeIcon = wrap(Gauge);
export const PuzzleIcon = wrap(Puzzle);
export const KeyboardIcon = wrap(Keyboard);
export const HookIcon = wrap(Zap);
export const ZapIcon = wrap(Zap);
export const TimerIcon = wrap(Clock);
export const CoinsIcon = wrap(Coins);
export const LayersIcon = wrap(Layers);
export const ChartBarIcon = wrap(ChartBar);
export const DatabaseIcon = wrap(Database);
export const TrashIcon = wrap(Trash2);
export const PowerIcon = wrap(LogOut);
export const FolderOpenIcon = wrap(FolderOpen);
export const RefreshIcon = wrap(RefreshCw);
export const PencilIcon = wrap(Pencil);
export const ImageIcon = wrap(Paperclip);
export const ClockIcon = wrap(History);
export const BrainIcon = wrap(Brain);
export const MessageIcon = wrap(MessageSquare);
export const MessagePlusIcon = wrap(MessageSquarePlus);
export const FlameIcon = wrap(Flame);
export const HomeIcon = wrap(House);
export const PanelRightIcon = wrap(PanelRight);
export const PanelLeftIcon = wrap(PanelLeft);
export const LogOutIcon = wrap(LogOut);
export const UserPlusIcon = wrap(UserPlus);
export const UsersIcon = wrap(Users);
export const SparkIcon = wrap(Sparkles);
export const StopCircleIcon = wrap(CircleStop);
export const CheckCircleIcon = wrap(CheckCircle);
export const AlertIcon = wrap(CircleAlert);
export const EyeIcon = wrap(Eye);
export const WrenchIcon = wrap(Wrench);
export const ListIcon = wrap(List);
export const EditIcon = wrap(Pencil);
export const GlobeIcon = wrap(Globe);
export const CopyIcon = wrap(Copy);
export const CircleSlashIcon = wrap(CircleSlash);
export const ArchiveIcon = wrap(Archive);
export const CodeIcon = wrap(FileCode);
export const ListChecksIcon = wrap(ListChecks);
/* the alert glyph that carries a warning's triangular read */
export const WarningIcon = wrap(TriangleAlert);
