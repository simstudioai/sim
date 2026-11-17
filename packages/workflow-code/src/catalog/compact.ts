/**
 * Encodes an expanded catalog as the core shard (`types.ts`, "Core-shard encoding").
 * `expandBlockCatalog` in `view.ts` is its inverse up to the option labels the core shard drops;
 * the registry-wide catalog test proves that over the live registry.
 *
 * Deterministic: tables are filled in catalog order (blocks, then triggers, each in key order),
 * so the same expanded catalog always yields the same bytes and the same hash.
 *
 * Serialized keys of input objects are memoized by identity across calls: the projection hands
 * the same frozen-in-practice block, trigger and output objects to every request's build, so a
 * rebuild serializes only what changed. Inputs must therefore not be mutated after compaction.
 */

import { stableStringify } from '../hash'
import { setOwn } from '../records'
import type {
  BlockCatalog,
  CatalogBlock,
  CatalogBlockEntry,
  CatalogConditionEntry,
  CatalogListRef,
  CatalogOutput,
  CatalogOutputEntry,
  CatalogSharedSubBlockRef,
  CatalogSubBlock,
  CatalogSubBlockEntry,
  CatalogTrigger,
  CatalogTriggerEntry,
  CatalogTriggerSubBlocksRef,
  ExpandedBlockCatalog,
} from './types'

/** Below this many serialized characters a reference costs about as much as the value. */
const MIN_INTERNED_LIST_CHARS = 16
const MIN_SHARED_SUBBLOCK_CHARS = 48
const MIN_SHARED_OUTPUTS_CHARS = 64

type Scalar = string | number | boolean

type KeyMemo = WeakMap<object, string>

function memoKey<T extends object>(memo: KeyMemo, value: T, serialize: (value: T) => string) {
  let key = memo.get(value)
  if (key === undefined) {
    key = serialize(value)
    memo.set(value, key)
  }
  return key
}

const plainKeys: KeyMemo = new WeakMap()
const triggerSurfaceKeys: KeyMemo = new WeakMap()
const blockEntryKeys: KeyMemo = new WeakMap()
const triggerEntryKeys: KeyMemo = new WeakMap()

function keyOf(value: object): string {
  return memoKey(plainKeys, value, stableStringify)
}

/** A trigger subBlock's key as it appears spread into a block (`surface: 'trigger'`). */
function triggerSurfaceKey(subBlock: CatalogSubBlock): string {
  return memoKey(triggerSurfaceKeys, subBlock, (value) =>
    stableStringify({ ...value, surface: 'trigger' })
  )
}

/**
 * Finds the longest run of `subBlocks` from `index` that equals a run of one trigger's subBlocks
 * (each with `surface: 'trigger'`). Candidates are tried in trigger-id order and the first longest
 * wins, so the choice is deterministic.
 */
function longestTriggerRun(
  subBlocks: readonly string[],
  index: number,
  starts: ReadonlyMap<string, Array<{ trigger: string; start: number }>>,
  triggerKeys: ReadonlyMap<string, readonly string[]>
): CatalogTriggerSubBlocksRef | null {
  let best: CatalogTriggerSubBlocksRef | null = null
  for (const candidate of starts.get(subBlocks[index]) ?? []) {
    const keys = triggerKeys.get(candidate.trigger) ?? []
    let count = 0
    while (
      index + count < subBlocks.length &&
      candidate.start + count < keys.length &&
      keys[candidate.start + count] === subBlocks[index + count]
    ) {
      count += 1
    }
    if (!best || count > best.count)
      best = { trigger: candidate.trigger, start: candidate.start, count }
  }
  return best
}

function stripLabels(subBlock: CatalogSubBlock): CatalogSubBlockEntry {
  if (!Array.isArray(subBlock.options)) return subBlock
  return {
    ...subBlock,
    options: subBlock.options.map((option) =>
      option.label === option.id ? { id: option.id } : { id: option.id, label: option.label }
    ),
  }
}

/** A block subBlock keeps only option ids, except the `operation` dropdown's labels. */
function blockSubBlockEntry(subBlock: CatalogSubBlock): CatalogSubBlockEntry {
  if (!Array.isArray(subBlock.options) || subBlock.id === 'operation') return stripLabels(subBlock)
  return { ...subBlock, options: subBlock.options.map((option) => ({ id: option.id })) }
}

function compactBlock(
  block: CatalogBlock,
  starts: ReadonlyMap<string, Array<{ trigger: string; start: number }>>,
  triggerKeys: ReadonlyMap<string, readonly string[]>,
  entryKeys: Map<CatalogSubBlockEntry, string>
): CatalogBlockEntry {
  const { subBlocks, outputs, ...rest } = block
  const keys = subBlocks.map((subBlock) => (subBlock.surface === 'trigger' ? keyOf(subBlock) : ''))
  const entries: CatalogBlockEntry['subBlocks'] = []
  for (let index = 0; index < subBlocks.length; ) {
    const run = keys[index] ? longestTriggerRun(keys, index, starts, triggerKeys) : null
    if (run && run.count > 0) {
      entries.push(run)
      index += run.count
      continue
    }
    const source = subBlocks[index]
    const entry = blockSubBlockEntry(source)
    entryKeys.set(
      entry,
      memoKey(blockEntryKeys, source, () => stableStringify(entry))
    )
    entries.push(entry)
    index += 1
  }
  return { ...rest, subBlocks: entries }
}

