import type { BlockState, Loop, Parallel } from '@sim/workflow-types/workflow'
import { diagnostic } from '../diagnostics/factory'
import {
  type BlockKey,
  isLoopType,
  isParallelType,
  type Json,
  type LoopSpec,
  type ParallelSpec,
} from '../model'
import type { CanonContext } from './context'
import { toValue } from './values'

const PARALLEL_BATCH_MIN = 1
export const PARALLEL_BATCH_MAX = 20
/** `count || 5` in `convertLoopBlockToLoop` and the loop orchestrator. */
export const DEFAULT_LOOP_ITERATIONS = 5
/** `data.count || 5` in `convertParallelBlockToParallel`. */
export const DEFAULT_PARALLEL_COUNT = 5

/** `clampParallelBatchSize`: a missing or non-numeric size is 20, anything else 1–20. */
export function effectiveBatchSize(batchSize: number | undefined): number {
  if (batchSize === undefined || Number.isNaN(batchSize)) return PARALLEL_BATCH_MAX
  return Math.max(PARALLEL_BATCH_MIN, Math.min(PARALLEL_BATCH_MAX, Math.trunc(batchSize)))
}

/** `block.data` keys a container's subflow config owns. */
export const SUBFLOW_DATA_KEYS: ReadonlySet<string> = new Set([
  'count',
  'collection',
  'loopType',
  'whileCondition',
  'doWhileCondition',
  'parallelType',
  'batchSize',
])

/**
 * Container subBlocks `block.data` supersedes: the config inputs the editing engine copies into
 * `data` (`iterations` → `count`, `condition` → `whileCondition`) and may also leave stored as
 * subBlocks. The serializer reads a container's config from `data` only, so these never run:
 * preserved state, which print leaves out and apply restores from the stored block.
 */
export const SUPERSEDED_CONTAINER_PARAMS: ReadonlySet<string> = new Set([
  ...SUBFLOW_DATA_KEYS,
  'iterations',
  'condition',
])

/** A subflow config with the `block.data` keys whose stored value it could not represent. */
interface SubflowResult<S> {
  spec: S
  /** Kept verbatim under `extra` so nothing is lost. */
  rejectedDataKeys: string[]
}

function firstDefined(...candidates: unknown[]): unknown {
  return candidates.find((candidate) => candidate !== undefined)
}

function rejectIfFromData(
  rejected: string[],
  data: Record<string, unknown>,
  dataKey: string
): void {
  if (data[dataKey] !== undefined) rejected.push(dataKey)
}

function stringField(value: unknown, context: CanonContext): string | undefined {
  return typeof value === 'string' ? (toValue(value, context) as string) : undefined
}

/**
 * Json fields of a subflow (collection / distribution) keep references rewritten in strings. An
 * object carrying its own `$sim` key is wrapped as a `literal` node, as everywhere in the model;
 * the wrapper is itself JSON, and materialize writes the object back unwrapped.
 */
function jsonField(value: unknown, context: CanonContext): Json | undefined {
  if (value === undefined) return undefined
  return toValue(value, context) as Json
}

function repaired(context: CanonContext, blockKey: BlockKey, message: string) {
  context.diagnostics.push(diagnostic('W_CANON_SUBFLOW_REPAIRED', message, { blockKey }))
}

/**
 * A loop's config. `block.data` is read first: the serializer
 * rebuilds loops from it (`generateLoopBlocks`, workflow-persistence subflow-helpers.ts) and the loader syncs the
 * subflow row's collection and conditions into it (`loadWorkflowFromNormalizedTablesRaw`), so it is what executes. The
 * loops map fills those fields when `data` omits them, but never the count: the loader does not
 * sync it, so a count only the map holds never runs, and the spec holds the 5 that does. Stored
 * values are otherwise kept raw, including a `0` count the runtime replaces with 5 (`count || 5`),
 * which is reported instead of repaired. Optional fields storage omits stay absent.
 */
