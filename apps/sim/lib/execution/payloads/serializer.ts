import { createLogger } from '@sim/logger'
import { isRecordLike } from '@sim/utils/object'
import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { isUserFileWithMetadata } from '@/lib/core/utils/user-file'
import {
  createLargeArrayManifest,
  isLargeArrayManifest,
} from '@/lib/execution/payloads/large-array-manifest'
import {
  isLargeValueRef,
  LARGE_VALUE_THRESHOLD_BYTES,
} from '@/lib/execution/payloads/large-value-ref'
import { type LargeValueStoreContext, storeLargeValue } from '@/lib/execution/payloads/store'
import { summarizeTraceSpansWithoutIo } from '@/lib/logs/execution/trace-spans/summarize'
import type { TraceSpan } from '@/lib/logs/types'
import type { BlockLog } from '@/executor/types'

const logger = createLogger('ExecutionPayloadSerializer')

export interface CompactExecutionPayloadOptions extends LargeValueStoreContext {
  thresholdBytes?: number
  preserveUserFileBase64?: boolean
  preserveRoot?: boolean
  rejectLargeValues?: boolean
  rejectLargeValueLabel?: string
}

interface CompactState {
  seen: WeakSet<object>
  /**
   * Return an unchanged plain object or array as-is instead of rebuilding it.
   * Only for input that `compactBlockOutput` already rebuilt: sharing a raw
   * handler output would retain V8's heavier `JSON.parse` object shapes.
   */
  reuseUnchanged?: boolean
}

const BLOCK_LOG_COMPACTION_CONCURRENCY = 4

function getJsonAndSize(value: unknown): { json: string; size: number } | null {
  try {
    const json = JSON.stringify(value)
    if (json === undefined) {
      return null
    }
    return {
      json,
      size: Buffer.byteLength(json, 'utf8'),
    }
  } catch {
    return null
  }
}

function stripUserFileBase64<T extends { base64?: unknown }>(value: T): Omit<T, 'base64'> {
  const { base64: _base64, ...rest } = value
  return rest
}

function canPersistDurably(options: CompactExecutionPayloadOptions): boolean {
  return Boolean(options.workspaceId && options.workflowId && options.executionId)
}

function largeValueLimitError(
  options: CompactExecutionPayloadOptions,
  observedBytes: number
): PayloadSizeLimitError {
  return new PayloadSizeLimitError({
    label: options.rejectLargeValueLabel ?? 'Large execution value',
    maxBytes: options.thresholdBytes ?? LARGE_VALUE_THRESHOLD_BYTES,
    observedBytes,
  })
}

function assertRejectSize(observedBytes: number, options: CompactExecutionPayloadOptions): void {
  if (!options.rejectLargeValues) return
  if (observedBytes > (options.thresholdBytes ?? LARGE_VALUE_THRESHOLD_BYTES)) {
    throw largeValueLimitError(options, observedBytes)
  }
}

type MaybePromise<T> = T | Promise<T>

/** `JSON.stringify` returned `undefined` (a function, symbol, or `undefined`). */
const JSON_OMITTED = -1
/** `JSON.stringify` threw (a cycle, a BigInt, or a throwing `toJSON` or getter). */
const JSON_UNSERIALIZABLE = -2

