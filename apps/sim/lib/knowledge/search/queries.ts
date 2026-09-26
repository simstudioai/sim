import { db } from '@sim/db'
import { document, embedding, embeddingSearch, knowledgeConnector } from '@sim/db/schema'
import { sha256Hex } from '@sim/security/hash'
import { compareStrings } from '@sim/utils/string'
import { and, eq, inArray, or, type SQL, sql } from 'drizzle-orm'
import { LRUCache } from 'lru-cache'
import {
  knowledgeAccessCondition,
  knowledgeMetadataCandidateAccessCondition,
} from '@/lib/knowledge/access/predicate'
import type { KnowledgeAccessProvider, KnowledgeAccessScope } from '@/lib/knowledge/access/types'
import {
  runSearchQuery,
  SEARCH_RETRIEVAL_BUDGET_MS,
  SearchBudget,
} from '@/lib/knowledge/search/budget'
import {
  candidateDocumentConditions,
  directVisibleDocumentsQuery,
  excludeSearchSources,
  FTS_CONFIG,
  getSearchResultFields,
  getVisibilityConditions,
  hydrateSearchCandidates,
  type KeywordSearchParams,
  type KnowledgeQueryVector,
  type LiveSourceAccess,
  liveSourceAccessForConnectors,
  probeVisibleDocuments,
  type RetrievalLegs,
  type SearchParams,
  type SearchReadCandidate,
  type SearchResult,
  selectAuthorizedSearchResults,
} from '@/lib/knowledge/search/candidates'
import { annotateSearchDiagnostics, measureSearchStage } from '@/lib/knowledge/search/diagnostics'
import type { WorkspaceSearchFilters } from '@/lib/knowledge/search/filters'
import { keywordCandidateRankingQuery } from '@/lib/knowledge/search/keyword-ranking'
import { applyRecencyBoost, RRF_K } from '@/lib/knowledge/search/recency'
import {
  getStructuredTagFilters,
  selectAuthorizedTagResults,
} from '@/lib/knowledge/search/tag-filters'
import {
  annotateVectorPoolPlanned,
  annotateVectorPoolSelected,
  gatheredVectorCandidatePool,
  hydrateVectorCandidates,
  prepareVectorLeg,
  rankVectorCandidatesExactly,
  readVectorCandidatePool,
  selectExactVectorPage,
  sliceVectorCandidatePool,
  type VectorCandidatePool,
  withVectorScanSettings,
} from '@/lib/knowledge/search/vector-leg'
import type { StructuredFilter } from '@/lib/knowledge/types'
import { embeddingDistance } from '@/lib/knowledge/vector-columns'

/**
 * How a search decides readability on each candidate's document. Ranking admits what the
 * caller's stored grants and tokens already read and, from the sources a held reader credential
 * could open, the candidates their mirrored permissions admit; the live proof those sources need
 * is asked for only once one of their candidates reaches hydration, and then once per search.
 */
interface DocumentReadAccess {
  /** The candidate predicate every leg ranks under. */
  rankCondition: SQL
  /**
   * A signed-in reader: their tag and keyword legs run under the search deadline and rank in one
   * statement. A caller with no person behind it runs those legs unbudgeted, as it always has.
   */
  signedIn: boolean
  /** Present only when a searched base holds a source whose reader must be proven live. */
  liveSourceAccess?: LiveSourceAccess
}

/**
 * Resolves a search's {@link DocumentReadAccess} without reaching any source: only the ids of the
 * searched bases' sources a held reader credential could open are read, and a caller holding none
 * ranks under the ordinary predicate alone.
 */
async function resolveDocumentReadAccess(
  knowledgeBaseIds: string[],
  access: KnowledgeAccessScope,
  accessProvider: KnowledgeAccessProvider | undefined,
  signal: AbortSignal | undefined
): Promise<DocumentReadAccess> {
  const ordinary = knowledgeAccessCondition(access)
  if (!accessProvider || access.kind !== 'user') {
    return { rankCondition: ordinary, signedIn: false }
  }
  const liveSources = await accessProvider.liveSourceConnectorCondition()
  if (!liveSources) return { rankCondition: ordinary, signedIn: true }
  const gated = await measureSearchStage('access_batch.connectors', () =>
    db
      .select({ id: knowledgeConnector.id })
      .from(knowledgeConnector)
      .where(and(liveSources, inArray(knowledgeConnector.knowledgeBaseId, knowledgeBaseIds)))
  )
  const gatedIds = gated.map((row) => row.id)
  const liveSourceAccess = liveSourceAccessForConnectors(gatedIds, accessProvider, signal)
  if (!liveSourceAccess) return { rankCondition: ordinary, signedIn: true }
  return {
    signedIn: true,
    rankCondition: or(
      ordinary,
      and(
        inArray(document.connectorId, gatedIds),
        knowledgeMetadataCandidateAccessCondition(access)
      )
    )!,
    liveSourceAccess,
  }
}