export function loopSpec(
  block: BlockState,
  loop: Loop | undefined,
  blockKey: BlockKey,
  context: CanonContext
): SubflowResult<LoopSpec> {
  const data: Record<string, unknown> = { ...block.data }
  // `loopType` and `iterations` are required. The type falls back to `for` only for a state with
  // no loops map (the loader always writes one); the count falls back to the 5 that runs whenever
  // `data.count` is absent.
  const spec: LoopSpec = { kind: 'loop', loopType: 'for', iterations: DEFAULT_LOOP_ITERATIONS }
  const rejected: string[] = []

  const loopType = firstDefined(data.loopType, loop?.loopType)
  if (isLoopType(loopType)) {
    spec.loopType = loopType
  } else if (loopType !== undefined) {
    // The serializer runs `data.loopType || 'for'` and never reads the map's type, so a falsy
    // stored type runs `for` and any other unknown one fails in the loop orchestrator.
    rejectIfFromData(rejected, data, 'loopType')
    const outcome = data.loopType
      ? 'the runtime fails with "Unknown loop type"'
      : 'the runtime runs "for"'
    repaired(context, blockKey, `Unknown loop type "${String(loopType)}"; ${outcome}`)
  }

  // The count that runs is `block.data.count || 5` (`convertLoopBlockToLoop`): the serializer
  // rebuilds loops from the blocks and every write recomputes the loops map from them, so a map
  // count with no `data.count` never runs. The loader repairs a non-numeric `data.count` from the
  // map (`loadWorkflowFromNormalizedTablesRaw`), the only time the map's count is read.
  if (typeof data.count === 'number') {
    spec.iterations = data.count
    if (data.count === 0) {
      repaired(
        context,
        blockKey,
        `Loop count is 0; the runtime runs ${DEFAULT_LOOP_ITERATIONS} iterations`
      )
    }
  } else if (data.count !== undefined) {
    rejected.push('count')
    if (typeof loop?.iterations === 'number') spec.iterations = loop.iterations
    repaired(context, blockKey, 'Loop count is not a number; the loader repairs it')
  }

  const forEachItems = jsonField(firstDefined(data.collection, loop?.forEachItems), context)
  if (forEachItems !== undefined) spec.forEachItems = forEachItems
  const whileCondition = stringField(
    firstDefined(data.whileCondition, loop?.whileCondition),
    context
  )
  if (whileCondition !== undefined) spec.whileCondition = whileCondition
  const doWhileCondition = stringField(
    firstDefined(data.doWhileCondition, loop?.doWhileCondition),
    context
  )
  if (doWhileCondition !== undefined) spec.doWhileCondition = doWhileCondition
  for (const key of ['whileCondition', 'doWhileCondition']) {
    if (data[key] !== undefined && typeof data[key] !== 'string') rejected.push(key)
  }
  return { spec, rejectedDataKeys: rejected }
}

/**
 * A parallel's config, `block.data` first for the same reason as loops. An unknown
 * `parallelType` is reported: the loader reads it as `count` while the serializer's helper reads
 * it as `collection` (the loader vs `convertParallelBlockToParallel`). `batchSize` is kept raw and
 * reported outside the 1–20 clamp.
 */
export function parallelSpec(
  block: BlockState,
  parallel: Parallel | undefined,
  blockKey: BlockKey,
  context: CanonContext
): SubflowResult<ParallelSpec> {
  const data: Record<string, unknown> = { ...block.data }
  const spec: ParallelSpec = { kind: 'parallel' }
  const rejected: string[] = []

  const parallelType = firstDefined(data.parallelType, parallel?.parallelType)
  if (isParallelType(parallelType)) {
    spec.parallelType = parallelType
  } else if (parallelType !== undefined) {
    rejectIfFromData(rejected, data, 'parallelType')
    repaired(
      context,
      blockKey,
      `Unknown parallel type "${String(parallelType)}"; the loader and the serializer disagree on its fallback`
    )
  }

  const count = firstDefined(data.count, parallel?.count)
  if (typeof count === 'number') {
    spec.count = count
    if (count === 0)
      repaired(context, blockKey, `Parallel count is 0; the runtime runs ${DEFAULT_PARALLEL_COUNT}`)
  } else if (count !== undefined) {
    rejectIfFromData(rejected, data, 'count')
    repaired(
      context,
      blockKey,
      `Parallel count is not a number; the runtime runs ${DEFAULT_PARALLEL_COUNT}`
    )
  }

  const distribution = jsonField(firstDefined(data.collection, parallel?.distribution), context)
  if (distribution !== undefined) spec.distribution = distribution

  const batchSize = firstDefined(data.batchSize, parallel?.batchSize)
  if (typeof batchSize === 'number') {
    spec.batchSize = batchSize
    if (batchSize < PARALLEL_BATCH_MIN || batchSize > PARALLEL_BATCH_MAX) {
      repaired(
        context,
        blockKey,
        `Parallel batch size ${batchSize} is clamped to ${PARALLEL_BATCH_MIN}–${PARALLEL_BATCH_MAX} at run time`
      )
    }
  } else if (batchSize !== undefined) {
    rejectIfFromData(rejected, data, 'batchSize')
    repaired(
      context,
      blockKey,
      `Parallel batch size is not a number; the runtime uses ${PARALLEL_BATCH_MAX}`
    )
  }
  return { spec, rejectedDataKeys: rejected }
}
