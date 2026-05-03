---
description: Propose a commit structure, commit, push, and update CHANGELOG.md.
---

You are wrapping up a unit of work. Your job: turn the current diff into well-grouped commits, push them, and capture the *why* in `CHANGELOG.md`. The user-facing acceptance criteria for this project (per `NOTES.md`) require CHANGELOG entries focused on the search/retrieval functionality, with concise reasons, motivations, and the prompts/instructions given to coding agents.

---

## Step 1 — Survey the change set

In parallel, run:

- `git status` (no `-uall`)
- `git diff` (unstaged)
- `git diff --staged`
- `git log --oneline -20`
- `git branch --show-current` and check upstream tracking

Read the diffs in full. Don't skim. You're about to commit them.

## Step 2 — Propose a commit structure

Group the changes into commits by **logical intent**, not by file. A commit answers one question for a future reader. Typical groupings for this repo:

- A pipeline stage (e.g., "vision-extract stage + tests")
- A frontend surface (e.g., "public upload page")
- An admin parameter (e.g., "expose top-K in admin config")
- Eval/test infra
- Infra / config / deps (kept separate from feature code)

Show the user your proposed structure: for each commit, list the files and a draft message. Ask for confirmation or edits before committing. **Don't commit until the user agrees.**

If the user is in **auto mode** (no interactive confirmation expected), proceed with your best grouping but make it conservative — when in doubt, one extra commit is better than one tangled commit.

## Step 3 — Commit

For each commit:
- Stage **only** the files for that commit by name. Never `git add -A` or `git add .`.
- Skip anything that looks like a secret (`.env`, keys, tokens). Warn the user if such a file appears in the diff and refuse to stage it without explicit confirmation.
- Write the message via HEREDOC so newlines render. Format:

  ```
  <type>: <imperative one-line summary>

  <optional body — the *why*, not the *what*. Reference the pipeline stage or
  user-facing behavior this enables.>

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  ```

  `<type>` is one of: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `eval`.

- After each commit, run `git status` to confirm.
- Never `--amend` unless the user asks. If a hook fails, fix the issue and create a new commit.
- Never `--no-verify`.

## Step 4 — Update CHANGELOG.md

Append (or create if missing) an entry at the top under an `## Unreleased` heading. For each commit in this push, write:

```markdown
### <type>: <summary>

**What changed:** <1–3 sentences, focused on the search/retrieval impact when relevant.>

**Why:** <Motivation — the user-facing or architectural reason. Tie back to the spec or NOTES.md when it helps.>

**Agent prompts used:** <If the change came from a planned/executed feature, paste the key prompts (the `/plan` feature description and any task-level prompts that produced non-trivial code). Trim noise; keep the substance.>
```

When a release tag happens later, the user (not you) will rename `Unreleased` to a version. Don't do that automatically.

## Step 5 — Push

- If the branch has no upstream, push with `-u`.
- Never force-push. Never push to `main`/`master` without explicit user confirmation.
- After push, report the branch and the commit count pushed.

## Step 6 — Report

Tight summary for the user:
- Commits created (count + messages).
- CHANGELOG.md entries added.
- Push target + status.
- Anything skipped or flagged (suspected secrets, unrelated stray files, hook warnings).

## Rules

- **One commit, one intent.** If you can't summarize a commit in one line without "and", split it.
- **Don't commit unrelated drift.** Stash or surface it; don't bury it.
- **Don't invent CHANGELOG content.** Every claim must map to a real diff in the commits you just made.
- **Don't push until the user has confirmed the commit structure** (unless auto mode is active and the structure is clean).
