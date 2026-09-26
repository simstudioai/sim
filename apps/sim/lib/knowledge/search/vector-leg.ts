import { db } from '@sim/db'
import { document, embedding, embeddingSearch } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage, getPostgresErrorCode } from '@sim/utils/errors'
import { and, eq, inArray, type SQL, sql } from 'drizzle-orm'
import { textArrayLiteral } from '@/lib/knowledge/access/predicate'
import {
  runSearchQuery,
  type SearchBudget,
  type SearchExecutor,
  sessionSettingsStatement,
} from '@/lib/knowledge/search/budget'
import {
  hydrateSearchCandidates,
  type KnowledgeQueryVector,
  SEARCH_READ_CANDIDATE_FIELDS,
  type SearchParams,
  type SearchReadCandidate,
  type SearchReadCandidatePage,
} from '@/lib/knowledge/search/candidates'
import {
  annotateSearchDiagnostics,
  measureSearchStage,
  recordSearchStageDuration,
  type SearchStage,
} from '@/lib/knowledge/search/diagnostics'
import { chunkTagCondition, getStructuredTagFilters } from '@/lib/knowledge/search/tag-filters'
import {
  embeddingCandidateDimensions,
  embeddingCandidateDistance,
  embeddingDistance,
} from '@/lib/knowledge/vector-columns'

const logger = createLogger('KnowledgeSearchCandidates')

/** SQLSTATE for an unrecognised configuration parameter — pgvector older than 0.8. */
const UNDEFINED_OBJECT_SQLSTATE = '42704'
/**
 * Approximate iterative-visit threshold for a permission-starved graph walk. It excludes
 * pgvector's initial beam, so it only takes effect once `ResumeScanItems` starts widening.
 *
 * It must therefore stay roughly an order of magnitude above `ef_search`, or the first beam
 * already exhausts the tuple budget and the scan stops before it can iterate at all — pgvector's
 * maintainer says as much in pgvector#912. Measured on a large corpus, pairing a 1,000-wide beam
 * with a 1,000-tuple budget returned fewer candidates than a narrower beam allowed to iterate,
 * and spent longer inside the one uninterruptible beam.
 */
export const CANDIDATE_HNSW_MAX_SCAN_TUPLES = 20_000

/**
 * Beam width per iteration. A beam is the granularity of cancellation: pgvector calls
 * `CHECK_FOR_INTERRUPTS` only while building an index, never inside `hnswgettuple`, so neither
 * `statement_timeout` nor a cancellation request can interrupt one. A narrower beam that iterates
 * therefore bounds the leg's uninterruptible floor as well as widening its reach.
 */
const CANDIDATE_HNSW_EF_SEARCH = '200'
const CANDIDATE_HNSW_SCAN_MEM_MULTIPLIER = '2'
/**
 * Candidates one walk gathers: the pages the search has asked for so far and as many again, in
 * case the full read predicate refuses some. The walk ends as soon as it has them, so a pool the
 * size of a page ends long before one sized for a rerank; a pool the pages outrun is walked again,
 * wider. The ceiling bounds the widest walk.
 */
const VECTOR_CANDIDATE_POOL_MIN = 200
export const MAX_VECTOR_CANDIDATES = 1600

/** The pool a search needs to serve `needed` candidates, at least twice the last pool. */
export function vectorCandidatePoolLimit(needed: number, previous: number | undefined): number {
  return Math.min(
    MAX_VECTOR_CANDIDATES,
    Math.max(VECTOR_CANDIDATE_POOL_MIN, needed * 2, (previous ?? 0) * 2)
  )
}

/**
 * A vector leg's candidate pool. Candidate selection ignores the page offset — only hydration
 * pages over the pool — so a page the hydrated rows outran reuses the pool it already has, and a
 * pool the pages outran is gathered again, wider. Excluding a denied source changes which
 * candidates belong in it.
 */
export interface VectorCandidatePool {
  excludedKey: string
  ids: SearchReadCandidate[]
  limit: number
  exhausted: boolean
}

