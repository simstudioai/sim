import type { BlockState, Loop, Parallel } from '@sim/workflow-types/workflow'
import type { Json, LoopSpec, ParallelSpec } from '../model'

/** `block.data` keys each subflow kind owns, and the model field each one holds. */
function dataFields(spec: LoopSpec | ParallelSpec): Record<string, Json | undefined> {
  if (spec.kind === 'loop') {
    return {
      loopType: spec.loopType,
      count: spec.iterations,
      collection: spec.forEachItems,
      whileCondition: spec.whileCondition,
      doWhileCondition: spec.doWhileCondition,
    }
  }
  return {
    parallelType: spec.parallelType,
    count: spec.count,
    collection: spec.distribution,
    batchSize: spec.batchSize,
  }
}

/**
 * Writes a changed subflow config into `block.data` (s1 materialize step 6). A field the spec
 * omits is removed, so storage omits it again (contract amendment 9). Keys listed in `skip` hold a
 * value canonicalize could not read as config and kept under `extra`; that copy wins.
 */
export function writeSubflowData(
  data: Record<string, unknown>,
  spec: LoopSpec | ParallelSpec,
  skip: ReadonlySet<string>
): void {
  for (const [key, value] of Object.entries(dataFields(spec))) {
    if (skip.has(key)) continue
    if (value === undefined) delete data[key]
    else data[key] = value
  }
}

function setOrDelete<T extends object, K extends keyof T>(target: T, key: K, value: T[K]): void {
  if (value === undefined) delete target[key]
  else target[key] = value
}

export interface SubflowEntryInputs {
  id: string
  block: BlockState
  spec: LoopSpec | ParallelSpec
  /** Ids of the blocks whose `data.parentId` is this container, in block order. */
  nodes: string[]
  prevEntry: Loop | Parallel | undefined
  /** Whether the config, enabled flag or locked flag differs from prev's (always for new). */
  specChanged: boolean
  enabledChanged: boolean
  lockedChanged: boolean
  /** True for a container that continues a prev one. */
  matched: boolean
  prevNodes: string[]
}

function sameMembers(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  const members = new Set(left)
  return right.every((id) => members.has(id))
}

/**
 * The loops/parallels map entry for a container (s1 materialize step 6, `generateLoopBlocks`),
 * consistent with `block.data`. Prev's entry is returned untouched when its config, membership and
 * flags are unchanged. A continuing container that had no entry gets one only when something
 * changed, so a no-op write adds nothing.
 */
export function subflowEntry(inputs: SubflowEntryInputs): Loop | Parallel | undefined {
  const { block, spec, prevEntry } = inputs
  const membersChanged = !sameMembers(prevEntry?.nodes ?? inputs.prevNodes, inputs.nodes)
  const changed =
    inputs.specChanged || inputs.enabledChanged || inputs.lockedChanged || membersChanged
  if (prevEntry && !changed) return prevEntry
  if (!prevEntry && inputs.matched && !changed) return undefined

  const enabled = block.enabled !== false
  if (spec.kind === 'loop') {
    const entry: Loop = prevEntry
      ? { ...(prevEntry as Loop) }
      : {
          id: inputs.id,
          nodes: inputs.nodes,
          iterations: spec.iterations,
          loopType: spec.loopType,
          enabled,
        }
    if (membersChanged) entry.nodes = inputs.nodes
    if (!prevEntry || inputs.enabledChanged) entry.enabled = enabled
    if (!prevEntry || inputs.specChanged) {
      entry.iterations = spec.iterations
      entry.loopType = spec.loopType
      setOrDelete(entry, 'forEachItems', spec.forEachItems as Loop['forEachItems'])
      setOrDelete(entry, 'whileCondition', spec.whileCondition)
      setOrDelete(entry, 'doWhileCondition', spec.doWhileCondition)
    }
    if (inputs.lockedChanged) setOrDelete(entry, 'locked', block.locked === true ? true : undefined)
    return entry
  }
  const entry: Parallel = prevEntry
    ? { ...(prevEntry as Parallel) }
    : { id: inputs.id, nodes: inputs.nodes, enabled }
  if (membersChanged) entry.nodes = inputs.nodes
  if (!prevEntry || inputs.enabledChanged) entry.enabled = enabled
  if (!prevEntry || inputs.specChanged) {
    setOrDelete(entry, 'parallelType', spec.parallelType)
    setOrDelete(entry, 'count', spec.count)
    setOrDelete(entry, 'distribution', spec.distribution as Parallel['distribution'])
    setOrDelete(entry, 'batchSize', spec.batchSize)
  }
  if (inputs.lockedChanged) setOrDelete(entry, 'locked', block.locked === true ? true : undefined)
  return entry
}
