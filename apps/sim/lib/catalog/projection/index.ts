/**
 * Pure, surface-neutral projections of Sim's code-defined catalogs: blocks,
 * tools, connector types, and enrichments.
 *
 * Nothing here authenticates, reads a database, or touches `next/server`, and
 * nothing here imports `@/tools/registry` or `@/connectors/registry.server` —
 * both invariants are pinned by `lib/catalog/registry-boundary.test.ts` and by
 * the module-graph guard in `scripts/check-tool-registry-boundary.ts`.
 */
export * from '@/lib/catalog/projection/block-detail'
export * from '@/lib/catalog/projection/block-summary'
export * from '@/lib/catalog/projection/connector-type'
export * from '@/lib/catalog/projection/enrichment'
export * from '@/lib/catalog/projection/subblock'
export * from '@/lib/catalog/projection/tool'
