import type { NormalizedBlockOutput } from '@/executor/types'
import type { ConsoleEntry } from './types'

/**
 * Terminal console safety limits used to bound persisted debug data.
 */
export const TERMINAL_CONSOLE_LIMITS = {
  MAX_ENTRIES_PER_WORKFLOW: 5000,
  MAX_STRING_LENGTH: 50_000,
  MAX_OBJECT_KEYS: 100,
  MAX_ARRAY_ITEMS: 100,
  MAX_DEPTH: 6,
  MAX_SERIALIZED_BYTES: 256 * 1024,
  MAX_SERIALIZED_PREVIEW_LENGTH: 10_000,
} as const

const textEncoder = new TextEncoder()

/**
 * Returns the UTF-8 byte length of a string.
 */
function getByteLength(value: string): number {
  return textEncoder.encode(value).length
}

/**
 * Truncates a string while preserving a short explanation.
 */
function truncateString(
  value: string,
  maxLength: number = TERMINAL_CONSOLE_LIMITS.MAX_STRING_LENGTH
): string {
  if (value.length <= maxLength) {
    return value
  }

  return `${value.slice(0, maxLength)}... [truncated ${value.length - maxLength} chars]`
}

/**
 * Safely stringifies terminal data without throwing on circular or non-JSON-safe values.
 */
export function safeConsoleStringify(value: unknown): string {
  const seen = new WeakSet<object>()

  try {
    return (
      JSON.stringify(
        value,
        (_key, currentValue) => {
          if (typeof currentValue === 'bigint') {
            return `${currentValue.toString()}n`
          }

          if (currentValue instanceof Error) {
            return {
              name: currentValue.name,
              message: currentValue.message,
              stack: currentValue.stack,
            }
          }

          if (typeof currentValue === 'function') {
            return `[Function ${currentValue.name || 'anonymous'}]`
          }

          if (typeof currentValue === 'symbol') {
            return currentValue.toString()
          }

          if (typeof currentValue === 'object' && currentValue !== null) {
            if (seen.has(currentValue)) {
              return '[Circular]'
            }

            seen.add(currentValue)
          }

          return currentValue
        },
        2
      ) ?? ''
    )
  } catch {
    try {
      return String(value)
    } catch {
      return '[Unserializable value]'
    }
  }
}

/**
 * Produces a terminal-safe representation of any value.
 */
export function normalizeConsoleValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) {
    return value
  }

  if (typeof value === 'string') {
    return truncateString(value)
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'bigint') {
    return `${value.toString()}n`
  }

  if (typeof value === 'function') {
    return `[Function ${value.name || 'anonymous'}]`
  }

  if (typeof value === 'symbol') {
    return value.toString()
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: truncateString(value.message),
      stack: value.stack ? truncateString(value.stack) : undefined,
    }
  }

  if (depth >= TERMINAL_CONSOLE_LIMITS.MAX_DEPTH) {
    return `[Truncated ${Array.isArray(value) ? 'array' : 'object'}]`
  }

  if (Array.isArray(value)) {
    const normalizedItems = value
      .slice(0, TERMINAL_CONSOLE_LIMITS.MAX_ARRAY_ITEMS)
      .map((item) => normalizeConsoleValue(item, depth + 1))

    if (value.length > TERMINAL_CONSOLE_LIMITS.MAX_ARRAY_ITEMS) {
      normalizedItems.push(
        `[... truncated ${value.length - TERMINAL_CONSOLE_LIMITS.MAX_ARRAY_ITEMS} items]`
      )
    }

    return normalizedItems
  }

  const objectEntries = Object.entries(value as Record<string, unknown>)
  const normalizedObject: Record<string, unknown> = {}

  for (const [key, entryValue] of objectEntries.slice(0, TERMINAL_CONSOLE_LIMITS.MAX_OBJECT_KEYS)) {
    normalizedObject[key] = normalizeConsoleValue(entryValue, depth + 1)
  }

  if (objectEntries.length > TERMINAL_CONSOLE_LIMITS.MAX_OBJECT_KEYS) {
    normalizedObject.__simTruncatedKeys =
      objectEntries.length - TERMINAL_CONSOLE_LIMITS.MAX_OBJECT_KEYS
  }

  return normalizedObject
}

