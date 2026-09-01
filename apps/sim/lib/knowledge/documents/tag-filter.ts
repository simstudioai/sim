import { document } from '@sim/db/schema'
import { and, eq, gt, gte, lt, lte, ne, type SQL, sql } from 'drizzle-orm'
import { coerceTagFilterValue, escapeLikePattern } from '@/lib/knowledge/tags/utils'

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

/**
 * Builds a SQL predicate for a single tag filter against the document table.
 *
 * Text comparisons are case-insensitive and date comparisons are evaluated on
 * the calendar day, matching the semantics of the knowledge base search filter
 * (`lib/knowledge/search/queries.ts`). The value is coerced by the same
 * function the tag-value gate validates with, so a value that passed validation
 * always compiles. Returns `undefined` only when the slot, operator, or value is
 * genuinely unusable — which, after validation, is a bug the caller reports
 * rather than a predicate it may skip.
 */
export function buildTagFilterCondition(filter: TagFilterCondition): SQL | undefined {
  if (!ALLOWED_TAG_SLOTS.has(filter.tagSlot)) return undefined

  const col = document[filter.tagSlot as keyof typeof document]

  const coerced = coerceTagFilterValue(filter.value, filter.fieldType)
  if (!coerced.ok) return undefined

  if (filter.fieldType === 'text') {
    const v = coerced.value as string
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
    const num = coerced.value as number
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
        if (filter.valueTo === undefined || filter.valueTo === null) return undefined
        const coercedTo = coerceTagFilterValue(filter.valueTo, 'number')
        if (!coercedTo.ok) return undefined
        const numTo = coercedTo.value as number
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
    const v = coerced.value as string
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
        const coercedTo = coerceTagFilterValue(filter.valueTo, 'date')
        if (!coercedTo.ok) return undefined
        const valueTo = coercedTo.value as string
        return and(sql`${col}::date >= ${v}::date`, sql`${col}::date <= ${valueTo}::date`)
      }
      default:
        return undefined
    }
  }

  if (filter.fieldType === 'boolean') {
    const boolVal = coerced.value as boolean
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
