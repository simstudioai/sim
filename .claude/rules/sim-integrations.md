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
- A tool that calls Sim's own API declares it: a static `request.url` string (`'/api/tools/{service}/{action}'`), or `` internalRoute`/api/table/${params.tableId}/rows` `` from `@/lib/core/utils/internal-route` when the path is dynamic (query params via `.withQuery({...})`). The transport signs internal requests with the executing user's token, so that decision follows the tool's source, never the resolved string — a builder returning a bare `/api/...` string is treated as EXTERNAL, because a `user-or-llm` param can produce one. `internalRoute` encodes every `${...}`; never add `encodeURIComponent` inside the template.
- Type coercions (`Number()`, etc.) belong in `tools.config.params` (runs at execution, after variable resolution) — never in `tools.config.tool` (runs at serialization; coercing there destroys dynamic `<Block.output>` references).
- `canonicalParamId` must NOT match any subblock's `id`, must be unique **block-wide** (groups are keyed by canonical id across every subblock and hold exactly one `basicId`, so two operations that each need a pair need two different canonical ids), and all subblocks in a canonical group must share the same `required` status. The `inputs` section and the params function reference canonical IDs, not raw subblock IDs — the serializer deletes the subblock IDs and republishes the active member's value under the canonical ID.
- A canonical pair carries ONE concept. For files that is upload (basic) + file reference (advanced), as in Gmail attachments (`blocks/blocks/gmail.ts`). Never overload the advanced side with alternate identifiers (URL, provider asset ID) — give those their own subblocks, mark mutually exclusive sources `required: false`, and enforce "exactly one" at execution.
- Blocks must also set the catalog/UI metadata fields `integrationType`, `tags`, `authMode`, `docsLink`, and export a `{Service}BlockMeta` — see the `/add-block` skill's BlockMeta section for details.
