import { db } from '@sim/db'
import { document, embedding, knowledgeConnector } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage, getPostgresErrorCode } from '@sim/utils/errors'
import { and, eq, inArray, isNull, type SQL, sql } from 'drizzle-orm'
import { knowledgeAccessCondition } from '@/lib/knowledge/access/predicate'
import type { KnowledgeAccessScope } from '@/lib/knowledge/access/types'
import type { KbEmbeddingDimensions } from '@/lib/knowledge/embedding-models'
import { workspaceSearchFilterConditions } from '@/lib/knowledge/search/filter-conditions'
import type { WorkspaceSearchFilters } from '@/lib/knowledge/search/filters'
import { applyRecencyBoost, RRF_K } from '@/lib/knowledge/search/recency'
import {
  coerceTagFilterValue,
  escapeLikePattern,
  uncompilableTagFilterError,
} from '@/lib/knowledge/tags/utils'
import type { StructuredFilter } from '@/lib/knowledge/types'
import { embeddingDistance } from '@/lib/knowledge/vector-columns'

const logger = createLogger('KnowledgeSearchQueries')

/** SQLSTATE for an unrecognised configuration parameter — pgvector older than 0.8. */
const UNDEFINED_OBJECT_SQLSTATE = '42704'
/** Tuples a relaxed-order scan may visit before giving up on filling the limit. */
const HNSW_MAX_SCAN_TUPLES = '20000'

/** How long to stop trying the iterative-scan settings after the server rejected them. */
const HNSW_SETTINGS_UNSUPPORTED_RETRY_MS = 10 * 60 * 1000

let hnswSettingsUnsupportedUntil = 0

type SearchExecutor = Pick<typeof db, 'select'>

/**
 * Shared HNSW indexes can be selective on KB scope, access, or tags, even for
 * small workspace searches. Iterative scans keep looking within a bounded
 * tuple budget. A transaction keeps the settings local under pooled connections;
 * older extensions retry without tuning until the compatibility cooldown expires.
 */
async function withVectorScanSettings<T>(
  run: (executor: SearchExecutor) => Promise<T>
): Promise<T> {
  if (Date.now() < hnswSettingsUnsupportedUntil) return run(db)
  let applyingSettings = false
  try {
    return await db.transaction(async (tx) => {
      applyingSettings = true
      await tx.execute(
        sql`SELECT set_config('hnsw.iterative_scan', 'relaxed_order', true), set_config('hnsw.max_scan_tuples', ${HNSW_MAX_SCAN_TUPLES}, true)`
      )
      applyingSettings = false
      return run(tx)
    })
  } catch (error) {
    if (!applyingSettings || getPostgresErrorCode(error) !== UNDEFINED_OBJECT_SQLSTATE) throw error
    hnswSettingsUnsupportedUntil = Date.now() + HNSW_SETTINGS_UNSUPPORTED_RETRY_MS
    logger.warn('pgvector iterative scan is unavailable; vector legs run without it', {
      error: getErrorMessage(error),
    })
    return run(db)
  }
}

export interface DocumentMetadata {
  filename: string
  sourceUrl: string | null
  /** When the source last changed the document; null for uploads and sources that do not say. */
  sourceModifiedAt: Date | null
  /** The connector the document was synced through; null for an upload. */
  connectorType: string | null
}

/**
 * Batch-fetch display metadata for documents referenced by search results.
 * Applies the same visibility and access predicates as the search SQL itself,
 * so the lookup never surfaces a filename for a row the caller could not have
 * matched. Returns a map keyed by document id; missing ids indicate the
 * document is no longer visible and should be skipped.
 */
export async function getDocumentMetadataByIds(
  documentIds: string[],
  access: KnowledgeAccessScope
): Promise<Record<string, DocumentMetadata>> {
  if (documentIds.length === 0) {
    return {}
  }

  const uniqueIds = [...new Set(documentIds)]
  const documents = await db
    .select({
      id: document.id,
      filename: document.filename,
      sourceUrl: document.sourceUrl,
      sourceModifiedAt: document.sourceModifiedAt,
      connectorType: knowledgeConnector.connectorType,
    })
    .from(document)
    .leftJoin(knowledgeConnector, eq(knowledgeConnector.id, document.connectorId))
    .where(
      and(
        inArray(document.id, uniqueIds),
        eq(document.userExcluded, false),
        isNull(document.archivedAt),
        isNull(document.deletedAt),
        knowledgeAccessCondition(access)
      )
    )

  const map: Record<string, DocumentMetadata> = {}
  documents.forEach((doc) => {
    map[doc.id] = {
      filename: doc.filename,
      sourceUrl: doc.sourceUrl ?? null,
      sourceModifiedAt: doc.sourceModifiedAt ?? null,
      connectorType: doc.connectorType ?? null,
    }
  })

  return map
}