/**
 * Stamps each row with the score its position came from and its 1-based rank.
 *
 * Hybrid results are ordered by a fused score the caller never saw, while the
 * `similarity` reported beside them is the vector leg's cosine value — so the
 * two modes answered with byte-identical `similarity` for orderings that could
 * differ. Exposing the ordering key makes the order explainable in either mode.
 */
function rankResults(rows: SearchResult[], scoreOf: (row: SearchResult) => number): SearchResult[] {
  return rows.map((row, index) => ({ ...row, rankScore: scoreOf(row), rank: index + 1 }))
}

/** Candidates each hybrid leg retrieves before the fused list is trimmed to `topK`. */
const HYBRID_CANDIDATE_MIN = 50
const HYBRID_CANDIDATE_MAX = 200
function hybridCandidateCount(topK: number): number {
  return Math.min(Math.max(topK * 3, HYBRID_CANDIDATE_MIN), HYBRID_CANDIDATE_MAX)
}

function getQueryStrategy(kbCount: number, topK: number) {
  return {
    useParallel: kbCount > 4 || (kbCount > 2 && topK > 50),
    distanceThreshold: kbCount > 3 ? 0.8 : 1.0,
  }
}

/**
 * A document-decided leg's statements run under the leg's deadline; a leg that reaches it before
 * it ranked anything is short, not failed.
 */
async function shortOnDeadline(
  budget: SearchBudget | undefined,
  run: () => Promise<SearchResult[]>
): Promise<SearchResult[]> {
  try {
    return await run()
  } catch (error) {
    if (!budget?.isTimeout(error)) throw error
    return []
  }
}

/**
 * Tag-only retrieval, decided on the document, in chunk-id order. A signed-in reader's tag leg
 * runs under the search deadline in one statement; a caller with no person behind it runs
 * unbudgeted, many bases in parallel. Each base is read up to the leg's whole `topK`, so the merged
 * page is the same one a single statement over every base would return. A search holding a source
 * whose reader must be proven live pages its candidates instead, so the proof is asked for only
 * when one is read.
 */
export async function handleTagOnlySearch(
  params: SearchParams,
  read: DocumentReadAccess
): Promise<SearchResult[]> {
  const { knowledgeBaseIds, topK, structuredFilters } = params

  if (!structuredFilters || structuredFilters.length === 0) {
    throw new Error('Tag filters are required for tag-only search')
  }
  params.signal?.throwIfAborted()
  if (read.liveSourceAccess) {
    return selectAuthorizedTagResults(params, read.rankCondition, read.liveSourceAccess)
  }

  const budget = read.signedIn ? params.budget : undefined
  const tagFilterConditions = getStructuredTagFilters(structuredFilters, embedding)
  const visibility = getVisibilityConditions(params.filters, read.rankCondition)
  const selectTagged = (kbScope: SQL) =>
    runSearchQuery(budget, 'tags.sql', (executor) =>
      executor
        .select(getSearchResultFields(sql<number>`0`.as('distance')))
        .from(embedding)
        .innerJoin(document, eq(embedding.documentId, document.id))
        .leftJoin(knowledgeConnector, eq(knowledgeConnector.id, document.connectorId))
        .where(and(kbScope, ...visibility, ...tagFilterConditions))
        .orderBy(embedding.id)
        .limit(topK)
    )

  return shortOnDeadline(budget, async () => {
    if (!read.signedIn && getQueryStrategy(knowledgeBaseIds.length, topK).useParallel) {
      const perBase = await Promise.all(
        knowledgeBaseIds.map((kbId) => selectTagged(eq(embedding.knowledgeBaseId, kbId)))
      )
      return perBase
        .flat()
        .sort((a, b) => compareStrings(a.id, b.id))
        .slice(0, topK)
    }
    return selectTagged(inArray(embedding.knowledgeBaseId, knowledgeBaseIds))
  })
}

