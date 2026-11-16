/**
 * The only reader of a served `BlockCatalog`'s layout. Every consumer (canonicalize, compile, the
 * printer, SDK codegen, the proof harness) asks these accessors for a block, trigger, builder or
 * tool and gets the expanded shape (`CatalogBlock`, `CatalogTrigger`), so the core shard's
 * encoding (`compact.ts`) can change without touching a consumer.
 *
 * Expansion is lazy and memoized per catalog object: compiling one workflow expands only the
 * blocks it names, and a catalog is immutable once served, so a memo never goes stale.
 */

import type {
  BlockCatalog,
  CatalogBlock,
  CatalogBlockDocs,
  CatalogBuilder,
  CatalogCondition,
  CatalogConditionEntry,
  CatalogListRef,
  CatalogOutput,
  CatalogOutputEntry,
  CatalogSharedSubBlockRef,
  CatalogSubBlock,
  CatalogSubBlockEntry,
  CatalogTool,
  CatalogTrigger,
  CatalogTriggerSubBlocksRef,
  ExpandedBlockCatalog,
  SubBlockConditionClause,
} from './types'

/** Docs shards by block type, merged into an expansion that wants display text. */
export type CatalogDocsReader = (type: string) => CatalogBlockDocs | undefined

interface CatalogMemo {
  blocks: Map<string, CatalogBlock>
  triggers: Map<string, CatalogTrigger>
}

const memos = new WeakMap<BlockCatalog, CatalogMemo>()

function memoOf(catalog: BlockCatalog): CatalogMemo {
  let memo = memos.get(catalog)
  if (!memo) {
    memo = { blocks: new Map(), triggers: new Map() }
    memos.set(catalog, memo)
  }
  return memo
}

function isListRef(value: unknown): value is CatalogListRef {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'list' in value
}

function listAt(catalog: BlockCatalog, ref: CatalogListRef): Array<string | number | boolean> {
  const list = catalog.lists?.[ref.list]
  if (!list) throw new Error(`Block catalog list ${ref.list} does not exist`)
  return [...list]
}

function expandCondition(catalog: BlockCatalog, entry: CatalogConditionEntry): CatalogCondition {
  if ('opaque' in entry) return entry
  const clause: SubBlockConditionClause = {
    field: entry.field,
    value: isListRef(entry.value) ? listAt(catalog, entry.value) : entry.value,
  }
  if (entry.not !== undefined) clause.not = entry.not
  if (entry.and) {
    const and: NonNullable<SubBlockConditionClause['and']> = {
      field: entry.and.field,
      value: isListRef(entry.and.value) ? listAt(catalog, entry.and.value) : entry.and.value,
    }
    if (entry.and.not !== undefined) and.not = entry.and.not
    clause.and = and
  }
  return clause
}

function sharedAt(catalog: BlockCatalog, ref: CatalogSharedSubBlockRef): CatalogSubBlockEntry {
  const entry = catalog.subBlocks?.[ref.shared]
  if (!entry) throw new Error(`Block catalog subBlock ${ref.shared} does not exist`)
  return entry
}

function expandSubBlock(
  catalog: BlockCatalog,
  ref: CatalogSubBlockEntry | CatalogSharedSubBlockRef,
  labels: readonly string[] | undefined
): CatalogSubBlock {
  const entry = 'shared' in ref ? sharedAt(catalog, ref) : ref
  const { condition, required, options, ...rest } = entry
  const subBlock: CatalogSubBlock = { ...rest }
  if (condition !== undefined) subBlock.condition = expandCondition(catalog, condition)
  if (required !== undefined) {
    subBlock.required =
      typeof required === 'boolean' ? required : expandCondition(catalog, required)
  }
  if (options !== undefined) {
    subBlock.options = Array.isArray(options)
      ? options.map((option, index) => ({
          id: option.id,
          label: labels?.[index] ?? option.label ?? option.id,
        }))
      : options
  }
  return subBlock
}

function triggerRun(catalog: BlockCatalog, ref: CatalogTriggerSubBlocksRef): CatalogSubBlock[] {
  const trigger = Object.hasOwn(catalog.triggers, ref.trigger)
    ? catalog.triggers[ref.trigger]
    : undefined
  const run = trigger?.subBlocks.slice(ref.start, ref.start + ref.count) ?? []
  if (run.length !== ref.count) {
    throw new Error(
      `Block catalog trigger run ${ref.trigger}[${ref.start}+${ref.count}] is out of range`
    )
  }
  return run.map((entry) => ({ ...expandSubBlock(catalog, entry, undefined), surface: 'trigger' }))
}

function sharedOutputsAt(catalog: BlockCatalog, index: number): Record<string, CatalogOutputEntry> {
  const record = catalog.outputs?.[index]
  if (!record) throw new Error(`Block catalog outputs ${index} does not exist`)
  return record
}

function expandOutput(catalog: BlockCatalog, entry: CatalogOutputEntry): CatalogOutput {
  const { properties, sharedProperties, items, ...rest } = entry
  const output: CatalogOutput = { ...rest }
  if (sharedProperties !== undefined) {
    output.properties = expandOutputRecord(catalog, sharedOutputsAt(catalog, sharedProperties))
  } else if (properties) {
    output.properties = expandOutputRecord(catalog, properties)
  }
  if (items) output.items = expandOutput(catalog, items)
  return output
}

