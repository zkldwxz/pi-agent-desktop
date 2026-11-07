import { memo } from "react";
import { cn } from "../lib/cn";

/* every logo inlined at build time; each draws in `currentColor`, so it takes
   the colour of the text around it, as baocode's BrandLogo does */
const SOURCES = import.meta.glob("../assets/model-icons/*.svg", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const LOGOS: Record<string, string> = Object.fromEntries(
  Object.entries(SOURCES).map(([path, svg]) => [
    path.replace(/^.*\/([^/]+)\.svg$/, "$1"),
    /* drop the attribution comment from the DOM (it stays in the file) and
       let the box size the glyph */
    svg.replace(/<!--[\s\S]*?-->/g, "").replace(/\swidth="[^"]*"/, ' width="100%"').replace(/\sheight="[^"]*"/, ' height="100%"'),
  ]),
);

export function hasBrandLogo(name: string | null | undefined): name is string {
  return Boolean(name && LOGOS[name]);
}

/** logo `name` (a file in assets/model-icons) in a square of `size` */
export const BrandLogo = memo(function BrandLogo({
  name,
  size,
  className,
}: {
  name: string;
  size: number;
  className?: string;
}) {
  const svg = LOGOS[name];
  if (!svg) return null;
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0", className)}
      style={{ width: size, height: size }}
      // eslint-disable-next-line react/no-danger -- bundled, trusted SVG files
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
});
