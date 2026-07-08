---
paths:
  - "apps/sim/tools/**"
  - "apps/sim/blocks/**"
  - "apps/sim/triggers/**"
---

# Adding Integrations

Build order: **Tools** (`tools/{service}/`) → **Block** (`blocks/blocks/{service}.ts`) → **Icon** (`components/icons.tsx`) → optional **Trigger** (`triggers/{service}/`). Always look up the service's API docs first.

The full authoring instructions — tool/block/icon/trigger scaffolding, SubBlock property tables, `condition`/`required`/`dependsOn`/`mode`/`canonicalParamId` syntax, the `normalizeFileInput`/file-handling helper table, and checklists — live in the skills: `/add-integration` (end-to-end), `/add-tools`, `/add-block`, `/add-trigger`.

## Hard rules (don't get these wrong)

- Tool IDs are `snake_case` (`service_action`). Register tools in `tools/registry.ts`, blocks in `blocks/registry-maps.ts` (the `BLOCK_REGISTRY` config map + `BLOCK_META_REGISTRY` catalog-meta map, alphabetically — `blocks/registry.ts` holds only the accessor functions), triggers in `triggers/registry.ts`.
- Type coercions (`Number()`, etc.) belong in `tools.config.params` (runs at execution, after variable resolution) — never in `tools.config.tool` (runs at serialization; coercing there destroys dynamic `<Block.output>` references).
- `canonicalParamId` must NOT match any subblock's `id`, must be unique per operation/condition context, and all subblocks in a canonical group must share the same `required` status. The `inputs` section and the params function reference canonical IDs, not raw subblock IDs.
- Blocks must also set the catalog/UI metadata fields `integrationType`, `tags`, `authMode`, `docsLink`, and export a `{Service}BlockMeta` — see the `/add-block` skill's BlockMeta section for details.