/** Condition value lists in an entry, as holders a pass can read and replace. */
function conditionEntries(entry: CatalogSubBlockEntry): CatalogConditionEntry[] {
  const conditions: CatalogConditionEntry[] = []
  if (entry.condition) conditions.push(entry.condition)
  if (typeof entry.required === 'object') conditions.push(entry.required)
  return conditions
}

function forEachList(
  entry: CatalogSubBlockEntry,
  visit: (list: Scalar[], replace: (ref: CatalogListRef) => void) => void
): void {
  for (const condition of conditionEntries(entry)) {
    if ('opaque' in condition) continue
    const { value } = condition
    if (Array.isArray(value)) visit(value, (ref) => (condition.value = ref))
    const and = condition.and
    if (and && Array.isArray(and.value)) {
      const list: Scalar[] = and.value
      visit(list, (ref) => (and.value = ref))
    }
  }
}

/** A deep copy whose condition objects a pass may rewrite in place. */
function ownConditions(entry: CatalogSubBlockEntry): CatalogSubBlockEntry {
  const copy: CatalogSubBlockEntry = { ...entry }
  const copyCondition = (condition: CatalogConditionEntry): CatalogConditionEntry =>
    'opaque' in condition
      ? condition
      : { ...condition, ...(condition.and ? { and: { ...condition.and } } : {}) }
  if (copy.condition) copy.condition = copyCondition(copy.condition)
  if (typeof copy.required === 'object') copy.required = copyCondition(copy.required)
  return copy
}

type EntryList = Array<CatalogSubBlockEntry | CatalogSharedSubBlockRef | CatalogTriggerSubBlocksRef>

/**
 * One inline subBlock entry of a block's or trigger's list. `entry` is the slot's current value;
 * a pass replaces it through `replace`, which also writes the owning list.
 */
interface EntrySlot {
  entry: CatalogSubBlockEntry
  replace: (value: CatalogSubBlockEntry | CatalogSharedSubBlockRef) => void
}

function slotAt(list: EntryList, index: number, entry: CatalogSubBlockEntry): EntrySlot {
  const slot: EntrySlot = {
    entry,
    replace: (value) => {
      list[index] = value
      if (!('shared' in value)) slot.entry = value
    },
  }
  return slot
}

/** Every inline subBlock entry in order: the shared table, block entries, then trigger entries. */
function entrySlots(
  shared: EntryList,
  blocks: Record<string, CatalogBlockEntry>,
  triggers: Record<string, CatalogTriggerEntry>
): EntrySlot[] {
  const lists: EntryList[] = [
    shared,
    ...Object.values(blocks).map((block) => block.subBlocks),
    ...Object.values(triggers).map((trigger) => trigger.subBlocks),
  ]
  const slots: EntrySlot[] = []
  for (const list of lists) {
    list.forEach((entry, index) => {
      if (!('trigger' in entry) && !('shared' in entry)) slots.push(slotAt(list, index, entry))
    })
  }
  return slots
}

function internLists(slots: readonly EntrySlot[]): Scalar[][] {
  const counts = new Map<string, number>()
  for (const slot of slots) {
    slot.replace(ownConditions(slot.entry))
    forEachList(slot.entry, (list) => {
      const key = JSON.stringify(list)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    })
  }
  const lists: Scalar[][] = []
  const indexByKey = new Map<string, number>()
  for (const slot of slots) {
    forEachList(slot.entry, (list, replace) => {
      const key = JSON.stringify(list)
      if ((counts.get(key) ?? 0) < 2 || key.length < MIN_INTERNED_LIST_CHARS) return
      let index = indexByKey.get(key)
      if (index === undefined) {
        index = lists.length
        lists.push([...list])
        indexByKey.set(key, index)
      }
      replace({ list: index })
    })
  }
  return lists
}

function internSubBlocks(
  slots: readonly EntrySlot[],
  entryKeys: ReadonlyMap<CatalogSubBlockEntry, string>
): CatalogSubBlockEntry[] {
  const keys = slots.map((slot) => entryKeys.get(slot.entry) ?? stableStringify(slot.entry))
  const counts = new Map<string, number>()
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1)
  const shared: CatalogSubBlockEntry[] = []
  const indexByKey = new Map<string, number>()
  slots.forEach((slot, position) => {
    const key = keys[position]
    if ((counts.get(key) ?? 0) < 2 || key.length < MIN_SHARED_SUBBLOCK_CHARS) return
    let index = indexByKey.get(key)
    if (index === undefined) {
      index = shared.length
      shared.push(slot.entry)
      indexByKey.set(key, index)
    }
    slot.replace({ shared: index })
  })
  return shared
}

