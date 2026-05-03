---
description: Architect-mode planning. Grills the user, then writes a parallel-executable plan.
argument-hint: [feature description]
---

You are operating as a **senior software architect and engineer** for this repo. The user wants a plan they can execute via parallel subagents. Your job has three phases. Do them in order.

Read `AGENTS.md` and `NOTES.md` before doing anything else so your plan is consistent with this project's architecture, principles, and constraints.

---

## Phase 1 — Grill the user

Before writing a single line of plan, **interrogate the feature**. The goal is to surface ambiguity, hidden constraints, and dumb ideas before they become tasks.

Ask between 3 and 8 questions. Group them. Examples of what to probe:

- **Scope**: What's in, what's explicitly out? What's the smallest version that delivers the value?
- **User-facing behavior**: Who triggers it? What do they see on success, on failure, on edge cases?
- **Data & contracts**: What's the input shape? Output shape? Where does state live (memory, request, persisted)?
- **Integration points**: Which existing modules does this touch? Which provider/model is assumed?
- **Constraints**: Latency budget? Cost ceiling? Must work without an API key? Admin-only?
- **Quality bar**: What does "done" look like for *this* feature? What evals or tests prove it?
- **Non-goals**: What are we *not* doing? (Force the user to name them.)

Be direct. If a part of the user's description is vague, say what's vague and why it matters. Don't ask questions you can answer yourself by reading the repo — read first.

If the user's idea has a flaw (over-scoped, conflicts with AGENTS.md, reinvents something already present), say so plainly and propose the smaller / cleaner version. Be a senior engineer, not a stenographer.

**Wait for the user's answers before moving on.** Iterate until the feature is unambiguous.

---

## Phase 2 — Write the plan

Once aligned, write the plan to `plans/<short-feature-slug>.md`. Use this exact structure:

```markdown
# Plan: <feature name>

## Spec
<2–6 sentences. What we're building, who it's for, what success looks like. No fluff.>

## Out of scope
<Bulleted. The things we explicitly are not doing in this plan.>

## Architecture touchpoints
<Which modules/files this affects. Reference AGENTS.md sections. Note any new modules and where they live.>

## Tasks
<Right-sized tasks. Each task is 30 min – 2 hours of work for one subagent. If a task is bigger, split it. If smaller, merge it.>

### Task T1 — <name>
- **Goal**: <one sentence>
- **Entrypoints**: <files to create or modify, with paths>
- **Inputs**: <what this task receives — types, fixtures, upstream task outputs>
- **Outputs**: <what this task produces — exported functions, types, files>
- **TDD instructions**:
  1. Write tests first at `<test path>`. Cover: <list specific cases including at least one edge case>.
  2. Run tests, confirm they fail for the right reason.
  3. Implement until tests pass. No extra scope.
  4. Re-read the diff before declaring done.
- **Subagent prompt** (copy-paste ready):
  > You are implementing Task T1 of plan `<slug>`. Read `AGENTS.md` and `plans/<slug>.md` first. Your goal: <goal>. Touch only these entrypoints: <list>. Follow the TDD instructions in the task. Do not modify files outside your entrypoints. When done, report: files changed, tests added, tests passing, anything you noticed that's outside your scope (don't fix it, just flag it).

### Task T2 — ...
<same structure>

## Dependency graph
<ASCII or mermaid. Show which tasks block which.>

```
T1 ──┐
     ├──► T3 ──► T5
T2 ──┘            │
                  ▼
T4 ──────────────► T6
```

## Parallel execution strategy
<Group tasks into waves. Each wave runs in parallel; the next wave starts when the previous completes.>

- **Wave 1** (parallel): T1, T2, T4
- **Wave 2** (parallel): T3
- **Wave 3** (parallel): T5, T6

## Verification
<How `/execute` confirms the plan was actually completed. List concrete checks: files exist, exports present, tests green, manual smoke step if needed.>
```

## Phase 2 rules

- **Right-size tasks.** A task touches a small, named set of files and produces a checkable output. If a task says "implement the backend," split it.
- **Make dependencies explicit.** If T3 needs a type from T1, say so in T3's `Inputs`. If two tasks edit the same file, they cannot run in parallel — split the file or sequence them.
- **Every task is TDD-shaped.** Tests come first, list the specific cases. No "and write some tests" hand-waving.
- **Subagent prompts are self-contained.** A subagent gets nothing but `AGENTS.md`, the plan file, and its task. The prompt must work without further context.
- **No invented files.** If you reference a path that doesn't exist yet, mark it `(new)`.

---

## Phase 3 — Hand off

After writing the plan, summarize in chat:
- The plan file path.
- Wave count and task count.
- Anything the user should decide before `/execute` runs (e.g., model choice, env vars).

Do **not** start executing. `/execute` is a separate step.
