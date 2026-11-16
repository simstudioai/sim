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
 * - unknown `block.data` extra data source does not carry.
 *
 * Canonicalize's output already holds all of this, so restoring onto it changes nothing and the
 * no-op round trip stays byte-identical.
 */

import { SUBFLOW_DATA_KEYS } from '../canonicalize/subflows'
import { canonicalActivityInputs, isInactive } from '../catalog/activity'
import { type CanonicalGroup, isCanonicalPair } from '../catalog/canonical-index'
import { buildCanonicalIndexForSurface } from '../catalog/surface'
import type { BlockCatalog, CatalogBlock } from '../catalog/types'
import { catalogBlock } from '../catalog/view'
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
import { deepEqual, getOwn, setOwn } from '../records'

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

/** The value a pair sends: its one active member's, or none. */
function pairValue(
  block: CanonicalBlock,
  group: CanonicalGroup,
  inactive: (id: SubBlockId) => boolean
): CanonicalParam | undefined {
  for (const id of members(group)) {
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
  const index = buildCanonicalIndexForSurface(declared, next.triggerMode)
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
    const basicId = group.basicId
    const basic = declared.subBlocks.find((subBlock) => subBlock.id === basicId)
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

function sameParams(
  left: Record<SubBlockId, CanonicalParam>,
  right: Record<SubBlockId, CanonicalParam>
): boolean {
  return deepEqual(left, right)
}

function restoreInactive(
  next: CanonicalBlock,
  prev: CanonicalBlock,
  declared: CatalogBlock,
  catalog: BlockCatalog
): void {
  for (let pass = 0; pass < MAX_RESTORE_PASSES; pass += 1) {
    const before = { ...next.params }
    const inactive = inactiveSet(next, declared, catalog)
    const ids = new Set([...Object.keys(next.params), ...Object.keys(prev.params)])
    for (const id of ids) {
      if (inactive(id)) setParam(next.params, id, getOwn(prev.params, id))
    }
    if (sameParams(before, next.params)) return
  }
}

function setOrDelete<T extends object, K extends keyof T>(target: T, key: K, value: T[K]): void {
  if (value === undefined) delete target[key]
  else target[key] = value
}

/** Fields of a loop or parallel config that the executor reads for its type. */
function liveFields(spec: LoopSpec | ParallelSpec): Set<string> {
  return new Set(Object.keys(executableSubflow(spec)))
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
  if (target.subflow) next.subflow = restoreSubflow(target.subflow, prev.subflow)
  setOrDelete(next, 'extra', restoreExtra(target, prev))
  return next
}