/**
 * How long a probe's finding that a reader's set is too large to rank exactly is remembered. A
 * readable set that large moves slowly, and the finding only skips the rescue, so a stale answer
 * costs the rescue of a set that has since shrunk below the probe limit, never access.
 */
const SATURATED_READ_TTL_MS = 60 * 1000

/**
 * Readable sets a probe found too large to rank exactly. An underfilled walk over a large base
 * would otherwise probe it again on every search, though the probe can only confirm the same answer.
 */
const saturatedReads = new LRUCache<string, true>({ max: 10_000, ttl: SATURATED_READ_TTL_MS })

/** Clears the saturated-read cache, for tests. */
export function forgetSaturatedReads(): void {
  saturatedReads.clear()
}

/**
 * What decides a probe's answer: the bases, the reader's tokens, the filters, the tags and the
 * sources a live proof excluded. Any change to them is a different set.
 */
function saturatedReadKey(params: SearchParams, excludedKey: string): string {
  return sha256Hex(
    JSON.stringify([
      [...params.knowledgeBaseIds].sort(),
      params.access.kind,
      [...params.access.tokens].sort(),
      params.filters ?? null,
      params.structuredFilters ?? null,
      excludedKey,
    ])
  )
}

/**
 * Vector retrieval, decided on the document: a bounded candidate pool, then hydration of each page
 * under the full read predicate, scored on the original vectors.
 *
 * A bounded ANN traversal fills the pool, joining each visited row's document laterally so
 * readability — the caller's tokens included — is decided before the limit counts it. When
 * visibility leaves the traversal short of its limit, a bounded probe decides whether the readable
 * set is small enough to rank exactly instead, which recovers the candidates the traversal's
 * post-filter discarded. The traversal and the rescue both carry each candidate's document, so a
 * page is a slice of the pool.
 */
export async function handleVectorSearch(
  params: SearchParams,
  read: DocumentReadAccess
): Promise<SearchResult[]> {
  const setup = prepareVectorLeg(params)
  let candidatePool: VectorCandidatePool | undefined
  return selectAuthorizedSearchResults({
    leg: 'vector',
    access: params.access,
    liveSourceAccess: read.liveSourceAccess,
    signal: params.signal,
    budget: params.budget,
    topK: params.topK,
    compareResults: (a, b) => a.distance - b.distance,
    selectPage: async (limit, offset, excludedSources) => {
      const exclusion = excludeSearchSources(excludedSources)
      if (params.filters?.documentIds?.length) {
        return selectExactVectorPage(
          setup,
          params.budget,
          [...getVisibilityConditions(params.filters, read.rankCondition), exclusion],
          limit,
          offset
        )
      }
      candidatePool = await readVectorCandidatePool(
        candidatePool,
        excludedSources,
        offset,
        limit,
        async ({ excludedKey, candidateLimit }) => {
          annotateVectorPoolPlanned(setup, candidateLimit)
          const candidateDocumentVisibility = [
            ...candidateDocumentConditions(
              params.knowledgeBaseIds,
              params.filters,
              read.rankCondition
            ),
            exclusion,
          ]
          /**
           * The bounded ANN traversal is the whole candidate set. The lateral read decides each
           * visited row on its document, a primary-key lookup per candidate, before LIMIT counts it.
           */
          let selected: SearchReadCandidate[] = await withVectorScanSettings(
            (executor) =>
              executor.execute<SearchReadCandidate>(sql`
            SELECT ${embeddingSearch.id} AS id, ${embeddingSearch.documentId} AS "documentId",
              visible.connector_id AS "connectorId"
            FROM ${embeddingSearch}
            CROSS JOIN LATERAL (
              SELECT ${document.connectorId} AS connector_id FROM ${document}
              WHERE ${and(eq(document.id, embeddingSearch.documentId), ...candidateDocumentVisibility, setup.candidateTagCondition)}
              LIMIT 1
            ) AS visible
            WHERE ${and(
              inArray(embeddingSearch.knowledgeBaseId, params.knowledgeBaseIds),
              eq(embeddingSearch.enabled, true)
            )}
            ORDER BY ${setup.distance} LIMIT ${candidateLimit}
          `),
            params.budget,
            'vector.candidate_search'
          )
          /**
           * A full traversal is already the nearest readable chunks. An underfilled one is the
           * signal that visibility removed neighbours the graph had already chosen: pgvector's HNSW
           * post-filters by construction, so a readable set that is a small share of the index is
           * discarded after the graph has committed to its neighbours, and widening the traversal
           * cannot recover them. Ranking the readable set exactly does, while that set is small
           * enough to afford. A set a recent probe found too large is not probed again.
           */
          const saturationKey =
            selected.length < candidateLimit ? saturatedReadKey(params, excludedKey) : undefined
          if (saturationKey !== undefined && !saturatedReads.has(saturationKey)) {
            const probe = await probeVisibleDocuments(
              directVisibleDocumentsQuery([
                ...candidateDocumentVisibility,
                setup.documentTagCondition,
              ]),
              params.budget,
              'vector.probe'
            )
            if (probe.kind === 'saturated') saturatedReads.set(saturationKey, true)
            if (probe.kind === 'documents') {
              annotateSearchDiagnostics({ vectorProbeDocumentCount: probe.documents.length })
              const sources = new Map(probe.documents.map((entry) => [entry.id, entry.connectorId]))
              /** The source comes from the probed document, which decided readability. */
              const ranked = await rankVectorCandidatesExactly({
                setup,
                knowledgeBaseIds: params.knowledgeBaseIds,
                documentIds: [...sources.keys()],
                columns: sql`${embeddingSearch.id} AS id, ${embeddingSearch.documentId} AS "documentId", NULL AS "connectorId"`,
                candidateLimit,
                budget: params.budget,
              })
              selected = ranked.map((row) => ({
                ...row,
                connectorId: sources.get(row.documentId) ?? null,
              }))
            }
          }
          const pool = gatheredVectorCandidatePool(excludedKey, selected, candidateLimit)
          annotateVectorPoolSelected(selected.length, candidateLimit)
          return pool
        }
      )
      /**
       * Rescoring the pool against the original vectors here would read one out-of-line vector per
       * candidate; the page is scored at hydration instead.
       */
      return sliceVectorCandidatePool(candidatePool, offset, limit)
    },
    hydrate: (ids, authorized) =>
      hydrateVectorCandidates(ids, knowledgeAccessCondition(authorized), setup, params),
  })
}