/** Matches every string `JSON.stringify` writes other than as `"` + itself + `"`. */
const JSON_ESCAPED_CHARACTER = /["\\\u0000-\u001f\ud800-\udfff]/

/**
 * What `getJsonAndSize` would report for a value, without necessarily
 * serializing it: `bytes` is the UTF-8 length of `JSON.stringify(value)`, or
 * {@link JSON_OMITTED} / {@link JSON_UNSERIALIZABLE}.
 */
interface JsonMeasure {
  bytes: number
  /**
   * Whether the value serializes the same nested under any key as on its own,
   * so a parent can add its bytes up instead of serializing it again. False
   * when it has a callable `toJSON`, which receives the key.
   */
  composable: boolean
  json?: string
}

interface CompactedNode {
  value: unknown
  bytes: number
  composable: boolean
}

interface CompactedChildren {
  compacted: unknown
  measured: JsonMeasure
}

const OMITTED_NODE: CompactedNode = { value: undefined, bytes: JSON_OMITTED, composable: true }

function isComposable(value: unknown): boolean {
  if (
    value === null ||
    (typeof value !== 'object' && typeof value !== 'function' && typeof value !== 'bigint')
  ) {
    return true
  }
  try {
    return typeof (value as { toJSON?: unknown }).toJSON !== 'function'
  } catch {
    return false
  }
}

function measureJson(value: unknown): JsonMeasure {
  let json: string | undefined
  try {
    json = JSON.stringify(value)
  } catch {
    return { bytes: JSON_UNSERIALIZABLE, composable: isComposable(value) }
  }
  if (json === undefined) {
    return { bytes: JSON_OMITTED, composable: isComposable(value) }
  }
  return { bytes: Buffer.byteLength(json, 'utf8'), composable: isComposable(value), json }
}

/** UTF-8 bytes of `JSON.stringify(text)`. */
function jsonStringBytes(text: string): number {
  return JSON_ESCAPED_CHARACTER.test(text)
    ? Buffer.byteLength(JSON.stringify(text), 'utf8')
    : Buffer.byteLength(text, 'utf8') + 2
}

/**
 * Measures a non-object value. A string that cannot fit the threshold (its
 * JSON is never shorter than its length + 2) is serialized, since it spills.
 */
function measureLeaf(value: unknown, thresholdBytes: number): JsonMeasure {
  if (typeof value === 'string' && value.length + 2 <= thresholdBytes) {
    return { bytes: jsonStringBytes(value), composable: true }
  }
  return measureJson(value)
}

function exceedsThreshold(bytes: number, thresholdBytes: number): boolean {
  return bytes >= 0 && bytes > thresholdBytes
}

function sumArrayBytes(nodes: readonly CompactedNode[]): number {
  let bytes = 1 + Math.max(nodes.length, 1)
  for (const node of nodes) {
    if (node.bytes === JSON_UNSERIALIZABLE) return JSON_UNSERIALIZABLE
    bytes += node.bytes === JSON_OMITTED ? 4 : node.bytes
  }
  return bytes
}

function sumObjectBytes(keys: readonly string[], nodes: readonly CompactedNode[]): number {
  let bytes = 2
  let propertyCount = 0
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index]
    if (node.bytes === JSON_UNSERIALIZABLE) return JSON_UNSERIALIZABLE
    if (node.bytes === JSON_OMITTED) continue
    bytes += (propertyCount > 0 ? 1 : 0) + jsonStringBytes(keys[index]) + 1 + node.bytes
    propertyCount += 1
  }
  return bytes
}

/**
 * Measures a rebuilt container from its children's measures, falling back to
 * serializing it when a `toJSON` (its own or a child's) makes the sum unsound.
 */
function measureContainer(
  compacted: unknown,
  nodes: readonly CompactedNode[],
  sumBytes: () => number,
  mustSerialize = false
): JsonMeasure {
  if (mustSerialize || !isComposable(compacted) || nodes.some((node) => !node.composable)) {
    return measureJson(compacted)
  }
  return { bytes: sumBytes(), composable: true }
}

function toNode(value: unknown, measured: JsonMeasure): CompactedNode {
  return { value, bytes: measured.bytes, composable: measured.composable }
}

function measuredNode(value: unknown): CompactedNode {
  return toNode(value, measureJson(value))
}

/**
 * Nesting levels walked on one synchronous stack before the walk resumes on a
 * fresh one. Each level costs several frames, and a level with a `toJSON`
 * serializes its subtree from where it stands, so an unbroken walk overflows
 * the stack on trees an awaiting walk handles.
 */
const RESUME_WALK_EVERY_DEPTH = 256

