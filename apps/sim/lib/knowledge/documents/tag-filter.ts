import { document } from '@sim/db/schema'
import { and, eq, gt, gte, lt, lte, ne, type SQL, sql } from 'drizzle-orm'
import { parseBooleanValue } from '@/lib/knowledge/tags/utils'

/**
 * A single tag filter applied to a document list query.
 */
export interface TagFilterCondition {
  tagSlot: string
  fieldType: 'text' | 'number' | 'date' | 'boolean'
  operator: string
  value: unknown
  valueTo?: unknown
}

const ALLOWED_TAG_SLOTS = new Set([
  'tag1',
  'tag2',
  'tag3',
  'tag4',
  'tag5',
  'tag6',
  'tag7',
  'number1',
  'number2',
  'number3',
  'number4',
  'number5',
  'date1',
  'date2',
  'boolean1',
  'boolean2',
  'boolean3',
])

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function escapeLikePattern(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

/**
 * Builds a SQL predicate for a single tag filter against the document table.
 *
 * Text comparisons are case-insensitive and date comparisons are evaluated on
 * the calendar day, matching the semantics of the knowledge base search filter
 * (`app/api/knowledge/search/utils.ts`). Returns `undefined` when the slot,
 * operator, or value is not usable so the caller can skip the condition.
 */
export function buildTagFilterCondition(filter: TagFilterCondition): SQL | undefined {
  if (!ALLOWED_TAG_SLOTS.has(filter.tagSlot)) return undefined

  const col = document[filter.tagSlot as keyof typeof document]

  if (filter.fieldType === 'text') {
    const v = String(filter.value ?? '')
    switch (filter.operator) {
      case 'eq':
        return sql`LOWER(${col}) = LOWER(${v})`
      case 'neq':
        return sql`LOWER(${col}) != LOWER(${v})`
      case 'contains': {
        const escaped = escapeLikePattern(v)
        return sql`LOWER(${col}) LIKE LOWER(${`%${escaped}%`}) ESCAPE '\\'`
      }
      case 'not_contains': {
        const escaped = escapeLikePattern(v)
        return sql`LOWER(${col}) NOT LIKE LOWER(${`%${escaped}%`}) ESCAPE '\\'`
      }
      case 'starts_with': {
        const escaped = escapeLikePattern(v)
        return sql`LOWER(${col}) LIKE LOWER(${`${escaped}%`}) ESCAPE '\\'`
      }
      case 'ends_with': {
        const escaped = escapeLikePattern(v)
        return sql`LOWER(${col}) LIKE LOWER(${`%${escaped}`}) ESCAPE '\\'`
      }
      default:
        return undefined
    }
  }

  if (filter.fieldType === 'number') {
    const num = Number(filter.value)
    if (Number.isNaN(num)) return undefined
    switch (filter.operator) {
      case 'eq':
        return eq(col as typeof document.number1, num)
      case 'neq':
        return ne(col as typeof document.number1, num)
      case 'gt':
        return gt(col as typeof document.number1, num)
      case 'gte':
        return gte(col as typeof document.number1, num)
      case 'lt':
        return lt(col as typeof document.number1, num)
      case 'lte':
        return lte(col as typeof document.number1, num)
      case 'between': {
        const numTo = Number(filter.valueTo)
        if (Number.isNaN(numTo)) return undefined
        return and(
          gte(col as typeof document.number1, num),
          lte(col as typeof document.number1, numTo)
        )
      }
      default:
        return undefined
    }
  }

  if (filter.fieldType === 'date') {
    const v = String(filter.value ?? '')
    if (!DATE_ONLY_PATTERN.test(v)) return undefined
    switch (filter.operator) {
      case 'eq':
        return sql`${col}::date = ${v}::date`
      case 'neq':
        return sql`${col}::date != ${v}::date`
      case 'gt':
        return sql`${col}::date > ${v}::date`
      case 'gte':
        return sql`${col}::date >= ${v}::date`
      case 'lt':
        return sql`${col}::date < ${v}::date`
      case 'lte':
        return sql`${col}::date <= ${v}::date`
      case 'between': {
        const valueTo = String(filter.valueTo ?? '')
        if (!DATE_ONLY_PATTERN.test(valueTo)) return undefined
        return and(sql`${col}::date >= ${v}::date`, sql`${col}::date <= ${valueTo}::date`)
      }
      default:
        return undefined
    }
  }

  if (filter.fieldType === 'boolean') {
    const boolVal =
      typeof filter.value === 'boolean' ? filter.value : parseBooleanValue(String(filter.value))
    if (boolVal === null) return undefined
    switch (filter.operator) {
      case 'eq':
        return eq(col as typeof document.boolean1, boolVal)
      case 'neq':
        return ne(col as typeof document.boolean1, boolVal)
      default:
        return undefined
    }
  }

  return undefined
}
