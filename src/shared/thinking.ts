/**
 * The thinking depths, in the order the ramp offers them.
 *
 * This is the complete list, not what any one model accepts: a model's own
 * subset is *derived* from it — `thinkingLevelsFor` filters it down by the
 * entry's `thinkingLevelMap`, and `withUltra` extends it with the desktop's own
 * Ultra step. Every surface that draws a ramp, fills a dropdown or validates a
 * pick reads the order from here.
 *
 * It used to be copied into six separate files, four in the renderer and two in
 * the main process. That is how the composer could offer a depth the session
 * then refused, and the chip snapped back with nothing to explain itself.
 */
export const THINKING_LEVELS: string[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