/**
 * A subtree whose walk continues on a fresh stack. `walked` settles once the
 * walk has visited every object below it, with its result (still pending while
 * a spill is in flight). Later siblings start only after it, so objects are
 * first seen in the same order as an unbroken walk.
 */
class ResumedWalk<T> {
  constructor(readonly walked: Promise<{ result: MaybePromise<T> }>) {}
}

/** The result of walking a subtree: ready, pending on a spill, or still walking. */
type Walk<T> = MaybePromise<T> | ResumedWalk<T>

/** Unwraps a walk into the promise of its result. */
async function settleWalk<T>(walk: Walk<T>): Promise<T> {
  return walk instanceof ResumedWalk ? (await walk.walked).result : walk
}

function thenMaybe<T, R>(
  value: MaybePromise<T>,
  next: (resolved: T) => MaybePromise<R>
): MaybePromise<R> {
  return value instanceof Promise ? value.then(next) : next(value)
}

function thenWalk<T, R>(walk: Walk<T>, next: (resolved: T) => MaybePromise<R>): Walk<R> {
  return walk instanceof ResumedWalk
    ? new ResumedWalk(walk.walked.then(({ result }) => ({ result: thenMaybe(result, next) })))
    : thenMaybe(walk, next)
}

/**
 * Starts every step in order and joins them like `Promise.all`, staying
 * synchronous when none is async. A step that throws synchronously still
 * observes the steps already pending, so none rejects unhandled. A step whose
 * walk resumed holds back the rest until it has walked.
 */
function startAll<T>(count: number, start: (index: number) => Walk<T>): Walk<T[]> {
  const results = new Array<MaybePromise<T>>(count)
  let hasPending = false
  try {
    for (let index = 0; index < count; index++) {
      const result = start(index)
      if (result instanceof ResumedWalk) {
        return new ResumedWalk(continueAll(result, index, count, start, results))
      }
      results[index] = result
      if (result instanceof Promise) hasPending = true
    }
  } catch (error) {
    if (hasPending) Promise.all(results).catch(() => {})
    throw error
  }
  return hasPending ? Promise.all(results) : (results as T[])
}

async function continueAll<T>(
  resumed: ResumedWalk<T>,
  resumedIndex: number,
  count: number,
  start: (index: number) => Walk<T>,
  results: MaybePromise<T>[]
): Promise<{ result: MaybePromise<T[]> }> {
  let hasPending = false
  /** Observes each pending step now, as a later step may throw before the join. */
  const accept = (result: MaybePromise<T>, index: number) => {
    results[index] = result
    if (result instanceof Promise) {
      hasPending = true
      result.catch(() => {})
    }
  }
  for (let index = 0; index < resumedIndex; index++) accept(results[index], index)
  accept((await resumed.walked).result, resumedIndex)
  for (let index = resumedIndex + 1; index < count; index++) {
    const result = start(index)
    accept(result instanceof ResumedWalk ? (await result.walked).result : result, index)
  }
  return { result: hasPending ? Promise.all(results) : (results as T[]) }
}

/** Runs `start` for each index in order, awaiting only when a step is async. */
function forEachInOrder<T>(
  count: number,
  start: (index: number) => Walk<T>,
  accept: (result: T, index: number) => void
): MaybePromise<void> {
  for (let index = 0; index < count; index++) {
    const result = start(index)
    if (result instanceof Promise || result instanceof ResumedWalk) {
      return continueInOrder(result, index, count, start, accept)
    }
    accept(result, index)
  }
}

async function continueInOrder<T>(
  pending: Promise<T> | ResumedWalk<T>,
  pendingIndex: number,
  count: number,
  start: (index: number) => Walk<T>,
  accept: (result: T, index: number) => void
): Promise<void> {
  accept(await settleWalk(pending), pendingIndex)
  for (let index = pendingIndex + 1; index < count; index++) {
    accept(await settleWalk(start(index)), index)
  }
}

