export const LARGE_VALUE_REF_MARKER = '__simLargeValueRef'

export const LARGE_VALUE_THRESHOLD_BYTES = 8 * 1024 * 1024
export const LARGE_VALUE_REF_VERSION = 1

export const LARGE_VALUE_KINDS = ['array', 'object', 'string', 'json'] as const

export type LargeValueKind = (typeof LARGE_VALUE_KINDS)[number]

export interface LargeValueRef {
  [LARGE_VALUE_REF_MARKER]: true
  version: typeof LARGE_VALUE_REF_VERSION
  id: string
  kind: LargeValueKind
  size: number
  key?: string
  executionId?: string
  preview?: unknown
}

const LARGE_VALUE_ID_PATTERN = /^lv_[A-Za-z0-9_-]{12}$/

export function isLargeValueStorageKey(key: string, id: string, executionId?: string): boolean {
  if (!key.startsWith('execution/')) return false
  if (!key.endsWith(`/large-value-${id}.json`)) return false
  if (executionId && !key.includes(`/${executionId}/`)) return false
  return true
}

export function isLargeValueRef(value: unknown): value is LargeValueRef {
  if (!value || typeof value !== 'object') return false

  const candidate = value as Record<string, unknown>
  const id = candidate.id
  const key = candidate.key
  const executionId = candidate.executionId

  return (
    candidate[LARGE_VALUE_REF_MARKER] === true &&
    candidate.version === LARGE_VALUE_REF_VERSION &&
    typeof id === 'string' &&
    LARGE_VALUE_ID_PATTERN.test(id) &&
    typeof candidate.kind === 'string' &&
    (LARGE_VALUE_KINDS as readonly string[]).includes(candidate.kind) &&
    typeof candidate.size === 'number' &&
    Number.isFinite(candidate.size) &&
    candidate.size > 0 &&
    (executionId === undefined || typeof executionId === 'string') &&
    (key === undefined ||
      (typeof key === 'string' &&
        isLargeValueStorageKey(key, id, executionId as string | undefined)))
  )
}

export function containsLargeValueRef(
  value: unknown,
  seen = new WeakSet<object>()
): LargeValueRef | null {
  if (!value || typeof value !== 'object') return null
  if (isLargeValueRef(value)) return value
  if (seen.has(value)) return null

  seen.add(value)

  if (Array.isArray(value)) {
    for (const item of value) {
      const ref = containsLargeValueRef(item, seen)
      if (ref) return ref
    }
    return null
  }

  for (const entryValue of Object.values(value)) {
    const ref = containsLargeValueRef(entryValue, seen)
    if (ref) return ref
  }

  return null
}

export function getLargeValueMaterializationError(ref: LargeValueRef): Error {
  return new Error(
    `This execution value is too large to inline (${formatLargeValueSize(ref.size)}). Select a nested field or reduce the amount of data passed between blocks.`
  )
}

function formatLargeValueSize(bytes: number): string {
  const megabytes = bytes / (1024 * 1024)
  return `${megabytes.toFixed(1)} MB`
}

export function assertNoLargeValueRefs(value: unknown): void {
  const ref = containsLargeValueRef(value)
  if (ref) {
    throw getLargeValueMaterializationError(ref)
  }
}
