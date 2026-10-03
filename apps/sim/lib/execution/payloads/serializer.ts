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

async function compactValue(
  value: unknown,
  options: CompactExecutionPayloadOptions,
  state: CompactState,
  depth = 0
): Promise<unknown> {
  if (!value || typeof value !== 'object') {
    const measured = getJsonAndSize(value)
    if (measured && measured.size > (options.thresholdBytes ?? LARGE_VALUE_THRESHOLD_BYTES)) {
      if (options.rejectLargeValues) {
        throw largeValueLimitError(options, measured.size)
      }
      return options.preserveRoot && depth === 0
        ? value
        : storeLargeValue(value, measured.json, measured.size, options)
    }
    return value
  }

  if (isLargeValueRef(value)) {
    return value
  }

  if (isLargeArrayManifest(value)) {
    const measured = getJsonAndSize(value)
    if (measured && measured.size > (options.thresholdBytes ?? LARGE_VALUE_THRESHOLD_BYTES)) {
      if (options.rejectLargeValues) {
        throw largeValueLimitError(options, measured.size)
      }
      return storeLargeValue(value, measured.json, measured.size, options)
    }
    return value
  }

  if (isUserFileWithMetadata(value) && !options.preserveUserFileBase64) {
    return stripUserFileBase64(value)
  }

  if (state.seen.has(value)) {
    return value
  }
  state.seen.add(value)

  const compacted = await compactEntries(value, options, state, depth)

  const measured = getJsonAndSize(compacted)
  if (measured && measured.size > (options.thresholdBytes ?? LARGE_VALUE_THRESHOLD_BYTES)) {
    if (options.rejectLargeValues) {
      throw largeValueLimitError(options, measured.size)
    }

    if (Array.isArray(compacted) && (canPersistDurably(options) || options.requireDurable)) {
      return createLargeArrayManifest(compacted, { ...options, requireDurable: true })
    }

    if (options.preserveRoot && depth === 0) {
      return compacted
    }

    return storeLargeValue(compacted, measured.json, measured.size, options)
  }

  return compacted
}

async function compactEntries(
  value: object,
  options: CompactExecutionPayloadOptions,
  state: CompactState,
  depth: number
): Promise<unknown> {
  if (options.rejectLargeValues) {
    return compactEntriesWithEarlyReject(value, options, state, depth)
  }

  if (Array.isArray(value)) {
    return Promise.all(value.map((item) => compactValue(item, options, state, depth + 1)))
  }

  return Object.fromEntries(
    await Promise.all(
      Object.entries(value).map(async ([key, entryValue]) => [
        key,
        key === 'finalBlockLogs' && Array.isArray(entryValue)
          ? await compactBlockLogs(entryValue as BlockLog[], options)
          : await compactValue(entryValue, options, state, depth + 1),
      ])
    )
  )
}

async function compactEntriesWithEarlyReject(
  value: object,
  options: CompactExecutionPayloadOptions,
  state: CompactState,
  depth: number
): Promise<unknown> {
  if (Array.isArray(value)) {
    const compacted: unknown[] = []
    let estimatedBytes = 2
    for (const item of value) {
      const compactedItem = await compactValue(item, options, state, depth + 1)
      compacted.push(compactedItem)
      const measured = getJsonAndSize(compactedItem)
      estimatedBytes += (compacted.length > 1 ? 1 : 0) + (measured?.size ?? 4)
      assertRejectSize(estimatedBytes, options)
    }
    return compacted
  }

  const compacted: Record<string, unknown> = {}
  let estimatedBytes = 2
  let serializedPropertyCount = 0
  for (const [key, entryValue] of Object.entries(value)) {
    const compactedEntry =
      key === 'finalBlockLogs' && Array.isArray(entryValue)
        ? await compactBlockLogs(entryValue as BlockLog[], options)
        : await compactValue(entryValue, options, state, depth + 1)
    compacted[key] = compactedEntry

    const measured = getJsonAndSize(compactedEntry)
    if (measured) {
      const keyJson = JSON.stringify(key)
      estimatedBytes +=
        (serializedPropertyCount > 0 ? 1 : 0) +
        Buffer.byteLength(keyJson, 'utf8') +
        1 +
        measured.size
      serializedPropertyCount += 1
      assertRejectSize(estimatedBytes, options)
    }
  }
  return compacted
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
  return (await compactValue(value, options, { seen: new WeakSet<object>() })) as T
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
  let compactedResults = (await Promise.all(
    results.map((result) => compactExecutionPayload(result, entryOptions))
  )) as T[]

  const aggregate = getJsonAndSize({ results: compactedResults })
  if (aggregate && aggregate.size <= (options.thresholdBytes ?? LARGE_VALUE_THRESHOLD_BYTES)) {
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
