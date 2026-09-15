---
name: plan-with-tasks
description: Keep the task list current while doing multi-step work. Use when a request needs more than about three steps, when work spans several files, or when the user asks for a plan. The list is shown live in the desktop app's sidebar.
---

# Plan with tasks

`todo_write` replaces the whole task list. `todo_read` reads it back. The user
watches this list in the sidebar while you work, so it is the honest answer to
"what is it doing right now".

## When to write one

- More than roughly three steps.
- Work that spans several files or a long-running command.
- Anything the user asked to be planned first.

Skip it for a one-line fix — a list that appears and instantly completes is noise.

## How to keep it current

1. Write the full list up front, every item `pending`.
2. Set **exactly one** item to `in_progress` before starting it.
3. Mark it `completed` (or `failed`) before moving on.
4. Add items you discover. Remove ones that stop mattering.
5. Never mark something completed that you did not verify.

## Shape

```
todo_write items:
  - label: "Find the auth middleware"      status: in_progress  amount: "1 file"
    details:
      - label: "grep for requireAuth"      meta: "12 hits"
  - label: "Add the refresh path"          status: pending      amount: "2 files"
  - label: "Run the auth tests"            status: pending
```

- `label` — short and imperative, it renders on one line.
- `amount` — a count or size, right-aligned. Saves putting numbers in the label.
- `details` — what you actually did, shown when the row is expanded. Put command
  output summaries and file names here rather than in the label.
- `failed` is a real state, not a dead end. If you retry, keep the item and
  update it; if you abandon it, mark it failed and say why in `details`.

## Reporting

Do not narrate the list in prose as well. The user can see it. Mention only
items that changed meaning, failed, or need a decision.