/**
 * Lexical (full-text) retrieval, decided on the document. Matches chunks against the generated
 * `embedding.content_tsv` column via `websearch_to_tsquery`, which tolerates arbitrary user input
 * and supports quoted phrases and `-negation`.
 *
 * Results carry the original vector's cosine distance rather than a placeholder, so callers can
 * report `similarity` for rows only the lexical leg found, on the same scale the vector leg uses.
 * Unlike the vector leg there is no distance threshold — surfacing exact-token matches that are
 * semantically distant is the entire point of this leg.
 *
 * Ranking and hydration are two steps on purpose. Projecting the cosine distance in the ranking
 * query makes Postgres detoast the chunk's vector and compute a distance for *every* full-text
 * match before the `LIMIT` applies — work that scales with how common the query term is rather
 * than with `topK`. Ranking therefore touches no vectors, and only the rows that survive the limit
 * are hydrated. A signed-in reader ranks in one statement under the search deadline (see
 * {@link rankSignedInKeywordCandidates}); a caller with no person behind it ranks unbudgeted, many
 * bases in parallel, each up to the leg's whole `topK` so the merged ranking is the global one. A
 * search holding a source whose reader must be proven live pages its ranking instead, so the
 * proof is asked for only when one of its candidates is read.
 */
async function executeKeywordSearch(
  params: KeywordSearchParams,
  read: DocumentReadAccess
): Promise<SearchResult[]> {
  const { knowledgeBaseIds, topK, query, queryVector, structuredFilters } = params

  if (!query.trim()) {
    return []
  }
  params.signal?.throwIfAborted()

  const tsQuery = sql`websearch_to_tsquery(${FTS_CONFIG}, ${query})`
  const tagFilterConditions = structuredFilters?.length
    ? getStructuredTagFilters(structuredFilters, embedding)
    : []
  const budget = read.signedIn ? params.budget : undefined
  /** Hydration pass: full rows scored on the original vectors, bounded to the survivors — one out-of-line vector read per returned row. */
  const hydrate = (ids: string[], accessCondition: SQL) =>
    hydrateSearchCandidates(
      ids,
      accessCondition,
      embeddingDistance(queryVector.dimensions, queryVector.vector).as('distance'),
      params.filters,
      [],
      'keyword',
      budget
    )
  const signedInRanking = {
    knowledgeBaseIds,
    tsQuery,
    tagFilterConditions,
    documentConditions: candidateDocumentConditions(
      knowledgeBaseIds,
      params.filters,
      read.rankCondition
    ),
    budget,
  }

  if (read.liveSourceAccess) {
    return selectAuthorizedSearchResults({
      leg: 'keyword',
      access: params.access,
      liveSourceAccess: read.liveSourceAccess,
      signal: params.signal,
      budget,
      topK,
      selectPage: async (limit, offset, excludedSources) => {
        const candidates = await rankSignedInKeywordCandidates({
          ...signedInRanking,
          exclusion: excludeSearchSources(excludedSources),
          limit,
          offset,
        })
        return { candidates, nextOffset: offset + candidates.length }
      },
      hydrate: (ids, authorized) => hydrate(ids, knowledgeAccessCondition(authorized)),
    })
  }

  const rankExpr = sql<number>`ts_rank_cd(${embedding.contentTsv}, ${tsQuery})`
  const visibility = getVisibilityConditions(params.filters, read.rankCondition)
  /** Ranking pass: ids and relevance only, so no vector is read. */
  const rankRows = (kbScope: SQL) =>
    db
      .select({ id: embedding.id, keywordRank: rankExpr.as('keyword_rank') })
      .from(embedding)
      .innerJoin(document, eq(embedding.documentId, document.id))
      .where(
        and(
          kbScope,
          ...visibility,
          sql`${embedding.contentTsv} @@ ${tsQuery}`,
          ...tagFilterConditions
        )
      )
      .orderBy(sql`${rankExpr} DESC`)
      .limit(topK)

  return shortOnDeadline(budget, async () => {
    let topIds: string[]
    if (read.signedIn) {
      const ranked = await rankSignedInKeywordCandidates({ ...signedInRanking, limit: topK })
      topIds = ranked.map((row) => row.id)
    } else if (getQueryStrategy(knowledgeBaseIds.length, topK).useParallel) {
      const perBase = await Promise.all(
        knowledgeBaseIds.map((kbId) => rankRows(eq(embedding.knowledgeBaseId, kbId)))
      )
      topIds = perBase
        .flat()
        .sort((a, b) => b.keywordRank - a.keywordRank)
        .slice(0, topK)
        .map((row) => row.id)
    } else {
      const ranked = await rankRows(inArray(embedding.knowledgeBaseId, knowledgeBaseIds))
      topIds = ranked.map((row) => row.id)
    }
    if (topIds.length === 0) {
      return []
    }
    const rowById = new Map((await hydrate(topIds, read.rankCondition)).map((row) => [row.id, row]))
    return topIds
      .map((id) => rowById.get(id))
      .filter((row): row is SearchResult => row !== undefined)
  })
}