/**
 * Applies a final serialized-size cap after recursive normalization.
 */
function capNormalizedValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value
  }

  const serialized = safeConsoleStringify(value)
  const serializedBytes = getByteLength(serialized)

  if (serializedBytes <= TERMINAL_CONSOLE_LIMITS.MAX_SERIALIZED_BYTES) {
    return value
  }

  return {
    __simTruncated: true,
    __simByteLength: serializedBytes,
    __simPreview: truncateString(serialized, TERMINAL_CONSOLE_LIMITS.MAX_SERIALIZED_PREVIEW_LENGTH),
  }
}

/**
 * Normalizes terminal input data before it is stored.
 */
export function normalizeConsoleInput(input: unknown): unknown {
  return capNormalizedValue(normalizeConsoleValue(input))
}

/**
 * Normalizes terminal output data before it is stored.
 */
export function normalizeConsoleOutput(output: unknown): NormalizedBlockOutput | undefined {
  if (output === undefined) {
    return undefined
  }

  return capNormalizedValue(normalizeConsoleValue(output)) as NormalizedBlockOutput
}

/**
 * Normalizes terminal error data before it is stored.
 */
export function normalizeConsoleError(error: unknown): string | null | undefined {
  if (error === undefined) {
    return undefined
  }

  if (error === null) {
    return null
  }

  return truncateString(
    typeof error === 'string' ? error : safeConsoleStringify(normalizeConsoleValue(error))
  )
}

/**
 * Returns a workflow's entries trimmed to the configured cap.
 */
export function trimWorkflowConsoleEntries(entries: ConsoleEntry[]): ConsoleEntry[] {
  if (entries.length <= TERMINAL_CONSOLE_LIMITS.MAX_ENTRIES_PER_WORKFLOW) {
    return entries
  }

  const executionGroups = new Map<string, ConsoleEntry[]>()

  for (const entry of entries) {
    const executionId = entry.executionId ?? entry.id
    const group = executionGroups.get(executionId)
    if (group) {
      group.push(entry)
    } else {
      executionGroups.set(executionId, [entry])
    }
  }

  const executionIds = [...executionGroups.keys()]
  const newestExecutionId = executionIds[0]

  if (!newestExecutionId) {
    return entries.slice(0, TERMINAL_CONSOLE_LIMITS.MAX_ENTRIES_PER_WORKFLOW)
  }

  const keptEntryIds = new Set<string>()
  let remainingSlots = TERMINAL_CONSOLE_LIMITS.MAX_ENTRIES_PER_WORKFLOW

  const newestExecutionEntries = executionGroups.get(newestExecutionId) ?? []
  const newestExecutionToKeep = newestExecutionEntries.slice(0, remainingSlots)
  newestExecutionToKeep.forEach((entry) => keptEntryIds.add(entry.id))
  remainingSlots -= newestExecutionToKeep.length

  for (const executionId of executionIds.slice(1)) {
    const executionEntries = executionGroups.get(executionId) ?? []

    if (executionEntries.length > remainingSlots) {
      continue
    }

    executionEntries.forEach((entry) => keptEntryIds.add(entry.id))
    remainingSlots -= executionEntries.length

    if (remainingSlots === 0) {
      break
    }
  }

  return entries.filter((entry) => keptEntryIds.has(entry.id))
}

/**
 * Applies workflow-level trimming while preserving newest-first order.
 */
export function trimConsoleEntries(entries: ConsoleEntry[]): ConsoleEntry[] {
  const workflowGroups = new Map<string, ConsoleEntry[]>()

  for (const entry of entries) {
    const workflowEntries = workflowGroups.get(entry.workflowId)
    if (workflowEntries) {
      workflowEntries.push(entry)
    } else {
      workflowGroups.set(entry.workflowId, [entry])
    }
  }

  const keptEntryIds = new Set<string>()

  for (const workflowEntries of workflowGroups.values()) {
    trimWorkflowConsoleEntries(workflowEntries).forEach((entry) => keptEntryIds.add(entry.id))
  }

  return entries.filter((entry) => keptEntryIds.has(entry.id))
}