/** What a pool rebuild is given: the pool's key, its new limit, and the pool it widens, if any. */
export interface VectorCandidatePoolRebuild<P extends VectorCandidatePool> {
  excludedKey: string
  candidateLimit: number
  previous: P | undefined
}

/**
 * The pool a page reads: the current one while it still serves the page under the same excluded
 * sources, otherwise the one `rebuild` gathers.
 */
export async function readVectorCandidatePool<P extends VectorCandidatePool>(
  pool: P | undefined,
  excludedSources: readonly string[],
  offset: number,
  limit: number,
  rebuild: (plan: VectorCandidatePoolRebuild<P>) => Promise<P>
): Promise<P> {
  const excludedKey = [...excludedSources].sort().join(',')
  const needed = offset + limit
  if (pool?.excludedKey === excludedKey && (pool.exhausted || pool.ids.length >= needed)) {
    return pool
  }
  const previous = pool?.excludedKey === excludedKey ? pool : undefined
  return rebuild({
    excludedKey,
    candidateLimit: vectorCandidatePoolLimit(needed, previous?.limit),
    previous,
  })
}

/**
 * A gathered pool. One the walk could not fill, or one at the ceiling, is all the pages will ever
 * get; `knownExhausted` overrides the fill test where a pool's end is known better than by its
 * length.
 */
export function gatheredVectorCandidatePool(
  excludedKey: string,
  selected: SearchReadCandidate[],
  candidateLimit: number,
  knownExhausted?: boolean
): VectorCandidatePool {
  return {
    excludedKey,
    ids: selected,
    limit: candidateLimit,
    exhausted:
      (knownExhausted ?? selected.length < candidateLimit) ||
      candidateLimit >= MAX_VECTOR_CANDIDATES,
  }
}

/** The pool's order is the page's order, so a page is a slice of it. */
export function sliceVectorCandidatePool(
  pool: VectorCandidatePool,
  offset: number,
  limit: number
): SearchReadCandidatePage {
  const slice = pool.ids.slice(offset, offset + limit)
  return { candidates: slice, nextOffset: offset + slice.length }
}

/** How long to stop trying the iterative-scan settings after the server rejected them. */
const HNSW_SETTINGS_UNSUPPORTED_RETRY_MS = 10 * 60 * 1000

let hnswSettingsUnsupportedUntil = 0

/**
 * Shared HNSW indexes can be selective on KB scope, access, or tags, even for
 * small workspace searches. Iterative scans keep looking within a bounded
 * tuple budget. A transaction keeps the settings local under pooled connections;
 * older extensions retry without tuning until the compatibility cooldown expires.
 */
