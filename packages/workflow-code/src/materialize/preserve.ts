/**
 * Preserved UI state: source holds what executes, and everything
 * else a stored block carries is taken from the block it continues. For a target block compiled
 * from source and the prev block it matched, this restores:
 * - the pair member and mode, when the pair's executable value is unchanged; a changed plain id
 *   keeps prev's selector member when prev showed it, since whether a selector or a hand-typed
 *   value produced the id is UI state;
 * - every value that is inactive under the target's values, including stored-absent ones and the
 *   editor defaults compile filled into fields that never run;
 * - the config fields of the loop or parallel types not in effect, and prev's spelling of a config
 *   that runs the same (`count: 0` and `count: 5`);
 * - unknown `block.data` extra data source does not carry;
 * - a container's subBlocks `block.data` supersedes (`SUPERSEDED_CONTAINER_PARAMS`).
 *
 * Canonicalize's output already holds all of this, so restoring onto it changes nothing and the
 * no-op round trip stays byte-identical.
 */

import { SUBFLOW_DATA_KEYS, SUPERSEDED_CONTAINER_PARAMS } from '../canonicalize/subflows'
import { canonicalActivityInputs, isInactive, withStoredValue } from '../catalog/activity'
import { type CanonicalGroup, isCanonicalPair } from '../catalog/canonical-index'
import { serializedCanonicalIndex } from '../catalog/surface'
import type { BlockCatalog, CatalogBlock } from '../catalog/types'
import { catalogBlock, declarationsOf } from '../catalog/view'
import { executableSubflow } from '../equivalence/executable'
import type {
  CanonicalBlock,
  CanonicalParam,
  Json,
  LoopSpec,
  ParallelSpec,
  ParamMode,
  SubBlockId,
} from '../model'
import { deepEqual, getOwn, setOrDelete, setOwn } from '../records'

/** Inactive restoration can flip another field's visibility; it settles within a few passes. */
const MAX_RESTORE_PASSES = 4

function inactiveSet(block: CanonicalBlock, declared: CatalogBlock, catalog: BlockCatalog) {
  const inputs = canonicalActivityInputs(block, declared, catalog)
  return (id: SubBlockId) => isInactive(id, inputs)
}

function setParam(
  params: Record<SubBlockId, CanonicalParam>,
  id: SubBlockId,
  param: CanonicalParam | undefined
) {
  if (param === undefined) delete params[id]
  else setOwn(params, id, param)
}

function members(group: CanonicalGroup): SubBlockId[] {
  return [group.basicId, ...group.advancedIds].filter((id): id is string => id !== undefined)
}

/**
 * The value a pair sends: its one active member's under the block's mode, or none. The mode
 * decides it even where every member is active: deploy reads both members of a trigger-mode pair,
 * but the pair runs (and source writes) the member its mode selects, so the other one is
 * preserved state.
 */
function pairValue(
  block: CanonicalBlock,
  group: CanonicalGroup,
  inactive: (id: SubBlockId) => boolean
): CanonicalParam | undefined {
  const mode = getOwn(block.modes, group.canonicalId)
  for (const id of members(group)) {
    if (mode !== undefined && (mode === 'advanced') !== group.advancedIds.includes(id)) continue
    const param = getOwn(block.params, id)
    if (param && !inactive(id)) return param
  }
  return undefined
}

/** A plain id string: what a selector stores, with no reference or env token in it. */
function isPlainId(param: CanonicalParam | undefined): param is { kind: 'value'; value: string } {
  return (
    param?.kind === 'value' &&
    typeof param.value === 'string' &&
    param.value.length > 0 &&
    !/[<>{}]/.test(param.value)
  )
}

function restorePairs(
  next: CanonicalBlock,
  prev: CanonicalBlock,
  declared: CatalogBlock,
  catalog: BlockCatalog
): void {
  const index = serializedCanonicalIndex(declared, next.triggerMode)
  const nextInactive = inactiveSet(next, declared, catalog)
  const prevInactive = inactiveSet(prev, declared, catalog)
  for (const group of Object.values(index.groupsById)) {
    if (!isCanonicalPair(group)) continue
    const cid = group.canonicalId
    const value = pairValue(next, group, nextInactive)
    const prevMode: ParamMode | undefined = getOwn(prev.modes, cid)
    if (deepEqual(value, pairValue(prev, group, prevInactive))) {
      for (const id of members(group)) setParam(next.params, id, getOwn(prev.params, id))
      if (prevMode === undefined) delete next.modes[cid]
      else setOwn(next.modes, cid, prevMode)
      continue
    }
    // The canvas edits one member at a time: a member the mode does not select keeps its stored
    // value. Off the trigger surface that member is inactive and `restoreInactive` restores it;
    // deploy reads every member of a trigger-mode pair, so it is restored here.
    const mode: ParamMode | undefined = getOwn(next.modes, cid)
    for (const id of members(group)) {
      if (mode === undefined || (mode === 'advanced') === group.advancedIds.includes(id)) continue
      if (getOwn(next.params, id) === undefined) setParam(next.params, id, getOwn(prev.params, id))
    }
    const basicId = group.basicId
    const basic = basicId === undefined ? undefined : declarationsOf(declared, basicId)[0]
    if (
      basicId !== undefined &&
      prevMode === 'basic' &&
      getOwn(next.modes, cid) === 'advanced' &&
      basic?.valueKind === 'picked' &&
      isPlainId(value)
    ) {
      for (const id of group.advancedIds) setParam(next.params, id, getOwn(prev.params, id))
      setOwn(next.params, basicId, value)
      setOwn(next.modes, cid, 'basic')
    }
  }
}

