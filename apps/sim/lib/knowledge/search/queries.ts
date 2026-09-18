import { db } from '@sim/db'
import {
  document,
  embedding,
  embeddingKeywordSearch,
  embeddingSearch,
  knowledgeConnector,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage, getPostgresErrorCode } from '@sim/utils/errors'
import { and, eq, inArray, isNull, type SQL, sql } from 'drizzle-orm'
import {
  knowledgeAccessCondition,
  knowledgeMetadataCandidateAccessCondition,
  textArrayLiteral,
} from '@/lib/knowledge/access/predicate'
import type { KnowledgeAccessProvider, KnowledgeAccessScope } from '@/lib/knowledge/access/types'
import type { KbEmbeddingDimensions } from '@/lib/knowledge/embedding-models'
import {
  type RetrievalLeg,
  runSearchQuery,
  SEARCH_RETRIEVAL_BUDGET_MS,
  SearchBudget,
  SearchDeadlineError,
  type SearchExecutor,
} from '@/lib/knowledge/search/budget'
import {
  annotateSearchDiagnostics,
  measureSearchStage,
  recordSearchStageDuration,
} from '@/lib/knowledge/search/diagnostics'
import { workspaceSearchFilterConditions } from '@/lib/knowledge/search/filter-conditions'
import type { WorkspaceSearchFilters } from '@/lib/knowledge/search/filters'
import { applyRecencyBoost, RRF_K } from '@/lib/knowledge/search/recency'
import {
  coerceTagFilterValue,
  escapeLikePattern,
  uncompilableTagFilterError,
} from '@/lib/knowledge/tags/utils'
import type { StructuredFilter } from '@/lib/knowledge/types'
import {
  embeddingCandidateDimensions,
  embeddingCandidateDistance,
  embeddingDistance,
} from '@/lib/knowledge/vector-columns'

const logger = createLogger('KnowledgeSearchQueries')

/** SQLSTATE for an unrecognised configuration parameter — pgvector older than 0.8. */
const UNDEFINED_OBJECT_SQLSTATE = '42704'
/** Bound candidate pages retained while live permissions are checked. */
const MAX_AUTHORIZED_SEARCH_CANDIDATES = 20_000
/**
 * Approximate iterative-visit threshold for a permission-starved graph walk. It excludes
 * pgvector's initial beam, so it only takes effect once `ResumeScanItems` starts widening.
 *
 * It must therefore stay roughly an order of magnitude above `ef_search`, or the first beam
 * already exhausts the tuple budget and the scan stops before it can iterate at all — pgvector's
 * maintainer says as much in pgvector#912. Measured on a production-shaped corpus, the previous
 * pairing of a 1,000-wide beam against a 1,000-tuple budget returned fewer candidates than a
 * narrower beam allowed to iterate, and spent longer inside the one uninterruptible beam.
 */
const CANDIDATE_HNSW_MAX_SCAN_TUPLES = '20000'
/**
 * Beam width per iteration. A beam is the granularity of cancellation: pgvector calls
 * `CHECK_FOR_INTERRUPTS` only while building an index, never inside `hnswgettuple`, so neither
 * `statement_timeout` nor a cancellation request can interrupt one. A narrower beam that iterates
 * therefore bounds the leg's uninterruptible floor as well as widening its reach.
 */
const CANDIDATE_HNSW_EF_SEARCH = '200'
const CANDIDATE_HNSW_SCAN_MEM_MULTIPLIER = '2'
const MIN_VECTOR_RERANK_CANDIDATES = 400
const MAX_VECTOR_RERANK_CANDIDATES = 1600
const VECTOR_RERANK_OVERSAMPLING = 32
/**
 * The probe's share of the leg. It ranks nothing, so it must never be why the leg misses its
 * own deadline.
 *
 * Its share comes out of what the rescue can claim from the narrowest live budget,
 * `DIRECT_SEARCH_VECTOR_BUDGET_MS`, before live authorization, hydration and the exact rerank
 * need the rest.
 */
const VECTOR_PROBE_BUDGET_MS = 600
/**
 * What one document costs the probe, measured on a corpus shaped like a search index under
 * comparable cache pressure: the access predicate, evaluated once per document.
 */
const VECTOR_PROBE_MICROSECONDS_PER_DOCUMENT = 6
/**
 * Documents the probe enumerates before it concludes the permitted set is too large to rank
 * exactly. Derived so that reaching it is what spends the probe's budget, rather than a separate
 * number that a change to that budget could silently invalidate.
 *
 * It bounds the rescue's second step too: exact ranking of the `halfvec` projection measures at
 * around half the probe's per-document cost, so a permitted set within this bound is affordable
 * by construction.
 */
