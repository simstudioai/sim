import { SelectorOptionsUnavailableError } from '@/lib/selectors/server/errors'
import type { SelectorProtectedValues } from '@/lib/selectors/server/types'
import type {
  SafeOptionMeta,
  SafeOptionMetaValue,
  SafeSelectorOption,
  SelectorExecutionResult,
} from '@/lib/selectors/types'

const MAX_OPTIONS = 10_000
const MAX_OPTION_TEXT = 16 * 1024
const MAX_META_FIELDS = 32

function requireSafeString(value: unknown, protectedValues: SelectorProtectedValues): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_OPTION_TEXT) {
    throw new SelectorOptionsUnavailableError()
  }
  if (protectedValues.contains(value)) throw new SelectorOptionsUnavailableError()
  return value
}

function sanitizeMeta(
  value: unknown,
  protectedValues: SelectorProtectedValues
): SafeOptionMeta | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SelectorOptionsUnavailableError()
  }

  const entries = Object.entries(value)
  if (entries.length > MAX_META_FIELDS) throw new SelectorOptionsUnavailableError()
  const meta: SafeOptionMeta = {}
  for (const [key, entry] of entries) {
    if (!key || key.length > 128) throw new SelectorOptionsUnavailableError()
    if (
      entry !== null &&
      typeof entry !== 'string' &&
      typeof entry !== 'number' &&
      typeof entry !== 'boolean'
    ) {
      throw new SelectorOptionsUnavailableError()
    }
    if (typeof entry === 'number' && !Number.isFinite(entry)) {
      throw new SelectorOptionsUnavailableError()
    }
    if (typeof entry === 'string' && protectedValues.contains(entry)) {
      throw new SelectorOptionsUnavailableError()
    }
    meta[key] = entry as SafeOptionMetaValue
  }
  return meta
}

function sanitizeOption(
  value: unknown,
  protectedValues: SelectorProtectedValues
): SafeSelectorOption {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SelectorOptionsUnavailableError()
  }
  const option = value as { id?: unknown; label?: unknown; meta?: unknown }
  const meta = sanitizeMeta(option.meta, protectedValues)
  return {
    id: requireSafeString(option.id, protectedValues),
    label: requireSafeString(option.label, protectedValues),
    ...(meta ? { meta } : {}),
  }
}

export function sanitizeSelectorResult(
  result: SelectorExecutionResult,
  protectedValues: SelectorProtectedValues
): SelectorExecutionResult {
  if (result.kind === 'detail') {
    return {
      kind: 'detail',
      item: result.item ? sanitizeOption(result.item, protectedValues) : null,
    }
  }

  if (result.items.length > MAX_OPTIONS) throw new SelectorOptionsUnavailableError()
  if (result.nextCursor !== undefined) {
    requireSafeString(result.nextCursor, protectedValues)
  }
  return {
    kind: 'list',
    items: result.items.map((item) => sanitizeOption(item, protectedValues)),
    ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
  }
}
