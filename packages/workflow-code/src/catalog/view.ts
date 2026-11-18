/**
 * The only reader of a served `BlockCatalog`'s layout. Every consumer (canonicalize, compile, the
 * printer, SDK codegen, the proof harness) asks these accessors for a block, trigger, builder or
 * tool and gets the expanded shape (`CatalogBlock`, `CatalogTrigger`), so the core shard's
 * encoding (`compact.ts`) can change without touching a consumer.
 *
 * Expansion is lazy and memoized per catalog object: compiling one workflow expands only the
 * blocks it names, and a catalog is immutable once served, so a memo never goes stale.
 */

import { isRecordLike } from '@sim/utils/object'
import { getOwn, setOwn } from '../records'
import type {
  BlockCatalog,
  CatalogBlock,
  CatalogBuilder,
  CatalogCondition,
  CatalogConditionEntry,
  CatalogListRef,
  CatalogOutput,
  CatalogOutputEntry,
  CatalogSharedSubBlockRef,
  CatalogSubBlock,
  CatalogSubBlockEntry,
  CatalogTrigger,
  CatalogTriggerSubBlocksRef,
  ExpandedBlockCatalog,
  SubBlockConditionClause,
} from './types'

interface CatalogMemo {
  blocks: Map<string, CatalogBlock>
  triggers: Map<string, CatalogTrigger>
  /** Builder `[path, builder]` pairs by block type, in catalog order; built on first use. */
  buildersByType?: Map<string, Array<[string, CatalogBuilder]>>
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
  return isRecordLike(value) && 'list' in value
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
  ref: CatalogSubBlockEntry | CatalogSharedSubBlockRef
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
      ? options.map((option) => ({ id: option.id, label: option.label ?? option.id }))
      : options
  }
  return subBlock
}

