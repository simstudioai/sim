---
description: Run all code quality skills — effects, memo, callbacks, state, React Query, emcn design review, url-state, and comments — analyzing in parallel, then applying fixes sequentially
argument-hint: [scope] [fix=true|false]
---

# Cleanup

Arguments:
- scope: what to review (default: your current changes). Examples: "diff to main", "PR #123", "src/components/", "whole codebase"
- fix: whether to apply fixes (default: true). Set to false to only propose changes.

User arguments: $ARGUMENTS

## Step 1 — Parallel analysis (read-only)

Spawn all eight passes concurrently as subagents in a **single message** (multiple Agent tool calls). Each runs its skill on the specified scope with `fix=false` — analysis and proposals ONLY, no edits. Instruct each agent to return its findings as a structured list: for every proposed change, the file path, line range, a one-line description of the change, and the exact before/after so the orchestrator can apply it without re-deriving.

Run these eight in parallel:

1. `/you-might-not-need-an-effect <scope> fix=false`
2. `/you-might-not-need-a-memo <scope> fix=false`
3. `/you-might-not-need-a-callback <scope> fix=false`
4. `/you-might-not-need-state <scope> fix=false`
5. `/react-query-best-practices <scope> fix=false`
6. `/emcn-design-review <scope> fix=false`
7. `/you-might-not-need-url-state <scope> fix=false`
8. `/you-might-not-need-a-comment <scope> fix=false`

## Step 2 — Converge

Collect all findings. Group them by file. Within each file, detect overlaps — two passes proposing changes to the same region (common: a state pass and an effect pass targeting the same block, or a memo and callback pass on the same component). For each overlap, reconcile into a single coherent change; drop proposals that a sibling pass has made moot.

## Step 3 — Sequential apply

If `fix=false`, skip this step — just report the proposals from Step 2.

Otherwise apply the reconciled changes yourself (in the main context, not delegated), file by file, in this dependency order so earlier structural changes settle before later passes build on them:

1. effects → 2. state → 3. memo → 4. callback → 5. React Query → 6. url-state → 7. emcn design → 8. comments

Comments apply last, on purpose: it operates on whatever the earlier structural passes settled the code into, so it never proposes edits to lines a sibling pass is about to delete or rewrite.

Re-read each file immediately before editing it (a prior pass in this same run may have changed it). After all edits, run `bun run lint:check` on the touched files.

## Step 4 — Summary

Output a summary across all eight passes: what each found, what was applied vs. skipped-as-redundant, and any proposals that need a human decision.
