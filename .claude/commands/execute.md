---
description: Orchestrate parallel subagents to execute a plan, then verify completion.
argument-hint: [plan slug or path]
---

You are the **orchestrator** for a plan in `plans/`. Your job is to run the tasks in dependency order, parallelize where the plan says to, and verify the work actually got done. You do not write feature code yourself — subagents do. You read, dispatch, collect, and verify.

---

## Step 1 — Load the plan

- If the user gave a slug or path, use it. Otherwise list `plans/*.md`, show the user the candidates, and ask which to execute.
- Read the plan in full. Confirm it has: Spec, Tasks (with TDD + subagent prompts), Dependency graph, Parallel execution strategy, Verification checklist.
- If any of those are missing or malformed, **stop** and tell the user — point them at `/plan`.

## Step 2 — Sanity check before dispatch

- Read `AGENTS.md` so you can spot subagent output that violates project principles.
- Confirm the working tree is clean enough to execute (uncommitted unrelated changes should be flagged before you start, not after).
- Verify entrypoint paths in each task are sensible (parent directories exist or the task is creating them).
- If a task's entrypoints overlap with another task in the **same wave**, that's a bug in the plan — flag it and stop. Two parallel agents must not edit the same file.

## Step 3 — Execute waves

For each wave in the plan's parallel execution strategy:

1. **Dispatch the entire wave in a single message** with multiple `Agent` tool calls — this is what makes them run in parallel. Do not dispatch them sequentially.
2. Each `Agent` call uses `subagent_type: "general-purpose"` unless a more specific type clearly fits.
3. The `prompt` for each agent is the **Subagent prompt** copied verbatim from the plan, plus this preamble:

   > You are subagent for Task `<Tn>` of plan `plans/<slug>.md`. Read `AGENTS.md` and the plan file before starting. Implement only your task. Do not touch files outside your declared entrypoints. Follow TDD. When done, your final message must be a structured report with these sections: **Files changed**, **Tests added** (with paths), **Tests passing** (yes/no with command run), **Out-of-scope observations** (things you noticed but did not fix), **Blockers** (if any).

4. Wait for the entire wave to complete before starting the next wave.
5. After each wave, run any verification step the plan attaches to that wave (typically: run the tests touched by the wave). If a wave fails verification, **stop the cascade** and report — do not start the next wave on a broken foundation.

## Step 4 — Verify the plan was actually completed

After the final wave, do **not** trust the subagents' "done" reports. Verify against the plan's `Verification` section:

- For every task: confirm declared output files exist, exported names are present, types match.
- Run the full test suite for the affected modules. Capture the output.
- Re-read the diff at a high level: does the change set match the spec? Anything obviously missing or extra?
- Cross-check against the **Spec** and **Out of scope** sections — did anyone implement something out of scope? Did anything in scope get skipped?
- Surface every out-of-scope observation the subagents flagged. Do not act on them; just collect.

## Step 5 — Report

Produce a single, tight report to the user:

- ✅ / ⚠️ / ❌ per task.
- Test results: count + command + pass/fail.
- Files changed (grouped by task).
- Anything the verification surfaced (missing pieces, scope creep, broken tests).
- Out-of-scope observations from subagents, listed for the user to decide on.
- Suggested next step: usually `/push-change`, sometimes "fix X before pushing."

## Rules

- **Parallel means parallel.** Dispatch a wave in one message with multiple tool calls. Sequential dispatch defeats the plan.
- **Never edit task code yourself during execution.** If a task fails, either re-dispatch it (with a corrected prompt explaining what went wrong), or stop and ask the user.
- **One file, one writer per wave.** If you discover a conflict mid-execution, halt the wave.
- **No silent retries.** If you re-dispatch, say so in the final report.
- **Don't push, don't commit.** That's `/push-change`.
