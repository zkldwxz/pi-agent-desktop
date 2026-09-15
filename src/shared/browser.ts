export interface BrowserState {
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  devtoolsOpen: boolean;
  designMode: boolean;
  error?: string;
}

export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One element picked in design mode. */
export interface DesignPick {
  /** stable CSS path, e.g. `main > section:nth-of-type(2) > div.card` */
  selector: string;
  /** nearest React component name, when the page exposes fibers */
  component?: string;
  /** lowercase tag name */
  tag: string;
  /** trimmed visible text, capped */
  text?: string;
  /** the element's rect in page coordinates */
  rect: { x: number; y: number; width: number; height: number };
  /** a curated slice of computed styles */
  styles: Record<string, string>;
  /** ancestor chain, outermost first */
  ancestry: { tag: string; component?: string; id?: string; classes: string[] }[];
  /** png data url of the element, cropped by the host */
  screenshot?: string;
  /** the user drew a region instead of clicking an element */
  mode: "element" | "region";
  page: { url: string; title: string };
  pickedAt: string;
}

export interface DesignRequest {
  /** keep listening after a pick, so several elements can be collected */
  keepAlive: boolean;
}