function expandOutputRecord(
  catalog: BlockCatalog,
  record: Record<string, CatalogOutputEntry>
): Record<string, CatalogOutput> {
  const expanded: Record<string, CatalogOutput> = {}
  for (const [name, entry] of Object.entries(record)) expanded[name] = expandOutput(catalog, entry)
  return expanded
}

function expandOutputs(
  catalog: BlockCatalog,
  entry: { outputs?: Record<string, CatalogOutputEntry>; sharedOutputs?: number }
): Record<string, CatalogOutput> {
  if (entry.sharedOutputs !== undefined) {
    return expandOutputRecord(catalog, sharedOutputsAt(catalog, entry.sharedOutputs))
  }
  return expandOutputRecord(catalog, entry.outputs ?? {})
}

function expandBlock(catalog: BlockCatalog, type: string, docs?: CatalogBlockDocs): CatalogBlock {
  const stored = catalog.blocks[type]
  const { subBlocks: entries, inputs, outputs, sharedOutputs, ...rest } = stored
  const subBlocks: CatalogSubBlock[] = []
  for (const entry of entries) {
    if ('trigger' in entry) {
      subBlocks.push(...triggerRun(catalog, entry))
      continue
    }
    subBlocks.push(expandSubBlock(catalog, entry, docs?.optionLabels?.[String(subBlocks.length)]))
  }
  return {
    ...rest,
    subBlocks,
    inputs: inputs ?? docs?.inputs ?? {},
    outputs: expandOutputs(catalog, stored),
  }
}

function expandTrigger(catalog: BlockCatalog, id: string): CatalogTrigger {
  const trigger = catalog.triggers[id]
  const { subBlocks, outputs, sharedOutputs, ...rest } = trigger
  return {
    ...rest,
    subBlocks: subBlocks.map((entry) => expandSubBlock(catalog, entry, undefined)),
    outputs: expandOutputs(catalog, trigger),
  }
}

/**
 * The expanded block of `type`, or `undefined` when the catalog does not serve it. Option labels
 * and inputs kept in the docs shard are absent: labels read as their ids, inputs as `{}`.
 */
export function catalogBlock(catalog: BlockCatalog, type: string): CatalogBlock | undefined {
  if (!Object.hasOwn(catalog.blocks, type)) return undefined
  const memo = memoOf(catalog)
  let block = memo.blocks.get(type)
  if (!block) {
    block = expandBlock(catalog, type)
    memo.blocks.set(type, block)
  }
  return block
}

/** Every block type the catalog serves, in catalog order. */
export function catalogBlockTypes(catalog: BlockCatalog): string[] {
  return Object.keys(catalog.blocks)
}

/** The expanded trigger `id`, or `undefined` when the catalog does not serve it. */
export function catalogTrigger(catalog: BlockCatalog, id: string): CatalogTrigger | undefined {
  if (!Object.hasOwn(catalog.triggers, id)) return undefined
  const memo = memoOf(catalog)
  let trigger = memo.triggers.get(id)
  if (!trigger) {
    trigger = expandTrigger(catalog, id)
    memo.triggers.set(id, trigger)
  }
  return trigger
}

/** Every trigger id the catalog serves, in catalog order. */
export function catalogTriggerIds(catalog: BlockCatalog): string[] {
  return Object.keys(catalog.triggers)
}

/** The builder at a dotted SDK path (`slack.sendMessage`), or `undefined`. */
export function catalogBuilder(catalog: BlockCatalog, path: string): CatalogBuilder | undefined {
  return Object.hasOwn(catalog.builders, path) ? catalog.builders[path] : undefined
}

/** Every builder path, in catalog order. */
export function catalogBuilderPaths(catalog: BlockCatalog): string[] {
  return Object.keys(catalog.builders)
}

/** The docs-shard tool `id` when the catalog carries tool docs, else `undefined`. */
export function catalogTool(catalog: BlockCatalog, id: string): CatalogTool | undefined {
  return catalog.tools && Object.hasOwn(catalog.tools, id) ? catalog.tools[id] : undefined
}

/**
 * The whole catalog in expanded form. With `docs`, each block's docs shard is merged back in, which
 * reproduces the projection exactly (the core-shard equivalence property); without, it is what
 * the per-block accessors return.
 */
export function expandBlockCatalog(
  catalog: BlockCatalog,
  docs?: CatalogDocsReader
): ExpandedBlockCatalog {
  const { blocks, triggers, subBlocks, lists, outputs, ...rest } = catalog
  const expandedBlocks: Record<string, CatalogBlock> = {}
  for (const type of Object.keys(blocks)) {
    const blockDocs = docs?.(type)
    expandedBlocks[type] = blockDocs
      ? expandBlock(catalog, type, blockDocs)
      : (catalogBlock(catalog, type) ?? expandBlock(catalog, type))
  }
  const expandedTriggers: Record<string, CatalogTrigger> = {}
  for (const id of Object.keys(triggers)) {
    expandedTriggers[id] = catalogTrigger(catalog, id) ?? expandTrigger(catalog, id)
  }
  return { ...rest, blocks: expandedBlocks, triggers: expandedTriggers }
}