function storeMeasured(
  value: unknown,
  measured: JsonMeasure,
  options: CompactExecutionPayloadOptions
): Promise<CompactedNode> {
  return storeLargeValue(
    value,
    measured.json ?? (JSON.stringify(value) as string),
    measured.bytes,
    options
  ).then(measuredNode)
}

/**
 * Compacts a value bottom-up, returning it with its JSON measure so each
 * ancestor sizes itself from its children instead of re-serializing them.
 * Stays synchronous until something spills or block logs compact, so a
 * fitting tree allocates no promises.
 */
function compactValue(
  value: unknown,
  options: CompactExecutionPayloadOptions,
  state: CompactState,
  depth = 0
): Walk<CompactedNode> {
  const thresholdBytes = options.thresholdBytes ?? LARGE_VALUE_THRESHOLD_BYTES
  if (!value || typeof value !== 'object') {
    const measured = measureLeaf(value, thresholdBytes)
    if (exceedsThreshold(measured.bytes, thresholdBytes)) {
      if (options.rejectLargeValues) {
        throw largeValueLimitError(options, measured.bytes)
      }
      return options.preserveRoot && depth === 0
        ? toNode(value, measured)
        : storeMeasured(value, measured, options)
    }
    return toNode(value, measured)
  }

  if (isLargeValueRef(value)) {
    return measuredNode(value)
  }

  if (isLargeArrayManifest(value)) {
    const measured = measureJson(value)
    if (exceedsThreshold(measured.bytes, thresholdBytes)) {
      if (options.rejectLargeValues) {
        throw largeValueLimitError(options, measured.bytes)
      }
      return storeMeasured(value, measured, options)
    }
    return toNode(value, measured)
  }

  if (isUserFileWithMetadata(value) && !options.preserveUserFileBase64) {
    return measuredNode(stripUserFileBase64(value))
  }

  if (state.seen.has(value)) {
    return measuredNode(value)
  }
  state.seen.add(value)

  const children =
    depth > 0 && depth % RESUME_WALK_EVERY_DEPTH === 0
      ? resumeEntries(value, options, state, depth)
      : compactEntries(value, options, state, depth)
  return thenWalk(children, ({ compacted, measured }) => {
    if (!exceedsThreshold(measured.bytes, thresholdBytes)) {
      return toNode(compacted, measured)
    }
    if (options.rejectLargeValues) {
      throw largeValueLimitError(options, measured.bytes)
    }

    if (Array.isArray(compacted) && (canPersistDurably(options) || options.requireDurable)) {
      return createLargeArrayManifest(compacted, { ...options, requireDurable: true }).then(
        measuredNode
      )
    }

    if (options.preserveRoot && depth === 0) {
      return toNode(compacted, measured)
    }

    return storeMeasured(compacted, measured, options)
  })
}

/**
 * Walks a container's entries on a fresh stack. Kept out of `compactValue` so
 * that function allocates no closure on every call.
 */
function resumeEntries(
  value: object,
  options: CompactExecutionPayloadOptions,
  state: CompactState,
  depth: number
): ResumedWalk<CompactedChildren> {
  return new ResumedWalk(
    Promise.resolve().then(() => {
      const result = compactEntries(value, options, state, depth)
      return result instanceof ResumedWalk ? result.walked : { result }
    })
  )
}

function compactEntryValue(
  key: string,
  entryValue: unknown,
  options: CompactExecutionPayloadOptions,
  state: CompactState,
  depth: number
): Walk<CompactedNode> {
  return key === 'finalBlockLogs' && Array.isArray(entryValue)
    ? compactBlockLogs(entryValue as BlockLog[], options).then(measuredNode)
    : compactValue(entryValue, options, state, depth + 1)
}

