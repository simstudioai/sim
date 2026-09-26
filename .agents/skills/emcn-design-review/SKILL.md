---
name: emcn-design-review
description: Review product UI changes for design drift using the local conformance check, EMCN components, and global styles.
argument-hint: "[scope] [fix=true|false]"
---

# EMCN design review

Review the requested product UI scope (default: current changes). When `fix=false`, explain proposed changes without applying them.

1. During UI work, run `bun run check:design --base origin/staging --working-tree` from the repo root, substituting the actual PR target for `origin/staging`. After committing, use `--head HEAD` for the immutable PR comparison. Exit 1 means findings to review; exit 2 means the check failed and must be repaired or reported. CI is warning-only for findings and fails on incomplete analysis.
2. For each new finding or relevant review signal, inspect the cited source, the applicable public EMCN export in `packages/emcn/src/index.ts`, and tokens and recipes in `apps/sim/app/_styles/globals.css`. Reuse a suitable component, prop, variant, or global token when it expresses the design intent. Avoid near-duplicate local colours or overriding EMCN chrome merely for convenience.
3. A genuinely new product treatment may remain an Extra. Explain its visual intent and why existing EMCN or global styling does not fit in the PR. The check does not decide design approval and must not be silenced by adding an arbitrary token, broad exclusion, or fake component wrapper. Ask the designer or engineer when changing a shared recipe would have broad or ambiguous effects.
4. Keep unresolved `unchecked` inputs and inspection failures distinct from proven violations. A quiet diff means no *new detected* debt, not proof of complete visual conformance. Existing debt stays quiet; a new copy can warn. Landing and docs are out of product scope; Monaco presentation, provider branding, and block identity palettes have deliberate exclusions. See `scripts/design-conformance/README.md` for exact rule boundaries.

Do not turn this review into an unrelated whole-codebase cleanup. Preserve intended appearance when migrating product UI and use before/after screenshots when a treatment changes.
