---
name: browser-ops
description: Drive the desktop app's embedded browser — open pages, read the accessibility-style snapshot, click, fill, search page text, and take screenshots. Use for verification, scraping a local dev server, testing a flow, or checking that a change actually works.
---

# Browser ops

Nine tools are available, all backed by the browser the user sees.

| Tool | What it does |
| --- | --- |
| `browser_open` | Load a URL and return a snapshot |
| `browser_snapshot` | Re-read: interactive nodes with boxes, plus visible text |
| `browser_click` | Click by CSS selector, by visible text, or by `[n]` index |
| `browser_fill` | Type into an input/textarea, optionally submitting |
| `browser_find` | Search visible text, returns matching lines with context |
| `browser_screenshot` | Capture the page, or one element by selector |
| `browser_design_pick` | Ask the user to click a component (see the `browser-design` skill) |

## Working method

**Read before acting.** `browser_snapshot` gives you the node list. Nodes are
indexed `[n]` and carry their box, so `[3]` is unambiguous even when two buttons
share a label.

**Prefer selector over text, text over index.** Index is positional and goes
stale the moment the page changes.

**Verify with an image.** After a click or a form submit, `browser_screenshot`
proves what happened. Snapshots tell you the DOM; screenshots tell you whether
the user would consider it working.

**The user can see this browser.** Don't use it for anything you would not want
on screen.

## Common tasks

Listing a local dev server:

```
browser_open   url: http://localhost:3000
browser_find   query: "Sign in"
browser_screenshot
```

Filling and submitting:

```
browser_fill   selector: "#email"  value: "a@b.com"
browser_fill   selector: "#password"  value: "..."  submit: true
browser_snapshot
```

## Limits

- No file downloads, no new windows — `window.open` navigates the same view.
- `browser_click` dispatches real DOM events; a site that requires trusted
  input may ignore them. If a click appears to do nothing, say so instead of
  retrying blindly.
- DevTools can be docked by the user; it does not affect your tools.
