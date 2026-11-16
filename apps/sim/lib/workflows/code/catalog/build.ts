import { createHash } from 'node:crypto'
import { compareStrings } from '@sim/utils/string'
import {
  type BlockCatalog,
  type CatalogBlock,
  type CatalogBuilder,
  type CatalogTrigger,
  compactBlockCatalog,
  type ExpandedBlockCatalog,
  stableStringify,
} from '@sim/workflow-code'
import { SDK_MAJOR } from '@sim/workflow-sdk/codegen'
import { containerBlock, projectBlock, projectTrigger } from '@/lib/workflows/code/catalog/project'
import {
  operationOptions,
  type SdkNamesFile,
  sortRecord,
  toCamelIdentifier,
} from '@/lib/workflows/code/catalog/sdk-names'
import { CUSTOM_BLOCK_TYPE_PREFIX } from '@/blocks/custom/build-config'
import type { BlockConfig } from '@/blocks/types'
import type { TriggerConfig } from '@/triggers/types'

/**
 * SHA-256 over the package's `stableStringify` (sorted keys, and a throw on anything that is not
 * plain JSON, so a function leaking into the catalog fails the build instead of hashing). The
 * digest uses `node:crypto` rather than the package's pure-JS `sha256Hex` because the core shard
 * is megabytes; the bytes hashed are identical, so the two agree.
 */
function catalogHash(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex')
}

interface CatalogBuildInput {
  /** Every block the catalog serves, in any order. */
  blocks: readonly BlockConfig[]
  /** Types placed in the workflow but not addable by this caller. */
  notAddable?: ReadonlySet<string>
  /** `getTrigger()`-shaped lookup; `undefined` for an unknown id. */
  trigger: (triggerId: string) => TriggerConfig | undefined
  sdkNames: SdkNamesFile
  scope?: { organizationId: string }
}

/**
 * Projections of registry block and trigger objects, keyed by identity. A built-in config is a
 * process-lifetime constant and every thunk it holds reads only the deployment, so it is projected
 * once per process; per-request custom-block configs are new objects and simply miss.
 */
const blockProjections = new WeakMap<BlockConfig, CatalogBlock>()
const triggerProjections = new WeakMap<TriggerConfig, CatalogTrigger>()

function memoized<Config extends object, Projected>(
  cache: WeakMap<Config, Projected>,
  config: Config,
  project: (config: Config) => Projected
): Projected {
  const cached = cache.get(config)
  if (cached !== undefined) return cached
  const projected = project(config)
  cache.set(config, projected)
  return projected
}

function addBuilder(
  builders: Record<string, CatalogBuilder>,
  path: string,
  builder: CatalogBuilder
): void {
  if (!Object.hasOwn(builders, path)) builders[path] = builder
}

/**
 * Builder entries for one block from its frozen names: one per operation (`slack.sendMessage`),
 * or the bare namespace for a block without an operation dropdown, plus one per trigger
 * (`trigger.gmail.poller`) pinning `selectedTriggerId` where the block stores it. A trigger block
 * (`category: 'triggers'`) is its own trigger: its namespace already sits under `trigger.`. A block
 * with no names entry gets none; the SDK's generic `block(type, …)` builder reaches it.
 */
function addBlockBuilders(
  builders: Record<string, CatalogBuilder>,
  block: BlockConfig,
  namespace: string,
  methods: Record<string, string> | undefined,
  triggerMethods: Record<string, string> | undefined
): void {
  const operations = operationOptions(block)
  if (operations.length > 0 && methods) {
    for (const operation of operations) {
      const method = methods[operation.id]
      if (method)
        addBuilder(builders, `${namespace}.${method}`, {
          type: block.type,
          operation: operation.id,
        })
    }
  } else {
    addBuilder(builders, namespace, { type: block.type })
  }
  if (!block.triggers?.enabled || !triggerMethods || block.category === 'triggers') return
  const pinsTrigger = block.subBlocks.some((subBlock) => subBlock.id === 'selectedTriggerId')
  for (const triggerId of block.triggers.available) {
    const method = triggerMethods[triggerId]
    if (!method) continue
    const builder: CatalogBuilder = { type: block.type, triggerMode: true }
    if (pinsTrigger) builder.fixed = { selectedTriggerId: triggerId }
    addBuilder(builders, `trigger.${namespace}.${method}`, builder)
  }
}

/** `custom_block_lead-scorer` → `custom.leadScorer`, suffixed on collision. */
function customNamespace(type: string, taken: Set<string>): string {
  const base = toCamelIdentifier(type.slice(CUSTOM_BLOCK_TYPE_PREFIX.length)) || 'block'
  const safe = /^[A-Za-z_$]/.test(base) ? base : `_${base}`
  let candidate = `custom.${safe}`
  for (let n = 2; taken.has(candidate); n++) candidate = `custom.${safe}${n}`
  taken.add(candidate)
  return candidate
}

/**
 * Projects registry definitions into an expanded catalog (no hash): the shape every consumer reads
 * through the package's catalog view. {@link buildBlockCatalog} encodes it as the served core shard.
 */
export function projectBlockCatalog(input: CatalogBuildInput): Omit<ExpandedBlockCatalog, 'hash'> {
  const blocks: Array<[string, CatalogBlock]> = []
  const builders: Record<string, CatalogBuilder> = {}
  const triggerIds = new Set<string>()
  const customNamespaces = new Set<string>()

  const ordered = [...input.blocks].sort((a, b) => compareStrings(a.type, b.type))
  for (const block of ordered) {
    const projected = memoized(blockProjections, block, projectBlock)
    const names = input.sdkNames.blocks[block.type]
    const catalogBlock: CatalogBlock = {
      ...projected,
      ...(input.notAddable?.has(block.type) && { addable: false as const }),
      ...(names?.paramAliases && { paramAliases: names.paramAliases }),
    }
    blocks.push([block.type, catalogBlock])

    if (names) {
      addBlockBuilders(builders, block, names.namespace, names.methods, names.triggers)
    } else if (block.type.startsWith(CUSTOM_BLOCK_TYPE_PREFIX)) {
      addBuilder(builders, customNamespace(block.type, customNamespaces), { type: block.type })
    }
    if (block.triggers?.enabled) for (const id of block.triggers.available) triggerIds.add(id)
  }

  // `core.d.ts` declares the container builders (`loop.forEach`, `parallel.collection`, ...), and
  // print and compile resolve them without the builders map.
  for (const type of ['loop', 'parallel'] as const) blocks.push([type, containerBlock(type)])

  const triggers: Array<[string, CatalogTrigger]> = []
  for (const id of triggerIds) {
    const config = input.trigger(id)
    if (!config) continue
    triggers.push([id, memoized(triggerProjections, config, projectTrigger)])
  }

  const catalog: Omit<ExpandedBlockCatalog, 'hash'> = {
    catalogVersion: 1,
    sdkMajor: SDK_MAJOR,
    blocks: sortRecord(Object.fromEntries(blocks)),
    triggers: sortRecord(Object.fromEntries(triggers)),
    builders: sortRecord(builders),
  }
  if (input.scope) catalog.scope = { organizationId: input.scope.organizationId }
  return catalog
}

/**
 * Builds the served `BlockCatalog` (its core shard) from registry definitions. Deterministic: the
 * same inputs give the same bytes and the same hash.
 */
export function buildBlockCatalog(input: CatalogBuildInput): BlockCatalog {
  const core = compactBlockCatalog(projectBlockCatalog(input))
  return { ...core, hash: catalogHash(core) }
}
