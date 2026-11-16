import type { CatalogGate } from '@/lib/catalog/application/context'
import { isBlockVisibleToCaller } from '@/lib/catalog/application/context'
import { buildBlockCatalog, type CatalogBuildResult } from '@/lib/workflows/code/catalog/build'
import { registryTrigger } from '@/lib/workflows/code/catalog/registry-sources'
import { getAllBlocks, getBlock, getBlockRegistry } from '@/blocks/registry'
import { SDK_NAMES } from '@/blocks/sdk-names.generated'
import type { BlockConfig } from '@/blocks/types'
import { getToolMetadata } from '@/tools/metadata'
import { getToolOutputsMetadata } from '@/tools/metadata-outputs'

interface CodeCatalogScope {
  gate: CatalogGate
  organizationId: string | null
  /** Block types stored in the workflow, for the per-workflow compile catalog (s4 step 2). */
  storedTypes?: readonly string[]
}

/**
 * The workspace catalog, or with `storedTypes` the per-workflow compile catalog: the blocks this
 * caller may place, sunset blocks included (existing placements must still compile), plus every
 * type already stored in the workflow that the caller could not place, marked `addable: false`.
 *
 * MUST run inside `withCatalogBlockScope(gate, …)`: visibility and the org's custom blocks are
 * resolved from that scope. Built-in blocks are projected from the raw registry config, not the
 * viewer projection, so a revealed preview block's display suffix never changes the hash.
 */
export function buildCodeCatalog(scope: CodeCatalogScope): CatalogBuildResult {
  const registry = getBlockRegistry()
  const included = new Map<string, BlockConfig>()
  for (const block of getAllBlocks()) {
    if (!isBlockVisibleToCaller(block, scope.gate, { includeSunset: true })) continue
    included.set(block.type, Object.hasOwn(registry, block.type) ? registry[block.type] : block)
  }

  const notAddable = new Set<string>()
  for (const type of scope.storedTypes ?? []) {
    if (included.has(type)) continue
    const block = Object.hasOwn(registry, type) ? registry[type] : getBlock(type)
    if (!block) continue
    included.set(type, block)
    notAddable.add(type)
  }

  return buildBlockCatalog(
    {
      blocks: [...included.values()],
      notAddable,
      trigger: registryTrigger,
      sdkNames: SDK_NAMES,
      ...(scope.organizationId && scope.gate.customBlockRows.length > 0
        ? { scope: { organizationId: scope.organizationId } }
        : {}),
    },
    { metadata: getToolMetadata, outputs: getToolOutputsMetadata }
  )
}