/** A signed-in reader's keyword ranking over the source chunks, in one statement; see {@link keywordCandidateRankingQuery}. */
function rankSignedInKeywordCandidates(input: {
  knowledgeBaseIds: string[]
  tsQuery: SQL
  tagFilterConditions: SQL[]
  documentConditions: (SQL | undefined)[]
  exclusion?: SQL
  limit: number
  offset?: number
  budget: SearchBudget | undefined
}): Promise<SearchReadCandidate[]> {
  return runSearchQuery(input.budget, 'keyword.sql', (executor) =>
    executor.execute<SearchReadCandidate>(
      keywordCandidateRankingQuery({
        matchedChunks: sql`
        SELECT ${embedding.id} AS id, ${embedding.documentId} AS document_id
        FROM ${embedding}
        WHERE ${and(
          inArray(embedding.knowledgeBaseId, input.knowledgeBaseIds),
          eq(embedding.enabled, true),
          sql`${embedding.contentTsv} @@ ${input.tsQuery}`,
          ...input.tagFilterConditions
        )}`,
        documentConditions: [...input.documentConditions, input.exclusion],
        rankTable: embedding,
        rank: sql<number>`ts_rank_cd(${embedding.contentTsv}, ${input.tsQuery})`,
        limit: input.limit,
        offset: input.offset ?? 0,
      })
    )
  )
}

