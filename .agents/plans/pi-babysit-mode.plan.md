---
name: pi-babysit-mode
overview: Add optional Babysit Mode to Create PR so a newly opened, ready-for-review pull request can request bot reviews, fix trusted feedback and diagnosable checks in bounded rounds, push one commit per fixing round, reply and resolve host-side, and return an accurate partial-success report.
todos:
  - id: shared-foundation
    content: Keep the shared GitHub tools, strict PR snapshot helpers, push hardening, redirect protection, and E2B lifetime plumbing
    status: completed
  - id: create-pr-surface
    content: Remove standalone Babysit and add the Create PR toggle, required reviewer mentions, bounded rounds, forced ready PR behavior, and conditional outputs
    status: completed
  - id: create-pr-composition
    content: Capture the new PR number, destroy the creation sandbox, run the internal Babysit continuation in a second sandbox, and aggregate results without persisting review content to memory
    status: completed
  - id: initial-review
    content: Preflight and pin the new PR, post initial reviewer comments, wait for later bot activity, and re-request review after every pushed fix
    status: completed
  - id: partial-results
    content: Preserve the created PR and accurate zero/false counters for no-PR, startup, budget, and later partial-success outcomes while keeping cancellation exceptional
    status: completed
  - id: docs-and-tests
    content: Update Pi documentation and tracking, remove stale standalone tests and types, add Create PR composition coverage, and run the repository gates
    status: completed
isProject: false
---

# Pi Create PR Babysit Mode

Branch `feature/pi-babysit`, originally branched from `feature/pi-search`.

## Current shape

Pi has three top-level modes: Create PR, Review Code, and Local Dev. Babysit is an optional Create PR continuation, not a standalone mode and not part of Review Code.

When enabled, Create PR:

1. Requires one or more comma-separated bot review comments.
2. Creates the PR ready for review.
3. Destroys the creation sandbox.
4. Strictly preflights and pins the new PR, posts the initial reviewer comments, and starts a second sandbox against that PR head.
5. Waits for trusted bot activity and required checks, fixes actionable feedback in bounded rounds, pushes at most one commit per round, replies, resolves, and requests review again.
6. Preserves the PR URL, branch, counters, booleans, and stop reason after partial success.

The Create PR phase can load and save conversation memory. The continuation receives the selected task, skills, model, and search configuration but always starts with `initialMessages: []`; its review-derived report is never written to conversation memory.

## Security and orchestration decisions

- Only complete threads whose comments are all from an owner, member, collaborator, or GitHub App bot are actionable.
- Check reads fail closed. Required failures and pending or missing contexts block a clean result; optional failures remain agent-visible.
- GitHub API writes are host-side and revalidate the pinned PR at phase boundaries.
- Pi receives no GitHub credential, GitHub tool, or Sim integration. Repository extensions, prompt templates, repository skills, and project trust are disabled.
- The token-bearing clone and push still run in a previously agent-controlled root sandbox. This is accepted Create-PR-equivalent residual risk, not absolute credential isolation.
- Create PR and its continuation use sequential sandboxes. E2B billing continues during inter-round waits; Daytona remains unchanged.
- Reviewer mentions are mandatory when the toggle is enabled. Each entry is posted once initially and after every successful fixing push.
- User cancellation throws. Once a PR exists, other startup or runtime failures return a partial-success report.

## Non-goals

Fork PRs, merge-conflict resolution, force-push or history rewriting, changes under `.github/`, Greptile-score gating, and fixing the pre-existing shared `PREPARE_SCRIPT` commit bug remain out of scope. A base-branch conflict is reported but does not prevent review-fix pushes.

## Validation

- Focused Pi regression suite: 259 tests passed.
- Full monorepo regression suite: 14,800 tests passed.
- Changed TypeScript files pass Biome, and `git diff --check` passes.
- API validation, monorepo boundaries, client boundaries, realtime pruning, migration safety, React Query, Zustand, utilities, skills sync, and agent-stream documentation checks pass.
- The full type-check remains blocked by pre-existing SDK mismatches in `apps/docs/app/api/chat/route.ts` and `apps/sim/providers/anthropic/core.ts`.
- The full lint check reaches only generated, untracked Playwright artifacts under `apps/sim/e2e/.runs`; the implementation files are clean.
- Contract generation checks that depend on the sibling Copilot checkout cannot run because `/Users/billleoutsakos/sim2/copilot/copilot/contracts/` is absent. Independent generated checks pass.