export interface SearchResult {
  id: string
  content: string
  documentId: string
  chunkIndex: number
  // Text tags
  tag1: string | null
  tag2: string | null
  tag3: string | null
  tag4: string | null
  tag5: string | null
  tag6: string | null
  tag7: string | null
  // Number tags (5 slots)
  number1: number | null
  number2: number | null
  number3: number | null
  number4: number | null
  number5: number | null
  // Date tags (2 slots)
  date1: Date | null
  date2: Date | null
  // Boolean tags (3 slots)
  boolean1: boolean | null
  boolean2: boolean | null
  boolean3: boolean | null
  distance: number
  knowledgeBaseId: string
  /** When the source last changed the document; NULL for uploads and sources that do not say. */
  sourceModifiedAt: Date | null
}

/**
 * A query embedding and the width it was produced at. The two travel together
 * because the width selects both the pgvector column the comparison reads and
 * the index form it has to be written in; a vector without it cannot be
 * compared against anything.
 */
export interface KnowledgeQueryVector {
  /** JSON array literal of the embedding, in pgvector's text input format. */
  vector: string
  dimensions: KbEmbeddingDimensions
}

export interface SearchParams {
  knowledgeBaseIds: string[]
  topK: number
  /** What the caller may read; every leg applies it. Required so no leg can be written without it. */
  access: KnowledgeAccessScope
  structuredFilters?: StructuredFilter[]
  filters?: WorkspaceSearchFilters
  queryVector?: KnowledgeQueryVector
  distanceThreshold?: number
}

/** All valid tag slot keys */
const TAG_SLOT_KEYS = [
  // Text tags (7 slots)
  'tag1',
  'tag2',
  'tag3',
  'tag4',
  'tag5',
  'tag6',
  'tag7',
  // Number tags (5 slots)
  'number1',
  'number2',
  'number3',
  'number4',
  'number5',
  // Date tags (2 slots)
  'date1',
  'date2',
  // Boolean tags (3 slots)
  'boolean1',
  'boolean2',
  'boolean3',
] as const

type TagSlotKey = (typeof TAG_SLOT_KEYS)[number]

function isTagSlotKey(key: string): key is TagSlotKey {
  return TAG_SLOT_KEYS.includes(key as TagSlotKey)
}

/** Common fields selected for search results */
const getSearchResultFields = (distanceExpr: any) => ({
  id: embedding.id,
  content: embedding.content,
  documentId: embedding.documentId,
  chunkIndex: embedding.chunkIndex,
  // Text tags
  tag1: embedding.tag1,
  tag2: embedding.tag2,
  tag3: embedding.tag3,
  tag4: embedding.tag4,
  tag5: embedding.tag5,
  tag6: embedding.tag6,
  tag7: embedding.tag7,
  // Number tags (5 slots)
  number1: embedding.number1,
  number2: embedding.number2,
  number3: embedding.number3,
  number4: embedding.number4,
  number5: embedding.number5,
  // Date tags (2 slots)
  date1: embedding.date1,
  date2: embedding.date2,
  // Boolean tags (3 slots)
  boolean1: embedding.boolean1,
  boolean2: embedding.boolean2,
  boolean3: embedding.boolean3,
  distance: distanceExpr,
  knowledgeBaseId: embedding.knowledgeBaseId,
  sourceModifiedAt: document.sourceModifiedAt,
})

/**
 * Build a single SQL condition for a filter
 */
