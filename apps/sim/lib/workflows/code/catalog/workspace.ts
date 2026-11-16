import { createHash } from 'node:crypto'
import { compareStrings } from '@sim/utils/string'
import type { BlockCatalog } from '@sim/workflow-code'
import { LRUCache } from 'lru-cache'
import type { CatalogGate } from '@/lib/catalog/application/context'
import { isBlockVisibleToCaller } from '@/lib/catalog/application/context'
import { buildBlockCatalog } from '@/lib/workflows/code/catalog/build'
import { registryTrigger } from '@/lib/workflows/code/catalog/registry-sources'
import { getAllBlocks, getBlock, getBlockRegistry } from '@/blocks/registry'
import { SDK_NAMES } from '@/blocks/sdk-names.generated'
import type { BlockConfig } from '@/blocks/types'

interface SourceCatalogScope {
  gate: CatalogGate
  organizationId: string | null
  /** Block types stored in the workflow, for the per-workflow source catalog. */
  storedTypes?: readonly string[]
}

/**
 * Built catalogs by content key ({@link catalogCacheKey}). A build projects and hashes the whole
 * registry (about 80 ms warm, 250 ms cold), and every source get, apply and catalog read
 * asks for one. Distinct keys per process are few: one per distinct gate outcome (visibility,
 * allowlist, a workspace's custom blocks, not-addable stored types). An entry is about 6 MB of heap,
 * so the ceiling (about 100 MB) is a memory backstop, not an operating limit.
 *
 * No TTL and no invalidator: the key is the content the build reads, so a custom block publish,
 * an allowlist change or a preview reveal yields a new key, and the old entry ages out. Built-in
 * block configs are constants for the life of the process (a deploy is a new process).
 */
const CATALOG_CACHE_MAX = 16
const compileCatalogs = new LRUCache<string, BlockCatalog>({ max: CATALOG_CACHE_MAX })

/**
 * The content a build reads, hashed: every included built-in type (the registry config is a
 * process constant), every included custom block's full row (the config is derived from the row
 * alone), the types marked not addable, and the organization the catalog is scoped to. The rows
 * and the scope are in the key, so a catalog holding one organization's custom blocks is never
 * served to another. `null` when an included type is neither built in nor one of the gate's custom
 * blocks: its config cannot be keyed, so that build is not cached.
 */
function catalogCacheKey(
  included: ReadonlyMap<string, BlockConfig>,
  notAddable: ReadonlySet<string>,
  scopeOrganizationId: string | null,
  gate: CatalogGate
): string | null {
  const registry = getBlockRegistry()
  const rowsByType = new Map(gate.customBlockRows.map((row) => [row.type, row]))
  const builtIn: string[] = []
  const custom: string[] = []
  for (const [type, config] of included) {
    if (Object.hasOwn(registry, type) && registry[type] === config) {
      builtIn.push(type)
      continue
    }
    const row = rowsByType.get(type)
    if (!row) return null
    custom.push(JSON.stringify([type, row]))
  }
  const key = JSON.stringify({
    builtIn: builtIn.sort(compareStrings),
    custom: custom.sort(compareStrings),
    notAddable: [...notAddable].sort(compareStrings),
    scope: scopeOrganizationId,
  })
  return createHash('sha256').update(key).digest('hex')
}

/**
 * The workspace catalog, or with `storedTypes` the per-workflow source catalog: the blocks this
 * caller may place, sunset blocks included (existing placements must still compile), plus every
 * type already stored in the workflow that the caller could not place, marked `addable: false`.
 *
 * MUST run inside `withCatalogBlockScope(gate, …)`: visibility and the org's custom blocks are
 * resolved from that scope. Built-in blocks are projected from the raw registry config, not the
 * viewer projection, so a revealed preview block's display suffix never changes the hash.
 *
 * Served from a process cache keyed by the content the build reads; callers share the result and
 * must not mutate it.
 */
export function buildSourceCatalog(scope: SourceCatalogScope): BlockCatalog {
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

  const scopeOrganizationId =
    scope.organizationId && scope.gate.customBlockRows.length > 0 ? scope.organizationId : null
  const key = catalogCacheKey(included, notAddable, scopeOrganizationId, scope.gate)
  const cached = key === null ? undefined : compileCatalogs.get(key)
  if (cached !== undefined) return cached

  const built = buildBlockCatalog({
    blocks: [...included.values()],
    notAddable,
    trigger: registryTrigger,
    sdkNames: SDK_NAMES,
    ...(scopeOrganizationId ? { scope: { organizationId: scopeOrganizationId } } : {}),
  })
  if (key !== null) compileCatalogs.set(key, built)
  return built
}