export const VECTOR_PROBE_DOCUMENT_LIMIT = Math.round(
  (VECTOR_PROBE_BUDGET_MS * 1000) / VECTOR_PROBE_MICROSECONDS_PER_DOCUMENT
)

/** How long to stop trying the iterative-scan settings after the server rejected them. */
const HNSW_SETTINGS_UNSUPPORTED_RETRY_MS = 10 * 60 * 1000

let hnswSettingsUnsupportedUntil = 0

/**
 * Shared HNSW indexes can be selective on KB scope, access, or tags, even for
 * small workspace searches. Iterative scans keep looking within a bounded
 * tuple budget. A transaction keeps the settings local under pooled connections;
 * older extensions retry without tuning until the compatibility cooldown expires.
 */
async function withVectorScanSettings<T>(
  run: (executor: SearchExecutor) => Promise<T>,
  budget?: SearchBudget
): Promise<T> {
  const stage = 'vector.candidate_search'
  const untuned = () => runSearchQuery(budget, stage, run)
  if (Date.now() < hnswSettingsUnsupportedUntil) return untuned()
  const acquireStarted = performance.now()
  let applyingSettings = false
  try {
    const tuned = async (tx: SearchExecutor) => {
      if (!budget)
        recordSearchStageDuration('vector.connection_acquire', performance.now() - acquireStarted)
      applyingSettings = true
      await measureSearchStage('vector.settings', () =>
        tx.execute(
          sql`SELECT set_config('hnsw.iterative_scan', 'relaxed_order', true), set_config('hnsw.max_scan_tuples', ${CANDIDATE_HNSW_MAX_SCAN_TUPLES}, true), set_config('hnsw.ef_search', ${CANDIDATE_HNSW_EF_SEARCH}, true), set_config('hnsw.scan_mem_multiplier', ${CANDIDATE_HNSW_SCAN_MEM_MULTIPLIER}, true)`
        )
      )
      applyingSettings = false
      if (budget)
        await tx.execute(
          sql`SELECT set_config('statement_timeout', ${String(budget.remaining())}, true)`
        )
      return run(tx)
    }
    return await (budget ? budget.query(stage, tuned) : db.transaction(tuned))
  } catch (error) {
    if (!applyingSettings || getPostgresErrorCode(error) !== UNDEFINED_OBJECT_SQLSTATE) throw error
    hnswSettingsUnsupportedUntil = Date.now() + HNSW_SETTINGS_UNSUPPORTED_RETRY_MS
    logger.warn('pgvector iterative scan is unavailable; vector legs run without it', {
      error: getErrorMessage(error),
    })
    return untuned()
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
  access: KnowledgeAccessScope,
  accessProvider?: KnowledgeAccessProvider,
  signal?: AbortSignal
): Promise<Record<string, DocumentMetadata>> {
  if (documentIds.length === 0) {
    return {}
  }

  const uniqueIds = [...new Set(documentIds)]
  const authorizedAccess = accessProvider
    ? await measureSearchStage('metadata.authorization', () =>
        accessProvider.getForDocuments(uniqueIds, signal)
      )
    : access
  const documents = await measureSearchStage('metadata.sql', () =>
    db
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
          knowledgeAccessCondition(authorizedAccess)
        )
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
  model: string
}

export interface SearchParams {
  knowledgeBaseIds: string[]
  topK: number
  /** What the caller may read; every leg applies it. Required so no leg can be written without it. */
  access: KnowledgeAccessScope
  accessProvider?: KnowledgeAccessProvider
  signal?: AbortSignal
  budget?: SearchBudget
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
const getSearchResultFields = (distanceExpr: SQL<number> | SQL.Aliased<number>) => ({
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
 * Match the normalization used by the stored text vectors so query terms and
 * document terms resolve to the same lexemes in both keyword retrieval paths.
 */
const FTS_CONFIG = 'english'

/**
 * Row visibility predicates shared by every search leg: a chunk is only
 * retrievable when both it and its document are enabled, the document finished
 * processing, it has not been excluded, archived, or soft-deleted, and its ACL
 * overlaps the caller's tokens. Every leg spreads this helper rather than
 * listing the predicates itself, so no leg can drift from the others.
 */
function getVisibilityConditions(
  access: KnowledgeAccessScope,
  filters?: WorkspaceSearchFilters,
  accessCondition: SQL = knowledgeAccessCondition(access),
  enabledColumn: typeof embedding.enabled | typeof embeddingSearch.enabled = embedding.enabled
) {
  return [
    eq(enabledColumn, true),
    ...getDocumentVisibilityConditions(access, filters, accessCondition),
  ]
}

function getDocumentVisibilityConditions(
  access: KnowledgeAccessScope,
  filters?: WorkspaceSearchFilters,
  accessCondition: SQL = knowledgeAccessCondition(access)
) {
  return [
    eq(document.enabled, true),
    eq(document.processingStatus, 'completed'),
    eq(document.userExcluded, false),
    isNull(document.archivedAt),
    isNull(document.deletedAt),
    accessCondition,
    ...workspaceSearchFilterConditions(filters),
  ]
}

interface SearchReadCandidatePage {
  candidates: SearchReadCandidate[]
  nextOffset: number
}

type SearchReadCandidate = {
  id: string
  documentId: string
  connectorId: string | null
  liveAuthorizationSource: boolean
}

/** Only opaque identifiers leave candidate ranking; content stays behind the full read predicate. */
const SEARCH_READ_CANDIDATE_FIELDS = {
  id: embedding.id,
  documentId: document.id,
  connectorId: document.connectorId,
  liveAuthorizationSource: sql<boolean>`EXISTS (
    SELECT 1 FROM ${knowledgeConnector}
    WHERE ${knowledgeConnector.id} = ${document.connectorId}
      AND (
        (${knowledgeConnector.connectorType} = 'github'
          AND ${knowledgeConnector.sourceConfig}::jsonb ? 'githubRepositoryId')
        OR (${knowledgeConnector.connectorType} = 'confluence'
          AND ${knowledgeConnector.accessMode} = 'admin')
      )
  )`,
}

const AUTHORIZED_SEARCH_PAGE_SIZE = 200
const AUTHORIZED_SEARCH_BUDGET_MS = 8000

/**
 * Verification follows ranked candidates, never the organization's source order. Denied
 * sources are excluded on refill, so many matches from one revoked source cannot
 * consume every result slot. Candidate pages and the shared deadline bound authorization work.
 */
async function selectAuthorizedSearchResults(input: {
  leg: 'vector' | 'keyword' | 'tags'
  access: KnowledgeAccessScope
  accessProvider?: KnowledgeAccessProvider
  filters?: WorkspaceSearchFilters
  signal?: AbortSignal
  budget?: SearchBudget
  topK: number
  selectPage: (
    limit: number,
    offset: number,
    excludedSources: readonly string[]
  ) => Promise<SearchReadCandidatePage>
  compareResults?: (a: SearchResult, b: SearchResult) => number
  hydrate: (ids: string[], access: KnowledgeAccessScope) => Promise<SearchResult[]>
}): Promise<SearchResult[]> {
  const deadline = Date.now() + AUTHORIZED_SEARCH_BUDGET_MS
  const pageSize = Math.min(AUTHORIZED_SEARCH_PAGE_SIZE, Math.max(input.topK, 20))
  const results = new Map<string, SearchResult>()
  const excludedSources = new Set<string>()
  const considered = new Set<string>()
  let scanned = 0
  let offset = 0
  try {
    while (
      results.size < input.topK &&
      scanned < MAX_AUTHORIZED_SEARCH_CANDIDATES &&
      (input.budget !== undefined || Date.now() < deadline)
    ) {
      input.signal?.throwIfAborted()
      input.budget?.remaining()
      const page = await measureSearchStage(`${input.leg}.candidates`, () =>
        input.selectPage(pageSize, offset, [...excludedSources])
      )
      if (!page.candidates.length) break
      scanned += page.candidates.length
      offset = page.nextOffset
      const candidates = page.candidates.filter((candidate) => !considered.has(candidate.id))
      for (const candidate of candidates) considered.add(candidate.id)
      if (!candidates.length) {
        if (page.candidates.length < pageSize) break
        continue
      }
      /** Candidate and hydration queries enforce this source filter; connector types are immutable. */
      const connectorIds =
        input.filters?.source &&
        input.filters.source !== 'github' &&
        input.filters.source !== 'confluence'
          ? []
          : [
              ...new Set(
                candidates.flatMap((candidate) =>
                  candidate.connectorId ? [candidate.connectorId] : []
                )
              ),
            ]
      const access = await measureSearchStage(`${input.leg}.authorization`, () =>
        input.accessProvider
          ? input.accessProvider.getForConnectors(connectorIds, input.signal)
          : input.access
      )
      input.signal?.throwIfAborted()
      const grantedSources = new Set(
        access.kind === 'user'
          ? [
              ...(access.githubInstallationGrants?.map((grant) => grant.connectorId) ?? []),
              ...(access.confluenceSiteGrants?.map((grant) => grant.connectorId) ?? []),
            ]
          : []
      )
      const excludedBefore = excludedSources.size
      for (const candidate of candidates) {
        if (
          input.accessProvider &&
          candidate.liveAuthorizationSource &&
          candidate.connectorId &&
          !grantedSources.has(candidate.connectorId)
        )
          excludedSources.add(candidate.connectorId)
      }
      const hydrated = await measureSearchStage(`${input.leg}.hydration`, () =>
        input.hydrate(
          candidates.map((candidate) => candidate.id),
          access
        )
      )
      const byId = new Map(hydrated.map((row) => [row.id, row]))
      for (const candidate of candidates) {
        const row = byId.get(candidate.id)
        if (row) results.set(row.id, row)
        if (!input.compareResults && results.size === input.topK) break
      }
      if (input.compareResults) {
        const ranked = [...results.values()].sort(input.compareResults).slice(0, input.topK)
        results.clear()
        for (const row of ranked) results.set(row.id, row)
      }
      if (excludedSources.size > excludedBefore) offset = 0
      else if (page.candidates.length < pageSize) break
    }
  } catch (error) {
    if (!input.budget?.isTimeout(error)) throw error
  }
  input.signal?.throwIfAborted()
  return [...results.values()]
}

function excludeSearchSources(sourceIds: readonly string[]): SQL | undefined {
  return sourceIds.length
    ? sql`(${document.connectorId} IS NULL OR NOT (${inArray(document.connectorId, [...sourceIds])}))`
    : undefined
}

function hydrateSearchCandidates(
  ids: string[],
  access: KnowledgeAccessScope,
  distance: SQL<number> | SQL.Aliased<number>,
  filters: WorkspaceSearchFilters | undefined,
  conditions: (SQL | undefined)[],
  leg: RetrievalLeg,
  budget?: SearchBudget
) {
  return runSearchQuery(budget, `${leg}.sql`, (executor) =>
    executor
      .select(getSearchResultFields(distance))
      .from(embedding)
      .innerJoin(document, eq(embedding.documentId, document.id))
      .where(
        and(inArray(embedding.id, ids), ...getVisibilityConditions(access, filters), ...conditions)
      )
  )
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

  if (params.accessProvider && access.kind === 'user') {
    const conditions = [
      inArray(embedding.knowledgeBaseId, knowledgeBaseIds),
      ...tagFilterConditions,
    ]
    return selectAuthorizedSearchResults({
      leg: 'tags',
      access: params.access,
      accessProvider: params.accessProvider,
      filters: params.filters,
      signal: params.signal,
      budget: params.budget,
      topK,
      selectPage: async (limit, offset, excludedSources) => {
        const candidates = await runSearchQuery(params.budget, 'tags.sql', (executor) =>
          executor
            .select(SEARCH_READ_CANDIDATE_FIELDS)
            .from(embedding)
            .innerJoin(document, eq(embedding.documentId, document.id))
            .where(
              and(
                ...conditions,
                ...getVisibilityConditions(
                  access,
                  params.filters,
                  knowledgeMetadataCandidateAccessCondition(access)
                ),
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
          authorized,
          sql<number>`0`.as('distance'),
          params.filters,
          conditions,
          'tags',
          params.budget
        ),
    })
  }

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
  const { queryVector, distanceThreshold } = params
  if (!queryVector || !distanceThreshold) {
    throw new Error('Query vector and distance threshold are required for vector-only search')
  }
  return selectVectorResults(params)
}

/**
 * Enumerate the documents the caller may read, stopping once there are more of them than an exact
 * ranking can afford. The bound is documents examined, not chunks accumulated: the access
 * predicate is evaluated once per document, and a search index holds only a few chunks per
 * document, so a chunk-bounded enumeration walks many times more documents than its limit says.
 *
 * Returns the document identities, or `null` when the permitted set exceeded that bound or the
 * probe spent its own deadline finding out — neither is a failure of the leg, which keeps the
 * candidates it already has.
 */
async function probeVisibleDocuments(
  conditions: (SQL | undefined)[],
  budget: SearchBudget | undefined
): Promise<string[] | null> {
  const probeBudget = budget?.capped(VECTOR_PROBE_BUDGET_MS)
  try {
    const probed = await runSearchQuery(probeBudget, 'vector.probe', (executor) =>
      executor.execute<{ id: string }>(sql`
        SELECT ${document.id} AS id FROM ${document}
        WHERE ${and(...conditions)}
        LIMIT ${VECTOR_PROBE_DOCUMENT_LIMIT + 1}
      `)
    )
    if (probed.length > VECTOR_PROBE_DOCUMENT_LIMIT) return null
    return probed.map(({ id }) => id)
  } catch (error) {
    if (!budget || !probeBudget?.isTimeout(error)) throw error
    /** Only the probe's share was spent; the leg's own deadline still governs. */
    budget.remaining()
    return null
  }
}

/** Tags live on chunks, so a row qualifies when a chunk it joins to carries them. */
function chunkTagCondition(join: SQL, tagConditions: SQL[]): SQL | undefined {
  if (!tagConditions.length) return undefined
  return sql`EXISTS (
    SELECT 1 FROM ${embedding}
    WHERE ${and(join, ...tagConditions)}
  )`
}

/**
 * Select a bounded candidate pool and rerank it against the original vectors.
 *
 * A bounded ANN traversal fills that pool. When visibility leaves the traversal short of its
 * limit, a bounded probe decides whether the permitted set is small enough to rank exactly
 * instead, which recovers the candidates the traversal's post-filter discarded.
 *
 * Live source authorization and content hydration still run after candidate ranking.
 */
async function selectVectorResults(params: SearchParams): Promise<SearchResult[]> {
  const queryVector = params.queryVector!
  const distance = embeddingDistance(queryVector.dimensions, queryVector.vector)
  const tagConditions = getStructuredTagFilters(params.structuredFilters ?? [], embedding)
  const conditions = [
    inArray(embedding.knowledgeBaseId, params.knowledgeBaseIds),
    ...tagConditions,
    sql`${distance} < ${params.distanceThreshold!}`,
  ]
  /** Applied before the candidate limit, so the limit never counts rows the tags exclude. */
  const candidateTagCondition = chunkTagCondition(
    eq(embedding.id, embeddingSearch.id),
    tagConditions
  )
  const accessProvider = params.access.kind === 'user' ? params.accessProvider : undefined
  /** Only live-verified readers may defer source authorization until after candidate ranking. */
  const candidateAccess = accessProvider
    ? knowledgeMetadataCandidateAccessCondition(params.access)
    : knowledgeAccessCondition(params.access)
  const candidateDistance = embeddingCandidateDistance(
    queryVector.dimensions,
    queryVector.vector,
    queryVector.model
  )
  const candidateLimit = Math.min(
    MAX_VECTOR_RERANK_CANDIDATES,
    Math.max(MIN_VECTOR_RERANK_CANDIDATES, params.topK * VECTOR_RERANK_OVERSAMPLING)
  )
  const documentTagCondition = chunkTagCondition(
    eq(embedding.documentId, document.id),
    tagConditions
  )
  /**
   * Candidate selection ignores the page offset — only the rerank pages over the pool — so a
   * refill reuses the pool it already has. Excluding another source is the only thing that
   * changes which candidates belong in it, and that resets the offset to zero anyway.
   */
  let candidatePool: { excludedKey: string; identities: Array<{ id: string }> } | undefined
  return selectAuthorizedSearchResults({
    leg: 'vector',
    access: params.access,
    accessProvider,
    filters: params.filters,
    signal: params.signal,
    budget: params.budget,
    topK: params.topK,
    compareResults: (a, b) => a.distance - b.distance,
    selectPage: async (limit, offset, excludedSources) => {
      const visibility = [
        ...getVisibilityConditions(params.access, params.filters, candidateAccess),
        excludeSearchSources(excludedSources),
      ]
      const candidateDocumentVisibility = [
        inArray(document.knowledgeBaseId, params.knowledgeBaseIds),
        ...getDocumentVisibilityConditions(params.access, params.filters, candidateAccess),
        excludeSearchSources(excludedSources),
      ]
      /** Explicit document IDs are already a bounded scope, and retain exhaustive ordering. */
      const exactPage = async () => {
        annotateSearchDiagnostics({ vectorRanking: 'exact' })
        const candidates = await runSearchQuery(params.budget, 'vector.exact', (executor) =>
          executor
            .select({ ...SEARCH_READ_CANDIDATE_FIELDS, distance: distance.as('distance') })
            .from(embedding)
            .innerJoin(document, eq(embedding.documentId, document.id))
            .where(and(...conditions, ...visibility))
            .orderBy(sql`(${distance}) + 0`, embedding.id)
            .limit(limit)
            .offset(offset)
        )
        return { candidates, nextOffset: offset + candidates.length }
      }
      if (params.filters?.documentIds?.length) return exactPage()
      const excludedKey = excludedSources.join('\u0000')
      if (candidatePool?.excludedKey !== excludedKey) {
        annotateSearchDiagnostics({
          vectorRanking: 'candidate-rerank',
          vectorCandidateStorage: 'stored-halfvec',
          vectorCandidateLimit: candidateLimit,
          vectorCandidateScan: 'planned',
          vectorCandidateDimensions: embeddingCandidateDimensions(
            queryVector.dimensions,
            queryVector.model
          ),
        })
        /**
         * The bounded ANN traversal is the whole candidate set. LIMIT keeps document
         * authorization downstream of the traversal, with a primary-key lookup per candidate.
         */
        const traversed = await withVectorScanSettings(
          (executor) =>
            executor.execute<{ id: string }>(sql`
          SELECT ${embeddingSearch.id} AS id FROM ${embeddingSearch}
          CROSS JOIN LATERAL (
            SELECT 1 FROM ${document}
            WHERE ${and(eq(document.id, embeddingSearch.documentId), ...candidateDocumentVisibility, candidateTagCondition)}
            LIMIT 1
          ) AS visible
          WHERE ${and(
            inArray(embeddingSearch.knowledgeBaseId, params.knowledgeBaseIds),
            eq(embeddingSearch.enabled, true)
          )}
          ORDER BY ${candidateDistance} LIMIT ${candidateLimit}
        `),
          params.budget
        )
        /**
         * A full traversal is already the nearest permitted chunks, so nothing else is worth
         * running. An underfilled one is the signal that visibility removed neighbours the graph
         * had already chosen: pgvector's HNSW post-filters by construction — it declares no scan
         * strategies and never reads the scan keys — so a permitted set that is a small share of
         * the index is discarded after the graph has committed to its neighbours, and widening
         * the traversal cannot recover them.
         *
         * Ranking the permitted set exactly does recover them, while that set is small enough to
         * afford.
         */
        let selected: Array<{ id: string }> = traversed
        if (traversed.length < candidateLimit) {
          const visibleDocumentIds = await probeVisibleDocuments(
            [...candidateDocumentVisibility, documentTagCondition],
            params.budget
          )
          if (visibleDocumentIds) {
            annotateSearchDiagnostics({
              vectorRanking: 'exact-candidates',
              vectorProbeDocumentCount: visibleDocumentIds.length,
            })
            /**
             * `+ 0` keeps the planner off the ANN index, and the probed identities keep the scan
             * on `embedding_search_document_lookup_idx`, so this reads what the permitted set
             * costs rather than re-deriving permission across the whole index. Exact ranking also
             * honours `statement_timeout`, which a traversal cannot.
             */
            selected = visibleDocumentIds.length
              ? await runSearchQuery(params.budget, 'vector.exact_candidates', (executor) =>
                  executor.execute<{ id: string }>(sql`
              SELECT ${embeddingSearch.id} AS id FROM ${embeddingSearch}
              WHERE ${and(
                inArray(embeddingSearch.knowledgeBaseId, params.knowledgeBaseIds),
                eq(embeddingSearch.enabled, true),
                sql`${embeddingSearch.documentId} = ANY(${textArrayLiteral(visibleDocumentIds)})`,
                candidateTagCondition
              )}
              ORDER BY (${candidateDistance}) + 0 LIMIT ${candidateLimit}
            `)
                )
              : []
          }
        }
        candidatePool = { excludedKey, identities: selected }
        annotateSearchDiagnostics({
          vectorCandidateCount: selected.length,
          vectorCandidateScan: selected.length < candidateLimit ? 'underfilled' : 'planned',
        })
      }
      const { identities } = candidatePool
      if (!identities.length) return { candidates: [], nextOffset: offset }
      /** Score each bounded candidate once; sorting the materialized scalar cannot invoke HNSW again. */
      const page = await runSearchQuery(params.budget, 'vector.rerank', (executor) =>
        executor.execute<SearchReadCandidate & { distance: number }>(sql`
          WITH scored_search_candidates AS MATERIALIZED (
            SELECT ${embedding.id} AS id, ${document.id} AS "documentId",
              ${document.connectorId} AS "connectorId",
              ${SEARCH_READ_CANDIDATE_FIELDS.liveAuthorizationSource} AS "liveAuthorizationSource",
              ${distance} AS distance
            FROM ${embedding} INNER JOIN ${document} ON ${document.id} = ${embedding.documentId}
            WHERE ${and(
              inArray(
                embedding.id,
                identities.map(({ id }) => id)
              ),
              ...conditions,
              ...visibility
            )}
          ) SELECT * FROM scored_search_candidates ORDER BY distance, id LIMIT ${limit} OFFSET ${offset}
        `)
      )
      return {
        candidates: page,
        nextOffset: offset + page.length,
      }
    },
    hydrate: (ids, authorized) =>
      hydrateSearchCandidates(
        ids,
        authorized,
        distance.as('distance'),
        params.filters,
        conditions,
        'vector',
        params.budget
      ),
  })
}

export interface KeywordSearchParams {
  knowledgeBaseIds: string[]
  topK: number
  access: KnowledgeAccessScope
  accessProvider?: KnowledgeAccessProvider
  signal?: AbortSignal
  budget?: SearchBudget
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
 * Candidate gathering mirrors the vector leg: resolved scopes use the same
 * per-base strategy, and live user scopes verify bounded pages from the same
 * global ranking pool before hydrating content.
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

  if (params.accessProvider && access.kind === 'user') {
    const conditions = [
      inArray(embedding.knowledgeBaseId, knowledgeBaseIds),
      sql`${embedding.contentTsv} @@ ${tsQuery}`,
      ...tagFilterConditions,
    ]
    const candidateRank = sql<number>`ts_rank_cd(${embeddingKeywordSearch.contentTsv}, ${tsQuery})`
    /** Keep readable identities and rank scalars separate so sorts never carry full text-search vectors. */
    return selectAuthorizedSearchResults({
      leg: 'keyword',
      access: params.access,
      accessProvider: params.accessProvider,
      filters: params.filters,
      signal: params.signal,
      budget: params.budget,
      topK,
      selectPage: async (limit, offset, excludedSources) => {
        const candidates = await runSearchQuery(params.budget, 'keyword.sql', (executor) =>
          executor.execute<SearchReadCandidate>(sql`
            WITH visible_keyword_documents AS MATERIALIZED (
              SELECT ${document.id} AS id FROM ${document}
              WHERE ${and(
                inArray(document.knowledgeBaseId, knowledgeBaseIds),
                ...getDocumentVisibilityConditions(
                  access,
                  params.filters,
                  knowledgeMetadataCandidateAccessCondition(access)
                ),
                excludeSearchSources(excludedSources)
              )}
            ), scored_keyword_candidates AS MATERIALIZED (
              SELECT ${embeddingKeywordSearch.id} AS id,
                ${embeddingKeywordSearch.documentId} AS document_id,
                ${candidateRank} AS keyword_rank
              FROM ${embeddingKeywordSearch}
              WHERE ${and(
                inArray(embeddingKeywordSearch.knowledgeBaseId, knowledgeBaseIds),
                eq(embeddingKeywordSearch.enabled, true),
                sql`${embeddingKeywordSearch.contentTsv} @@ ${tsQuery}`,
                sql`${embeddingKeywordSearch.documentId} IN (SELECT id FROM visible_keyword_documents)`,
                sql`EXISTS (SELECT 1 FROM visible_keyword_documents)`,
                tagFilterConditions.length
                  ? sql`EXISTS (
                  SELECT 1 FROM ${embedding} WHERE ${embedding.id} = ${embeddingKeywordSearch.id}
                    AND ${and(...tagFilterConditions)}
                )`
                  : undefined
              )}
            ), ranked_keyword_candidates AS MATERIALIZED (
              SELECT * FROM scored_keyword_candidates
              ORDER BY keyword_rank DESC, id LIMIT ${limit} OFFSET ${offset}
            )
            SELECT ranked_keyword_candidates.id, ${document.id} AS "documentId",
              ${document.connectorId} AS "connectorId",
              ${SEARCH_READ_CANDIDATE_FIELDS.liveAuthorizationSource} AS "liveAuthorizationSource"
            FROM ranked_keyword_candidates INNER JOIN ${document}
              ON ${document.id} = ranked_keyword_candidates.document_id
            ORDER BY ranked_keyword_candidates.keyword_rank DESC, ranked_keyword_candidates.id
          `)
        )
        return { candidates, nextOffset: offset + candidates.length }
      },
      hydrate: (ids, authorized) =>
        hydrateSearchCandidates(
          ids,
          authorized,
          embeddingDistance(queryVector.dimensions, queryVector.vector).as('distance'),
          params.filters,
          conditions,
          'keyword',
          params.budget
        ),
    })
  }

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
  const { structuredFilters, queryVector, distanceThreshold } = params
  if (!structuredFilters || structuredFilters.length === 0) {
    throw new Error('Tag filters are required for tag and vector search')
  }
  if (!queryVector || !distanceThreshold) {
    throw new Error('Query vector and distance threshold are required for tag and vector search')
  }
  return selectVectorResults(params)
}

/**
 * `hybrid` fuses lexical and vector retrieval; `vector` is the legacy
 * semantic-only path, kept as an opt-out.
 */
export type KnowledgeSearchMode = 'hybrid' | 'vector'

export interface ExecuteKnowledgeSearchParams {
  /** Optional vector-leg budget; keyword and tag retrieval keep their default budgets. */
  vectorBudgetMs?: number
  knowledgeBaseIds: string[]
  /** Candidate count each leg retrieves and the fused list is trimmed to. */
  topK: number
  /** What the caller may read; resolved from the principal by the use case, never from input. */
  access: KnowledgeAccessScope
  accessProvider?: KnowledgeAccessProvider
  signal?: AbortSignal
  searchMode: KnowledgeSearchMode
  /** Lets a recently modified document edge past a stale one of similar relevance; off by default. */
  boostRecency?: boolean
  query?: string
  /** Required whenever `query` is present. */
  queryVector?: KnowledgeQueryVector
  structuredFilters?: StructuredFilter[]
  filters?: WorkspaceSearchFilters
}

export interface RetrievalStatus {
  status: 'complete' | 'partial'
  timedOutLegs: Array<'vector' | 'keyword' | 'tags'>
}

export interface KnowledgeRetrievalResult {
  rows: SearchResult[]
  retrieval: RetrievalStatus
}

/** Legacy surfaces cannot silently present partial retrieval as complete. */
export async function executeKnowledgeSearch(
  params: ExecuteKnowledgeSearchParams
): Promise<SearchResult[]> {
  const result = await retrieveKnowledgeSearch(params)
  if (result.retrieval.status === 'partial') throw new SearchDeadlineError()
  return result.rows
}

/** Shared hybrid retrieval, with explicit completeness for surfaces that can represent it. */
export async function retrieveKnowledgeSearch(
  params: ExecuteKnowledgeSearchParams
): Promise<KnowledgeRetrievalResult> {
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
  params.signal?.throwIfAborted()
  const started = performance.now()
  const deadline = started + SEARCH_RETRIEVAL_BUDGET_MS
  const vectorBudgetMs = params.vectorBudgetMs ?? SEARCH_RETRIEVAL_BUDGET_MS
  annotateSearchDiagnostics({ vectorBudgetMs })
  const budgets = {
    vector: new SearchBudget('vector', started + vectorBudgetMs, params.signal),
    keyword: new SearchBudget('keyword', deadline, params.signal),
    tags: new SearchBudget('tags', deadline, params.signal),
  }
  const finish = (rows: SearchResult[]): KnowledgeRetrievalResult => {
    params.signal?.throwIfAborted()
    const timedOutLegs = Object.values(budgets)
      .filter((budget) => budget.timedOut)
      .map((budget) => budget.leg)
    return {
      rows: boostRecency ? applyRecencyBoost(rows) : rows,
      retrieval: { status: timedOutLegs.length ? 'partial' : 'complete', timedOutLegs },
    }
  }
  const common = {
    knowledgeBaseIds,
    access,
    accessProvider: params.accessProvider,
    signal: params.signal,
    filters: params.filters,
    structuredFilters,
  }
  const hasQuery = Boolean(query?.trim())
  const hasFilters = Boolean(structuredFilters?.length)
  if (!hasQuery) {
    if (!hasFilters) throw new Error('A search query or tag filters are required')
    return finish(
      await measureSearchStage('tags', () =>
        handleTagOnlySearch({ ...common, topK, budget: budgets.tags })
      )
    )
  }
  if (!queryVector) throw new Error('Query vector is required when searching with a query')
  const { distanceThreshold } = getQueryStrategy(knowledgeBaseIds.length, topK)
  const legTopK = searchMode === 'hybrid' ? hybridCandidateCount(topK) : topK
  const vectorParams = {
    ...common,
    topK: legTopK,
    queryVector,
    distanceThreshold,
    budget: budgets.vector,
  }
  const vectorSearch = measureSearchStage('vector', () =>
    hasFilters ? handleTagAndVectorSearch(vectorParams) : handleVectorOnlySearch(vectorParams)
  )
  if (searchMode === 'vector') return finish(await vectorSearch)
  const keywordSearch = measureSearchStage('keyword', () =>
    executeKeywordSearch({
      ...common,
      topK: legTopK,
      query: query!,
      queryVector,
      budget: budgets.keyword,
    })
  )
  const legs = await Promise.allSettled([vectorSearch, keywordSearch])
  /** Wait for both legs to release SQL resources; only deadline failures permit partial success. */
  for (const leg of legs) if (leg.status === 'rejected') throw leg.reason
  const vectorResults = legs[0].status === 'fulfilled' ? legs[0].value : []
  const keywordResults = legs[1].status === 'fulfilled' ? legs[1].value : []
  return finish(fuseByReciprocalRank([keywordResults, vectorResults], topK))
}
