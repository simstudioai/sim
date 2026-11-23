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

/** Where a projection reads trigger configs and the frozen SDK names from. */
interface CatalogSources {
  /** `getTrigger()`-shaped lookup; `undefined` for an unknown id. */
  trigger: (triggerId: string) => TriggerConfig | undefined
  sdkNames: SdkNamesFile
}

interface CatalogBuildInput extends CatalogSources {
  /** Every block the catalog serves, in any order. */
  blocks: readonly BlockConfig[]
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

/** What projecting a set of blocks yields, before containers and triggers are added. */
interface ProjectedBlocks {
  blocks: Array<[string, CatalogBlock]>
  builders: Record<string, CatalogBuilder>
  triggerIds: Set<string>
}

/**
 * Projects blocks in type order with their builders and the trigger ids they reference.
 * `takenCustomNamespaces` holds the `custom.*` builder paths already used, so a custom block's
 * namespace stays unique against them.
 */
function projectBlocks(
  input: readonly BlockConfig[],
  sdkNames: SdkNamesFile,
  options: { addable: boolean; takenCustomNamespaces?: Iterable<string> }
): ProjectedBlocks {
  const blocks: Array<[string, CatalogBlock]> = []
  const builders: Record<string, CatalogBuilder> = {}
  const triggerIds = new Set<string>()
  const customNamespaces = new Set<string>(options.takenCustomNamespaces)

  const ordered = [...input].sort((a, b) => compareStrings(a.type, b.type))
  for (const block of ordered) {
    const projected = memoized(blockProjections, block, projectBlock)
    const names = sdkNames.blocks[block.type]
    const catalogBlock: CatalogBlock = {
      ...projected,
      ...(!options.addable && { addable: false as const }),
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
  return { blocks, builders, triggerIds }
}

/**
 * Projects registry definitions into an expanded catalog (no hash): the shape every consumer reads
 * through the package's catalog view. {@link buildBlockCatalog} encodes it as the served core shard.
 */
export function projectBlockCatalog(input: CatalogBuildInput): Omit<ExpandedBlockCatalog, 'hash'> {
  const { blocks, builders, triggerIds } = projectBlocks(input.blocks, input.sdkNames, {
    addable: true,
  })

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

/**
 * `base` plus block types that may stay where a workflow already uses them but that this caller
 * cannot add, each marked `addable: false`, with the triggers and builders they bring. The added
 * entries are in expanded form (a valid core-shard entry), and the hash covers `base.hash` and
 * them, so it is as deterministic as a build. Only the added types are projected and hashed,
 * which lets one cached workspace catalog serve every workflow's not-addable set. Builder paths
 * and custom namespaces `base` already uses keep pointing where they did. Never mutates `base`.
 */
export function withNotAddableBlocks(
  base: BlockCatalog,
  blocks: readonly BlockConfig[],
  sources: CatalogSources
): BlockCatalog {
  const fresh = blocks.filter((block) => !Object.hasOwn(base.blocks, block.type))
  if (fresh.length === 0) return base
  const projected = projectBlocks(fresh, sources.sdkNames, {
    addable: false,
    takenCustomNamespaces: Object.keys(base.builders).filter((path) => path.startsWith('custom.')),
  })
  const triggers: Record<string, CatalogTrigger> = {}
  for (const id of projected.triggerIds) {
    if (Object.hasOwn(base.triggers, id)) continue
    const config = sources.trigger(id)
    if (config) triggers[id] = memoized(triggerProjections, config, projectTrigger)
  }
  const builders: Record<string, CatalogBuilder> = {}
  for (const [path, builder] of Object.entries(projected.builders)) {
    if (!Object.hasOwn(base.builders, path)) builders[path] = builder
  }
  const added = {
    blocks: sortRecord(Object.fromEntries(projected.blocks)),
    triggers: sortRecord(triggers),
    builders: sortRecord(builders),
  }
  return {
    ...base,
    blocks: sortRecord({ ...base.blocks, ...added.blocks }),
    triggers: sortRecord({ ...base.triggers, ...added.triggers }),
    builders: sortRecord({ ...base.builders, ...added.builders }),
    hash: catalogHash({ base: base.hash, notAddable: added }),
  }
}
