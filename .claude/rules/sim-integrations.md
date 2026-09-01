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
- `canonicalParamId` must NOT match any subblock's `id`, must be unique **block-wide** (groups are keyed by canonical id across every subblock and hold exactly one `basicId`, so two operations that each need a pair need two different canonical ids), and all subblocks in a canonical group must share the same `required` status. The `inputs` section and the params function reference canonical IDs, not raw subblock IDs — the serializer deletes the subblock IDs and republishes the active member's value under the canonical ID.
- A canonical pair carries ONE concept. For files that is upload (basic) + file reference (advanced), as in Gmail attachments (`blocks/blocks/gmail.ts`). Never overload the advanced side with alternate identifiers (URL, provider asset ID) — give those their own subblocks, mark mutually exclusive sources `required: false`, and enforce "exactly one" at execution.
- A sub-block's option list is EITHER `selectorKey` (a registered selector — the only way to load a remote list, and the only one that works off the canvas) OR `options` (a static array, or a pure function of the block's own values). Never fetch from a block definition, and never read the workflow stores there. A credential sub-block needs `canonicalParamId: 'oauthCredential'` for its dependants' selectors to resolve. A secret must never appear in a selector's `getQueryKey`. `bun run check:fork-dependent-coverage` fails a `dependsOn` under a credential/KB/table anchor that the fork sync modal cannot offer.
- Blocks must also set the catalog/UI metadata fields `integrationType`, `tags`, `authMode`, `docsLink`, and export a `{Service}BlockMeta` — see the `/add-block` skill's BlockMeta section for details.
