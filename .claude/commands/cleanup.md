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

First parse the user's `$ARGUMENTS` into `scope` and `fix`: extract the `fix=true|false` token wherever it appears in the string (start, middle, or end), and treat everything else — with that token removed — as `scope`. Defaults: `scope` = your current changes, `fix` = true. The `fix` value is consumed by Step 3 — it does NOT propagate to these passes, which always run `fix=false`.

Spawn all eight passes concurrently as subagents in a **single message** (multiple Agent tool calls). Each runs its skill on the parsed `scope` with `fix=false` — analysis and proposals ONLY, no edits. Instruct each agent to return its findings as a structured list: for every proposed change, the file path, line range, a one-line description of the change, and the exact before/after so the orchestrator can apply it without re-deriving.

Run these eight in parallel, substituting the parsed `scope` for `<scope>` in each invocation (pass the real scope text, never the literal `<scope>`):

1. `/you-might-not-need-an-effect <scope> fix=false`
2. `/you-might-not-need-a-memo <scope> fix=false`
3. `/you-might-not-need-a-callback <scope> fix=false`
4. `/you-might-not-need-state <scope> fix=false`
5. `/react-query-best-practices <scope> fix=false`
6. `/emcn-design-review <scope> fix=false`
7. `/you-might-not-need-url-state <scope> fix=false`
8. `/you-might-not-need-a-comment <scope> fix=false`

## Step 2 — Converge

Collect all findings into one list, **keeping each proposal tagged with the pass that produced it** — do NOT collapse a file's proposals into a single unlabeled patch, because Step 3 applies in pass order and needs those labels. Detect overlaps where two passes touch the same region (common: a state pass and an effect pass on the same block, or a memo and callback pass on the same component). Reconcile only genuine same-region conflicts, and drop proposals a sibling pass has made moot; a reconciled change inherits the pass label of the earliest pass it belongs to. Non-overlapping proposals stay as-is with their own labels. The output is a per-pass list of surviving changes, not a per-file patch.

## Step 3 — Sequential apply

If `fix=false`, skip this step — just report the proposals from Step 2.

Otherwise apply the surviving changes yourself (in the main context, not delegated), iterating **pass by pass** in this dependency order so earlier structural changes settle before later passes build on them:

1. effects → 2. state → 3. memo → 4. callback → 5. React Query → 6. url-state → 7. emcn design → 8. comments

For each pass in turn, apply all of that pass's changes, then move to the next pass. A file touched by several passes is therefore edited once per pass, in this order — not once as a merged patch. This is what makes the ordering real: a single merged-per-file patch would collapse all passes into one edit and lose it.

Comments apply last, on purpose: that pass operates on whatever the earlier structural passes settled the code into, so it never edits lines a sibling pass is about to delete or rewrite.

Re-read each file immediately before editing it (a prior pass in this same run may have changed it). After all edits, run `bun run lint:check` on the touched files.

## Step 4 — Summary

Output a summary across all eight passes: what each found, what was applied vs. skipped-as-redundant, and any proposals that need a human decision.
