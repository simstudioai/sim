import { db } from '@sim/db'
import {
  document,
  embedding,
  embeddingKeywordSearch,
  embeddingKeywordTin,
  embeddingSearch,
  knowledgeConnector,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { sha256Hex } from '@sim/security/hash'
import { getErrorMessage, getPostgresErrorCode } from '@sim/utils/errors'
import { and, eq, inArray, isNull, type SQL, sql } from 'drizzle-orm'
import { LRUCache } from 'lru-cache'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import { resolveSearchAccessPlan } from '@/lib/knowledge/access/connector-eligibility'
import {
  knowledgeAccessCondition,
  knowledgeAclOverlapCondition,
  knowledgeCandidateAccessConditionForConnectors,
  knowledgeMetadataCandidateAccessCondition,
  projectionCandidateAccessCondition,
  type SearchAccessPlan,
  textArrayLiteral,
} from '@/lib/knowledge/access/predicate'
import {
  type ConfluenceSiteReadGrant,
  type GitHubInstallationReadGrant,
  type KnowledgeAccessProvider,
  type KnowledgeAccessScope,
  MAX_KNOWLEDGE_ACCESS_CANDIDATES,
} from '@/lib/knowledge/access/types'
import type { KbEmbeddingDimensions } from '@/lib/knowledge/embedding-models'
import {
  type RetrievalLeg,
  runSearchQuery,
  SEARCH_RETRIEVAL_BUDGET_MS,
  SearchBudget,
  SearchDeadlineError,
  type SearchExecutor,
  sessionSettingsStatement,
} from '@/lib/knowledge/search/budget'
import {
  annotateSearchDiagnostics,
  measureSearchStage,
  recordSearchStageDuration,
  type SearchStage,
} from '@/lib/knowledge/search/diagnostics'
import { workspaceSearchFilterConditions } from '@/lib/knowledge/search/filter-conditions'
import type { WorkspaceSearchFilters } from '@/lib/knowledge/search/filters'
import { applyRecencyBoost, RRF_K } from '@/lib/knowledge/search/recency'
import { indexedVectorSources } from '@/lib/knowledge/search/source-vector-indexes'
import { resolveTinKeywordQuery } from '@/lib/knowledge/search/tin-keyword'
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
 * How far a walk that decides readability on the row may go before giving up: a cap, not a target,
 * since the scan stops as soon as the limit is met. The default cap was sized for a walk that looked
 * a document up per visited tuple; on the row a tuple costs a fraction of that, so a caller whose
 * neighbourhood is mostly unreadable can be carried past it for tens of milliseconds rather than
 * left with what the neighbourhood happened to hold.
 */
const ON_ROW_WALK_SCAN_TUPLES = 100_000
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
  budget?: SearchBudget,
  stage: SearchStage = 'vector.candidate_search',
  maxScanTuples: number = Number(CANDIDATE_HNSW_MAX_SCAN_TUPLES)
): Promise<T> {
  const untuned = () => runSearchQuery(budget, stage, run)
  if (Date.now() < hnswSettingsUnsupportedUntil) return untuned()
  const acquireStarted = performance.now()
  const settings = [
    sql`set_config('hnsw.iterative_scan', 'relaxed_order', true)`,
    sql`set_config('hnsw.max_scan_tuples', ${String(maxScanTuples)}, true)`,
    sql`set_config('hnsw.ef_search', ${CANDIDATE_HNSW_EF_SEARCH}, true)`,
    sql`set_config('hnsw.scan_mem_multiplier', ${CANDIDATE_HNSW_SCAN_MEM_MULTIPLIER}, true)`,
  ]
  /** Only a failure while the settings are being applied says the extension lacks them. */
  let applyingSettings = true
  try {
    /** Under a budget the settings ride in the deadline statement; alone they are one of their own. */
    if (budget) {
      return await budget.query(
        stage,
        (tx) => {
          applyingSettings = false
          return run(tx)
        },
        settings
      )
    }
    return await db.transaction(async (tx) => {
      recordSearchStageDuration('vector.connection_acquire', performance.now() - acquireStarted)
      await measureSearchStage('vector.settings', () =>
        tx.execute(sessionSettingsStatement(settings))
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
 * Batch-fetch display metadata for documents referenced by search results, under the full read
 * predicate and the scope the results were read under — with the live grants that scope resolved,
 * so a gated source's result keeps its name and URL, and a revoked one loses them here too.
 * Returns a map keyed by document id; missing ids indicate the document is no longer visible and
 * should be skipped.
 */
export async function getDocumentMetadataByIds(
  documentIds: string[],
  access: KnowledgeAccessScope
): Promise<Record<string, DocumentMetadata>> {
  if (documentIds.length === 0) {
    return {}
  }

  const uniqueIds = [...new Set(documentIds)]
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
          knowledgeAccessCondition(access)
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
  liveSourceAccess?: LiveSourceAccess
  signal?: AbortSignal
  budget?: SearchBudget
  structuredFilters?: StructuredFilter[]
  filters?: WorkspaceSearchFilters
  queryVector?: KnowledgeQueryVector
  distanceThreshold?: number
  /** Resolved once per user-scoped search; absent for resolved scopes and explicit documents. */
  permitted?: PermittedDocuments
  /** Connector state resolved once per search, so no candidate re-derives it. */
  accessPlan?: SearchAccessPlan
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
 * Chunks Tin ranks before access is checked, widening while too few are readable to fill a page.
 * A caller past the permitted-set limit reads a large share of the index, so the first window
 * almost always fills; the widest bounds the work before the GIN ranking takes over.
 */
const TIN_KEYWORD_WINDOWS = [2000, 10_000, 50_000] as const

/** Readable rows one wide window returns for a narrow reader: several pages' worth, ranked once. */
const NARROW_KEYWORD_PAGE = 1000

/**
 * The widest window a narrow reader ranks: wide enough that a few percent of it fills their page
 * several times over, and less than half the cost of the widest window the broad readers reach.
 * It is tried only after the first window came back short: ranking costs grow with the window,
 * and a term that is common where the reader can read fills the page from the narrowest one.
 */
const NARROW_KEYWORD_WINDOWS = [TIN_KEYWORD_WINDOWS[0], 20_000] as const

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

/**
 * The candidate predicate a leg applies, with connector state resolved ahead of the query when the
 * search resolved it. Both shapes admit exactly the same documents.
 */
function candidateAccessCondition(
  access: KnowledgeAccessScope,
  plan: SearchAccessPlan | undefined
): SQL {
  return plan
    ? knowledgeCandidateAccessConditionForConnectors(access, plan)
    : knowledgeMetadataCandidateAccessCondition(access)
}

/**
 * The document-level candidate predicate every ranked leg applies. The permitted set is resolved
 * with the same list, which is what lets a leg rank inside it without admitting anything more.
 */
function candidateDocumentConditions(
  knowledgeBaseIds: string[],
  access: KnowledgeAccessScope,
  filters: WorkspaceSearchFilters | undefined,
  accessCondition: SQL
) {
  return [
    inArray(document.knowledgeBaseId, knowledgeBaseIds),
    ...getDocumentVisibilityConditions(access, filters, accessCondition),
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
}

/** Only opaque identifiers leave candidate ranking; content stays behind the full read predicate. */
const SEARCH_READ_CANDIDATE_FIELDS = {
  id: embedding.id,
  documentId: document.id,
  connectorId: document.connectorId,
}

/**
 * The caller's proof of reader access to the sources that require one, resolved at most once per
 * search and only when a candidate from such a source is about to be read.
 */
export interface LiveSourceAccess {
  gates: (connectorId: string) => boolean
  /** The caller's scope with its grants, and the gated sources those grants do not cover. */
  resolve: () => Promise<{ access: KnowledgeAccessScope; denied: ReadonlySet<string> }>
  /** The scope content was read under: with its grants once they were resolved, else as given. */
  current: () => Promise<KnowledgeAccessScope>
}

/** Binds a search's gated sources to one memoized resolution of the caller's grants. */
export function liveSourceAccessFor(
  access: KnowledgeAccessScope,
  plan: SearchAccessPlan | undefined,
  accessProvider: KnowledgeAccessProvider | undefined,
  signal?: AbortSignal
): LiveSourceAccess | undefined {
  const gated = new Set(plan?.connectors.liveProofRequired ?? [])
  if (!accessProvider || gated.size === 0) return undefined
  let pending: Promise<{ access: KnowledgeAccessScope; denied: ReadonlySet<string> }> | undefined
  /** The provider authorizes connectors in bounded pages, so a wide scope resolves page by page. */
  const pages: string[][] = []
  for (const id of gated) {
    const last = pages.at(-1)
    if (!last || last.length === MAX_KNOWLEDGE_ACCESS_CANDIDATES) pages.push([id])
    else last.push(id)
  }
  return {
    gates: (connectorId) => gated.has(connectorId),
    current: async () => (pending ? (await pending).access : access),
    resolve: () => {
      pending ??= measureSearchStage('live_source_grants', async () => {
        const scopes = await mapWithConcurrency(pages, SOURCE_RANKING_CONCURRENCY, (page) =>
          accessProvider.getForConnectors(page, signal)
        )
        const [first] = scopes
        const githubInstallationGrants: GitHubInstallationReadGrant[] = []
        const confluenceSiteGrants: ConfluenceSiteReadGrant[] = []
        for (const scope of scopes) {
          if (scope.kind !== 'user') continue
          if (scope.githubInstallationGrants)
            githubInstallationGrants.push(...scope.githubInstallationGrants)
          if (scope.confluenceSiteGrants) confluenceSiteGrants.push(...scope.confluenceSiteGrants)
        }
        const granted = new Set([
          ...githubInstallationGrants.map((grant) => grant.connectorId),
          ...confluenceSiteGrants.map((grant) => grant.connectorId),
        ])
        const denied = new Set([...gated].filter((id) => !granted.has(id)))
        const merged =
          first.kind === 'user'
            ? { ...first, githubInstallationGrants, confluenceSiteGrants }
            : first
        return { access: merged, denied }
      })
      return pending
    },
  }
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
  liveSourceAccess?: LiveSourceAccess
}): Promise<SearchResult[]> {
  const deadline = Date.now() + AUTHORIZED_SEARCH_BUDGET_MS
  const pageSize = Math.min(AUTHORIZED_SEARCH_PAGE_SIZE, Math.max(input.topK, 20))
  const results = new Map<string, SearchResult>()
  const considered = new Set<string>()
  /** Gated sources the caller turned out not to hold: left out of every page once that is known. */
  let excluded: ReadonlySet<string> = new Set()
  let scanned = 0
  let offset = 0
  /** Candidates a ranking returned beyond the current hydration slice. */
  let pending: SearchReadCandidate[] = []
  let lastPageShort = false
  try {
    while (
      results.size < input.topK &&
      scanned < MAX_AUTHORIZED_SEARCH_CANDIDATES &&
      (input.budget !== undefined || Date.now() < deadline)
    ) {
      input.signal?.throwIfAborted()
      input.budget?.remaining()
      /**
       * A ranking may hand back more candidates than one hydration should read — a narrow
       * reader's keyword window is ranked once for several pages' worth — so a page is drained in
       * hydration-sized slices, and what is left waits, unread, until the results still need it.
       */
      if (!pending.length) {
        const page = await measureSearchStage(`${input.leg}.candidates`, () =>
          input.selectPage(pageSize, offset, [...excluded])
        )
        if (!page.candidates.length) break
        scanned += page.candidates.length
        offset = page.nextOffset
        lastPageShort = page.candidates.length < pageSize
        pending = page.candidates.filter((candidate) => !considered.has(candidate.id))
        if (!pending.length) {
          if (lastPageShort) break
          continue
        }
      }
      /**
       * A candidate counts as considered only once its slice is read: the slices a refill discards
       * were never read, so the rebuilt pages may hand their readable candidates back.
       */
      const candidates = pending
        .slice(0, pageSize)
        .filter((candidate) => !considered.has(candidate.id))
      pending = pending.slice(pageSize)
      for (const candidate of candidates) considered.add(candidate.id)
      if (!candidates.length) continue
      /**
       * A source that proves its reader live is asked for that proof only once a candidate of
       * its own reaches this page, and then once for the whole search: a scope that ranks none
       * of them — most scopes — never asks, and one that ranks many asks once.
       */
      const proof = input.liveSourceAccess
      const gatedOnPage =
        proof !== undefined &&
        candidates.some((candidate) => candidate.connectorId && proof.gates(candidate.connectorId))
      let access = input.access
      let refill = false
      if (gatedOnPage && proof) {
        const resolved = await proof.resolve()
        access = resolved.access
        /**
         * A denied source's candidates cannot hydrate, yet they took the slots of sources the
         * caller does hold. Once the denial is known the pages are rebuilt without that source,
         * from the start; the ids already seen are not read twice.
         */
        if (resolved.denied.size > excluded.size) {
          excluded = resolved.denied
          refill = true
        }
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
      if (refill) {
        /** The rebuilt pages are a new stream of candidates, so the scan budget starts over. */
        offset = 0
        scanned = 0
        pending = []
        continue
      }
      /** A short page is the end of the candidates, whether or not they were reordered. */
      if (!pending.length && lastPageShort) break
    }
  } catch (error) {
    if (!input.budget?.isTimeout(error)) throw error
  }
  input.signal?.throwIfAborted()
  return [...results.values()]
}

/** Keeps the candidates of sources the caller turned out not to hold out of a page. */
function excludeSearchSources(sourceIds: readonly string[]): SQL | undefined {
  return sourceIds.length
    ? sql`(${document.connectorId} IS NULL OR NOT (${inArray(document.connectorId, [...sourceIds])}))`
    : undefined
}

/**
 * Loads the content of candidates that survived ranking, under the read predicate.
 *
 * The resolved connector state bounds ranking, never this. A page of ranked identifiers is small,
 * so its content is read under the full predicate, which re-reads each connector's own lifecycle
 * and approval: a source deleted, archived or unapproved while the search was running stops
 * answering here, at the gate that returns content.
 */
function hydrateSearchCandidates(
  ids: string[],
  access: KnowledgeAccessScope,
  distance: SQL<number> | SQL.Aliased<number>,
  filters: WorkspaceSearchFilters | undefined,
  conditions: (SQL | undefined)[],
  leg: RetrievalLeg,
  budget?: SearchBudget
) {
  const accessCondition = knowledgeAccessCondition(access)
  return runSearchQuery(budget, `${leg}.sql`, (executor) =>
    executor
      .select(getSearchResultFields(distance))
      .from(embedding)
      .innerJoin(document, eq(embedding.documentId, document.id))
      .where(
        and(
          inArray(embedding.id, ids),
          ...getVisibilityConditions(access, filters, accessCondition),
          ...conditions
        )
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
      liveSourceAccess: params.liveSourceAccess,
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
                  candidateAccessCondition(access, params.accessPlan)
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

type ProbeOutcome =
  | { kind: 'documents'; documents: PermittedDocument[] }
  /** The caller reads more documents than an exact ranking can afford. */
  | { kind: 'saturated' }
  /** The probe spent its own deadline before finding out. */
  | { kind: 'timed_out' }

/**
 * Enumerate the documents the caller may read, stopping once there are more of them than an exact
 * ranking can afford. The bound is documents examined, not chunks accumulated: the access
 * predicate is evaluated once per document, and a search index holds only a few chunks per
 * document, so a chunk-bounded enumeration walks many times more documents than its limit says.
 *
 * Neither saturation nor a timeout is a failure of the leg, which keeps the candidates it
 * already has.
 */
async function probeVisibleDocuments(
  knowledgeBaseIds: string[],
  conditions: (SQL | undefined)[],
  access: KnowledgeAccessScope,
  budget: SearchBudget | undefined,
  stage: 'vector.probe' | 'permitted_documents'
): Promise<ProbeOutcome> {
  const probeBudget = budget?.capped(VECTOR_PROBE_BUDGET_MS)
  try {
    const probed = await runSearchQuery(probeBudget, stage, (executor) =>
      executor.execute<PermittedDocument & { saturated: boolean }>(
        visibleDocumentsQuery(knowledgeBaseIds, conditions, access)
      )
    )
    /** The saturation sentinel is only ever emitted alone. */
    if (probed.length > VECTOR_PROBE_DOCUMENT_LIMIT || probed[0]?.saturated) {
      return { kind: 'saturated' }
    }
    return {
      kind: 'documents',
      documents: probed.map(({ id, connectorId }) => ({ id, connectorId })),
    }
  } catch (error) {
    if (!budget || !probeBudget?.isTimeout(error)) throw error
    /** Only the probe's share was spent; the leg's own deadline still governs. */
    budget.remaining()
    return { kind: 'timed_out' }
  }
}

/**
 * The probe's SQL, returning at most one row past the document limit.
 *
 * A user scope first materializes the documents its tokens reach in these bases, read through
 * `doc_acl_gin_idx` alone, then applies the state and full access conditions to those rows in
 * memory; the set is aliased as `document` so the shared conditions bind to it unchanged. Handed
 * the combined predicate instead, PostgreSQL misjudges the token overlap as unselective and
 * intersects it with base-wide indexes that read the whole search index.
 *
 * The index is global and every caller holds the baseline tokens every tenant's org-wide, public,
 * and uploaded documents carry, so the reach must be counted inside these bases or those
 * documents alone would saturate it. The base check is applied outside an `OFFSET 0` fence so it
 * filters the index's rows instead of replacing the index with a base-wide scan. The reach is
 * counted before any row is materialized, so a caller whose tokens reach past the limit pays only
 * for the count, and a `saturated` sentinel row then reports the set as unbounded. Resolved scopes
 * hold base-wide tokens, so they filter directly.
 */
export function visibleDocumentsQuery(
  knowledgeBaseIds: string[],
  conditions: (SQL | undefined)[],
  access: KnowledgeAccessScope
): SQL {
  const limit = VECTOR_PROBE_DOCUMENT_LIMIT + 1
  if (access.kind !== 'user') {
    return sql`
      SELECT ${document.id} AS id, ${document.connectorId} AS "connectorId", false AS saturated
      FROM ${document}
      WHERE ${and(...conditions)}
      LIMIT ${limit}
    `
  }
  /** Exactly `doc_acl_gin_idx`'s predicate, so both the count and the rows read that index alone. */
  const reached = sql`${document.deletedAt} IS NULL AND ${knowledgeAclOverlapCondition(access)}`
  const underLimit = sql`(SELECT n FROM reach) < ${limit}`
  const inBases = inArray(document.knowledgeBaseId, knowledgeBaseIds)
  return sql`
    WITH reach AS MATERIALIZED (
      SELECT count(*) AS n FROM (
        SELECT 1 FROM (
          SELECT ${document.knowledgeBaseId} FROM ${document} WHERE ${reached} OFFSET 0
        ) AS ${document}
        WHERE ${inBases}
        LIMIT ${limit}
      ) AS reached
    ), reachable AS MATERIALIZED (
      SELECT * FROM (
        SELECT * FROM ${document} WHERE ${underLimit} AND ${reached} OFFSET 0
      ) AS ${document}
      WHERE ${inBases}
    )
    (
      SELECT ${document.id} AS id, ${document.connectorId} AS "connectorId", false AS saturated
      FROM reachable AS ${document}
      WHERE ${underLimit} AND ${and(...conditions)}
      LIMIT ${limit}
    )
    UNION ALL
    SELECT NULL, NULL, true WHERE (SELECT n FROM reach) >= ${limit}
  `
}

/** A document a caller may rank, with the source a live authorization pass may later exclude. */
type PermittedDocument = {
  id: string
  connectorId: string | null
}

/**
 * The documents a user-scoped search may rank, resolved once before either leg runs.
 *
 * Organization search indexes grant most documents to a single mailbox, channel, or file owner,
 * so a member typically reads a vanishing share of the index. Ranking the whole index and
 * checking access afterwards then scans thousands of candidates to find none; ranking inside the
 * permitted set finds every eligible chunk at a cost proportional to what the member can read.
 * `unbounded` means the set exceeded the probe's limit, where post-filtered index search fills
 * quickly because most candidates are readable.
 */
export type PermittedDocuments =
  | { kind: 'bounded'; documents: readonly PermittedDocument[] }
  | { kind: 'unbounded'; broad: boolean }

/**
 * The share of the index a caller must reach before the whole graph is walked for them. pgvector
 * post-filters, so a walk returns a caller's own neighbours in proportion to their reach: above
 * this share almost every neighbour the graph visits is theirs and one walk is the cheapest exact
 * answer there is; below it the walk spends its budget on chunks they cannot read, and each
 * readable source is searched on its own instead.
 */
export const BROAD_REACH_SHARE = 0.25

/**
 * How long a caller's saturated reach is remembered. Reach counts the documents a caller's tokens
 * touch in the bases, which moves slowly, and an unbounded set only means the legs search the
 * index with the full access predicate, so a stale answer costs speed, never access.
 */
const SATURATED_REACH_TTL_MS = 5 * 60 * 1000

/** A saturated reach, and whether it is broad enough to walk the whole graph for. */
const saturatedReach = new LRUCache<string, { broad: boolean }>({
  max: 10_000,
  ttl: SATURATED_REACH_TTL_MS,
})

/** How many documents the bases hold: the denominator of a reach share, and it moves slowly. */
const indexDocumentCounts = new LRUCache<string, number>({
  max: 1000,
  ttl: SATURATED_REACH_TTL_MS,
  /**
   * The planner's estimate of the bases' documents, from the statistics it already keeps: a share
   * threshold needs the order of magnitude, and counting every row to learn it costs more than the
   * search it serves.
   */
  fetchMethod: async (key) => {
    const [row] = await db.execute<{ 'QUERY PLAN': Array<{ Plan: { 'Plan Rows': number } }> }>(sql`
      EXPLAIN (FORMAT JSON) SELECT 1 FROM ${document}
      WHERE ${document.knowledgeBaseId} = ANY(${textArrayLiteral(key.split(','))})
        AND ${document.deletedAt} IS NULL`)
    /** An empty answer is not remembered; the bases may simply not have been analyzed yet. */
    return Number(row?.['QUERY PLAN']?.[0]?.Plan?.['Plan Rows'] ?? 0) || undefined
  },
})

/**
 * Whether a saturated reach is broad: the caller reaches at least {@link BROAD_REACH_SHARE} of the
 * bases' documents. Counted once against that bound and remembered with the saturation, so the
 * first search after the window pays for it and the rest do not.
 */
async function reachIsBroad(
  knowledgeBaseIds: string[],
  access: KnowledgeAccessScope,
  budget: SearchBudget | undefined
): Promise<boolean> {
  if (access.kind !== 'user') return true
  const total = (await indexDocumentCounts.fetch([...knowledgeBaseIds].sort().join(','))) ?? 0
  const bound = Math.ceil(total * BROAD_REACH_SHARE)
  if (bound <= VECTOR_PROBE_DOCUMENT_LIMIT) return true
  const [row] = await runSearchQuery(budget, 'permitted_documents', (executor) =>
    executor.execute<{ n: number }>(sql`
      SELECT count(*) AS n FROM (
        SELECT 1 FROM ${document}
        WHERE ${document.deletedAt} IS NULL AND ${knowledgeAclOverlapCondition(access)}
          AND ${inArray(document.knowledgeBaseId, knowledgeBaseIds)}
        LIMIT ${bound}
      ) reached`)
  )
  return Number(row?.n ?? 0) >= bound
}

/** Reach depends only on the bases and the caller's tokens; filters narrow the set, not the reach. */
function reachKey(
  knowledgeBaseIds: readonly string[],
  access: KnowledgeAccessScope
): string | null {
  if (access.kind !== 'user') return null
  return `${[...knowledgeBaseIds].sort().join(',')}:${sha256Hex([...access.tokens].sort().join('\n'))}`
}

/** Forgets every remembered reach, after the bases' documents or a caller's tokens changed. */
export function forgetSearchReach(): void {
  saturatedReach.clear()
  indexDocumentCounts.clear()
}

/** A resolved scope's reach, remembered per bases and tokens, with no document enumerated. */
export async function resolveReach(
  knowledgeBaseIds: string[],
  access: KnowledgeAccessScope,
  budget: SearchBudget | undefined
): Promise<PermittedDocuments> {
  const key = reachKey(knowledgeBaseIds, access)
  const remembered = key ? saturatedReach.get(key) : undefined
  if (remembered) return { kind: 'unbounded', broad: remembered.broad }
  try {
    const broad = await reachIsBroad(knowledgeBaseIds, access, budget)
    if (key) saturatedReach.set(key, { broad })
    return { kind: 'unbounded', broad }
  } catch (error) {
    if (!budget?.isTimeout(error)) throw error
    /** A count that ran out of time decides this search only; the next one counts again. */
    return { kind: 'unbounded', broad: true }
  }
}

/**
 * Resolve the permitted set with the candidate predicate both legs apply, so restricting a leg
 * to it never admits a document the leg would otherwise refuse. Tag filters stay chunk-level in
 * each leg; the set is the document-level superset they narrow.
 *
 * It runs ahead of both legs on the vector leg's budget, so exhausting that budget here reports
 * `unbounded` and marks the vector leg timed out rather than failing the keyword leg with it.
 */
export async function resolvePermittedDocuments(params: {
  knowledgeBaseIds: string[]
  access: KnowledgeAccessScope
  filters?: WorkspaceSearchFilters
  budget?: SearchBudget
  accessPlan?: SearchAccessPlan
}): Promise<PermittedDocuments> {
  const key = reachKey(params.knowledgeBaseIds, params.access)
  let probe: ProbeOutcome
  let broad = true
  const remembered = key ? saturatedReach.get(key) : undefined
  if (remembered) {
    probe = { kind: 'saturated' }
    broad = remembered.broad
  } else {
    try {
      probe = await probeVisibleDocuments(
        params.knowledgeBaseIds,
        candidateDocumentConditions(
          params.knowledgeBaseIds,
          params.access,
          params.filters,
          candidateAccessCondition(params.access, params.accessPlan)
        ),
        params.access,
        params.budget,
        'permitted_documents'
      )
    } catch (error) {
      if (!params.budget?.isTimeout(error)) throw error
      probe = { kind: 'timed_out' }
    }
    if (probe.kind === 'saturated') {
      try {
        broad = await reachIsBroad(params.knowledgeBaseIds, params.access, params.budget)
      } catch (error) {
        if (!params.budget?.isTimeout(error)) throw error
      }
      if (key) saturatedReach.set(key, { broad })
    }
  }
  const permitted: PermittedDocuments =
    probe.kind === 'documents'
      ? { kind: 'bounded', documents: probe.documents }
      : { kind: 'unbounded', broad }
  annotateSearchDiagnostics({
    permittedDocuments: permitted.kind,
    ...(probe.kind === 'documents' ? { permittedDocumentCount: probe.documents.length } : {}),
  })
  return permitted
}

/**
 * Tags live on chunks, so a row qualifies when a chunk it joins to carries them — and only a
 * chunk the search can actually return counts, or a document whose sole match is disabled would
 * be admitted by a check that ranking then discards.
 */
function chunkTagCondition(join: SQL, tagConditions: SQL[]): SQL | undefined {
  if (!tagConditions.length) return undefined
  return sql`EXISTS (
    SELECT 1 FROM ${embedding}
    WHERE ${and(join, eq(embedding.enabled, true), ...tagConditions)}
  )`
}

/**
 * How many chunks the sliced sources contribute to exact ranking. A caller's slice of mirrored
 * sources — their mail, their files, the spaces they belong to — sits below this, and ranking that
 * many exactly, on the projection's half-precision vectors, measures in tens of milliseconds.
 */
const SOURCE_EXACT_CHUNK_LIMIT = 150_000

/** Sources whose own index a caller's ranking walks, and whether anything is left to rank exactly. */
interface SourceVectorPlan {
  walked: readonly string[]
  sliced: readonly string[]
}

/**
 * How each readable source contributes its nearest chunks.
 *
 * Membership decides it, not a count: a member of a source reads essentially all of it, so its own
 * index is walked and the graph's neighbours are chunks they can read. Every other source is
 * sliced — mirrored permissions give a caller their own mail, their own files — and those slices
 * are ranked exactly together, which is cheaper than a walk and exact by construction. A source
 * the caller is a member of but which has no index of its own is sliced too.
 */
function planSourceVectorCandidates(input: {
  plan: SearchAccessPlan
  indexedSources: ReadonlySet<string>
}): SourceVectorPlan {
  const eligible = [
    ...new Set([
      ...input.plan.connectors.workspace,
      ...input.plan.connectors.admin,
      ...input.plan.connectors.members,
    ]),
  ]
  const walked = input.plan.memberSources.filter((id) => input.indexedSources.has(id))
  const walking = new Set(walked)
  return { walked, sliced: eligible.filter((id) => !walking.has(id)) }
}

/**
 * The nearest readable chunks, gathered per source and merged by distance.
 *
 * Walking one source at a time is what keeps recall: pgvector post-filters, so a walk over every
 * source spends its scan budget on the sources this caller cannot read and returns few of their
 * true neighbours. Inside one source they read, almost every neighbour qualifies.
 *
 * Nothing but the merged identities crosses the wire — each source's readable documents are
 * resolved inside its own statement.
 */
async function selectSourceVectorCandidates(input: {
  access: KnowledgeAccessScope
  knowledgeBaseIds: string[]
  plan: SearchAccessPlan
  tagCondition: SQL | undefined
  documentTagCondition: SQL | undefined
  candidateDistance: SQL<number>
  candidateLimit: number
  budget?: SearchBudget
}): Promise<Array<{ id: string }>> {
  const sources = planSourceVectorCandidates({
    plan: input.plan,
    indexedSources: await indexedVectorSources(),
  })
  annotateSearchDiagnostics({
    vectorRanking: 'per-source',
    vectorSourcesWalked: sources.walked.length,
    vectorSourcesSliced: sources.sliced.length,
  })
  const base = and(
    inArray(embeddingSearch.knowledgeBaseId, input.knowledgeBaseIds),
    eq(embeddingSearch.enabled, true),
    input.tagCondition
  )
  type RankedChunks = Promise<Array<{ id: string; distance: number }>>
  /**
   * Walks one source's own index, or the sliced sources together when their slice saturated.
   * Readability is decided on the row the walk visits — the source and ACL are mirrored there —
   * so the graph is not stalled by a document lookup per candidate; the tag filter, which lives on
   * the chunk, still joins.
   */
  const onRow = projectionCandidateAccessCondition(embeddingSearch, input.access, input.plan)
  const walk =
    (scope: SQL): (() => RankedChunks) =>
    () =>
      withVectorScanSettings(
        (executor) =>
          executor.execute<{ id: string; distance: number }>(sql`
            SELECT ${embeddingSearch.id} AS id, ${input.candidateDistance} AS distance
            FROM ${embeddingSearch} /* on-row visibility */
            WHERE ${and(
              base,
              scope,
              onRow,
              input.documentTagCondition === undefined
                ? undefined
                : sql`EXISTS (
              SELECT 1 FROM ${document}
              WHERE ${and(eq(document.id, embeddingSearch.documentId), input.documentTagCondition)}
            )`
            )}
            ORDER BY ${input.candidateDistance} LIMIT ${input.candidateLimit}`),
        input.budget,
        'vector.source_walk',
        ON_ROW_WALK_SCAN_TUPLES
      )
  const walks: Array<() => RankedChunks> = sources.walked.map((connectorId) =>
    walk(eq(embeddingSearch.connectorId, connectorId))
  )
  const slicedScope = sql`(${embeddingSearch.connectorId} IS NULL
    OR ${embeddingSearch.connectorId} = ANY(${textArrayLiteral([...sources.sliced])}))`
  /** One statement for every sliced source: their readable chunks, ranked exactly on the row. */
  /**
   * One statement for the sliced sources and, with them, every uploaded document: uploads carry no
   * connector, so a caller who is a member of all the indexed sources would otherwise rank none.
   */
  const slice: Array<() => RankedChunks> = [
    async () => {
      /**
       * The sliced sources' readable chunks, decided on the row, ranked exactly: the ACL index
       * enumerates them and `+ 0` keeps the planner off the graph. The chunks are counted one past
       * the bound in the same statement, so a set too large to rank exactly is known before it is.
       */
      const readableChunks = and(
        base,
        slicedScope,
        onRow,
        input.documentTagCondition === undefined
          ? undefined
          : sql`EXISTS (SELECT 1 FROM ${document} WHERE ${and(eq(document.id, embeddingSearch.documentId), input.documentTagCondition)})`
      )
      const rows = await runSearchQuery(input.budget, 'vector.source_exact', (executor) =>
        executor.execute<{ id: string; distance: number; saturated: boolean }>(sql`
                WITH readable_chunks AS MATERIALIZED (
                  SELECT ${embeddingSearch.id} AS id, ${input.candidateDistance} AS distance
                  FROM ${embeddingSearch}
                  WHERE ${readableChunks}
                  LIMIT ${SOURCE_EXACT_CHUNK_LIMIT + 1}
                )
                SELECT id, distance + 0 AS distance,
                  (SELECT count(*) FROM readable_chunks) > ${SOURCE_EXACT_CHUNK_LIMIT} AS saturated
                FROM readable_chunks
                ORDER BY distance LIMIT ${input.candidateLimit}`)
      )
      /**
       * The slice enumerates readable chunks in no particular order, so a set past its bound
       * would rank an arbitrary subset and could miss the nearest chunks entirely. Walk those
       * sources instead: approximate, but drawn from the whole of them.
       */
      if (!rows.some((row) => row.saturated)) return rows
      annotateSearchDiagnostics({ vectorSlicedSaturated: true })
      return walk(slicedScope)()
    },
  ]
  /** A source whose search runs out of budget marks the leg partial; the others' results stand. */
  const scored = await mapWithConcurrency(
    [...walks, ...slice],
    SOURCE_RANKING_CONCURRENCY,
    async (run) => {
      try {
        return await run()
      } catch (error) {
        if (!input.budget?.isTimeout(error)) throw error
        return []
      }
    }
  )
  const ranked: Array<{ id: string; distance: number }> = scored.flat()
  return ranked
    .sort((a, b) => Number(a.distance) - Number(b.distance))
    .slice(0, input.candidateLimit)
    .map((row) => ({ id: row.id }))
}

/** Sources ranked at once; each holds a connection for its own statement. */
const SOURCE_RANKING_CONCURRENCY = 3

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
    ? candidateAccessCondition(params.access, params.accessPlan)
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
  let candidatePool: { excludedKey: string; ids: Array<{ id: string }> } | undefined
  return selectAuthorizedSearchResults({
    leg: 'vector',
    access: params.access,
    liveSourceAccess: params.liveSourceAccess,
    filters: params.filters,
    signal: params.signal,
    budget: params.budget,
    topK: params.topK,
    compareResults: (a, b) => a.distance - b.distance,
    selectPage: async (limit, offset, excludedSources) => {
      const excludedKey = [...excludedSources].sort().join(',')
      const visibility = [
        ...getVisibilityConditions(params.access, params.filters, candidateAccess),
        excludeSearchSources(excludedSources),
      ]
      const candidateDocumentVisibility = [
        ...candidateDocumentConditions(
          params.knowledgeBaseIds,
          params.access,
          params.filters,
          candidateAccess
        ),
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
      if (candidatePool?.excludedKey !== excludedKey) {
        const plannedIndexedSources =
          params.access.kind === 'user' && params.accessPlan?.memberSources.length
            ? await indexedVectorSources()
            : undefined
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
         * `+ 0` keeps the planner off the ANN index, and the permitted identities keep the scan on
         * `embedding_search_document_lookup_idx`, so this reads what the permitted set costs
         * rather than re-deriving permission across the whole index. Exact ranking also honours
         * `statement_timeout`, which a traversal cannot.
         */
        const rankPermittedExactly = async (documentIds: string[]) => {
          annotateSearchDiagnostics({ vectorRanking: 'exact-candidates' })
          if (!documentIds.length) return []
          return runSearchQuery(params.budget, 'vector.exact_candidates', (executor) =>
            executor.execute<{ id: string }>(sql`
              SELECT ${embeddingSearch.id} AS id FROM ${embeddingSearch}
              WHERE ${and(
                inArray(embeddingSearch.knowledgeBaseId, params.knowledgeBaseIds),
                eq(embeddingSearch.enabled, true),
                sql`${embeddingSearch.documentId} = ANY(${textArrayLiteral(documentIds)})`,
                candidateTagCondition
              )}
              ORDER BY (${candidateDistance}) + 0 LIMIT ${candidateLimit}
            `)
          )
        }
        let selected: Array<{ id: string }>
        const plan = params.access.kind === 'user' ? params.accessPlan : undefined
        /**
         * A source the caller is a member of that has its own index is walked on its own, which
         * beats ranking it exactly once it is large enough to have earned that index.
         */
        const walksASource = plan?.memberSources.some(
          (id) => plannedIndexedSources?.has(id) ?? false
        )
        if (params.permitted?.kind === 'bounded' && !walksASource) {
          /**
           * A bounded permitted set is ranked exactly without walking the graph first: the walk
           * post-filters, so when the caller reads a small share of the index it spends its whole
           * uninterruptible tuple budget and still returns almost none of their neighbours.
           */
          selected = await rankPermittedExactly(params.permitted.documents.map((entry) => entry.id))
        } else if (plan && !(params.permitted?.kind === 'unbounded' && params.permitted.broad)) {
          /**
           * Readability follows sources, so each readable source is searched in its own index and
           * the results merged. A member reads a source whole or barely at all: walking one source
           * spends its budget among chunks they can read, where a walk over every source spends it
           * on the sources they cannot. A caller whose reach is broad skips this: for them the
           * whole graph's neighbours are mostly theirs already, and one walk is the cheaper answer.
           */
          selected = await selectSourceVectorCandidates({
            access: params.access,
            knowledgeBaseIds: params.knowledgeBaseIds,
            plan,
            tagCondition: candidateTagCondition,
            documentTagCondition,
            candidateDistance,
            candidateLimit,
            budget: params.budget,
          })
        } else {
          /**
           * The bounded ANN traversal is the whole candidate set. LIMIT keeps document
           * authorization downstream of the traversal, with a primary-key lookup per candidate.
           */
          const scopeOfWalk = and(
            inArray(embeddingSearch.knowledgeBaseId, params.knowledgeBaseIds),
            eq(embeddingSearch.enabled, true)
          )
          selected = await withVectorScanSettings(
            (executor) =>
              executor.execute<{ id: string }>(
                plan
                  ? sql`
            SELECT ${embeddingSearch.id} AS id FROM ${embeddingSearch} /* on-row visibility */
            WHERE ${and(
              scopeOfWalk,
              projectionCandidateAccessCondition(embeddingSearch, params.access, plan),
              documentTagCondition === undefined
                ? undefined
                : sql`EXISTS (SELECT 1 FROM ${document} WHERE ${and(eq(document.id, embeddingSearch.documentId), documentTagCondition)})`
            )}
            ORDER BY ${candidateDistance} LIMIT ${candidateLimit}
          `
                  : sql`
            SELECT ${embeddingSearch.id} AS id FROM ${embeddingSearch}
            CROSS JOIN LATERAL (
              SELECT 1 FROM ${document}
              WHERE ${and(eq(document.id, embeddingSearch.documentId), ...candidateDocumentVisibility, candidateTagCondition)}
              LIMIT 1
            ) AS visible
            WHERE ${scopeOfWalk}
            ORDER BY ${candidateDistance} LIMIT ${candidateLimit}
          `
              ),
            params.budget,
            'vector.candidate_search',
            plan ? ON_ROW_WALK_SCAN_TUPLES : undefined
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
           * afford. An `unbounded` permitted set already proved it is not, so the probe is skipped.
           */
          /**
           * A walk that decides readability on the row is not discarded that way: it keeps
           * walking, up to its cap, until the limit is met, so an underfilled on-row walk means
           * the caller's readable chunks near the query are simply that few.
           */
          if (selected.length < candidateLimit && params.permitted?.kind !== 'unbounded') {
            const probe = await probeVisibleDocuments(
              params.knowledgeBaseIds,
              [...candidateDocumentVisibility, documentTagCondition],
              params.access,
              params.budget,
              'vector.probe'
            )
            if (probe.kind === 'documents') {
              annotateSearchDiagnostics({ vectorProbeDocumentCount: probe.documents.length })
              selected = await rankPermittedExactly(probe.documents.map(({ id }) => id))
            }
          }
        }
        candidatePool = { excludedKey, ids: selected }
        annotateSearchDiagnostics({
          vectorCandidateCount: selected.length,
          vectorCandidateScan: selected.length < candidateLimit ? 'underfilled' : 'planned',
        })
      }
      const identities = candidatePool.ids
      if (!identities.length) return { candidates: [], nextOffset: offset }
      /** Score each bounded candidate once; sorting the materialized scalar cannot invoke HNSW again. */
      const page = await runSearchQuery(params.budget, 'vector.rerank', (executor) =>
        executor.execute<SearchReadCandidate & { distance: number }>(sql`
          WITH scored_search_candidates AS MATERIALIZED (
            SELECT ${embedding.id} AS id, ${document.id} AS "documentId",
              ${document.connectorId} AS "connectorId",
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
  liveSourceAccess?: LiveSourceAccess
  signal?: AbortSignal
  budget?: SearchBudget
  query: string
  /** Query embedding, so keyword-only hits still carry a real cosine distance. */
  queryVector: KnowledgeQueryVector
  structuredFilters?: StructuredFilter[]
  filters?: WorkspaceSearchFilters
  /** Resolved once per user-scoped search; absent for resolved scopes and explicit documents. */
  permitted?: PermittedDocuments
  /** Connector state resolved once per search, so no candidate re-derives it. */
  accessPlan?: SearchAccessPlan
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
 *
 * The live-scope ranking query runs in three stages: match, authorize, rank. The
 * visibility predicate carries correlated subqueries — one per connector, one per
 * search-integration decision — so evaluating it across a base ahead of the query costs a table
 * pass priced by how many documents the base holds rather than by how many the query matched.
 * Matching first restricts that predicate to the documents the query actually matched.
 *
 * Two details keep that ordering from paying the saving back. Restricting the predicate with
 * `document.id = ANY (...)` rather than a subquery keeps the narrowed lookup on a bitmap scan,
 * which prefetches, where a plain `IN (SELECT ...)` plans as an index walk that does not. And
 * the match stage carries identifiers only: ranking every match rather than every *visible*
 * match would detoast one text-search vector per match, which on a mid-frequency term costs
 * more than the pass it replaces.
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
    /**
     * A caller reaching past the permitted-set limit reads much of the index, so ranking every
     * match before checking access is the leg's whole cost for a common term. Where the Tin
     * projection is complete, BM25 ranks inside the bases first and access is checked only on the
     * top of that ranking.
     */
    const tinQuery =
      params.permitted?.kind === 'unbounded' && tagFilterConditions.length === 0
        ? await resolveTinKeywordQuery(knowledgeBaseIds, query, FTS_CONFIG, params.budget)
        : null
    annotateSearchDiagnostics({
      ...(params.permitted?.kind === 'unbounded'
        ? { keywordRanking: tinQuery ? 'tin' : 'gin' }
        : {}),
    })
    const accessPlan = access.kind === 'user' ? params.accessPlan : undefined
    /** The projection predicate over the ranked CTE's mirrored columns, plus any excluded source. */
    const onRowKeywordVisibility = (excludedSources: readonly string[]) =>
      and(
        projectionCandidateAccessCondition(
          {
            connectorId: sql`ranked_tin_chunks.connector_id`,
            acl: sql`ranked_tin_chunks.acl`,
            documentId: sql`ranked_tin_chunks.document_id`,
          },
          access,
          accessPlan!
        ),
        excludedSources.length
          ? sql`(ranked_tin_chunks.connector_id IS NULL OR NOT (ranked_tin_chunks.connector_id = ANY(${textArrayLiteral([...excludedSources])})))`
          : undefined
      )
    const documentConditions = (excludedSources: readonly string[]) =>
      and(
        ...candidateDocumentConditions(
          knowledgeBaseIds,
          access,
          params.filters,
          candidateAccessCondition(access, params.accessPlan)
        ),
        excludeSearchSources(excludedSources)
      )
    /**
     * One page from the top of Tin's ranking. The window of ranked chunks widens while too few of
     * them are readable to fill the page; if the widest window still cannot, the page is left to
     * the GIN ranking, which covers every match.
     */
    const selectTinPage = async (
      scopedQuery: SQL,
      limit: number,
      offset: number,
      excludedSources: readonly string[]
    ): Promise<SearchReadCandidatePage | null> => {
      /**
       * A resolved scope decides readability on the ranked row. The windows widen while the page
       * is short, a narrow reader's to a wide one sooner and no further, and what the widest
       * cannot fill is left short rather than handed to a ranking over every match.
       */
      const narrow =
        accessPlan !== undefined &&
        params.permitted?.kind === 'unbounded' &&
        !params.permitted.broad
      const windows: readonly number[] = narrow ? NARROW_KEYWORD_WINDOWS : TIN_KEYWORD_WINDOWS
      /**
       * A narrow reader's page is the readable remainder of a wide ranking, and that ranking is
       * the cost: each page would rank the window again to find the next few readable rows, so one
       * statement returns as many as several pages could ask for.
       */
      const pageLimit = narrow ? Math.max(limit, NARROW_KEYWORD_PAGE) : limit
      for (const window of windows) {
        if (window < offset + limit) continue
        const [page] = await runSearchQuery(params.budget, 'keyword.tin', (executor) =>
          executor.execute<{ ranked: number; candidates: SearchReadCandidate[] }>(sql`
            WITH ranked_tin_chunks AS MATERIALIZED (
              SELECT ${embeddingKeywordTin.id} AS id, ${embeddingKeywordTin.documentId} AS document_id,
                ${embeddingKeywordTin.enabled} AS enabled, ${embeddingKeywordTin.connectorId} AS connector_id,
                ${embeddingKeywordTin.acl} AS acl,
                tin.full_score(${embeddingKeywordTin}.ctid) AS keyword_rank
              FROM ${embeddingKeywordTin}
              WHERE ${embeddingKeywordTin.content} ==> (${scopedQuery})
              ORDER BY keyword_rank DESC
              LIMIT ${window}
            ), page AS (
              ${
                accessPlan
                  ? /**
                     * Readability decided on the ranked row: its source and ACL are mirrored there,
                     * so a window of mostly unreadable chunks costs an array test per row, not a
                     * document lookup. The full predicate follows at hydration.
                     */
                    sql`
              SELECT ranked_tin_chunks.id, ranked_tin_chunks.document_id AS "documentId",
                ranked_tin_chunks.connector_id AS "connectorId", ranked_tin_chunks.keyword_rank
              FROM ranked_tin_chunks /* on-row visibility */
              WHERE ranked_tin_chunks.enabled AND ${onRowKeywordVisibility(excludedSources)}
              ORDER BY ranked_tin_chunks.keyword_rank DESC, ranked_tin_chunks.id
              LIMIT ${pageLimit} OFFSET ${offset}`
                  : sql`
              SELECT ranked_tin_chunks.id, ${document.id} AS "documentId",
                ${document.connectorId} AS "connectorId",
                ranked_tin_chunks.keyword_rank
              FROM ranked_tin_chunks INNER JOIN ${document}
                ON ${document.id} = ranked_tin_chunks.document_id
              WHERE ranked_tin_chunks.enabled
                AND ${and(...candidateDocumentConditions(knowledgeBaseIds, access, params.filters, knowledgeAccessCondition(access)), excludeSearchSources(excludedSources))}
              ORDER BY ranked_tin_chunks.keyword_rank DESC, ranked_tin_chunks.id
              LIMIT ${pageLimit} OFFSET ${offset}`
              }
            )
            SELECT (SELECT count(*)::int FROM ranked_tin_chunks) AS ranked,
              coalesce((
                SELECT json_agg(json_build_object(
                  'id', page.id, 'documentId', page."documentId", 'connectorId', page."connectorId"
                ) ORDER BY page.keyword_rank DESC, page.id)
                FROM page
              ), '[]'::json) AS candidates
          `)
        )
        annotateSearchDiagnostics({ keywordTinWindow: window })
        if (
          page.candidates.length >= limit ||
          page.ranked < window ||
          (accessPlan !== undefined && window === windows[windows.length - 1])
        ) {
          return { candidates: page.candidates, nextOffset: offset + page.candidates.length }
        }
      }
      return null
    }
    /** Parenthesized where used: `==>` binds tighter than `||`. */
    const tinScope = tinQuery
      ? sql`'(' || ${sql.join(
          knowledgeBaseIds.map((id) => sql`knowledge_tin_base_token(${id}) || '^0'`),
          sql` || ' OR ' || `
        )} || ') AND (' || ${tinQuery} || ')'`
      : undefined
    /** Keep readable identities and rank scalars separate so sorts never carry full text-search vectors. */
    return selectAuthorizedSearchResults({
      leg: 'keyword',
      access: params.access,
      liveSourceAccess: params.liveSourceAccess,
      filters: params.filters,
      signal: params.signal,
      budget: params.budget,
      topK,
      selectPage: async (limit, offset, excludedSources) => {
        /**
         * A bounded permitted set confines matching to the chunks the caller may read, so a term
         * common across the index is ranked only where it can surface. The visibility CTE below
         * still re-applies the candidate predicate, so the restriction can only narrow.
         */
        const permittedIds =
          params.permitted?.kind === 'bounded'
            ? params.permitted.documents.map((entry) => entry.id)
            : undefined
        if (permittedIds?.length === 0) return { candidates: [], nextOffset: offset }
        if (tinScope && (accessPlan || !permittedIds)) {
          const tinPage = await selectTinPage(tinScope, limit, offset, excludedSources)
          if (tinPage) return tinPage
          annotateSearchDiagnostics({ keywordRanking: 'gin' })
        }
        const baseScope = and(
          inArray(embeddingKeywordSearch.knowledgeBaseId, knowledgeBaseIds),
          eq(embeddingKeywordSearch.enabled, true)
        )
        const chunkMatch = and(
          sql`${embeddingKeywordSearch.contentTsv} @@ ${tsQuery}`,
          tagFilterConditions.length
            ? sql`EXISTS (
            SELECT 1 FROM ${embedding} WHERE ${embedding.id} = ${embeddingKeywordSearch.id}
              AND ${and(...tagFilterConditions)}
          )`
            : undefined
        )
        /**
         * A bounded permitted set is read through its documents alone and matched row by row, at a
         * cost linear in the permitted chunks. Offered the text or base indexes alongside,
         * PostgreSQL may intersect the permitted chunks with every chunk in the base that holds the
         * term or sits in the base; measured on an organization index that plan cost several
         * times the direct read, and the direct read is never materially slower. The permitted
         * documents were resolved inside these bases; the base check still applies to the rows
         * read, so the read can never widen the scope. `OFFSET 0` keeps the read from being
         * flattened back into an intersection; the alias lets the shared conditions bind to it.
         */
        const matchedChunks = permittedIds
          ? sql`
              SELECT ${embeddingKeywordSearch.id} AS id, ${embeddingKeywordSearch.documentId} AS document_id
              FROM (
                SELECT * FROM ${embeddingKeywordSearch}
                WHERE ${embeddingKeywordSearch.documentId} = ANY(${textArrayLiteral(permittedIds)})
                OFFSET 0
              ) AS ${embeddingKeywordSearch}
              WHERE ${and(baseScope, chunkMatch)}`
          : sql`
              SELECT ${embeddingKeywordSearch.id} AS id, ${embeddingKeywordSearch.documentId} AS document_id
              FROM ${embeddingKeywordSearch}
              WHERE ${and(baseScope, chunkMatch)}`
        const candidates = await runSearchQuery(params.budget, 'keyword.sql', (executor) =>
          executor.execute<SearchReadCandidate>(sql`
            WITH matched_keyword_chunks AS MATERIALIZED (${matchedChunks}
            ), visible_keyword_documents AS MATERIALIZED (
              SELECT ${document.id} AS id FROM ${document}
              WHERE ${and(
                sql`${document.id} = ANY (ARRAY(SELECT document_id FROM matched_keyword_chunks))`,
                documentConditions(excludedSources)
              )}
            ), ranked_keyword_candidates AS MATERIALIZED (
              SELECT matched_keyword_chunks.id, matched_keyword_chunks.document_id,
                ${candidateRank} AS keyword_rank
              FROM matched_keyword_chunks INNER JOIN ${embeddingKeywordSearch}
                ON ${embeddingKeywordSearch.id} = matched_keyword_chunks.id
              WHERE matched_keyword_chunks.document_id IN (SELECT id FROM visible_keyword_documents)
              ORDER BY keyword_rank DESC, matched_keyword_chunks.id
              LIMIT ${limit} OFFSET ${offset}
            )
            SELECT ranked_keyword_candidates.id, ${document.id} AS "documentId",
              ${document.connectorId} AS "connectorId"
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
  liveSourceAccess?: LiveSourceAccess
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
  /** The scope the returned content was read under; what may see these rows may see their metadata. */
  readAccess: KnowledgeAccessScope
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
  const finish = async (rows: SearchResult[]): Promise<KnowledgeRetrievalResult> => {
    params.signal?.throwIfAborted()
    const readAccess = (await liveSourceAccess?.current()) ?? access
    const timedOutLegs = Object.values(budgets)
      .filter((budget) => budget.timedOut)
      .map((budget) => budget.leg)
    return {
      rows: boostRecency ? applyRecencyBoost(rows) : rows,
      retrieval: { status: timedOutLegs.length ? 'partial' : 'complete', timedOutLegs },
      readAccess,
    }
  }
  /**
   * Connector state is the same for every document a connector owns, so both legs read it from
   * one resolution instead of proving it per candidate.
   */
  const accessPlan =
    access.kind === 'user' && params.accessProvider
      ? await measureSearchStage('access_plan', () =>
          resolveSearchAccessPlan(knowledgeBaseIds, access)
        )
      : undefined
  const liveSourceAccess = liveSourceAccessFor(
    access,
    accessPlan,
    params.accessProvider,
    params.signal
  )
  const common = {
    knowledgeBaseIds,
    access,
    accessProvider: params.accessProvider,
    signal: params.signal,
    filters: params.filters,
    structuredFilters,
    liveSourceAccess,
  }
  const hasQuery = Boolean(query?.trim())
  const hasFilters = Boolean(structuredFilters?.length)
  if (!hasQuery) {
    if (!hasFilters) throw new Error('A search query or tag filters are required')
    return finish(
      await measureSearchStage('tags', () =>
        handleTagOnlySearch({ ...common, topK, budget: budgets.tags, accessPlan })
      )
    )
  }
  if (!queryVector) throw new Error('Query vector is required when searching with a query')
  const { distanceThreshold } = getQueryStrategy(knowledgeBaseIds.length, topK)
  const legTopK = searchMode === 'hybrid' ? hybridCandidateCount(topK) : topK
  /**
   * Live user scopes resolve what they may read once, before either leg, so both rank inside it
   * when it is small. Resolved scopes read whole bases, and explicit documents are already a
   * bounded scope with their own exhaustive ordering.
   */
  const permitted =
    access.kind === 'user' && params.accessProvider && !params.filters?.documentIds?.length
      ? accessPlan
        ? /**
           * With readability decided on the projection row, a resolved scope never needs its
           * readable documents enumerated ahead of ranking: its reach alone chooses between one
           * walk over the whole graph and a search of each source.
           */
          await measureSearchStage('permitted_documents', () =>
            resolveReach(knowledgeBaseIds, access, budgets.vector)
          )
        : await resolvePermittedDocuments({
            knowledgeBaseIds,
            access,
            filters: params.filters,
            budget: budgets.vector,
            accessPlan,
          })
      : undefined
  const vectorParams = {
    ...common,
    topK: legTopK,
    queryVector,
    distanceThreshold,
    budget: budgets.vector,
    permitted,
    accessPlan,
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
      permitted,
      accessPlan,
    })
  )
  const legs = await Promise.allSettled([vectorSearch, keywordSearch])
  /** Wait for both legs to release SQL resources; only deadline failures permit partial success. */
  for (const leg of legs) if (leg.status === 'rejected') throw leg.reason
  const vectorResults = legs[0].status === 'fulfilled' ? legs[0].value : []
  const keywordResults = legs[1].status === 'fulfilled' ? legs[1].value : []
  return finish(fuseByReciprocalRank([keywordResults, vectorResults], topK))
}