function buildFilterCondition(filter: StructuredFilter, embeddingTable: any) {
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

  // Date values arrive as YYYY-MM-DD strings from the frontend.
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
export function getStructuredTagFilters(filters: StructuredFilter[], embeddingTable: any) {
  return filters.map((filter) => {
    const condition = buildFilterCondition(filter, embeddingTable)
    if (condition === null) throw uncompilableTagFilterError(filter)
    return condition
  })
}

/**
 * Text-search configuration used to build the query. Must match the config the
 * generated `embedding.content_tsv` column was built with
 * (`to_tsvector('english', content)`) — a mismatch silently stops Postgres from
 * using the `emb_content_fts_idx` GIN index and degrades to a sequential scan.
 */
const FTS_CONFIG = 'english'

/**
 * Row visibility predicates shared by every search leg: a chunk is only
 * retrievable when both it and its document are enabled, the document finished
 * processing, it has not been excluded, archived, or soft-deleted, and its ACL
 * overlaps the caller's tokens. Every leg spreads this helper rather than
 * listing the predicates itself, so no leg can drift from the others.
 */
function getVisibilityConditions(access: KnowledgeAccessScope, filters?: WorkspaceSearchFilters) {
  return [
    eq(embedding.enabled, true),
    eq(document.enabled, true),
    eq(document.processingStatus, 'completed'),
    eq(document.userExcluded, false),
    isNull(document.archivedAt),
    isNull(document.deletedAt),
    knowledgeAccessCondition(access),
    ...workspaceSearchFilterConditions(filters),
  ]
}

/** Candidates each hybrid leg retrieves before the fused list is trimmed to `topK`. */
const HYBRID_CANDIDATE_MIN = 50
const HYBRID_CANDIDATE_MAX = 200
export function hybridCandidateCount(topK: number): number {
  return Math.min(Math.max(topK * 3, HYBRID_CANDIDATE_MIN), HYBRID_CANDIDATE_MAX)
}

export function getQueryStrategy(kbCount: number, topK: number) {
  const useParallel = kbCount > 4 || (kbCount > 2 && topK > 50)
  const distanceThreshold = kbCount > 3 ? 0.8 : 1.0
  const parallelLimit = Math.ceil(topK / kbCount) + 5

  return {
    useParallel,
    distanceThreshold,
    parallelLimit,
    singleQueryOptimized: kbCount <= 2,
  }
}

export async function handleTagOnlySearch(params: SearchParams): Promise<SearchResult[]> {
  const { knowledgeBaseIds, topK, structuredFilters, access } = params

  if (!structuredFilters || structuredFilters.length === 0) {
    throw new Error('Tag filters are required for tag-only search')
  }

  const strategy = getQueryStrategy(knowledgeBaseIds.length, topK)
  const tagFilterConditions = getStructuredTagFilters(structuredFilters, embedding)

  if (strategy.useParallel) {
    const parallelLimit = Math.ceil(topK / knowledgeBaseIds.length) + 5

    const queryPromises = knowledgeBaseIds.map(async (kbId) => {
      return await db
        .select(getSearchResultFields(sql<number>`0`.as('distance')))
        .from(embedding)
        .innerJoin(document, eq(embedding.documentId, document.id))
        .where(
          and(
            eq(embedding.knowledgeBaseId, kbId),
            ...getVisibilityConditions(access, params.filters),
            ...tagFilterConditions
          )
        )
        .limit(parallelLimit)
    })

    const parallelResults = await Promise.all(queryPromises)
    return parallelResults.flat().slice(0, topK)
  }
  // Single query for fewer KBs
  return await db
    .select(getSearchResultFields(sql<number>`0`.as('distance')))
    .from(embedding)
    .innerJoin(document, eq(embedding.documentId, document.id))
    .where(
      and(
        inArray(embedding.knowledgeBaseId, knowledgeBaseIds),
        ...getVisibilityConditions(access, params.filters),
        ...tagFilterConditions
      )
    )
    .limit(topK)
}

export async function handleVectorOnlySearch(params: SearchParams): Promise<SearchResult[]> {
  const { knowledgeBaseIds, topK, queryVector, distanceThreshold, access } = params

  if (!queryVector || !distanceThreshold) {
    throw new Error('Query vector and distance threshold are required for vector-only search')
  }

  const strategy = getQueryStrategy(knowledgeBaseIds.length, topK)

  const distance = embeddingDistance(queryVector.dimensions, queryVector.vector)
  const distanceExpr = distance.as('distance')
  const vectorLeg = (executor: SearchExecutor, kbScope: SQL | undefined, limit: number) =>
    executor
      .select(getSearchResultFields(distanceExpr))
      .from(embedding)
      .innerJoin(document, eq(embedding.documentId, document.id))
      .where(
        and(
          kbScope,
          ...getVisibilityConditions(access, params.filters),
          sql`${distance} < ${distanceThreshold}`
        )
      )
      .orderBy(distance)
      .limit(limit)

  /**
   * A relaxed-order iterative scan may hand rows back slightly out of distance
   * order, so both paths re-sort in memory before trimming to `topK`.
   */
  if (strategy.useParallel) {
    const parallelLimit = Math.ceil(topK / knowledgeBaseIds.length) + 5
    const allResults = await withVectorScanSettings(async (executor) => {
      const parallelResults = await Promise.all(
        knowledgeBaseIds.map((kbId) =>
          vectorLeg(executor, eq(embedding.knowledgeBaseId, kbId), parallelLimit)
        )
      )
      return parallelResults.flat()
    })
    return allResults.sort((a, b) => a.distance - b.distance).slice(0, topK)
  }
  const rows = await withVectorScanSettings((executor) =>
    vectorLeg(executor, inArray(embedding.knowledgeBaseId, knowledgeBaseIds), topK)
  )
  return rows.sort((a, b) => a.distance - b.distance)
}

export interface KeywordSearchParams {
  knowledgeBaseIds: string[]
  topK: number
  access: KnowledgeAccessScope
  query: string
  /** Query embedding, so keyword-only hits still carry a real cosine distance. */
  queryVector: KnowledgeQueryVector
  structuredFilters?: StructuredFilter[]
  filters?: WorkspaceSearchFilters
}

/**
 * Lexical (full-text) retrieval leg. Matches chunks against the generated
 * `content_tsv` column via `websearch_to_tsquery`, which tolerates arbitrary
 * user input and supports quoted phrases and `-negation`.
 *
 * Results carry the true cosine distance rather than a placeholder, so callers
 * can report `similarity` for rows only the lexical leg found. Unlike the vector
 * leg there is no distance threshold — surfacing exact-token matches that are
 * semantically distant is the entire point of this leg.
 *
 * Candidate gathering mirrors the vector leg's `getQueryStrategy`: across many
 * knowledge bases a single global `LIMIT` lets whichever base ranks strongest
 * lexically consume every slot, so an exact-token hit in a smaller base would
 * never reach fusion. Both legs must draw candidates the same way, or rank
 * fusion is combining rankings taken over differently-shaped pools.
 *
 * Ranking and hydration are two steps on purpose. Projecting the cosine
 * distance in the ranking query makes Postgres detoast the chunk's vector and
 * compute a distance for *every* full-text match before the `LIMIT`
 * applies — work that scales with how common the query term is rather than
 * with `topK` (measured at ~59x the buffer reads on a 20k-chunk base for a term
 * matching every row). Ranking therefore touches no vectors, and only the rows
 * that survive the limit are hydrated.
 */
export async function executeKeywordSearch(params: KeywordSearchParams): Promise<SearchResult[]> {
  const { knowledgeBaseIds, topK, query, queryVector, structuredFilters, access } = params

  if (!query.trim()) {
    return []
  }

  const tsQuery = sql`websearch_to_tsquery(${FTS_CONFIG}, ${query})`
  const rankExpr = sql<number>`ts_rank_cd(${embedding.contentTsv}, ${tsQuery})`
  const tagFilterConditions = structuredFilters?.length
    ? getStructuredTagFilters(structuredFilters, embedding)
    : []

  const rankConditions = (kbScope: SQL | undefined) =>
    and(
      kbScope,
      ...getVisibilityConditions(access, params.filters),
      sql`${embedding.contentTsv} @@ ${tsQuery}`,
      ...tagFilterConditions
    )

  /** Ranking pass: ids and relevance only, so no vector is read. */
  const rankRows = (kbScope: SQL | undefined, limit: number) =>
    db
      .select({ id: embedding.id, keywordRank: rankExpr.as('keyword_rank') })
      .from(embedding)
      .innerJoin(document, eq(embedding.documentId, document.id))
      .where(rankConditions(kbScope))
      .orderBy(sql`${rankExpr} DESC`)
      .limit(limit)

  const strategy = getQueryStrategy(knowledgeBaseIds.length, topK)

  let ranked: { id: string; keywordRank: number }[]
  if (strategy.useParallel) {
    const parallelLimit = Math.ceil(topK / knowledgeBaseIds.length) + 5
    const perBase = await Promise.all(
      knowledgeBaseIds.map((kbId) => rankRows(eq(embedding.knowledgeBaseId, kbId), parallelLimit))
    )
    ranked = perBase.flat().sort((a, b) => b.keywordRank - a.keywordRank)
  } else {
    ranked = await rankRows(inArray(embedding.knowledgeBaseId, knowledgeBaseIds), topK)
  }

  const topIds = ranked.slice(0, topK).map((row) => row.id)
  if (topIds.length === 0) {
    return []
  }

  /** Hydration pass: full rows plus the cosine distance, bounded to the survivors. */
  const hydrated = await db
    .select(
      getSearchResultFields(
        embeddingDistance(queryVector.dimensions, queryVector.vector).as('distance')
      )
    )
    .from(embedding)
    .innerJoin(document, eq(embedding.documentId, document.id))
    .where(and(inArray(embedding.id, topIds), ...getVisibilityConditions(access, params.filters)))

  const rowById = new Map(hydrated.map((row) => [row.id, row]))
  return topIds.map((id) => rowById.get(id)).filter((row): row is SearchResult => row !== undefined)
}

/**
 * Fuse independently-ranked result lists by reciprocal rank:
 * `score(row) = Σ 1 / (RRF_K + rank)` across the lists it appears in.
 *
 * Rank fusion is used rather than score normalization because cosine distance
 * and `ts_rank_cd` are on incomparable scales with no corpus-independent
 * mapping between them. Rows are deduped by chunk id, first occurrence wins.
 *
 * Equal scores are common and must not be broken by list order: rank *n* in one
 * leg always ties rank *n* in every other leg, so sorting alone would let the
 * first list monopolize the head of the output and starve the others entirely
 * at small `topK`. Selection therefore drains each tie group round-robin,
 * preferring the candidate whose least-served leg has been served least.
 *
 * A row is credited to *every* leg that returned it, not to one chosen leg: it
 * satisfied all of them, and charging a shared hit to a single leg would leave
 * the round-robin owing the other one a slot it has already been served —
 * which at small `topK` evicts a row only the shared hit's leg could produce.
 * A total tie goes to the earliest list, so callers put the leg whose hits the
 * other leg cannot produce first.
 */
export function fuseByReciprocalRank(rankedLists: SearchResult[][], topK: number): SearchResult[] {
  const scores = new Map<string, number>()
  const rowById = new Map<string, SearchResult>()
  const legsOfRow = new Map<string, number[]>()

  rankedLists.forEach((list, leg) => {
    list.forEach((row, index) => {
      scores.set(row.id, (scores.get(row.id) ?? 0) + 1 / (RRF_K + index + 1))
      if (!rowById.has(row.id)) {
        rowById.set(row.id, row)
      }
      const legs = legsOfRow.get(row.id)
      if (legs) {
        if (!legs.includes(leg)) legs.push(leg)
      } else {
        legsOfRow.set(row.id, [leg])
      }
    })
  })

  // Stable sort keeps rowById insertion order (earliest leg first) inside each tie group.
  const ordered = [...rowById.values()].sort(
    (a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0)
  )

  const contributed = rankedLists.map(() => 0)
  /** How starved a candidate's most-neglected leg is; lower wins the tie. */
  const starvation = (id: string) =>
    Math.min(...(legsOfRow.get(id) ?? [0]).map((leg) => contributed[leg]))

  const fused: SearchResult[] = []
  let groupStart = 0

  while (groupStart < ordered.length && fused.length < topK) {
    const groupScore = scores.get(ordered[groupStart].id) ?? 0
    let groupEnd = groupStart
    while (groupEnd < ordered.length && (scores.get(ordered[groupEnd].id) ?? 0) === groupScore) {
      groupEnd++
    }

    const group = ordered.slice(groupStart, groupEnd)
    while (group.length > 0 && fused.length < topK) {
      let pick = 0
      for (let i = 1; i < group.length; i++) {
        if (starvation(group[i].id) < starvation(group[pick].id)) {
          pick = i
        }
      }
      const [row] = group.splice(pick, 1)
      fused.push(row)
      for (const leg of legsOfRow.get(row.id) ?? []) {
        contributed[leg]++
      }
    }

    groupStart = groupEnd
  }

  return fused
}

export async function handleTagAndVectorSearch(params: SearchParams): Promise<SearchResult[]> {
  const { knowledgeBaseIds, topK, structuredFilters, queryVector, distanceThreshold, access } =
    params

  if (!structuredFilters || structuredFilters.length === 0) {
    throw new Error('Tag filters are required for tag and vector search')
  }
  if (!queryVector || !distanceThreshold) {
    throw new Error('Query vector and distance threshold are required for tag and vector search')
  }

  const tagFilterConditions = getStructuredTagFilters(structuredFilters, embedding)
  const distance = embeddingDistance(queryVector.dimensions, queryVector.vector)
  const rows = await withVectorScanSettings((executor) =>
    executor
      .select(getSearchResultFields(distance.as('distance')))
      .from(embedding)
      .innerJoin(document, eq(embedding.documentId, document.id))
      .where(
        and(
          inArray(embedding.knowledgeBaseId, knowledgeBaseIds),
          ...getVisibilityConditions(access, params.filters),
          ...tagFilterConditions,
          sql`${distance} < ${distanceThreshold}`
        )
      )
      .orderBy(distance)
      .limit(topK)
  )
  return rows.sort((a, b) => a.distance - b.distance)
}

/**
 * `hybrid` fuses lexical and vector retrieval; `vector` is the legacy
 * semantic-only path, kept as an opt-out.
 */
export type KnowledgeSearchMode = 'hybrid' | 'vector'

export interface ExecuteKnowledgeSearchParams {
  knowledgeBaseIds: string[]
  /** Candidate count each leg retrieves and the fused list is trimmed to. */
  topK: number
  /** What the caller may read; resolved from the principal by the use case, never from input. */
  access: KnowledgeAccessScope
  searchMode: KnowledgeSearchMode
  /** Lets a recently modified document edge past a stale one of similar relevance; off by default. */
  boostRecency?: boolean
  query?: string
  /** Required whenever `query` is present. */
  queryVector?: KnowledgeQueryVector
  structuredFilters?: StructuredFilter[]
  filters?: WorkspaceSearchFilters
}

/**
 * Single retrieval entry point shared by the internal and v1 search routes.
 * Callers remain responsible for auth, embedding generation, billing, and for
 * rejecting requests that carry neither a query nor tag filters.
 */
export async function executeKnowledgeSearch(
  params: ExecuteKnowledgeSearchParams
): Promise<SearchResult[]> {
  const {
    knowledgeBaseIds,
    topK,
    searchMode,
    query,
    queryVector,
    structuredFilters,
    access,
    boostRecency = false,
  } = params

  const hasQuery = Boolean(query?.trim())
  const hasFilters = Boolean(structuredFilters && structuredFilters.length > 0)

  if (!hasQuery) {
    if (!hasFilters) {
      throw new Error('A search query or tag filters are required')
    }
    return await handleTagOnlySearch({
      knowledgeBaseIds,
      topK,
      structuredFilters,
      access,
      filters: params.filters,
    })
  }

  if (!queryVector) {
    throw new Error('Query vector is required when searching with a query')
  }

  const { distanceThreshold } = getQueryStrategy(knowledgeBaseIds.length, topK)
  /**
   * Hybrid fuses two rankings, so each leg retrieves more than the caller
   * asked for: a chunk that both legs rank just below `topK` is a strong
   * signal the fused list must be able to surface.
   */
  const legTopK = searchMode === 'hybrid' ? hybridCandidateCount(topK) : topK

  const vectorSearch = hasFilters
    ? handleTagAndVectorSearch({
        knowledgeBaseIds,
        topK: legTopK,
        structuredFilters,
        queryVector,
        distanceThreshold,
        access,
        filters: params.filters,
      })
    : handleVectorOnlySearch({
        knowledgeBaseIds,
        topK: legTopK,
        queryVector,
        distanceThreshold,
        access,
        filters: params.filters,
      })

  if (searchMode === 'vector') {
    const results = await vectorSearch
    return boostRecency ? applyRecencyBoost(results) : results
  }

  /**
   * The lexical leg is best-effort: a failure there falls back to vector-only
   * results rather than failing the whole search.
   */
  const keywordSearch = executeKeywordSearch({
    knowledgeBaseIds,
    topK: legTopK,
    query: query!,
    queryVector,
    structuredFilters,
    access,
    filters: params.filters,
  }).catch((error) => {
    logger.warn('Keyword search leg failed; falling back to vector-only results', {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return [] as SearchResult[]
  })

  const [vectorResults, keywordResults] = await Promise.all([vectorSearch, keywordSearch])

  /**
   * Lexical leg first: on a total tie it wins, which is the behavior this mode
   * exists for — an exact-token chunk the vector leg ranked below its distance
   * threshold is precisely what a caller opted into hybrid to recover, and at
   * `topK: 1` something has to win.
   */
  const fused = fuseByReciprocalRank([keywordResults, vectorResults], topK)
  return boostRecency ? applyRecencyBoost(fused) : fused
}
