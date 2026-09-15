---
name: browser-design
description: Drive the desktop app's embedded browser when the user is working on a UI — open a page, pick a component in design mode, read its computed styles and React component name, look at a cropped screenshot, then make the change in the source. Use whenever a request is about how something looks or is laid out.
---

# Browser design

The desktop app has an embedded browser with a design mode. Use it instead of
guessing what a component looks like.

## The loop

1. **Open the page.** `browser_open` with a URL or bare host (`localhost:5173`).
   The user watches this browser, so they can see what you see and take over.
2. **Look at it.** `browser_screenshot` returns an image. If you can see images,
   look before you change anything.
3. **Anchor to a component.** `browser_design_pick` asks the user to click an
   element. You get back:
   - `selector` — a stable CSS path
   - `component` — the nearest React component name, read from the fiber tree
   - `styles` — the computed values that actually applied
   - `ancestry` — the wrapper chain, outermost first
   - a screenshot **cropped to that element**
4. **Find it in the source.** Grep the component name, then the selector's
   distinctive class or `data-testid`. The component name is usually the
   fastest path to the file.
5. **Change the code.** Prefer the styles the project already uses over the
   computed values you were handed — computed styles include everything the
   cascade resolved, not what was authored.
6. **Verify.** Reload the browser and take another screenshot. Compare against
   the first one.

## When to use it

- "make this card denser" / "this looks wrong" / "align these"
- anything about spacing, colour, radius, type, or layout
- after any change to a component the user can see

## When not to

- Pure logic, tests, or data changes with no visual surface.
- If the user already told you the file and the fix, just make it.

## Notes

- The browser has its own session, so site logins persist between runs.
- `browser_snapshot` lists interactive nodes with `[n]` indices; use those with
  `browser_click` / `browser_fill` when you need to drive a flow.
- A design pick can also be started by the user with **Shift+Ctrl+D**; the
  result arrives in the conversation as a `<design-pick>` block with the
  screenshot attached.
