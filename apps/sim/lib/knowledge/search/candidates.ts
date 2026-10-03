import { document, embedding, embeddingSearch, knowledgeConnector } from '@sim/db/schema'
import { and, eq, inArray, isNull, type SQL, sql } from 'drizzle-orm'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import {
  type ConfluenceSiteReadGrant,
  type GitHubInstallationReadGrant,
  type KnowledgeAccessProvider,
  type KnowledgeAccessScope,
  MAX_KNOWLEDGE_ACCESS_CANDIDATES,
} from '@/lib/knowledge/access/types'
import type { KbEmbeddingDimensions } from '@/lib/knowledge/embedding-models'
import { type RetrievalLeg, runSearchQuery, type SearchBudget } from '@/lib/knowledge/search/budget'
import { measureSearchStage } from '@/lib/knowledge/search/diagnostics'
import { workspaceSearchFilterConditions } from '@/lib/knowledge/search/filter-conditions'
import type { WorkspaceSearchFilters } from '@/lib/knowledge/search/filters'
import type { StructuredFilter } from '@/lib/knowledge/types'

/** Bound candidate pages retained while live permissions are checked. */
const MAX_AUTHORIZED_SEARCH_CANDIDATES = 20_000
/**
 * The probe's share of the leg. It ranks nothing, so it must never be why the leg misses its
 * own deadline.
 *
 * Its share comes out of what the rescue can claim from the narrowest live budget,
 * `DIRECT_SEARCH_VECTOR_BUDGET_MS`, before live authorization, hydration and the exact rerank
 * need the rest.
 */
export const VECTOR_PROBE_BUDGET_MS = 600
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