export async function withVectorScanSettings<T>(
  run: (executor: SearchExecutor) => Promise<T>,
  budget: SearchBudget | undefined,
  stage: SearchStage,
  maxScanTuples: number = CANDIDATE_HNSW_MAX_SCAN_TUPLES
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

/** What every vector leg derives from its query before it ranks a candidate. */
export interface VectorLegSetup {
  queryVector: KnowledgeQueryVector
  /** The projection's score: the walk and the candidate threshold stay in cache; a page is scored on the original vectors at hydration. */
  distance: SQL<number>
  /** The bases, the tag filters and the threshold: what every hydrated row still meets. */
  conditions: SQL[]
  /** Applied on the projection row before the candidate limit, so the limit never counts rows the tags exclude. */
  candidateTagCondition: SQL | undefined
  /** The same tags, asked of a document: whether any chunk it can return carries them. */
  documentTagCondition: SQL | undefined
}

/** The shared setup of a vector leg; a leg without a query vector and threshold is a caller defect. */
export function prepareVectorLeg(params: SearchParams): VectorLegSetup {
  const { queryVector, distanceThreshold } = params
  if (!queryVector || !distanceThreshold) {
    throw new Error('Query vector and distance threshold are required for vector search')
  }
  const distance = embeddingCandidateDistance(
    queryVector.dimensions,
    queryVector.vector,
    queryVector.model
  )
  const tagConditions = getStructuredTagFilters(params.structuredFilters ?? [], embedding)
  return {
    queryVector,
    distance,
    conditions: [
      inArray(embedding.knowledgeBaseId, params.knowledgeBaseIds),
      ...tagConditions,
      sql`${distance} < ${distanceThreshold}`,
    ],
    candidateTagCondition: chunkTagCondition(eq(embedding.id, embeddingSearch.id), tagConditions),
    documentTagCondition: chunkTagCondition(eq(embedding.documentId, document.id), tagConditions),
  }
}

/** Explicit document IDs are already a bounded scope, and keep exhaustive ordering: one exact page. */
export async function selectExactVectorPage(
  setup: VectorLegSetup,
  budget: SearchBudget | undefined,
  visibility: (SQL | undefined)[],
  limit: number,
  offset: number
): Promise<SearchReadCandidatePage> {
  annotateSearchDiagnostics({ vectorRanking: 'exact' })
  const candidates = await runSearchQuery(budget, 'vector.exact', (executor) =>
    executor
      .select({ ...SEARCH_READ_CANDIDATE_FIELDS, distance: setup.distance.as('distance') })
      .from(embedding)
      .innerJoin(document, eq(embedding.documentId, document.id))
      .leftJoin(embeddingSearch, eq(embeddingSearch.id, embedding.id))
      .where(and(...setup.conditions, ...visibility))
      .orderBy(sql`(${setup.distance}) + 0`, embedding.id)
      .limit(limit)
      .offset(offset)
  )
  return { candidates, nextOffset: offset + candidates.length }
}

/**
 * Ranks the chunks of a known set of documents exactly: `+ 0` keeps the planner off the ANN
 * index, and the document identities keep the scan on the projection's document lookup, so this
 * reads what the set costs. `columns` names the candidate identities each strategy reads off the
 * row.
 */
export function rankVectorCandidatesExactly(input: {
  setup: VectorLegSetup
  knowledgeBaseIds: string[]
  documentIds: readonly string[]
  columns: SQL
  conditions?: (SQL | undefined)[]
  candidateLimit: number
  budget: SearchBudget | undefined
}): Promise<SearchReadCandidate[]> {
  annotateSearchDiagnostics({ vectorRanking: 'exact-candidates' })
  if (!input.documentIds.length) return Promise.resolve([])
  return runSearchQuery(input.budget, 'vector.exact_candidates', (executor) =>
    executor.execute<SearchReadCandidate>(sql`
      SELECT ${input.columns}
      FROM ${embeddingSearch}
      WHERE ${and(
        inArray(embeddingSearch.knowledgeBaseId, input.knowledgeBaseIds),
        eq(embeddingSearch.enabled, true),
        sql`${embeddingSearch.documentId} = ANY(${textArrayLiteral([...input.documentIds])})`,
        input.setup.candidateTagCondition,
        ...(input.conditions ?? [])
      )}
      ORDER BY (${input.setup.distance}) + 0 LIMIT ${input.candidateLimit}
    `)
  )
}

/** Records the pool a vector leg is about to gather. */
export function annotateVectorPoolPlanned(setup: VectorLegSetup, candidateLimit: number): void {
  annotateSearchDiagnostics({
    vectorRanking: 'projection-walk',
    vectorCandidateLimit: candidateLimit,
    vectorCandidateScan: 'planned',
    vectorCandidateDimensions: embeddingCandidateDimensions(
      setup.queryVector.dimensions,
      setup.queryVector.model
    ),
  })
}

/** Records how much of its pool a vector leg gathered. */
export function annotateVectorPoolSelected(selected: number, candidateLimit: number): void {
  annotateSearchDiagnostics({
    vectorCandidateCount: selected,
    vectorCandidateScan: selected < candidateLimit ? 'underfilled' : 'planned',
  })
}

/** Loads a vector page under the read predicate, scored on the original vectors. */
export function hydrateVectorCandidates(
  ids: string[],
  accessCondition: SQL,
  setup: VectorLegSetup,
  params: SearchParams
) {
  return hydrateSearchCandidates(
    ids,
    accessCondition,
    embeddingDistance(setup.queryVector.dimensions, setup.queryVector.vector).as('distance'),
    params.filters,
    setup.conditions,
    'vector',
    params.budget,
    true
  )
}