function compactEntries(
  value: object,
  options: CompactExecutionPayloadOptions,
  state: CompactState,
  depth: number
): Walk<CompactedChildren> {
  if (options.rejectLargeValues) {
    return compactEntriesWithEarlyReject(value, options, state, depth)
  }

  if (Array.isArray(value)) {
    const pending = startAll(value.length, (index) =>
      index in value ? compactValue(value[index], options, state, depth + 1) : OMITTED_NODE
    )
    return thenWalk(pending, (nodes) => {
      const compacted =
        state.reuseUnchanged &&
        Object.getPrototypeOf(value) === Array.prototype &&
        nodes.every((node, index) => node.value === value[index])
          ? value
          : nodes.map((node) => node.value)
      return { compacted, measured: measureContainer(compacted, nodes, () => sumArrayBytes(nodes)) }
    })
  }

  const entries = Object.entries(value)
  const pending = startAll(entries.length, (index) =>
    compactEntryValue(entries[index][0], entries[index][1], options, state, depth)
  )
  return thenWalk(pending, (nodes) => {
    const compacted =
      state.reuseUnchanged &&
      Object.getPrototypeOf(value) === Object.prototype &&
      nodes.every((node, index) => node.value === entries[index][1])
        ? value
        : Object.fromEntries(entries.map(([key], index) => [key, nodes[index].value]))
    return {
      compacted,
      measured: measureContainer(compacted, nodes, () =>
        sumObjectBytes(
          entries.map(([key]) => key),
          nodes
        )
      ),
    }
  })
}

function compactEntriesWithEarlyReject(
  value: object,
  options: CompactExecutionPayloadOptions,
  state: CompactState,
  depth: number
): MaybePromise<CompactedChildren> {
  if (Array.isArray(value)) {
    const compacted: unknown[] = []
    const nodes: CompactedNode[] = []
    let estimatedBytes = 2
    return thenMaybe(
      forEachInOrder(
        value.length,
        (index) => compactValue(value[index], options, state, depth + 1),
        (node) => {
          compacted.push(node.value)
          nodes.push(node)
          estimatedBytes += (compacted.length > 1 ? 1 : 0) + (node.bytes >= 0 ? node.bytes : 4)
          assertRejectSize(estimatedBytes, options)
        }
      ),
      () => ({
        compacted,
        measured: measureContainer(compacted, nodes, () => sumArrayBytes(nodes)),
      })
    )
  }

  const compacted: Record<string, unknown> = {}
  const entries = Object.entries(value)
  const nodes: CompactedNode[] = []
  let estimatedBytes = 2
  let serializedPropertyCount = 0
  return thenMaybe(
    forEachInOrder(
      entries.length,
      (index) => compactEntryValue(entries[index][0], entries[index][1], options, state, depth),
      (node, index) => {
        const key = entries[index][0]
        compacted[key] = node.value
        nodes.push(node)
        if (node.bytes >= 0) {
          estimatedBytes +=
            (serializedPropertyCount > 0 ? 1 : 0) + jsonStringBytes(key) + 1 + node.bytes
          serializedPropertyCount += 1
          assertRejectSize(estimatedBytes, options)
        }
      }
    ),
    () => ({
      compacted,
      measured: measureContainer(
        compacted,
        nodes,
        () =>
          sumObjectBytes(
            entries.map(([key]) => key),
            nodes
          ),
        // Assigning `__proto__` sets the prototype instead of adding a key.
        entries.some(([key]) => key === '__proto__')
      ),
    })
  )
}

async function forceStoreValue(
  value: unknown,
  options: CompactExecutionPayloadOptions
): Promise<unknown> {
  if (isLargeValueRef(value) || isLargeArrayManifest(value)) {
    return value
  }
  const measured = getJsonAndSize(value)
  if (!measured) {
    return value
  }
  return storeLargeValue(value, measured.json, measured.size, options)
}

export async function compactExecutionPayload<T>(
  value: T,
  options: CompactExecutionPayloadOptions = {}
): Promise<T> {
  return (await settleWalk(compactValue(value, options, { seen: new WeakSet<object>() })))
    .value as T
}

