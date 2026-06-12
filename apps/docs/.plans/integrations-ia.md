# Spec: integration pages as per-service block indexes

Status: approved, in progress. Owner: docs reorg (`feat/docs-reorg`).

## Ontology (the thing we're encoding)

Everything in a workflow is a **block**. A workflow is **blocks + connections**. Some
blocks are **triggers** — they take no input and start the run. This is literal in the
code: `BlockCategory = 'blocks' | 'tools' | 'triggers'`, and integration blocks
(`gmail`, `github`, …) additionally carry a `triggers: {}` capability — the same block
does actions *and* can start a workflow. There is no separate "trigger" species, and we
stop using the word **"Tools"** in user-facing docs.

Encoding: a small **Trigger** badge on any block that starts a workflow (driven by
`category: 'triggers'` or a `triggers:{}` capability). Native trigger blocks and an
integration's trigger use the same badge.

## Target IA

- **`/integrations/<service>`** (generated, one page per service) — a **block index for
  that service**: its capabilities listed, trigger capability(ies) badged **Trigger**.
  This single page is the per-integration unified reference. Replaces `/tools/<service>`
  **and** `/triggers/<service>`.
- **Blocks reference** (hand-written: core blocks + the ~10 trigger blocks) — same
  pattern: a block index with triggers badged. Folds today's *Core Blocks* + *Core
  Triggers* into one "blocks, some are triggers" surface.
- **Retire** `/tools/*`, `/triggers/<service>`, and the interim `integration-triggers/`
  folder → all become `/integrations/<service>`.

## Resolved decisions

- **A. Native trigger blocks** live in the **Blocks** reference, badged **Trigger**, kept
  in a scannable "Triggers" sub-grouping within it. (Done as the final step, after the
  generator work.)
- **B. Navbar / section label = "Integrations".** Users search by service; the ontology
  ("it's a block") is taught in prose, not the nav label.
- **C. Redirects added.** Initially decided as a fresh start, revised before merge:
  `/tools/*` are live, indexed URLs referenced by deployed app docsLink fields and
  marketplace listings, so next.config now 308s them (and the old
  `/triggers/<service>` pages) to `/integrations/<service>`.
- **D. Integration page = one page per service** listing the service's operations + its
  trigger(s), triggers badged. Not Tools/Triggers tabs; a single badged block index.

## Generator (`scripts/generate-docs.ts`)

Today: `generateAllBlockDocs()` → writes `tools/<service>.mdx` (per `category:'tools'`
block) + `generateAllTriggerDocs()` writes `triggers/<service>.mdx` from
`apps/sim/triggers/<provider>/` + rewrites `triggers/meta.json` + emits
icons/icon-mapping/landing `integrations.json`. **One integration = two pages today.**

Changes:
1. New output root `content/docs/en/integrations/`; stop writing `tools/` and integration
   `triggers/`.
2. **Join by service:** for each integration gather (a) the block's operations/actions and
   (b) the trigger config from `apps/sim/triggers/<provider>/` if present.
3. Emit `integrations/<service>.mdx`: header (icon + name) + block index, trigger entries
   badged. Generate `integrations/meta.json`.
4. Repoint landing/icon `docsUrl` (`/tools/<x>` → `/integrations/<x>`); keep the landing
   `integrations.json` shape intact.
5. Keep hand-written core blocks + native triggers (`HANDWRITTEN_*` / `SKIP_*`). Remove
   the old `tools`/`triggers` meta writers.

## Redirects (`apps/docs/next.config.ts`)

- `/tools` -> `/integrations`; `/tools/:slug` -> `/integrations/:slug` (custom-tools -> building-agents)
- `/triggers/<service>` -> `/integrations/<service>` (enumerated; provider-slug mappings for jsm/google-*/microsoft-teams)
- `/blocks` -> `/workflows#blocks`; `/triggers` -> `/workflows#triggers`
- Native trigger pages (`/triggers/start|schedule|webhook|rss|table`) unaffected.

## Migration order

1. Trigger badge component + the integration-page template.
2. Rewrite the generator to emit `/integrations/<service>`; regenerate; delete old
   `tools/` + integration `triggers/` + `integration-triggers/`.
3. Redirects; rename the navbar surface to Integrations; update `meta.json`.
4. Fold native triggers into the Blocks reference (badged); retire the separate Core
   Triggers framing.
5. Build + link-check.

## Notes / risk

- The generator also feeds the **landing page** via `integrations.json` — changes must not
  break its shape, only repoint doc URLs.
- The interim `integration-triggers/` folder and the *Core Triggers* accordion are
  scaffolding that this supersedes.