/** The legs of a search whose readability is decided on each candidate's document. */
function documentRetrievalLegs(read: DocumentReadAccess): RetrievalLegs {
  return {
    tags: (params) => handleTagOnlySearch(params, read),
    vector: (params) => handleVectorSearch(params, read),
    keyword: (params) => executeKeywordSearch(params, read),
  }
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

  return rankResults(fused, (row) => scores.get(row.id) ?? 0)
}

/**
 * `hybrid` fuses lexical and vector retrieval; `vector` is the legacy
 * semantic-only path, kept as an opt-out.
 */
export type KnowledgeSearchMode = 'hybrid' | 'vector'

interface ExecuteKnowledgeSearchParams {
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
  /** Runs the search-index retrieval legs; see `usesIndexedRetrieval`. */
  indexedRetrieval?: boolean
}

export interface RetrievalStatus {
  status: 'complete' | 'partial'
  timedOutLegs: Array<'vector' | 'keyword' | 'tags'>
}

export interface KnowledgeRetrievalResult {
  rows: SearchResult[]
  retrieval: RetrievalStatus
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
    accessProvider,
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
  const hasQuery = Boolean(query?.trim())
  const hasFilters = Boolean(structuredFilters?.length)
  const finish = async (rows: SearchResult[]): Promise<KnowledgeRetrievalResult> => {
    params.signal?.throwIfAborted()
    const timedOutLegs = Object.values(budgets)
      .filter((budget) => budget.timedOut)
      .map((budget) => budget.leg)
    return {
      rows: rankResults(
        boostRecency ? applyRecencyBoost(rows) : rows,
        (row) => row.rankScore ?? (hasQuery ? 1 - row.distance : 1)
      ),
      retrieval: { status: timedOutLegs.length ? 'partial' : 'complete', timedOutLegs },
    }
  }
  if (!hasQuery && !hasFilters) throw new Error('A search query or tag filters are required')
  if (hasQuery && !queryVector) {
    throw new Error('Query vector is required when searching with a query')
  }
  /**
   * The one seam between the two retrieval strategies. A signed-in reader's search over search
   * indexes, while indexed organization search is on, binds the reader's resolved plan and ranks
   * on the projection rows; the dormant module loads only then. Everything else decides
   * readability on each candidate's document, under the caller's own tokens and any live source
   * proof they hold.
   */
  const legs: RetrievalLegs =
    access.kind === 'user' && accessProvider && params.indexedRetrieval === true
      ? await (await import('@/lib/sim-search/indexed/retrieval')).prepareIndexedRetrieval({
          knowledgeBaseIds,
          access,
          accessProvider,
          filters: params.filters,
          signal: params.signal,
          ranked: hasQuery,
          budget: budgets.vector,
        })
      : documentRetrievalLegs(
          await resolveDocumentReadAccess(knowledgeBaseIds, access, accessProvider, params.signal)
        )
  const common = {
    knowledgeBaseIds,
    access,
    signal: params.signal,
    filters: params.filters,
    structuredFilters,
  }
  if (!hasQuery) {
    return finish(
      await measureSearchStage('tags', () => legs.tags({ ...common, topK, budget: budgets.tags }))
    )
  }
  const { distanceThreshold } = getQueryStrategy(knowledgeBaseIds.length, topK)
  const legTopK = searchMode === 'hybrid' ? hybridCandidateCount(topK) : topK
  const vectorSearch = measureSearchStage('vector', () =>
    legs.vector({
      ...common,
      topK: legTopK,
      queryVector,
      distanceThreshold,
      budget: budgets.vector,
    })
  )
  if (searchMode === 'vector') return finish(await vectorSearch)
  const keywordSearch = measureSearchStage('keyword', () =>
    legs.keyword({
      ...common,
      topK: legTopK,
      query: query!,
      queryVector: queryVector!,
      budget: budgets.keyword,
    })
  )
  const settled = await Promise.allSettled([vectorSearch, keywordSearch])
  /** Wait for both legs to release SQL resources; only deadline failures permit partial success. */
  for (const leg of settled) if (leg.status === 'rejected') throw leg.reason
  const vectorResults = settled[0].status === 'fulfilled' ? settled[0].value : []
  const keywordResults = settled[1].status === 'fulfilled' ? settled[1].value : []
  return finish(fuseByReciprocalRank([keywordResults, vectorResults], topK))
}
