import { omit } from '@sim/utils/object'
import {
  type BlockData,
  type BlockState,
  isSubflowType,
  type SubBlockState,
} from '@sim/workflow-types/workflow'
import { implicitIds, unliftedBranchIds } from '../canonicalize/branches'
import { parseModeMap } from '../canonicalize/modes'
import { isExcludedSubBlockId, surfaceDeclaration } from '../canonicalize/params'
import { SUBFLOW_DATA_KEYS } from '../canonicalize/subflows'
import { mintsFreshValue } from '../catalog/defaults'
import { catalogBlock } from '../catalog/view'
import type { LockItem, LockLayout, WorkflowLockBlock } from '../lock'
import type { BlockKey, BranchKey, CanonicalBlock, SubBlockId } from '../model'
import { deepEqual, getOwn, parseStoredList, setOwn } from '../records'
import { structuredCodec } from '../structured'
import { writeBranches } from './branches'
import type { MaterializeContext } from './context'
import type { ResolvedBlock } from './identity'
import { writeBlockModes, writeToolModes } from './modes'
import { encodeParam, matchPrevTools } from './params'
import { writeSubflowData } from './subflows'

/** `block.data` keys the model or the layout owns on any block; everything else is `extra`. */
const MODEL_DATA_KEYS = new Set(['parentId', 'extent', 'width', 'height', 'canonicalModes'])

interface BlockInputs {
  key: BlockKey
  target: CanonicalBlock
  resolved: ResolvedBlock
  parentId: string | null
  /** The stored block this one continues, with its canonical form and stored ids. */
  prev?: {
    block: BlockState
    canonical: CanonicalBlock
    parentId: string | null
    branchIds: Record<BranchKey, string> | undefined
    items: Record<SubBlockId, LockItem[]> | undefined
  }
  /** The lock entry whose id this block carries (branch and item ids). */
  lockBlock: WorkflowLockBlock | undefined
  /** The lock layout recorded under this key; it positions only a new block. */
  layout: LockLayout | undefined
}

export interface BuiltBlock {
  block: BlockState
  /** Branch key → row id, for edge handles and the identity. */
  branchIds: Record<BranchKey, string> | undefined
  items: Record<SubBlockId, LockItem[]>
  needsLayout: boolean
}

function applyLayout(block: BlockState, layout: LockLayout): BlockState {
  const next: BlockState = { ...block, position: { x: layout.x, y: layout.y } }
  if (layout.height !== undefined) next.height = layout.height
  if (layout.horizontalHandles !== undefined) next.horizontalHandles = layout.horizontalHandles
  if (layout.w !== undefined || layout.h !== undefined) {
    const data: Record<string, unknown> = { ...block.data }
    if (layout.w !== undefined) data.width = layout.w
    if (layout.h !== undefined) data.height = layout.h
    next.data = data as BlockData
  }
  return next
}

/** Every pair is compared except the key and parent, which the caller compares by id. */
function sameBlock(left: CanonicalBlock, right: CanonicalBlock): boolean {
  return deepEqual(omit(left, ['key', 'parent']), omit(right, ['key', 'parent']))
}

function rawValues(subBlocks: Record<string, SubBlockState>): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const [id, subBlock] of Object.entries(subBlocks)) setOwn(values, id, subBlock?.value)
  return values
}

/**
 * One block of the materialized graph. A block canonical-equal to the
 * prev block it continues, under the same parent id, is prev's stored object unchanged. Otherwise
 * it starts from prev (or `hooks.initBlock` for a new block), keeps every server-owned field
 * prev had (runtime trigger subBlocks, stored outputs, subBlock type metadata), and writes
 * only what changed. Stored outputs are recomputed only when something they derive from changed.
 */
