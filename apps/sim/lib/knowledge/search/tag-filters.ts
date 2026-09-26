import { document, embedding } from '@sim/db/schema'
import { and, eq, inArray, type SQL, sql } from 'drizzle-orm'
import { knowledgeAccessCondition } from '@/lib/knowledge/access/predicate'
import { runSearchQuery } from '@/lib/knowledge/search/budget'
import {
  excludeSearchSources,
  getVisibilityConditions,
  hydrateSearchCandidates,
  type LiveSourceAccess,
  SEARCH_READ_CANDIDATE_FIELDS,
  type SearchParams,
  type SearchResult,
  selectAuthorizedSearchResults,
} from '@/lib/knowledge/search/candidates'
import {
  coerceTagFilterValue,
  escapeLikePattern,
  uncompilableTagFilterError,
} from '@/lib/knowledge/tags/utils'
import type { StructuredFilter } from '@/lib/knowledge/types'

/** All valid tag slot keys */
const TAG_SLOT_KEYS = [
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
] as const

type TagSlotKey = (typeof TAG_SLOT_KEYS)[number]

function isTagSlotKey(key: string): key is TagSlotKey {
  return TAG_SLOT_KEYS.includes(key as TagSlotKey)
}

/** The embedding columns a tag filter can compile against, one per tag slot. */
type TagFilterTable = Pick<typeof embedding, TagSlotKey>

/**
 * Build a single SQL condition for a filter. Date values arrive as `YYYY-MM-DD` strings and
 * compare as dates.
 */
function buildFilterCondition(filter: StructuredFilter, embeddingTable: TagFilterTable) {
  const { tagSlot, fieldType, operator, value, valueTo } = filter

  if (!isTagSlotKey(tagSlot)) {
    return null
  }

  const column = embeddingTable[tagSlot]
  if (!column) return null

  if (fieldType === 'text') {
    const coerced = coerceTagFilterValue(value, 'text')
    if (!coerced.ok) return null
    const stringValue = coerced.value as string
    const escaped = escapeLikePattern(stringValue)
    switch (operator) {
      case 'eq':
        return sql`LOWER(${column}) = LOWER(${stringValue})`
      case 'neq':
        return sql`LOWER(${column}) != LOWER(${stringValue})`
      case 'contains':
        return sql`LOWER(${column}) LIKE LOWER(${`%${escaped}%`}) ESCAPE '\\'`
      case 'not_contains':
        return sql`LOWER(${column}) NOT LIKE LOWER(${`%${escaped}%`}) ESCAPE '\\'`
      case 'starts_with':
        return sql`LOWER(${column}) LIKE LOWER(${`${escaped}%`}) ESCAPE '\\'`
      case 'ends_with':
        return sql`LOWER(${column}) LIKE LOWER(${`%${escaped}`}) ESCAPE '\\'`
      default:
        return sql`LOWER(${column}) = LOWER(${stringValue})`
    }
  }

  if (fieldType === 'number') {
    const coerced = coerceTagFilterValue(value, 'number')
    if (!coerced.ok) return null
    const numValue = coerced.value as number

    switch (operator) {
      case 'eq':
        return sql`${column} = ${numValue}`
      case 'neq':
        return sql`${column} != ${numValue}`
      case 'gt':
        return sql`${column} > ${numValue}`
      case 'gte':
        return sql`${column} >= ${numValue}`
      case 'lt':
        return sql`${column} < ${numValue}`
      case 'lte':
        return sql`${column} <= ${numValue}`
      case 'between':
        if (valueTo !== undefined) {
          const coercedTo = coerceTagFilterValue(valueTo, 'number')
          if (!coercedTo.ok) return sql`${column} = ${numValue}`
          return sql`${column} >= ${numValue} AND ${column} <= ${coercedTo.value as number}`
        }
        return sql`${column} = ${numValue}`
      default:
        return sql`${column} = ${numValue}`
    }
  }

  if (fieldType === 'date') {
    const coerced = coerceTagFilterValue(value, 'date')
    if (!coerced.ok) return null
    const dateStr = coerced.value as string

    switch (operator) {
      case 'eq':
        return sql`${column}::date = ${dateStr}::date`
      case 'neq':
        return sql`${column}::date != ${dateStr}::date`
      case 'gt':
        return sql`${column}::date > ${dateStr}::date`
      case 'gte':
        return sql`${column}::date >= ${dateStr}::date`
      case 'lt':
        return sql`${column}::date < ${dateStr}::date`
      case 'lte':
        return sql`${column}::date <= ${dateStr}::date`
      case 'between':
        if (valueTo !== undefined) {
          const coercedTo = coerceTagFilterValue(valueTo, 'date')
          if (!coercedTo.ok) {
            return sql`${column}::date = ${dateStr}::date`
          }
          const dateStrTo = coercedTo.value as string
          return sql`${column}::date >= ${dateStr}::date AND ${column}::date <= ${dateStrTo}::date`
        }
        return sql`${column}::date = ${dateStr}::date`
      default:
        return sql`${column}::date = ${dateStr}::date`
    }
  }

  if (fieldType === 'boolean') {
    const coerced = coerceTagFilterValue(value, 'boolean')
    if (!coerced.ok) return null
    const boolValue = coerced.value as boolean
    switch (operator) {
      case 'eq':
        return sql`${column} = ${boolValue}`
      case 'neq':
        return sql`${column} != ${boolValue}`
      default:
        return sql`${column} = ${boolValue}`
    }
  }

  return sql`${column} = ${value}`
}