export async function compactWorkflowVariableValue<T>(
  value: T,
  options: CompactExecutionPayloadOptions = {}
): Promise<T> {
  return compactExecutionPayload(value, { ...options, requireDurable: true })
}

/**
 * Compacts subflow result aggregates while preserving indexable `results`.
 */
export async function compactSubflowResults<T>(
  results: T[],
  options: CompactExecutionPayloadOptions = {}
): Promise<T[]> {
  const entryOptions = { ...options, preserveRoot: false }
  const nodes = await settleWalk(
    startAll(results.length, (index) =>
      index in results
        ? compactValue(results[index], entryOptions, {
            seen: new WeakSet<object>(),
            reuseUnchanged: true,
          })
        : OMITTED_NODE
    )
  )
  let compactedResults = nodes.map((node) => node.value) as T[]

  const aggregate = { results: compactedResults }
  const resultsBytes =
    isComposable(aggregate) && isComposable(compactedResults)
      ? measureContainer(compactedResults, nodes, () => sumArrayBytes(nodes)).bytes
      : JSON_UNSERIALIZABLE
  const aggregateBytes =
    resultsBytes >= 0 ? resultsBytes + '{"results":}'.length : measureJson(aggregate).bytes
  if (
    aggregateBytes >= 0 &&
    aggregateBytes <= (options.thresholdBytes ?? LARGE_VALUE_THRESHOLD_BYTES)
  ) {
    return compactedResults
  }

  compactedResults = (await Promise.all(
    compactedResults.map((result) => forceStoreValue(result, options))
  )) as T[]

  return compactedResults
}

/** Maps each entry of a record concurrently, keeping its keys. */
async function mapEntriesAsync(
  record: Record<string, unknown>,
  mapValue: (key: string, value: unknown) => Promise<unknown>
): Promise<Record<string, unknown>> {
  return Object.fromEntries(
    await Promise.all(
      Object.entries(record).map(async ([key, value]) => [key, await mapValue(key, value)])
    )
  )
}

/**
 * Compacts a trace span tree without collapsing its structure: `children` and
 * `output.childTraceSpans` stay arrays of spans and only each span's payload
 * fields spill when oversized. A malformed list or entry is dropped, so every
 * reader can walk the tree. See {@link compactChildTraceSpans} for the size bound.
 */
async function compactTraceSpanTree(
  spans: unknown,
  options: CompactExecutionPayloadOptions,
  seen: WeakSet<object>
): Promise<unknown[] | undefined> {
  if (!Array.isArray(spans)) {
    return undefined
  }
  return Promise.all(
    spans.filter(isRecordLike).map((span) => compactTraceSpan(span, options, seen))
  )
}

async function compactTraceSpan(
  span: Record<string, unknown>,
  options: CompactExecutionPayloadOptions,
  seen: WeakSet<object>
): Promise<Record<string, unknown>> {
  if (seen.has(span)) {
    return span
  }
  seen.add(span)
  return mapEntriesAsync(span, (key, value) => {
    if (key === 'children') return compactTraceSpanTree(value, options, seen)
    if (key === 'output') return compactSpanOutput(value, options, seen)
    return compactExecutionPayload(value, options)
  })
}

/**
 * Compacts a span's output. One carrying a nested child workflow's
 * `childTraceSpans` keeps its root so the spans stay attached; its other
 * fields spill individually.
 */
async function compactSpanOutput(
  output: unknown,
  options: CompactExecutionPayloadOptions,
  seen: WeakSet<object>
): Promise<unknown> {
  if (!isRecordLike(output) || !('childTraceSpans' in output)) {
    return compactExecutionPayload(output, options)
  }
  return mapEntriesAsync(output, (key, value) =>
    key === 'childTraceSpans'
      ? compactTraceSpanTree(value, options, seen)
      : compactExecutionPayload(value, options)
  )
}