export function buildBlock(inputs: BlockInputs, context: MaterializeContext): BuiltBlock {
  const { key, target, resolved, prev } = inputs
  const id = resolved.id

  if (
    prev &&
    resolved.entry.status === 'matched' &&
    resolved.entry.retypedFrom === undefined &&
    inputs.parentId === prev.parentId &&
    sameBlock(target, prev.canonical)
  ) {
    return {
      block: prev.block,
      branchIds: prev.branchIds,
      items: prev.items ?? {},
      needsLayout: false,
    }
  }

  const before = prev?.canonical
  const base =
    prev?.block ??
    context.hooks.initBlock({
      id,
      type: target.type,
      name: target.name,
      triggerMode: target.triggerMode,
    })
  const isNew = !prev
  let block: BlockState = { ...base, id, name: target.name }
  const data: Record<string, unknown> = { ...base.data }
  const subBlocks: Record<string, SubBlockState> = { ...base.subBlocks }
  let outputsDirty = isNew

  if (block.type !== target.type) {
    block.type = target.type
    outputsDirty = true
  }
  if (!before || before.enabled !== target.enabled) block.enabled = target.enabled
  if (!before || before.locked !== target.locked) block.locked = target.locked
  if (!before || before.triggerMode !== target.triggerMode) {
    block.triggerMode = target.triggerMode
    outputsDirty = true
  }
  if (!before || before.advancedMode !== target.advancedMode) {
    block.advancedMode = target.advancedMode
    outputsDirty = true
  }
  if (!before || !deepEqual(before.retry, target.retry)) {
    block =
      target.retry === null ? omit(block, ['retry']) : { ...block, retry: { ...target.retry } }
  }

  const catalog = catalogBlock(context.catalog, target.type)
  const branchSpec = catalog?.graph.branches
  const branchSubBlockId = branchSpec?.subBlockId
  const itemSources = (subBlockId: SubBlockId): LockItem[] => [
    ...((inputs.lockBlock?.items && getOwn(inputs.lockBlock.items, subBlockId)) ?? []),
    ...((prev?.items && getOwn(prev.items, subBlockId)) ?? []),
  ]

  const paramIds = new Set([...Object.keys(target.params), ...Object.keys(before?.params ?? {})])
  for (const paramId of paramIds) {
    const next = getOwn(target.params, paramId)
    const previous = before ? getOwn(before.params, paramId) : undefined
    if (next && previous && deepEqual(next, previous)) continue
    outputsDirty = true
    const existing = getOwn(subBlocks, paramId)
    if (!next) {
      if (existing) setOwn(subBlocks, paramId, { ...existing, value: null })
      continue
    }
    const declaration = surfaceDeclaration(catalog, paramId, target.triggerMode)
    const value = encodeParam(
      next,
      {
        blockKey: key,
        param: paramId,
        declaration,
        prevRaw: existing?.value,
        prevParam: previous,
        itemIds: itemSources(paramId),
        forceText: paramId === branchSubBlockId,
      },
      context
    )
    setOwn(subBlocks, paramId, {
      ...(existing ?? { id: paramId, type: declaration?.type ?? 'short-input' }),
      value: value as SubBlockState['value'],
    })
  }
  if (isNew) {
    for (const [subBlockId, subBlock] of Object.entries(subBlocks)) {
      if (
        Object.hasOwn(target.params, subBlockId) ||
        subBlockId === branchSubBlockId ||
        isExcludedSubBlockId(subBlockId) ||
        subBlock?.value === null ||
        subBlock?.value === undefined
      ) {
        continue
      }
      const declaration = surfaceDeclaration(catalog, subBlockId, target.triggerMode)
      if (declaration && mintsFreshValue(declaration)) continue
      setOwn(subBlocks, subBlockId, { ...subBlock, value: null })
    }
  }

  let branchIds: Record<BranchKey, string> | undefined
  if (branchSpec && target.branches) {
    const subBlockId = branchSpec.subBlockId
    if (Object.hasOwn(target.params, subBlockId)) {
      branchIds = unliftedBranchIds(branchSpec.kind, id, getOwn(subBlocks, subBlockId)?.value)
    } else if (before?.branches && deepEqual(before.branches, target.branches)) {
      branchIds = prev?.branchIds
    } else {
      outputsDirty = true
      const write = writeBranches(
        target.branches,
        id,
        [resolved.lockOwned ? inputs.lockBlock?.branches : undefined, prev?.branchIds],
        before?.branches?.rows,
        context
      )
      const existing = getOwn(subBlocks, subBlockId)
      if (write.value !== null) {
        setOwn(subBlocks, subBlockId, {
          ...(existing ?? {
            id: subBlockId,
            type:
              surfaceDeclaration(catalog, subBlockId, target.triggerMode)?.type ?? 'short-input',
          }),
          value: write.value,
        })
      } else if (existing && existing.value !== null && existing.value !== undefined) {
        setOwn(subBlocks, subBlockId, { ...existing, value: null })
      }
      branchIds = target.branches.rows === null ? implicitIds(branchSpec.kind, id) : write.ids
    }
  }

  const nextExtra = target.extra ?? {}
  if (catalog && !Object.hasOwn(nextExtra, 'canonicalModes')) {
    const original = parseModeMap(data.canonicalModes)
    let modes = writeBlockModes(
      original ?? {},
      target.modes,
      catalog,
      rawValues(subBlocks),
      target.triggerMode,
      target.advancedMode
    )
    for (const [paramId, param] of Object.entries(target.params)) {
      if (param.kind !== 'tools') continue
      const previous = before ? getOwn(before.params, paramId) : undefined
      if (previous && deepEqual(param, previous)) continue
      modes = writeToolModes(
        modes,
        param.tools,
        parseStoredList(getOwn(subBlocks, paramId)?.value) ?? [],
        matchPrevTools(param.tools, previous?.kind === 'tools' ? previous.tools : []),
        context.catalog
      )
    }
    if (!deepEqual(modes, original ?? {})) {
      data.canonicalModes = modes
      outputsDirty = true
    }
  }

  if (target.subflow && (!before || !deepEqual(before.subflow, target.subflow))) {
    writeSubflowData(data, target.subflow, new Set(Object.keys(nextExtra)), before?.subflow)
  }

  const prevExtra = before?.extra ?? {}
  if (isNew || !deepEqual(prevExtra, nextExtra)) {
    for (const dataKey of Object.keys(prevExtra)) {
      if (!Object.hasOwn(nextExtra, dataKey)) delete data[dataKey]
    }
    for (const [dataKey, value] of Object.entries(nextExtra)) {
      if (!deepEqual(getOwn(data, dataKey), value)) setOwn(data, dataKey, value)
    }
  }
  if (isNew) {
    const isContainer = isSubflowType(target.type)
    for (const dataKey of Object.keys(data)) {
      const owned = MODEL_DATA_KEYS.has(dataKey) || (isContainer && SUBFLOW_DATA_KEYS.has(dataKey))
      if (!owned && !Object.hasOwn(nextExtra, dataKey)) delete data[dataKey]
    }
  }

  const reparented = isNew || inputs.parentId !== prev?.parentId
  if (reparented) {
    if (inputs.parentId !== null) {
      data.parentId = inputs.parentId
      data.extent = 'parent'
    } else {
      const dropped = ['parentId', 'extent'].filter(
        (dataKey) =>
          !Object.hasOwn(nextExtra, dataKey) &&
          (dataKey === 'parentId' || data[dataKey] === 'parent')
      )
      for (const dataKey of dropped) delete data[dataKey]
    }
  }

  if (base.data !== undefined || Object.keys(data).length > 0) {
    block.data = deepEqual(base.data, data) ? base.data : (data as BlockData)
  }
  block.subBlocks = subBlocks
  // Stored outputs are server-owned and derived. They are rewritten only when the derivation
  // itself changes: a block whose stored outputs predate the registry (or were seeded empty)
  // keeps them through an edit its outputs do not derive from, as it does on the canvas.
  if (outputsDirty) {
    const outputs = context.hooks.computeOutputs(block)
    if (!prev || !deepEqual(outputs, context.hooks.computeOutputs(prev.block))) {
      block.outputs = outputs
    }
  }

  let built = block
  let needsLayout = false
  if (isNew && inputs.layout) built = applyLayout(block, inputs.layout)
  else if (reparented) {
    // A child's position is relative to its container, so a move into or out of one keeps a
    // position from the wrong frame: send it to autolayout, as the server does an unplaced block.
    if (!isNew) built = { ...block, position: { x: 0, y: 0 } }
    needsLayout = true
  }

  const items: Record<SubBlockId, LockItem[]> = {}
  for (const [paramId, param] of Object.entries(target.params)) {
    if (param.kind !== 'value') continue
    const declaration = surfaceDeclaration(catalog, paramId, target.triggerMode)
    const found = structuredCodec(declaration)?.lockItems(getOwn(subBlocks, paramId)?.value) ?? []
    if (found.length > 0) setOwn(items, paramId, found)
  }
  return { block: built, branchIds, items, needsLayout }
}
