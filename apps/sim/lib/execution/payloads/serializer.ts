import { isUserFileWithMetadata } from '@/lib/core/utils/user-file'
import {
  isLargeValueRef,
  LARGE_VALUE_THRESHOLD_BYTES,
} from '@/lib/execution/payloads/large-value-ref'
import { type LargeValueStoreContext, storeLargeValue } from '@/lib/execution/payloads/store'
import type { BlockLog } from '@/executor/types'

export interface CompactExecutionPayloadOptions extends LargeValueStoreContext {
  thresholdBytes?: number
  preserveUserFileBase64?: boolean
  preserveRoot?: boolean
}

interface CompactState {
  seen: WeakSet<object>
}

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

async function compactValue(
  value: unknown,
  options: CompactExecutionPayloadOptions,
  state: CompactState,
  depth = 0
): Promise<unknown> {
  if (!value || typeof value !== 'object') {
    const measured = getJsonAndSize(value)
    if (measured && measured.size > (options.thresholdBytes ?? LARGE_VALUE_THRESHOLD_BYTES)) {
      return options.preserveRoot && depth === 0
        ? value
        : storeLargeValue(value, measured.json, measured.size, options)
    }
    return value
  }

  if (isLargeValueRef(value)) {
    return value
  }

  if (isUserFileWithMetadata(value) && !options.preserveUserFileBase64) {
    return stripUserFileBase64(value)
  }

  if (state.seen.has(value)) {
    return value
  }
  state.seen.add(value)

  const compacted = Array.isArray(value)
    ? await Promise.all(value.map((item) => compactValue(item, options, state, depth + 1)))
    : Object.fromEntries(
        await Promise.all(
          Object.entries(value).map(async ([key, entryValue]) => [
            key,
            key === 'finalBlockLogs' && Array.isArray(entryValue)
              ? await compactBlockLogs(entryValue as BlockLog[], options)
              : await compactValue(entryValue, options, state, depth + 1),
          ])
        )
      )

  const measured = getJsonAndSize(compacted)
  if (measured && measured.size > (options.thresholdBytes ?? LARGE_VALUE_THRESHOLD_BYTES)) {
    return options.preserveRoot && depth === 0
      ? compacted
      : storeLargeValue(compacted, measured.json, measured.size, options)
  }

  return compacted
}

async function forceStoreValue(
  value: unknown,
  options: CompactExecutionPayloadOptions
): Promise<unknown> {
  if (isLargeValueRef(value)) {
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

export async function compactBlockLogs(
  logs: BlockLog[] | undefined,
  options: CompactExecutionPayloadOptions = {}
): Promise<BlockLog[] | undefined> {
  if (!logs) {
    return logs
  }

  return Promise.all(
    logs.map(async (log) => {
      const compactedLog = { ...log }
      if ('input' in compactedLog) {
        compactedLog.input = await compactExecutionPayload(compactedLog.input, options)
      }
      if ('output' in compactedLog) {
        compactedLog.output = await compactExecutionPayload(compactedLog.output, options)
      }
      if ('childTraceSpans' in compactedLog) {
        compactedLog.childTraceSpans = await compactExecutionPayload(
          compactedLog.childTraceSpans,
          options
        )
      }
      return compactedLog
    })
  )
}