/**
 * Restores prev's value into each param inactive under the target's values. A value goes back
 * only while its field stays inactive with it: a field whose activity hangs on its own value (a
 * standalone advanced field runs only while non-empty) is inactive only because source emptied
 * it, and restoring prev's value would run what source cleared. A restore can change another
 * field's activity, so passes repeat until nothing changes.
 */
function restoreInactive(
  next: CanonicalBlock,
  prev: CanonicalBlock,
  declared: CatalogBlock,
  catalog: BlockCatalog
): void {
  for (let pass = 0; pass < MAX_RESTORE_PASSES; pass += 1) {
    const before = { ...next.params }
    const passInputs = canonicalActivityInputs(next, declared, catalog)
    /** `passInputs` with this pass's restores applied, as `next.params` now holds them. */
    let current = passInputs
    const ids = new Set([...Object.keys(next.params), ...Object.keys(prev.params)])
    for (const id of ids) {
      if (!isInactive(id, passInputs)) continue
      const restored = getOwn(prev.params, id)
      if (deepEqual(getOwn(next.params, id), restored)) continue
      const value = restored?.kind === 'tools' ? restored.tools : restored?.value
      const withPrev = withStoredValue(catalog, current, id, value)
      if (isInactive(id, withPrev)) {
        setParam(next.params, id, restored)
        current = withPrev
      }
    }
    if (deepEqual(before, next.params)) return
  }
}

/** Fields of a loop or parallel config that the executor reads for its type. */
function liveFields(spec: LoopSpec | ParallelSpec): Set<string> {
  return new Set(Object.keys(executableSubflow(spec).config))
}

function restoreLoop(target: LoopSpec, prev: LoopSpec, live: Set<string>): LoopSpec {
  const merged: LoopSpec = { ...target }
  if (!live.has('iterations')) merged.iterations = prev.iterations
  if (!live.has('forEachItems')) {
    setOrDelete(merged, 'forEachItems', prev.forEachItems)
  }
  if (!live.has('whileCondition')) {
    setOrDelete(merged, 'whileCondition', prev.whileCondition)
  }
  if (!live.has('doWhileCondition')) {
    setOrDelete(merged, 'doWhileCondition', prev.doWhileCondition)
  }
  return merged
}

function restoreParallel(
  target: ParallelSpec,
  prev: ParallelSpec,
  live: Set<string>
): ParallelSpec {
  const merged: ParallelSpec = { ...target }
  if (!live.has('count')) {
    setOrDelete(merged, 'count', prev.count)
  }
  if (!live.has('distribution')) {
    setOrDelete(merged, 'distribution', prev.distribution)
  }
  return merged
}

function restoreSubflow(
  target: LoopSpec | ParallelSpec,
  prev: LoopSpec | ParallelSpec | undefined
): LoopSpec | ParallelSpec {
  if (!prev) return target
  if (deepEqual(executableSubflow(target), executableSubflow(prev))) return prev
  const live = liveFields(target)
  if (target.kind === 'loop' && prev.kind === 'loop') return restoreLoop(target, prev, live)
  if (target.kind === 'parallel' && prev.kind === 'parallel') {
    return restoreParallel(target, prev, live)
  }
  return target
}

/**
 * Unknown `block.data` source leaves out comes from prev. A container's subflow keys are the
 * only ones source carries (`meta.subflowData`), so the target's copy of those wins.
 */
function restoreExtra(target: CanonicalBlock, prev: CanonicalBlock): CanonicalBlock['extra'] {
  const data: Record<string, Json> = {}
  for (const [key, value] of Object.entries(prev.extra ?? {})) {
    const printed = target.subflow !== undefined && SUBFLOW_DATA_KEYS.has(key)
    if (!printed) setOwn(data, key, value)
  }
  for (const [key, value] of Object.entries(target.extra ?? {})) setOwn(data, key, value)
  return Object.keys(data).length > 0 ? data : undefined
}

/**
 * `target` with the preserved UI state of `prev`, the stored block it continues (see the module
 * comment). Blocks of different types share nothing to restore.
 */
export function restorePreserved(
  target: CanonicalBlock,
  prev: CanonicalBlock,
  catalog: BlockCatalog
): CanonicalBlock {
  if (target.type !== prev.type) return target
  const next: CanonicalBlock = {
    ...target,
    params: { ...target.params },
    modes: { ...target.modes },
  }
  const declared = target.subflow ? undefined : catalogBlock(catalog, target.type)
  if (declared) {
    restorePairs(next, prev, declared, catalog)
    restoreInactive(next, prev, declared, catalog)
  }
  if (target.subflow) {
    next.subflow = restoreSubflow(target.subflow, prev.subflow)
    for (const id of SUPERSEDED_CONTAINER_PARAMS) setParam(next.params, id, getOwn(prev.params, id))
  }
  setOrDelete(next, 'extra', restoreExtra(target, prev))
  return next
}