export interface SearchResult {
  id: string
  content: string
  documentId: string
  chunkIndex: number
  tag1: string | null
  tag2: string | null
  tag3: string | null
  tag4: string | null
  tag5: string | null
  tag6: string | null
  tag7: string | null
  number1: number | null
  number2: number | null
  number3: number | null
  number4: number | null
  number5: number | null
  date1: Date | null
  date2: Date | null
  boolean1: boolean | null
  boolean2: boolean | null
  boolean3: boolean | null
  /**
   * The score this row's position in the returned list comes from: the
   * reciprocal-rank-fusion score in hybrid mode, the cosine similarity
   * (`1 - distance`) in vector mode, and 1 for a tag-only search. Stamped by
   * retrieval on every row it returns; absent on rows straight from a single
   * retrieval leg. Recency may reorder rows without changing this score.
   */
  rankScore?: number
  /** 1-based position in the returned order, stamped alongside `rankScore`. */
  rank?: number
  distance: number
  knowledgeBaseId: string
  /** When the source last changed the document; NULL for uploads and sources that do not say. */
  sourceModifiedAt: Date | null
  filename: string
  sourceUrl: string | null
  /** The connector type behind the document; NULL for an upload. */
  connectorType: string | null
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

/** What every retrieval leg is handed, whichever strategy ranks its candidates. */
export interface SearchParams {
  knowledgeBaseIds: string[]
  topK: number
  /** What the caller may read; every leg applies it. Required so no leg can be written without it. */
  access: KnowledgeAccessScope
  signal?: AbortSignal
  budget?: SearchBudget
  structuredFilters?: StructuredFilter[]
  filters?: WorkspaceSearchFilters
  queryVector?: KnowledgeQueryVector
  distanceThreshold?: number
}

export interface KeywordSearchParams {
  knowledgeBaseIds: string[]
  topK: number
  access: KnowledgeAccessScope
  signal?: AbortSignal
  budget?: SearchBudget
  query: string
  /** Query embedding, so keyword-only hits still carry a real cosine distance. */
  queryVector: KnowledgeQueryVector
  structuredFilters?: StructuredFilter[]
  filters?: WorkspaceSearchFilters
}

/**
 * The three ranked legs of one search. Workspace knowledge bases decide readability on the
 * document; the dormant search-index strategies bind the caller's resolved plan instead. Retrieval
 * picks one set per search and runs, fuses, and reports on it the same way either way.
 */
export interface RetrievalLegs {
  tags(params: SearchParams): Promise<SearchResult[]>
  vector(params: SearchParams): Promise<SearchResult[]>
  keyword(params: KeywordSearchParams): Promise<SearchResult[]>
}

/** Common fields selected for search results */
export const getSearchResultFields = (distanceExpr: SQL<number> | SQL.Aliased<number>) => ({
  id: embedding.id,
  content: embedding.content,
  documentId: embedding.documentId,
  chunkIndex: embedding.chunkIndex,
  tag1: embedding.tag1,
  tag2: embedding.tag2,
  tag3: embedding.tag3,
  tag4: embedding.tag4,
  tag5: embedding.tag5,
  tag6: embedding.tag6,
  tag7: embedding.tag7,
  number1: embedding.number1,
  number2: embedding.number2,
  number3: embedding.number3,
  number4: embedding.number4,
  number5: embedding.number5,
  date1: embedding.date1,
  date2: embedding.date2,
  boolean1: embedding.boolean1,
  boolean2: embedding.boolean2,
  boolean3: embedding.boolean3,
  distance: distanceExpr,
  knowledgeBaseId: embedding.knowledgeBaseId,
  sourceModifiedAt: document.sourceModifiedAt,
  filename: document.filename,
  sourceUrl: document.sourceUrl,
  connectorType: knowledgeConnector.connectorType,
})

/**
 * Match the normalization used by the stored text vectors so query terms and
 * document terms resolve to the same lexemes in both keyword retrieval paths.
 */
export const FTS_CONFIG = 'english'

/**
 * Row visibility predicates shared by every search leg: a chunk is only
 * retrievable when both it and its document are enabled, the document finished
 * processing, it has not been excluded, archived, or soft-deleted, and the
 * caller may read it. Every leg spreads this helper rather than listing the
 * predicates itself, so no leg can drift from the others.
 */
export function getVisibilityConditions(
  filters: WorkspaceSearchFilters | undefined,
  accessCondition: SQL,
  enabledColumn: typeof embedding.enabled | typeof embeddingSearch.enabled = embedding.enabled
) {
  return [eq(enabledColumn, true), ...getDocumentVisibilityConditions(filters, accessCondition)]
}

function getDocumentVisibilityConditions(
  filters: WorkspaceSearchFilters | undefined,
  accessCondition: SQL
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
 * The document-level candidate predicate every ranked leg applies. A permitted set is resolved
 * with the same list, which is what lets a leg rank inside it without admitting anything more.
 */
export function candidateDocumentConditions(
  knowledgeBaseIds: string[],
  filters: WorkspaceSearchFilters | undefined,
  accessCondition: SQL
) {
  return [
    inArray(document.knowledgeBaseId, knowledgeBaseIds),
    ...getDocumentVisibilityConditions(filters, accessCondition),
  ]
}

export interface SearchReadCandidatePage {
  candidates: SearchReadCandidate[]
  nextOffset: number
}

export type SearchReadCandidate = {
  id: string
  documentId: string
  connectorId: string | null
}

/** Only opaque identifiers leave candidate ranking; content stays behind the full read predicate. */
export const SEARCH_READ_CANDIDATE_FIELDS = {
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
}

/** Sources ranked or authorized at once; each holds a connection or a request of its own. */
export const SOURCE_RANKING_CONCURRENCY = 3

/**
 * Binds a search's gated sources to one memoized resolution of the caller's grants; nothing when
 * the search holds no gated source.
 */
export function liveSourceAccessForConnectors(
  gatedConnectorIds: readonly string[],
  accessProvider: KnowledgeAccessProvider,
  signal?: AbortSignal
): LiveSourceAccess | undefined {
  const gated = new Set(gatedConnectorIds)
  if (gated.size === 0) return undefined
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

/** Keeps the candidates of sources the caller turned out not to hold out of a page. */
export function excludeSearchSources(sourceIds: readonly string[]): SQL | undefined {
  return sourceIds.length
    ? sql`(${document.connectorId} IS NULL OR NOT (${inArray(document.connectorId, [...sourceIds])}))`
    : undefined
}

const AUTHORIZED_SEARCH_PAGE_SIZE = 200
const AUTHORIZED_SEARCH_BUDGET_MS = 8000

/**
 * Verification follows ranked candidates, never the organization's source order. Denied
 * sources are excluded on refill, so many matches from one revoked source cannot
 * consume every result slot. Candidate pages and the shared deadline bound authorization work.
 */
export async function selectAuthorizedSearchResults(input: {
  leg: 'vector' | 'keyword' | 'tags'
  access: KnowledgeAccessScope
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
        /** Short means the ranking had fewer to give, not that a read recovered fewer than it asked. */
        lastPageShort = page.nextOffset - offset < pageSize
        offset = page.nextOffset
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
  const rows = [...results.values()]
  /** A reordered leg keeps every page's rows until the end: a later page cannot displace what an earlier one ranked. */
  return input.compareResults ? rows.sort(input.compareResults).slice(0, input.topK) : rows
}

/**
 * Loads the content of candidates that survived ranking, under the read predicate.
 *
 * A page of ranked identifiers is small, so its content is read under the full predicate, which
 * re-reads each connector's own lifecycle and approval: a source deleted, archived or unapproved
 * while the search was running stops answering here, at the gate that returns content.
 */
export function hydrateSearchCandidates(
  ids: string[],
  accessCondition: SQL,
  distance: SQL<number> | SQL.Aliased<number>,
  filters: WorkspaceSearchFilters | undefined,
  conditions: (SQL | undefined)[],
  leg: RetrievalLeg,
  budget?: SearchBudget,
  /** Whether a condition reads the projection's stored halfvec, which only the vector leg's threshold does. */
  joinProjection = false
) {
  /**
   * The projection joins so a condition on its stored halfvec — the candidate threshold — can be
   * tested here; the returned score is whatever the leg passes as `distance`. Both legs pass the
   * original vector's cosine distance: one out-of-line read per hydrated row, the page's size,
   * where scoring the whole candidate pool that way read one per candidate on every novel query.
   */
  return runSearchQuery(budget, `${leg}.sql`, (executor) => {
    const read = executor
      .select(getSearchResultFields(distance))
      .from(embedding)
      .innerJoin(document, eq(embedding.documentId, document.id))
      .leftJoin(knowledgeConnector, eq(knowledgeConnector.id, document.connectorId))
    return (
      joinProjection ? read.leftJoin(embeddingSearch, eq(embeddingSearch.id, embedding.id)) : read
    ).where(
      and(
        inArray(embedding.id, ids),
        ...getVisibilityConditions(filters, accessCondition),
        ...conditions
      )
    )
  })
}

/** A document a caller may rank, with the source a live authorization pass may later exclude. */
export type PermittedDocument = {
  id: string
  connectorId: string | null
}

export type ProbeOutcome =
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
 * `query` returns at most one row past {@link VECTOR_PROBE_DOCUMENT_LIMIT}, or a lone
 * `saturated` sentinel. Neither saturation nor a timeout is a failure of the leg, which keeps the
 * candidates it already has.
 */
export async function probeVisibleDocuments(
  query: SQL,
  budget: SearchBudget | undefined,
  stage: 'vector.probe' | 'permitted_documents',
  probeBudgetMs: number = VECTOR_PROBE_BUDGET_MS
): Promise<ProbeOutcome> {
  const probeBudget = budget?.capped(probeBudgetMs)
  try {
    const probed = await runSearchQuery(probeBudget, stage, (executor) =>
      executor.execute<PermittedDocument & { saturated: boolean }>(query)
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
 * The probe's SQL when the conditions decide readability on the document as they are, returning
 * at most one row past the document limit.
 */
export function directVisibleDocumentsQuery(conditions: (SQL | undefined)[]): SQL {
  return sql`
    SELECT ${document.id} AS id, ${document.connectorId} AS "connectorId", false AS saturated
    FROM ${document}
    WHERE ${and(...conditions)}
    LIMIT ${VECTOR_PROBE_DOCUMENT_LIMIT + 1}
  `
}
