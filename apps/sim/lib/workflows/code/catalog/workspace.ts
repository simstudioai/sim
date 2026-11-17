import { createHash } from 'node:crypto'
import { toRecordOrNull } from '@sim/utils/object'
import { compareStrings } from '@sim/utils/string'
import { type BlockCatalog, parseJsonContainer } from '@sim/workflow-code'
import { LRUCache } from 'lru-cache'
import type { CatalogGate } from '@/lib/catalog/application/context'
import { isBlockVisibleToCaller } from '@/lib/catalog/application/context'
import { buildBlockCatalog, withNotAddableBlocks } from '@/lib/workflows/code/catalog/build'
import { registryTrigger } from '@/lib/workflows/code/catalog/registry-sources'
import { getAllBlocks, getBlock, getBlockRegistry } from '@/blocks/registry'
import { SDK_NAMES } from '@/blocks/sdk-names.generated'
import type { BlockConfig } from '@/blocks/types'

interface SourceCatalogScope {
  gate: CatalogGate
  organizationId: string | null
  /**
   * Block types stored in the workflow, as blocks or as agent tools, for the per-workflow source
   * catalog ({@link storedCatalogTypes}).
   */
  storedTypes?: readonly string[]
}

/** A stored block as far as {@link storedCatalogTypes} reads it. */
interface StoredBlockTypes {
  type: string
  /** The stored `subBlocks` map, read untyped: the catalog read takes it straight from jsonb. */
  subBlocks?: unknown
}

/** The block config ids of a type's `tool-input` fields, the fields that hold attached tools. */
export function toolInputIds(type: string): string[] {
  return (getBlock(type)?.subBlocks ?? [])
    .filter((subBlock) => subBlock.type === 'tool-input')
    .map((subBlock) => subBlock.id)
}

/**
 * Every type a stored workflow's source catalog must declare: each block's type, and the type of
 * each tool attached to a `tool-input` field (an agent's tools). A tool type the caller can no
 * longer place still needs its declaration, or the printer cannot tell its password params apart
 * and would print a stored key verbatim.
 */
export function storedCatalogTypes(blocks: Iterable<StoredBlockTypes>): string[] {
  const types = new Set<string>()
  for (const block of blocks) {
    types.add(block.type)
    for (const id of toolInputIds(block.type)) {
      const raw = toRecordOrNull(toRecordOrNull(block.subBlocks)?.[id])?.value
      const tools = typeof raw === 'string' ? parseJsonContainer(raw) : raw
      if (!Array.isArray(tools)) continue
      for (const tool of tools) {
        const type = toRecordOrNull(tool)?.type
        if (typeof type === 'string') types.add(type)
      }
    }
  }
  return [...types]
}

/**
 * Built workspace catalogs by content key ({@link catalogCacheKey}). A build projects and hashes
 * the whole registry, and every source get, apply and catalog read asks for one. Distinct keys per
 * process are few: one per distinct gate outcome (visibility, allowlist, a workspace's custom
 * blocks). A workflow's not-addable stored types are overlaid on the cached entry per request
 * ({@link withNotAddableBlocks}), never part of the key, so callers whose workflows hold different
 * hidden types share one entry. An entry is several MB of heap, so the ceiling is a memory
 * backstop, not an operating limit.
 *
 * No TTL and no invalidator: the key is the content the build reads, so a custom block publish,
 * an allowlist change or a preview reveal yields a new key, and the old entry ages out. Built-in
 * block configs are constants for the life of the process (a deploy is a new process).
 */
const CATALOG_CACHE_MAX = 16
const compileCatalogs = new LRUCache<string, BlockCatalog>({ max: CATALOG_CACHE_MAX })

/**
 * Workspace catalogs with a workflow's not-addable types overlaid, by base catalog hash and the
 * sorted overlaid types. Only registry configs are overlaid through it: they are process constants,
 * so the types name the content; a custom block's config is not, and its overlay is rebuilt. An
 * overlay shares its base's maps, so an entry costs little beyond the added types.
 */
const NOT_ADDABLE_OVERLAY_CACHE_MAX = 64
const notAddableOverlays = new LRUCache<string, BlockCatalog>({
  max: NOT_ADDABLE_OVERLAY_CACHE_MAX,
})

/**
 * The content a build reads, hashed: every included built-in type (the registry config is a
 * process constant), every included custom block's full row (the config is derived from the row
 * alone), and the organization the catalog is scoped to. The rows and the scope are in the key,
 * so a catalog holding one organization's custom blocks is never served to another. `null` when
 * an included type is neither built in nor one of the gate's custom blocks: its config cannot be
 * keyed, so that build is not cached.
 */
function catalogCacheKey(
  included: ReadonlyMap<string, BlockConfig>,
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
 * The workspace catalog is served from a process cache keyed by the content the build reads, and
 * the not-addable types are overlaid per call; callers share the result and must not mutate it.
 */
export function buildSourceCatalog(scope: SourceCatalogScope): BlockCatalog {
  const registry = getBlockRegistry()
  const included = new Map<string, BlockConfig>()
  for (const block of getAllBlocks()) {
    if (!isBlockVisibleToCaller(block, scope.gate, { includeSunset: true })) continue
    included.set(block.type, Object.hasOwn(registry, block.type) ? registry[block.type] : block)
  }

  const scopeOrganizationId =
    scope.organizationId && scope.gate.customBlockRows.length > 0 ? scope.organizationId : null
  const key = catalogCacheKey(included, scopeOrganizationId, scope.gate)
  let workspaceCatalog = key === null ? undefined : compileCatalogs.get(key)
  if (workspaceCatalog === undefined) {
    workspaceCatalog = buildBlockCatalog({
      blocks: [...included.values()],
      trigger: registryTrigger,
      sdkNames: SDK_NAMES,
      ...(scopeOrganizationId ? { scope: { organizationId: scopeOrganizationId } } : {}),
    })
    if (key !== null) compileCatalogs.set(key, workspaceCatalog)
  }

  const notAddable = new Map<string, BlockConfig>()
  let allRegistry = true
  for (const type of scope.storedTypes ?? []) {
    if (included.has(type) || notAddable.has(type)) continue
    const isRegistry = Object.hasOwn(registry, type)
    const block = isRegistry ? registry[type] : getBlock(type)
    if (!block) continue
    notAddable.set(type, block)
    allRegistry &&= isRegistry
  }
  if (notAddable.size === 0) return workspaceCatalog
  const overlay = () =>
    withNotAddableBlocks(workspaceCatalog, [...notAddable.values()], {
      trigger: registryTrigger,
      sdkNames: SDK_NAMES,
    })
  if (!allRegistry) return overlay()
  const overlayKey = JSON.stringify([
    workspaceCatalog.hash,
    [...notAddable.keys()].sort(compareStrings),
  ])
  let catalog = notAddableOverlays.get(overlayKey)
  if (catalog === undefined) {
    catalog = overlay()
    notAddableOverlays.set(overlayKey, catalog)
  }
  return catalog
}
