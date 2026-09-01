import { OrchestrationError } from '@/lib/core/orchestration/types'

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** Field types a tag filter value can be compiled for. */
export type TagFilterFieldType = 'text' | 'number' | 'date' | 'boolean'

export type TagFilterValueCoercion =
  | { ok: true; value: string | number | boolean }
  | { ok: false; reason: 'number' | 'date-format' | 'date-calendar' | 'boolean' }

/**
 * Coerces a raw tag filter value into the typed value its SQL predicate
 * compares against.
 *
 * This is the only place a filter value is parsed. `validateTagValue` reports
 * the failures it returns, and both filter builders — the document list
 * (`lib/knowledge/documents/tag-filter.ts`) and search
 * (`lib/knowledge/search/queries.ts`) — consume the value it produces. Sharing
 * one parse is what makes "the gate accepted this value" and "the predicate
 * compiled that same value" a single fact. Three independent parses used to
 * disagree: a boolean `"TRUE"` passed the gate, matched `= true` on the
 * document list and `= false` on search, and a date carrying a leading space
 * passed the gate (which trimmed) but compiled to no predicate at all on the
 * document list (which did not), returning the whole knowledge base under a
 * 200.
 */
export function coerceTagFilterValue(
  value: unknown,
  fieldType: TagFilterFieldType
): TagFilterValueCoercion {
  switch (fieldType) {
    case 'text':
      return { ok: true, value: String(value ?? '') }
    case 'number': {
      const numValue = typeof value === 'number' ? value : Number(String(value ?? '').trim())
      if (Number.isNaN(numValue)) return { ok: false, reason: 'number' }
      return { ok: true, value: numValue }
    }
    case 'date': {
      const stringValue = String(value ?? '').trim()
      if (!DATE_ONLY_PATTERN.test(stringValue)) return { ok: false, reason: 'date-format' }
      const [year, month, day] = stringValue.split('-').map(Number)
      const date = new Date(year, month - 1, day)
      if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
        return { ok: false, reason: 'date-calendar' }
      }
      return { ok: true, value: stringValue }
    }
    case 'boolean': {
      if (typeof value === 'boolean') return { ok: true, value }
      const lowerValue = String(value ?? '')
        .trim()
        .toLowerCase()
      if (lowerValue === 'true') return { ok: true, value: true }
      if (lowerValue === 'false') return { ok: true, value: false }
      return { ok: false, reason: 'boolean' }
    }
  }
}

/**
 * Escapes the LIKE metacharacters in a tag filter value so a `%` or `_` a
 * caller typed matches itself instead of acting as a wildcard. Both filter
 * builders pair this with `ESCAPE '\'`.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

/**
 * The failure raised when a validated tag filter still fails to compile to a
 * SQL predicate.
 *
 * Both filter builders return "no predicate" for a filter they cannot compile,
 * and both consumers used to skip it. A skipped predicate does not narrow
 * anything, so a filtered read answered 200 with every row the caller could
 * see. Once validation has passed, that state is a defect in this code — not an
 * input a surface may quietly ignore — so it is surfaced as a validation
 * failure the caller can act on.
 */
export function uncompilableTagFilterError(filter: {
  tagSlot: string
  fieldType: string
  operator: string
}): OrchestrationError {
  return new OrchestrationError(
    'validation',
    `Tag filter on slot "${filter.tagSlot}" could not be applied (field type "${filter.fieldType}", operator "${filter.operator}")`
  )
}

/**
 * Validate a tag value against its expected field type
 * Returns an error message if invalid, or null if valid
 */
export function validateTagValue(tagName: string, value: string, fieldType: string): string | null {
  if (fieldType !== 'boolean' && fieldType !== 'number' && fieldType !== 'date') return null

  const coerced = coerceTagFilterValue(value, fieldType)
  if (coerced.ok) return null

  switch (coerced.reason) {
    case 'boolean':
      return `Tag "${tagName}" expects a boolean value (true/false), but received "${value}"`
    case 'number':
      return `Tag "${tagName}" expects a number value, but received "${value}"`
    case 'date-format':
      return `Tag "${tagName}" expects a date in YYYY-MM-DD format, but received "${value}"`
    case 'date-calendar':
      return `Tag "${tagName}" has an invalid date: "${value}"`
  }
}

/**
 * Build error message for undefined tags
 */
export function buildUndefinedTagsError(undefinedTags: string[]): string {
  const tagList = undefinedTags.map((t) => `"${t}"`).join(', ')
  return `The following tags are not defined in this knowledge base: ${tagList}. Please define them at the knowledge base level first.`
}

/**
 * Parse a string to number with strict validation
 * Returns null if invalid
 */
export function parseNumberValue(value: string): number | null {
  const num = Number(value)
  return Number.isNaN(num) ? null : num
}

/**
 * Parse a string to Date with strict YYYY-MM-DD validation
 * Returns null if invalid format or invalid date
 */
export function parseDateValue(value: string): Date | null {
  const stringValue = String(value).trim()

  if (!/^\d{4}-\d{2}-\d{2}$/.test(stringValue)) {
    return null
  }

  // Validate the date is actually valid (e.g., reject 2024-02-31)
  const [year, month, day] = stringValue.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null
  }

  return date
}

/**
 * Parse a string to boolean with strict validation
 * Returns null if not 'true' or 'false'
 */
export function parseBooleanValue(value: string): boolean | null {
  const lowerValue = String(value).trim().toLowerCase()
  if (lowerValue === 'true') return true
  if (lowerValue === 'false') return false
  return null
}