/**
 * Build SQL conditions from structured filters with operator support. Every
 * filter is a conjunct, including two that name the same tag.
 *
 * Search used to group filters by slot and OR same-slot conditions together,
 * which made the two surfaces over the same tag vocabulary answer different
 * questions: the document list ANDs every filter, so `gte 9` plus `lte 2` on one
 * number tag returned nothing there and a full page of results from search —
 * a widening on the billed endpoint, the same failure mode as dropping a filter.
 * OR also made a range on a single text tag (`contains A` and `contains B`)
 * inexpressible, while the union it produced stays reachable as separate
 * searches. Neither contract ever documented the OR, so no caller could have
 * been relying on it deliberately.
 *
 * Every filter reaching here has already been validated, so one that fails to
 * compile is a defect rather than a predicate to skip. Skipping it dropped the
 * tag term from the WHERE clause entirely and answered a filtered search with
 * the whole knowledge base under a 200 — and search is billed, so the caller
 * paid for the widened scan. It is reported as a validation failure instead.
 */
export function getStructuredTagFilters(
  filters: StructuredFilter[],
  embeddingTable: TagFilterTable
) {
  return filters.map((filter) => {
    const condition = buildFilterCondition(filter, embeddingTable)
    if (condition === null) throw uncompilableTagFilterError(filter)
    return condition
  })
}

/**
 * Tags live on chunks, so a row qualifies when a chunk it joins to carries them — and only a
 * chunk the search can actually return counts, or a document whose sole match is disabled would
 * be admitted by a check that ranking then discards.
 */
export function chunkTagCondition(join: SQL, tagConditions: SQL[]): SQL | undefined {
  if (!tagConditions.length) return undefined
  return sql`EXISTS (
    SELECT 1 FROM ${embedding}
    WHERE ${and(join, eq(embedding.enabled, true), ...tagConditions)}
  )`
}

/**
 * Tag-only candidates in id order under a candidate predicate, hydrated under the full read
 * predicate once any live source proof a page needs is known.
 */
export function selectAuthorizedTagResults(
  params: SearchParams,
  candidateAccess: SQL,
  liveSourceAccess: LiveSourceAccess | undefined
): Promise<SearchResult[]> {
  const conditions = [
    inArray(embedding.knowledgeBaseId, params.knowledgeBaseIds),
    ...getStructuredTagFilters(params.structuredFilters ?? [], embedding),
  ]
  return selectAuthorizedSearchResults({
    leg: 'tags',
    access: params.access,
    liveSourceAccess,
    signal: params.signal,
    budget: params.budget,
    topK: params.topK,
    selectPage: async (limit, offset, excludedSources) => {
      const candidates = await runSearchQuery(params.budget, 'tags.sql', (executor) =>
        executor
          .select(SEARCH_READ_CANDIDATE_FIELDS)
          .from(embedding)
          .innerJoin(document, eq(embedding.documentId, document.id))
          .where(
            and(
              ...conditions,
              ...getVisibilityConditions(params.filters, candidateAccess),
              excludeSearchSources(excludedSources)
            )
          )
          .orderBy(embedding.id)
          .limit(limit)
          .offset(offset)
      )
      return { candidates, nextOffset: offset + candidates.length }
    },
    hydrate: (ids, authorized) =>
      hydrateSearchCandidates(
        ids,
        knowledgeAccessCondition(authorized),
        sql<number>`0`.as('distance'),
        params.filters,
        conditions,
        'tags',
        params.budget
      ),
  })
}
