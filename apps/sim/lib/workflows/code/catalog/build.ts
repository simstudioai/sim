import { createHash } from 'node:crypto'
import { compareStrings } from '@sim/utils/string'
import {
  type BlockCatalog,
  type CatalogBlock,
  type CatalogBlockDocs,
  type CatalogBuilder,
  type CatalogTool,
  type CatalogTrigger,
  compactBlockCatalog,
  type ExpandedBlockCatalog,
  stableStringify,
} from '@sim/workflow-code'
import { SDK_MAJOR } from '@sim/workflow-sdk/codegen'
import {
  containerBlock,
  type OpaqueSite,
  type ProjectedBlock,
  type ProjectionReport,
  projectBlock,
  projectCatalogTool,
  projectTrigger,
} from '@/lib/workflows/code/catalog/project'
import {
  operationOptions,
  type SdkNamesFile,
  toCamelIdentifier,
} from '@/lib/workflows/code/catalog/sdk-names'
import { CUSTOM_BLOCK_TYPE_PREFIX } from '@/blocks/custom/build-config'
import type { BlockConfig } from '@/blocks/types'
import type { ToolMetadata } from '@/tools/metadata'
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

/**
 * One block's docs shard: the text, tool schemas, option labels and inputs the core shard leaves
 * out. `expandBlockCatalog(catalog, docs)` merges the `CatalogBlockDocs` part back.
 */
interface CatalogDocsShard extends CatalogBlockDocs {
  type: string
  hash: string
  description: string
  tools: Record<string, CatalogTool>
}

interface CatalogBuildInput {
  /** Every block the catalog serves, in any order. */
  blocks: readonly BlockConfig[]
  /** Types placed in the workflow but not addable by this caller (s4: per-workflow catalog). */
  notAddable?: ReadonlySet<string>
  /** `getTrigger()`-shaped lookup; `undefined` for an unknown id. */
  trigger: (triggerId: string) => TriggerConfig | undefined
  sdkNames: SdkNamesFile
  scope?: { organizationId: string }
}

export interface CatalogBuildResult {
  catalog: BlockCatalog
  report: ProjectionReport
  docs: (type: string) => CatalogDocsShard | undefined
}

/** The projection before encoding: every block and trigger in expanded form. */
export interface CatalogProjection {
  catalog: Omit<ExpandedBlockCatalog, 'hash'>
  report: ProjectionReport
  /** Block descriptions and tool ids, for the docs shards. */
  descriptions: ReadonlyMap<string, { description: string; access: string[] }>
}

interface ToolMetadataSource {
  metadata: (toolId: string) => ToolMetadata | undefined
  outputs: (toolId: string) => Record<string, unknown> | undefined
}

interface MemoizedBlock {
  projected: ProjectedBlock
  opaque: OpaqueSite[]
}

/**
 * Projections of registry block objects, keyed by identity. A built-in block config is a
 * process-lifetime constant and every thunk it holds reads only the deployment, so it is projected
 * once per process; per-request custom-block configs are new objects and simply miss.
 */
const blockProjections = new WeakMap<BlockConfig, MemoizedBlock>()
const triggerProjections = new WeakMap<TriggerConfig, MemoizedTrigger>()

interface MemoizedTrigger {
  projected: CatalogTrigger
  opaque: OpaqueSite[]
}

function memoizedBlock(block: BlockConfig): MemoizedBlock {
  const cached = blockProjections.get(block)
  if (cached) return cached
  const report: ProjectionReport = { opaque: [] }
  const entry = { projected: projectBlock(block, report), opaque: report.opaque }
  blockProjections.set(block, entry)
  return entry
}

function memoizedTrigger(trigger: TriggerConfig): MemoizedTrigger {
  const cached = triggerProjections.get(trigger)
  if (cached) return cached
  const report: ProjectionReport = { opaque: [] }
  const entry = { projected: projectTrigger(trigger, report), opaque: report.opaque }
  triggerProjections.set(trigger, entry)
  return entry
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

function sortedRecord<T>(entries: Array<[string, T]>): Record<string, T> {
  return Object.fromEntries(entries.sort(([a], [b]) => compareStrings(a, b)))
}

/**
 * Projects registry definitions into an expanded catalog (no hash): the shape every consumer reads
 * through the package's catalog view. {@link buildBlockCatalog} encodes it as the served core shard.
 */
export function projectBlockCatalog(input: CatalogBuildInput): CatalogProjection {
  const report: ProjectionReport = { opaque: [] }
  const blocks: Array<[string, CatalogBlock]> = []
  const descriptions = new Map<string, { description: string; access: string[] }>()
  const builders: Record<string, CatalogBuilder> = {}
  const triggerIds = new Set<string>()
  const customNamespaces = new Set<string>()

  const ordered = [...input.blocks].sort((a, b) => compareStrings(a.type, b.type))
  for (const block of ordered) {
    const { projected, opaque } = memoizedBlock(block)
    report.opaque.push(...opaque)
    const names = input.sdkNames.blocks[block.type]
    const catalogBlock: CatalogBlock = {
      ...projected.block,
      ...(input.notAddable?.has(block.type) && { addable: false as const }),
      ...(names?.paramAliases && { paramAliases: names.paramAliases }),
    }
    blocks.push([block.type, catalogBlock])
    descriptions.set(block.type, {
      description: projected.description,
      access: catalogBlock.tools.access,
    })

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
    const { projected, opaque } = memoizedTrigger(config)
    report.opaque.push(...opaque)
    triggers.push([id, projected])
  }

  const catalog: Omit<ExpandedBlockCatalog, 'hash'> = {
    catalogVersion: 1,
    sdkMajor: SDK_MAJOR,
    blocks: sortedRecord(blocks),
    triggers: sortedRecord(triggers),
    builders: sortedRecord(Object.entries(builders)),
  }
  if (input.scope) catalog.scope = { organizationId: input.scope.organizationId }
  return { catalog, report, descriptions }
}

/**
 * Builds the core shard of a `BlockCatalog` from registry definitions, plus a docs-shard reader.
 * Deterministic: the same inputs give the same bytes and the same hash.
 */
export function buildBlockCatalog(
  input: CatalogBuildInput,
  tools?: ToolMetadataSource
): CatalogBuildResult {
  const { catalog: expanded, report, descriptions } = projectBlockCatalog(input)
  const { core, docs: blockDocs } = compactBlockCatalog(expanded)
  const catalog: BlockCatalog = { ...core, hash: catalogHash(core) }

  const docs = (type: string): CatalogDocsShard | undefined => {
    const entry = descriptions.get(type)
    if (!entry) return undefined
    const shardTools: Record<string, CatalogTool> = {}
    for (const toolId of entry.access) {
      const metadata = tools?.metadata(toolId)
      if (metadata)
        shardTools[toolId] = projectCatalogTool(toolId, metadata, tools?.outputs(toolId))
    }
    const body = {
      type,
      description: entry.description,
      tools: shardTools,
      ...(Object.hasOwn(blockDocs, type) ? blockDocs[type] : {}),
    }
    return { ...body, hash: catalogHash(body) }
  }

  return { catalog, report, docs }
}