function triggerRun(catalog: BlockCatalog, ref: CatalogTriggerSubBlocksRef): CatalogSubBlock[] {
  const trigger = getOwn(catalog.triggers, ref.trigger)
  const run = trigger?.subBlocks.slice(ref.start, ref.start + ref.count) ?? []
  if (run.length !== ref.count) {
    throw new Error(
      `Block catalog trigger run ${ref.trigger}[${ref.start}+${ref.count}] is out of range`
    )
  }
  return run.map((entry) => ({ ...expandSubBlock(catalog, entry), surface: 'trigger' }))
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
  for (const [name, entry] of Object.entries(record)) {
    setOwn(expanded, name, expandOutput(catalog, entry))
  }
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

function expandBlock(catalog: BlockCatalog, type: string): CatalogBlock {
  const stored = catalog.blocks[type]
  const { subBlocks: entries, outputs, sharedOutputs, ...rest } = stored
  const subBlocks: CatalogSubBlock[] = []
  for (const entry of entries) {
    if ('trigger' in entry) {
      subBlocks.push(...triggerRun(catalog, entry))
      continue
    }
    subBlocks.push(expandSubBlock(catalog, entry))
  }
  return {
    ...rest,
    subBlocks,
    outputs: expandOutputs(catalog, stored),
  }
}

function expandTrigger(catalog: BlockCatalog, id: string): CatalogTrigger {
  const trigger = catalog.triggers[id]
  const { subBlocks, outputs, sharedOutputs, ...rest } = trigger
  return {
    ...rest,
    subBlocks: subBlocks.map((entry) => expandSubBlock(catalog, entry)),
    outputs: expandOutputs(catalog, trigger),
  }
}

/**
 * The expanded block of `type`, or `undefined` when the catalog does not serve it. An option label
 * the core shard does not keep reads as its id.
 */
export function catalogBlock(catalog: BlockCatalog, type: string): CatalogBlock | undefined {
  return Object.hasOwn(catalog.blocks, type) ? memoBlock(catalog, type) : undefined
}

/** The memoized expansion of a block type the catalog serves (an own key of `blocks`). */
function memoBlock(catalog: BlockCatalog, type: string): CatalogBlock {
  const memo = memoOf(catalog)
  let block = memo.blocks.get(type)
  if (!block) {
    block = expandBlock(catalog, type)
    memo.blocks.set(type, block)
  }
  return block
}

const NO_DECLARATIONS: readonly CatalogSubBlock[] = []

/** {@link declarationsById} per subBlock list; a served block's list is never edited. */
const declarationsMemo = new WeakMap<
  ReadonlyArray<CatalogSubBlock>,
  ReadonlyMap<string, readonly CatalogSubBlock[]>
>()

/**
 * A block's declarations by subBlock id, in declared order: a block may declare one id more than
 * once (one copy per surface, or per operation). Built once per block.
 */
function declarationsById(
  block: Pick<CatalogBlock, 'subBlocks'>
): ReadonlyMap<string, readonly CatalogSubBlock[]> {
  let byId = declarationsMemo.get(block.subBlocks)
  if (!byId) {
    const built = new Map<string, CatalogSubBlock[]>()
    for (const subBlock of block.subBlocks) {
      const list = built.get(subBlock.id)
      if (list) list.push(subBlock)
      else built.set(subBlock.id, [subBlock])
    }
    byId = built
    declarationsMemo.set(block.subBlocks, byId)
  }
  return byId
}

/** Every declaration of `id` on a block ({@link declarationsById}), in declared order. */
export function declarationsOf(
  block: Pick<CatalogBlock, 'subBlocks'>,
  id: string
): readonly CatalogSubBlock[] {
  return declarationsById(block).get(id) ?? NO_DECLARATIONS
}

/** Every block type the catalog serves, in catalog order. */
export function catalogBlockTypes(catalog: BlockCatalog): string[] {
  return Object.keys(catalog.blocks)
}

/** The expanded trigger `id`, or `undefined` when the catalog does not serve it. */
export function catalogTrigger(catalog: BlockCatalog, id: string): CatalogTrigger | undefined {
  return Object.hasOwn(catalog.triggers, id) ? memoTrigger(catalog, id) : undefined
}

/** The memoized expansion of a trigger the catalog serves (an own key of `triggers`). */
function memoTrigger(catalog: BlockCatalog, id: string): CatalogTrigger {
  const memo = memoOf(catalog)
  let trigger = memo.triggers.get(id)
  if (!trigger) {
    trigger = expandTrigger(catalog, id)
    memo.triggers.set(id, trigger)
  }
  return trigger
}

/** The builder at a dotted SDK path (`slack.sendMessage`), or `undefined`. */
export function catalogBuilder(catalog: BlockCatalog, path: string): CatalogBuilder | undefined {
  return getOwn(catalog.builders, path)
}

/** Every builder path, in catalog order. */
export function catalogBuilderPaths(catalog: BlockCatalog): string[] {
  return Object.keys(catalog.builders)
}

/** The `[path, builder]` pairs that build blocks of `type`, in catalog order. */
export function catalogBuildersOfType(
  catalog: BlockCatalog,
  type: string
): ReadonlyArray<[string, CatalogBuilder]> {
  const memo = memoOf(catalog)
  if (!memo.buildersByType) {
    const byType = new Map<string, Array<[string, CatalogBuilder]>>()
    for (const [path, builder] of Object.entries(catalog.builders)) {
      const list = byType.get(builder.type) ?? []
      list.push([path, builder])
      byType.set(builder.type, list)
    }
    memo.buildersByType = byType
  }
  return memo.buildersByType.get(type) ?? []
}

/** The whole catalog in expanded form: what the per-block accessors return. */
export function expandBlockCatalog(catalog: BlockCatalog): ExpandedBlockCatalog {
  const { blocks, triggers, subBlocks, lists, outputs, ...rest } = catalog
  const expandedBlocks: Record<string, CatalogBlock> = {}
  for (const type of Object.keys(blocks)) setOwn(expandedBlocks, type, memoBlock(catalog, type))
  const expandedTriggers: Record<string, CatalogTrigger> = {}
  for (const id of Object.keys(triggers)) setOwn(expandedTriggers, id, memoTrigger(catalog, id))
  return { ...rest, blocks: expandedBlocks, triggers: expandedTriggers }
}
