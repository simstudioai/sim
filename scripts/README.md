# Integration documentation generator

`generate-docs.ts` compiles the per-service **integration** pages under
`apps/docs/content/docs/integrations/` from the block/tool/trigger registry in
`apps/sim`. The block selects the available actions; the trigger registry adds supported events.
Some services have triggers without an action block.

> **Golden rule:** the generated `.mdx` files are *derived artifacts*, not the source of
> truth. Do not hand-edit them — your changes are overwritten on the next run. The only
> editable region is the `MANUAL-CONTENT` block (see below). To change what a page says,
> edit the TypeScript in `apps/sim` and regenerate.

## Where an integration lives canonically

For a service like Gmail, three TS sources define it:

| Source | What it is | What it feeds in the page |
| --- | --- | --- |
| `apps/sim/blocks/blocks/<service>.ts` | The **block**: `type`, `name`, `category` (`tools` for integrations), `bgColor`, config sub-blocks, `tools.access` (which actions it exposes), an optional `triggers` capability, `outputs` | Title and integration icon metadata, use guidance, and the available actions |
| `apps/sim/tools/<service>/*.ts` | Each **action's** params + outputs | Every `### <action>` → `#### Input` / `#### Output` under `## Actions` |
| `apps/sim/triggers/<provider>/` | The **trigger's** config fields + outputs | The `## Triggers` section |
| `apps/sim/lib/oauth/**` and auth capability metadata | Requested scopes, callback routes, client configuration and deployment gates | `## OAuth scopes` |
| `apps/sim/components/icons.tsx` | The brand glyph | The page icon |

The block references actions by id in `tools.access`; the generator looks each one up in
`apps/sim/tools/`.

## What the generator does

Run with `cd apps/sim && bun run generate-docs` (or `bun run scripts/generate-docs.ts`
from the repo root). One pass (`generateAllBlockDocs`):

1. **Copies icons** `apps/sim/components/icons.tsx` → `apps/docs/components/icons.tsx` and
   builds `apps/docs/components/ui/icon-mapping.ts`.
2. **Block pass** — for each integration block (`category: 'tools'`, plus the `memory` /
   `knowledge` / `table` / `enrichment` / `logs` / `deployments` exceptions), writes `integrations/<service>.mdx`:
   integration frontmatter + preserved introduction + `## OAuth scopes` when applicable +
   `## Use the block` + `## Actions`. Credential requirements precede the action reference.
3. **Trigger pass** (`generateAllTriggerDocs`) — reads `apps/sim/triggers/<provider>/` and
   adds `## Triggers` after the action reference and before shared input schemas or
   authored operational notes, or writes a standalone page for trigger-only services.
4. Writes `integrations/meta.json`, the public integration catalog and its client metadata,
   counts and icons. Review these outputs alongside the MDX.

### Hand-written pages it never touches

Core block pages (`blocks/*`), the native trigger pages (`triggers/{start,schedule,webhook,rss,table}`),
the integrations overview (`integrations/index.mdx`), and the service-account pages are
fully hand-written. The generator skips them via `HANDWRITTEN_INTEGRATION_DOCS`,
`HANDWRITTEN_TRIGGER_DOCS`, and `SKIP_TRIGGER_PROVIDERS`. Integration guides are registered
in the shared navigation file described below, which feeds `HANDWRITTEN_INTEGRATION_DOCS`.
Add other hand-written pages to the appropriate set if the generator would otherwise
produce them.

## Manual content (the one editable region)

Each generated page may carry hand-written prose inside marker comments. The generator
preserves anything between the markers and overwrites everything else, so this survives
every regeneration:

```mdx
{/* MANUAL-CONTENT-START:intro */}
[AgentMail](https://agentmail.to/) is an API-first email platform…
{/* MANUAL-CONTENT-END */}
```

The merge uses the marker name (`extractManualContent` + `mergeWithManualContent`).
`intro` follows the frontmatter and MDX imports; `usage` follows **Use the block**; `outputs` and
`notes` follow matching generated headings when those headings exist. A section without
an insertion anchor is appended intact, including custom marker names. Do not move useful
setup or limits into a fallback section when readers need them before acting.

The displayed **Use the block**, **OAuth scopes**, and **JSON input schemas** headings
preserve the older `usage-instructions`, `oauth-scopes`, and `json-input-schemas` anchor IDs.
Keep those IDs stable when editing the template. Action names, schema type names and
parameter/output paths are literal identifiers; preserve their meaning and order.

> If you **move** the output folder, reseed manual content from the old location first —
> the generator only preserves markers it finds in the *existing output file*, so a fresh
> folder starts with none.

## Practical: to change…

- **An action's params/outputs, a trigger, or to add a service** → edit
  `apps/sim/{blocks,tools,triggers}` and re-run the generator.
- **A page's prose intro** → edit its `MANUAL-CONTENT:intro` block directly; it survives regen.
- **The overview / service-account / core-block / native-trigger pages** → hand-edit freely.

## Sidebar navigation

Section labels link to their `index.mdx` overview; the adjacent arrow expands their
children. Keep `index` out of a non-root folder's `meta.json` pages array so Fumadocs
uses it as the folder link instead of a duplicate child. Root tabs such as CLI still
list `index` because their root label is not a sidebar row.

Register hand-written integration guides under `guides` in
`apps/docs/content/integration-navigation.json`. The key is the existing MDX filename
without its extension; `title` is the shorter
sidebar label, and `integration` is the parent integration's filename. The docs loader
groups these pages under a clickable integration row while preserving every URL.
Omit `integration` for guides shared across providers, which appear under
**Shared credential guides**. The generator reads the same registry to protect these
pages from stale-doc cleanup, so adding a guide requires only one registration.

Use `relatedPages` for tutorials elsewhere in the docs tree, retaining their existing
paths. Register retired integration aliases in `redirects`; those URLs redirect to the
canonical integration. Remove the retired MDX file so sidebar, sitemap, and LLM
exports all use the canonical page. Primary integration
rows are sorted by their visible names; child guides retain the registry's order.

The generated integration `meta.json` remains a sorted inventory of pages. Grouping
happens when Fumadocs builds the page tree, so it survives regeneration without moving
content files or changing links, search results, or the docs manifest.

## Gotchas

- **Never hand-edit `apps/docs/components/icons.tsx`** — step 1 overwrites it from the sim
  app. Components that need an icon the sim app lacks should define it locally or use
  `@sim/emcn/icons` (see `components/workflow-preview/block-icons.tsx`).
- The generator is the source of truth for `integrations/` and its `meta.json`; manual
  edits there are transient.

## CI

CI checks generated freshness through `bun run check:docs` and the public catalog through
`bun run check:integration-catalog`. Regenerate locally and commit the outputs with their
owning source changes. Run the generator a second time and confirm it produces no further
changes. Check that every authored region and registered guide survives, all action/trigger
and field references remain complete, preserved anchors work, and the production docs build
renders the affected pages. The separate main-branch docs workflow updates search embeddings;
it does not author or commit these integration references.
