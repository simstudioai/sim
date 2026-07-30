---
description: Analyze and fix redundant or self-explanatory inline comments — remove noise, promote genuine documentation to TSDoc
argument-hint: "[scope] [fix=true|false]"
---

# You Might Not Need a Comment

Arguments:
- scope: what to analyze (default: your current changes). Examples: "diff to main", "PR #123", "src/components/", "whole codebase"
- fix: whether to apply fixes (default: true). Set to false to only propose changes.

User arguments: $ARGUMENTS

## The one rule that matters

A comment must add information the code cannot express itself. Code says *what* and *how*; a comment earns its place only by explaining *why* — a non-obvious constraint, a workaround, a decision, a gotcha. If deleting the comment loses no information a competent reader wouldn't recover from the code in seconds, delete it.

This codebase's convention: **TSDoc for documentation, no non-TSDoc comments, no `====` separators.** Genuine documentation belongs in a `/** ... */` block on the declaration; everything that survives as an inline `//` comment must be a real *why*, kept terse.

## Anti-patterns to detect

1. **Restates the code**: `// increment counter` above `counter++`, `// return the result` above `return result`, `// loop over items`. Delete.
2. **Narrates the obvious from names**: the function is `fetchUserById`, the comment says `// fetches a user by id`. The identifier already said it. Delete.
3. **Section-divider / banner comments**: `// ==== Helpers ====`, `// --- state ---`, `// #region`. Against convention. Delete (the code's structure is the structure).
4. **Commented-out code**: dead code left as a comment. Delete — git is the history.
5. **Redundant type/param echo in prose comments**: `// takes a string and returns a number` when the signature already says so. Delete.
6. **Changelog / attribution noise**: `// added by X`, `// TODO(2021): ...` long-stale, `// fix for bug`. Delete unless it encodes a live, actionable constraint.
7. **Genuine documentation written as a loose `//` block on a declaration**: a real explanation of what an exported function/type/const is for, but written as stacked `//` lines instead of TSDoc. Convert to a `/** ... */` TSDoc block on the declaration.

## Patterns that ARE correct — do not flag

- A `//` comment that explains a **non-obvious why**: a workaround for an upstream bug, an ordering constraint, a perf reason, a spec/edge-case the code can't self-document (`// first-match wins — matches the old find() semantics`).
- Existing TSDoc `/** ... */` blocks on declarations — leave them (only tighten if verbose).
- `// boundary-raw-fetch:`, `// double-cast-allowed:`, `// boundary-raw-json:`, `// untyped-response:`, `// migration-safe:` and other **machine-read annotations** — these are load-bearing, never touch them.
- `// biome-ignore`, `// eslint-disable`, `// @ts-expect-error` and other tooling directives.
- `// TODO` / `// FIXME` that point at real, still-open work.

## Bias

Prefer **deletion over rewriting**, and **no comment over a comment** when the code is already clear. When a comment is genuine documentation, prefer promoting it to terse TSDoc over leaving a loose `//` block. Never add new comments in this pass — this is a reduction pass. When unsure whether a comment encodes a real *why*, keep it.

## Steps

1. Analyze the specified scope for the anti-patterns listed above
2. If fix=true, apply the fixes. If fix=false, propose the fixes without applying.