function compactTrigger(
  trigger: CatalogTrigger,
  entryKeys: Map<CatalogSubBlockEntry, string>
): CatalogTriggerEntry {
  const { outputs, ...rest } = trigger
  const subBlocks = trigger.subBlocks.map((source) => {
    const entry = stripLabels(source)
    entryKeys.set(
      entry,
      memoKey(triggerEntryKeys, source, () => stableStringify(entry))
    )
    return entry
  })
  return { ...rest, subBlocks }
}

/**
 * Interns output records (a block's or trigger's `outputs`, or a nested `properties`) that occur
 * more than once. A shared record is encoded before it is stored, so table entries reference
 * earlier entries and never themselves.
 */
class OutputInterner {
  readonly table: Array<Record<string, CatalogOutputEntry>> = []
  private readonly counts = new Map<string, number>()
  private readonly indexByKey = new Map<string, number>()

  count(record: Record<string, CatalogOutput>): void {
    const key = keyOf(record)
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1)
    for (const output of Object.values(record)) this.countOutput(output)
  }

  private countOutput(output: CatalogOutput): void {
    if (output.properties) this.count(output.properties)
    if (output.items) this.countOutput(output.items)
  }

  /** The shared index for `record`, or `null` to store it inline. */
  sharedIndex(record: Record<string, CatalogOutput>): number | null {
    const key = keyOf(record)
    if ((this.counts.get(key) ?? 0) < 2 || key.length < MIN_SHARED_OUTPUTS_CHARS) return null
    let index = this.indexByKey.get(key)
    if (index === undefined) {
      const encoded = this.encodeRecord(record)
      index = this.table.length
      this.table.push(encoded)
      this.indexByKey.set(key, index)
    }
    return index
  }

  encodeRecord(record: Record<string, CatalogOutput>): Record<string, CatalogOutputEntry> {
    const encoded: Record<string, CatalogOutputEntry> = {}
    for (const [name, output] of Object.entries(record)) {
      setOwn(encoded, name, this.encodeOutput(output))
    }
    return encoded
  }

  private encodeOutput(output: CatalogOutput): CatalogOutputEntry {
    const { properties, items, ...rest } = output
    const entry: CatalogOutputEntry = { ...rest }
    if (properties) {
      const shared = this.sharedIndex(properties)
      if (shared === null) entry.properties = this.encodeRecord(properties)
      else entry.sharedProperties = shared
    }
    if (items) entry.items = this.encodeOutput(items)
    return entry
  }
}

function outputsEntry(
  outputs: Record<string, CatalogOutput>,
  interner: OutputInterner
): { outputs: Record<string, CatalogOutputEntry> } | { sharedOutputs: number } {
  const shared = interner.sharedIndex(outputs)
  return shared === null ? { outputs: interner.encodeRecord(outputs) } : { sharedOutputs: shared }
}

/**
 * Encodes `expanded` as a core shard (see the module comment), without its `hash`: the caller
 * hashes these exact bytes.
 */
export function compactBlockCatalog(
  expanded: Omit<ExpandedBlockCatalog, 'hash'>
): Omit<BlockCatalog, 'hash'> {
  const { blocks, triggers, ...rest } = expanded
  const triggerKeys = new Map<string, string[]>()
  const starts = new Map<string, Array<{ trigger: string; start: number }>>()
  for (const [id, trigger] of Object.entries(triggers)) {
    const keys = trigger.subBlocks.map(triggerSurfaceKey)
    triggerKeys.set(id, keys)
    keys.forEach((key, start) => {
      const list = starts.get(key)
      if (list) list.push({ trigger: id, start })
      else starts.set(key, [{ trigger: id, start }])
    })
  }

  const entryKeys = new Map<CatalogSubBlockEntry, string>()
  const blockEntries: Record<string, CatalogBlockEntry> = {}
  for (const [type, block] of Object.entries(blocks)) {
    blockEntries[type] = compactBlock(block, starts, triggerKeys, entryKeys)
  }
  const triggerEntries: Record<string, CatalogTriggerEntry> = {}
  for (const [id, trigger] of Object.entries(triggers)) {
    triggerEntries[id] = compactTrigger(trigger, entryKeys)
  }

  const subBlocks = internSubBlocks(entrySlots([], blockEntries, triggerEntries), entryKeys)
  const lists = internLists(entrySlots(subBlocks, blockEntries, triggerEntries))

  const interner = new OutputInterner()
  for (const block of Object.values(blocks)) interner.count(block.outputs)
  for (const trigger of Object.values(triggers)) interner.count(trigger.outputs)
  for (const [type, block] of Object.entries(blocks)) {
    blockEntries[type] = { ...blockEntries[type], ...outputsEntry(block.outputs, interner) }
  }
  for (const [id, trigger] of Object.entries(triggers)) {
    triggerEntries[id] = { ...triggerEntries[id], ...outputsEntry(trigger.outputs, interner) }
  }

  const core: Omit<BlockCatalog, 'hash'> = {
    ...rest,
    blocks: blockEntries,
    triggers: triggerEntries,
  }
  if (subBlocks.length > 0) core.subBlocks = subBlocks
  if (lists.length > 0) core.lists = lists
  if (interner.table.length > 0) core.outputs = interner.table
  return core
}