/**
 * Compacts a block's child span tree for its log. Readers walk span trees as
 * arrays, so a tree is never collapsed: payload fields spill individually (see
 * {@link compactTraceSpanTree}). A tree still over the threshold as a whole
 * keeps only its skeleton (shape, names, timing, status, cost), and one whose
 * skeleton is still over it is dropped, bounding it as generic compaction did.
 */
async function compactChildTraceSpans(
  spans: unknown,
  options: CompactExecutionPayloadOptions
): Promise<TraceSpan[] | undefined> {
  if (!Array.isArray(spans)) {
    if (spans !== undefined) {
      logger.warn('Dropping child trace spans that are not a list', { shape: typeof spans })
    }
    return undefined
  }
  const compacted = (await compactTraceSpanTree(
    spans,
    options,
    new WeakSet<object>()
  )) as TraceSpan[]
  const maxBytes = options.thresholdBytes ?? LARGE_VALUE_THRESHOLD_BYTES
  const measured = getJsonAndSize(compacted)
  if (!measured) {
    logger.warn('Dropping child trace spans that cannot be serialized')
    return undefined
  }
  if (measured.size <= maxBytes) {
    return compacted
  }
  if (options.rejectLargeValues) {
    throw largeValueLimitError(options, measured.size)
  }
  const skeleton = summarizeTraceSpansWithoutIo(compacted)
  const skeletonSize = getJsonAndSize(skeleton)?.size
  if (skeletonSize !== undefined && skeletonSize <= maxBytes) {
    logger.warn('Kept only the skeleton of child trace spans too large to keep whole', {
      observedBytes: measured.size,
      maxBytes,
    })
    return skeleton
  }
  logger.warn('Dropping child trace spans too large to keep', {
    observedBytes: skeletonSize ?? measured.size,
    maxBytes,
  })
  return undefined
}

export interface CompactedBlockOutput<T> {
  /** The output without `childTraceSpans`, compacted as execution state. */
  output: T
  /** The output's child span tree for the block log (see {@link compactChildTraceSpans}). */
  childTraceSpans?: TraceSpan[]
}

/**
 * Compacts a block output for execution state and splits off its
 * `childTraceSpans`, which belong to the block log rather than state. The
 * output compacts as any execution payload, so an oversized one still spills
 * whole.
 */
export async function compactBlockOutput<T>(
  output: T,
  options: CompactExecutionPayloadOptions = {}
): Promise<CompactedBlockOutput<T>> {
  if (!isRecordLike(output) || !('childTraceSpans' in output)) {
    return { output: await compactExecutionPayload(output, options) }
  }
  const { childTraceSpans, ...rest } = output
  const [compactedOutput, compactedSpans] = await Promise.all([
    compactExecutionPayload(rest, options),
    compactChildTraceSpans(childTraceSpans, options),
  ])
  return { output: compactedOutput as T, childTraceSpans: compactedSpans }
}

export async function compactBlockLogs(
  logs: BlockLog[] | undefined,
  options: CompactExecutionPayloadOptions = {}
): Promise<BlockLog[] | undefined> {
  if (!logs) {
    return logs
  }

  const compactedLogs = new Array<BlockLog>(logs.length)
  let cursor = 0
  const worker = async (): Promise<void> => {
    while (true) {
      const index = cursor
      cursor += 1
      if (index >= logs.length) return

      const log = logs[index]
      const compactedLog = { ...log }
      if ('input' in compactedLog) {
        compactedLog.input = await compactExecutionPayload(compactedLog.input, options)
      }
      if ('output' in compactedLog) {
        compactedLog.output = await compactExecutionPayload(compactedLog.output, options)
      }
      if ('childTraceSpans' in compactedLog) {
        compactedLog.childTraceSpans = await compactChildTraceSpans(
          compactedLog.childTraceSpans,
          options
        )
      }
      compactedLogs[index] = compactedLog
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(BLOCK_LOG_COMPACTION_CONCURRENCY, logs.length) }, worker)
  )
  return compactedLogs
}
