/**
 * Which operating system the shell is drawing itself for.
 *
 * One renderer serves two chrome models: Windows and Linux paint their own
 * caption buttons into the title bar and use classic scrollbars, while macOS
 * keeps its native traffic lights and auto-hiding overlay scrollbars. The main
 * process asks `process.platform`; this is the same question from the page, and
 * `main.tsx` mirrors it onto `<html>` as `os-mac` so stylesheets can branch too.
 */
export const IS_MAC = navigator.platform.startsWith("Mac");

/** The one platform whose shells live under a drive letter. */
export const IS_WINDOWS = /^Win/.test(navigator.platform);
