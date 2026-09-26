import { document, embedding, embeddingKeywordSearch, embeddingKeywordTin } from '@sim/db/schema'
import { and, eq, inArray, type SQL, sql } from 'drizzle-orm'
import { knowledgeAccessCondition, textArrayLiteral } from '@/lib/knowledge/access/predicate'
import { runSearchQuery } from '@/lib/knowledge/search/budget'
import {
  candidateDocumentConditions,
  excludeSearchSources,
  FTS_CONFIG,
  hydrateSearchCandidates,
  type KeywordSearchParams,
  type SearchReadCandidate,
  type SearchReadCandidatePage,
  type SearchResult,
  selectAuthorizedSearchResults,
} from '@/lib/knowledge/search/candidates'
import { annotateSearchDiagnostics } from '@/lib/knowledge/search/diagnostics'
import { searchDateFilterCondition } from '@/lib/knowledge/search/filter-conditions'
import { keywordCandidateRankingQuery } from '@/lib/knowledge/search/keyword-ranking'
import { getStructuredTagFilters } from '@/lib/knowledge/search/tag-filters'
import { embeddingDistance } from '@/lib/knowledge/vector-columns'
import {
  documentSatisfies,
  type IndexedRetrievalContext,
  PERMITTED_EXACT_DOCUMENT_LIMIT,
} from '@/lib/sim-search/indexed/retrieval/permitted'
import {
  excludeSearchSourcesOnRow,
  knowledgeCandidateAccessConditionForConnectors,
  projectionCandidateAccessCondition,
  projectionDecidedOnDocument,
} from '@/lib/sim-search/indexed/retrieval/projection-access'
import { isProjectionFilled } from '@/lib/sim-search/indexed/retrieval/projection-fill'
import { resolveTinKeywordQuery } from '@/lib/sim-search/indexed/retrieval/tin-keyword'

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
 * The keyword leg of a user-scoped search-index search.
 *
 * A bounded permitted set confines matching to the chunks the caller may read. A caller reaching
 * past the permitted-set limit reads much of the index, so ranking every match before checking
 * access is the leg's whole cost for a common term: where the Tin projection is complete, BM25
 * ranks inside the bases first and access is checked, on the row, only on the top of that
 * ranking. Otherwise the GIN projection (`embedding_keyword_search`) ranks in three stages:
 * match, authorize, rank.
 *
 * The visibility predicate carries correlated subqueries — one per connector, one per
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
export async function executeIndexedKeywordSearch(
  params: KeywordSearchParams,
  context: IndexedRetrievalContext
): Promise<SearchResult[]> {
  const { knowledgeBaseIds, topK, query, queryVector, structuredFilters } = params
  if (!query.trim()) return []
  const { access, accessPlan, permitted } = context
  const tsQuery = sql`websearch_to_tsquery(${FTS_CONFIG}, ${query})`
  const tagFilterConditions = structuredFilters?.length
    ? getStructuredTagFilters(structuredFilters, embedding)
    : []
  const candidateRank = sql<number>`ts_rank_cd(${embeddingKeywordSearch.contentTsv}, ${tsQuery})`
  /**
   * A bounded set past the exact-ranking size is read on the row like an unbounded one: the
   * bounded read materializes every chunk of the set before it matches a term, where a ranking
   * decided on the row costs what the term matches.
   */
  const largePermittedSet =
    permitted?.kind === 'bounded' && permitted.documents.length >= PERMITTED_EXACT_DOCUMENT_LIMIT
  const onRowReader = permitted?.kind === 'unbounded' || largePermittedSet
  let tinQuery: Awaited<ReturnType<typeof resolveTinKeywordQuery>> = null
  if (onRowReader && tagFilterConditions.length === 0) {
    try {
      tinQuery = await resolveTinKeywordQuery(query, FTS_CONFIG, params.budget)
    } catch (error) {
      /** A leg whose deadline passed before it ranked anything is short, not failed. */
      if (!params.budget?.isTimeout(error)) throw error
      return []
    }
  }
  if (onRowReader) annotateSearchDiagnostics({ keywordRanking: tinQuery ? 'tin' : 'gin' })
  /** A filled projection decides readability on the ranked row alone; none of its rows needs the document. */
  const tinFilled = tinQuery
    ? await isProjectionFilled('embedding_keyword_tin', 'keyword.projection_filled', params.budget)
    : false
  /** The ranked CTE's mirrored columns, which the on-row predicates read. */
  const rankedTinRow = {
    connectorId: sql`ranked_tin_chunks.connector_id`,
    acl: sql`ranked_tin_chunks.acl`,
    documentId: sql`ranked_tin_chunks.document_id`,
  }
  /** The projection predicate over the ranked CTE's mirrored columns, plus any excluded source. */
  const onRowKeywordVisibility = (excludedSources: readonly string[]) =>
    and(
      projectionCandidateAccessCondition(rankedTinRow, access, accessPlan, {
        filled: tinFilled,
      }),
      documentSatisfies(
        sql`ranked_tin_chunks.document_id`,
        searchDateFilterCondition(params.filters)
      ),
      excludeSearchSourcesOnRow(rankedTinRow, tinFilled, excludedSources)
    )
  const documentConditions = (excludedSources: readonly string[]) =>
    and(
      ...candidateDocumentConditions(
        knowledgeBaseIds,
        params.filters,
        knowledgeCandidateAccessConditionForConnectors(access, accessPlan)
      ),
      excludeSearchSources(excludedSources)
    )
  /**
   * A page read on the row takes each candidate's source from the row, which is what decides
   * whether its live source proof is asked for. A row decided on its document — not yet filled,
   * or its document marked for the projector — takes it from the document: one primary-key read
   * per such row of the page, after its limit, never per ranked row.
   */
  const onRowPage = (ranked: SQL) => sql`
              SELECT paged.id, paged."documentId",
                CASE WHEN paged.decided_on_document
                  THEN (SELECT ${document.connectorId} FROM ${document} WHERE ${document.id} = paged."documentId")
                  ELSE paged."connectorId"
                END AS "connectorId",
                paged.keyword_rank
              FROM (${ranked}) AS paged`
  /**
   * One page from the top of Tin's ranking. Readability is decided on the ranked row. The windows
   * widen while the page is short, a narrow reader's to a wide one sooner and no further, and what
   * the widest cannot fill is left short rather than handed to a ranking over every match. A large
   * bounded set is the exception on its first page: its bounded read was exhaustive, so the widest
   * window that still falls short hands that page to the GIN ranking, which covers every match. A
   * later page stays with Tin: the two rankers order differently, so an offset advanced through
   * one cannot resume the other.
   */
  const selectTinPage = async (
    scopedQuery: SQL,
    limit: number,
    offset: number,
    excludedSources: readonly string[]
  ): Promise<SearchReadCandidatePage | null> => {
    const narrow = (permitted?.kind === 'unbounded' && !permitted.broad) || largePermittedSet
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
              /**
               * Readability decided on the ranked row: its source and ACL are mirrored there, so a
               * window of mostly unreadable chunks costs an array test per row, not a document
               * lookup. The full predicate follows at hydration.
               */
              onRowPage(
                sql`
            SELECT ranked_tin_chunks.id, ranked_tin_chunks.document_id AS "documentId",
              ranked_tin_chunks.connector_id AS "connectorId", ranked_tin_chunks.keyword_rank,
              ${projectionDecidedOnDocument(rankedTinRow, tinFilled)} AS decided_on_document
            FROM ranked_tin_chunks /* on-row visibility */
            WHERE ranked_tin_chunks.enabled AND ${onRowKeywordVisibility(excludedSources)}
            ORDER BY ranked_tin_chunks.keyword_rank DESC, ranked_tin_chunks.id
            LIMIT ${pageLimit} OFFSET ${offset}`
              )
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
        (!(largePermittedSet && offset === 0) && window === windows[windows.length - 1])
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
  /**
   * Tin and GIN order candidates differently, so a search that once handed a page to GIN stays
   * with GIN: an offset advanced through one ranking cannot resume the other.
   */
  let handedToGin = false
  /** Keep readable identities and rank scalars separate so sorts never carry full text-search vectors. */
  return selectAuthorizedSearchResults({
    leg: 'keyword',
    access,
    liveSourceAccess: context.liveSourceAccess,
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
        permitted?.kind === 'bounded' && !largePermittedSet
          ? permitted.documents.map((entry) => entry.id)
          : undefined
      if (permittedIds?.length === 0) return { candidates: [], nextOffset: offset }
      if (tinScope && !handedToGin) {
        const tinPage = await selectTinPage(tinScope, limit, offset, excludedSources)
        if (tinPage) return tinPage
        handedToGin = true
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
        executor.execute<SearchReadCandidate>(
          keywordCandidateRankingQuery({
            matchedChunks,
            documentConditions: [documentConditions(excludedSources)],
            rankTable: embeddingKeywordSearch,
            rank: candidateRank,
            limit,
            offset,
          })
        )
      )
      return { candidates, nextOffset: offset + candidates.length }
    },
    /** Every candidate already matched the query where it was ranked; matching it again here would detoast one text-search vector per result. */
    hydrate: (ids, authorized) =>
      hydrateSearchCandidates(
        ids,
        knowledgeAccessCondition(authorized),
        embeddingDistance(queryVector.dimensions, queryVector.vector).as('distance'),
        params.filters,
        [inArray(embedding.knowledgeBaseId, knowledgeBaseIds), ...tagFilterConditions],
        'keyword',
        params.budget
      ),
  })
}
