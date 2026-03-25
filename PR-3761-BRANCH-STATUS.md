# PR 3761 Branch Status

## Purpose

This note describes what each relevant branch contains and how responsibilities are split, so it is easier to see where changes overlap.

PR: `https://github.com/simstudioai/sim/pull/3761`

## Branches

### `staging`

Base branch for PR `#3761`.

What it contains:

- current shared integration baseline before OpenCode optional runtime lands
- current default compose and deployment behavior
- no PR-specific branch-only review fixes from this worktree

What it does **not** contain yet:

- the OpenCode branch work described below until PR `#3761` is merged

### `feat/opencode-optional-runtime`

Feature branch for PR `#3761`.

Primary responsibility:

- add the OpenCode integration and its optional runtime overlay without changing the existing default local/prod setups

What it contains:

- OpenCode block in Sim
- OpenCode tools
- OpenCode API routes
- `apps/sim/lib/opencode`
- wiring for `@opencode-ai/sdk` in Next/Vitest
- async dropdown/combobox support needed by the integration
- optional runtime files under `docker/opencode/`
- `docker-compose.opencode.yml`
- `docker-compose.opencode.local.yml`
- deployment/runtime hardening for:
  - `OPENCODE_REPOSITORY_ROOT`
  - `OPENCODE_SERVER_PASSWORD`
  - retry/session handling
  - route error behavior
  - OpenCode runtime config guards

What this branch intentionally preserves:

- `docker-compose.local.yml` stays as the default local setup
- `docker-compose.prod.yml` stays as the default production setup
- OpenCode remains hidden by default behind `NEXT_PUBLIC_OPENCODE_ENABLED`

### `origin/feat/opencode-optional-runtime`

Remote branch backing PR `#3761`.

Expected relationship:

- should match local `feat/opencode-optional-runtime`
- if local and remote diverge, local work has not been pushed yet or remote changed externally

## Overlap And Boundaries

### Product / app layer

Owned here in `feat/opencode-optional-runtime`:

- OpenCode block/tool/route/lib implementation
- editor support required by the OpenCode selectors

Possible overlap area:

- shared editor components like dropdown/combobox
- these are not OpenCode-only files, but this branch touches them only where needed for OpenCode async option behavior

### Runtime / deployment layer

Owned here in `feat/opencode-optional-runtime`:

- optional OpenCode container/runtime bootstrap
- optional compose overlays

Boundary:

- this branch should not replace the default local/prod compose files as the main path
- it only adds overlays and guards around the optional runtime

### Review-fix layer

Many follow-up changes in this branch are not separate features.

They are:

- hardening fixes
- correctness fixes
- small refactors
- review-driven adjustments on top of the same OpenCode feature branch

That means several files now contain both:

- original feature work
- later review fixes

So if something feels like it is "overlapping", that is expected: the branch has accumulated refinement passes on top of the original OpenCode implementation rather than splitting them into separate branches.

## Final Branch State

At the end of this session:

- current branch: `feat/opencode-optional-runtime`
- base branch: `staging`
- remote tracking branch: `origin/feat/opencode-optional-runtime`
- local/remote divergence: none
- worktree state: clean

## Practical Reading Guide

If you want to understand the branch quickly, read it in this order:

1. `apps/sim/lib/opencode/`
2. `apps/sim/app/api/opencode/`
3. `apps/sim/app/api/tools/opencode/`
4. `apps/sim/blocks/blocks/opencode.ts`
5. `docker/opencode/`
6. `docker-compose.opencode.yml`
7. `docker-compose.opencode.local.yml`

If you want to understand where overlap happened, check these shared files next:

- `apps/sim/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/combobox/combobox.tsx`
- `apps/sim/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/dropdown/dropdown.tsx`
- `apps/sim/app/api/tools/opencode/prompt/route.ts`
