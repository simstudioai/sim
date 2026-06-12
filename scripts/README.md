# Integration documentation generator

`generate-docs.ts` compiles the per-service **integration** pages under
`apps/docs/content/docs/en/integrations/` from the block/tool/trigger registry in
`apps/sim`. The ontology it encodes: everything is a block, and an integration is one
block that has **Actions** and, optionally, a **Trigger**.

> **Golden rule:** the generated `.mdx` files are *derived artifacts*, not the source of
> truth. Do not hand-edit them — your changes are overwritten on the next run. The only
> editable region is the `MANUAL-CONTENT` block (see below). To change what a page says,
> edit the TypeScript in `apps/sim` and regenerate.

## Where an integration lives canonically

For a service like Gmail, three TS sources define it:

| Source | What it is | What it feeds in the page |
| --- | --- | --- |
| `apps/sim/blocks/blocks/<service>.ts` | The **block**: `type`, `name`, `category` (`tools` for integrations), `bgColor`, config sub-blocks, `tools.access` (which actions it exposes), an optional `triggers` capability, `outputs` | Header / `BlockInfoCard`, Usage Instructions, and *which* actions + trigger appear |
| `apps/sim/tools/<service>/*.ts` | Each **action's** params + outputs | Every `### <action>` → `#### Input` / `#### Output` under `## Actions` |
| `apps/sim/triggers/<provider>/` | The **trigger's** config fields + outputs | The `## Triggers` section |
| `apps/sim/components/icons.tsx` | The brand glyph | The page icon |

The block references actions by id in `tools.access`; the generator looks each one up in
`apps/sim/tools/`.

## What the generator does

Run with `cd apps/sim && bun run generate-docs` (or `bun run scripts/generate-docs.ts`
from the repo root). One pass (`generateAllBlockDocs`):

1. **Copies icons** `apps/sim/components/icons.tsx` → `apps/docs/components/icons.tsx` and
   builds `apps/docs/components/ui/icon-mapping.ts`.
2. **Block pass** — for each integration block (`category: 'tools'`, plus the `memory` /
   `knowledge` / `table` exceptions), writes `integrations/<service>.mdx`:
   `BlockInfoCard` + Usage Instructions + `## Actions`.
3. **Trigger pass** (`generateAllTriggerDocs`) — reads `apps/sim/triggers/<provider>/` and
   **appends a `## Triggers` section** to that service's page, or writes a standalone page
   for trigger-only services.
4. Writes `integrations/meta.json` and regenerates the landing page's `integrations.json`.

### Hand-written pages it never touches

Core block pages (`blocks/*`), the native trigger pages (`triggers/{start,schedule,webhook,rss,table}`),
the integrations overview (`integrations/index.mdx`), and the service-account pages are
fully hand-written. The generator skips them via `HANDWRITTEN_INTEGRATION_DOCS`,
`HANDWRITTEN_TRIGGER_DOCS`, and `SKIP_TRIGGER_PROVIDERS`. Add a page name to those sets if
you hand-author a page the generator would otherwise produce.

## Manual content (the one editable region)

Each generated page may carry hand-written prose inside marker comments. The generator
preserves anything between the markers and overwrites everything else, so this survives
every regeneration:

```mdx
{/* MANUAL-CONTENT-START:intro */}
[AgentMail](https://agentmail.to/) is an API-first email platform…
{/* MANUAL-CONTENT-END */}
```

Supported section names: `intro` (after the `BlockInfoCard` — the most common),
`usage`, `configuration`, `outputs`, `notes`. The merge is by marker name
(`extractManualContent` + `mergeWithManualContent`), so a section is re-inserted at the
matching spot in the freshly generated structure.

> If you **move** the output folder, reseed manual content from the old location first —
> the generator only preserves markers it finds in the *existing output file*, so a fresh
> folder starts with none.

## Practical: to change…

- **An action's params/outputs, a trigger, or to add a service** → edit
  `apps/sim/{blocks,tools,triggers}` and re-run the generator.
- **A page's prose intro** → edit its `MANUAL-CONTENT:intro` block directly; it survives regen.
- **The overview / service-account / core-block / native-trigger pages** → hand-edit freely.

## Gotchas

- **Never hand-edit `apps/docs/components/icons.tsx`** — step 1 overwrites it from the sim
  app. Components that need an icon the sim app lacks should define it locally or use
  `lucide-react` (see `components/workflow-preview/block-icons.tsx`).
- The generator is the source of truth for `integrations/` and its `meta.json`; manual
  edits there are transient.

## CI

The generator runs in CI on pushes to the main branch and commits the regenerated docs
back. Keep block/tool/trigger metadata accurate in `apps/sim` and the docs follow.
