import type { BlockState, Loop, Parallel } from '@sim/workflow-types/workflow'
import { isJsonObject, type Json, type LoopSpec, type ParallelSpec } from '../model'
import { setOrDelete } from '../records'

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
 * Writes a changed subflow config into `block.data`. A field the spec
 * omits is removed, so storage omits it again. Keys listed in `skip` hold a
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

/** What a container's map entry is built from, besides its config and prev's entry. */
interface SubflowEntryContext {
  id: string
  block: BlockState
  /** Ids of the blocks whose `data.parentId` is this container, in block order. */
  nodes: string[]
  /** Whether the config differs from prev's (always for new). */
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
 * The executor types a loop's collection and a parallel's distribution as an array, an object or
 * text. A JSON scalar fits none of them (the API contract refuses one), so it is left out, as an
 * absent collection is; the executor reads the collection from `block.data`, which keeps it.
 */
function storedCollection(value: Json | undefined): Loop['forEachItems'] {
  if (typeof value === 'string' || Array.isArray(value) || isJsonObject(value)) return value
  return undefined
}

/**
 * Whether prev's entry stands: `{ entry }` (prev's, or none for a continuing container that had
 * none) when its config, membership and flags are unchanged, else `null` to build one.
 */
function standingEntry<E extends Loop | Parallel>(
  context: SubflowEntryContext,
  prevEntry: E | undefined,
  membersChanged: boolean
): { entry: E | undefined } | null {
  const changed =
    context.specChanged || context.enabledChanged || context.lockedChanged || membersChanged
  if (prevEntry && !changed) return { entry: prevEntry }
  if (!prevEntry && context.matched && !changed) return { entry: undefined }
  return null
}

/**
 * A loop's `loops` map entry (`generateLoopBlocks`), consistent with `block.data`. Prev's entry is
 * returned untouched when its config, membership and flags are unchanged. A continuing container
 * that had no entry gets one only when something changed, so a no-op write adds nothing.
 */
export function loopEntry(
  context: SubflowEntryContext,
  spec: LoopSpec,
  prevEntry: Loop | undefined
): Loop | undefined {
  const membersChanged = !sameMembers(prevEntry?.nodes ?? context.prevNodes, context.nodes)
  const standing = standingEntry(context, prevEntry, membersChanged)
  if (standing) return standing.entry
  const { block } = context
  const enabled = block.enabled !== false
  const entry: Loop = prevEntry
    ? { ...prevEntry }
    : {
        id: context.id,
        nodes: context.nodes,
        iterations: spec.iterations,
        loopType: spec.loopType,
        enabled,
      }
  if (membersChanged) entry.nodes = context.nodes
  if (!prevEntry || context.enabledChanged) entry.enabled = enabled
  if (!prevEntry || context.specChanged) {
    entry.iterations = spec.iterations
    entry.loopType = spec.loopType
    setOrDelete(entry, 'forEachItems', storedCollection(spec.forEachItems))
    setOrDelete(entry, 'whileCondition', spec.whileCondition)
    setOrDelete(entry, 'doWhileCondition', spec.doWhileCondition)
  }
  if (context.lockedChanged) setOrDelete(entry, 'locked', block.locked === true ? true : undefined)
  return entry
}

/** A parallel's `parallels` map entry, by the same rules as {@link loopEntry}. */
export function parallelEntry(
  context: SubflowEntryContext,
  spec: ParallelSpec,
  prevEntry: Parallel | undefined
): Parallel | undefined {
  const membersChanged = !sameMembers(prevEntry?.nodes ?? context.prevNodes, context.nodes)
  const standing = standingEntry(context, prevEntry, membersChanged)
  if (standing) return standing.entry
  const { block } = context
  const enabled = block.enabled !== false
  const entry: Parallel = prevEntry
    ? { ...prevEntry }
    : { id: context.id, nodes: context.nodes, enabled }
  if (membersChanged) entry.nodes = context.nodes
  if (!prevEntry || context.enabledChanged) entry.enabled = enabled
  if (!prevEntry || context.specChanged) {
    setOrDelete(entry, 'parallelType', spec.parallelType)
    setOrDelete(entry, 'count', spec.count)
    setOrDelete(entry, 'distribution', storedCollection(spec.distribution))
    setOrDelete(entry, 'batchSize', spec.batchSize)
  }
  if (context.lockedChanged) setOrDelete(entry, 'locked', block.locked === true ? true : undefined)
  return entry
}
