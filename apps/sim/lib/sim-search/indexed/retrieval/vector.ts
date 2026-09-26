import { document, embeddingSearch } from '@sim/db/schema'
import { and, eq, inArray, type SQL, sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import { knowledgeAccessCondition, textArrayLiteral } from '@/lib/knowledge/access/predicate'
import type { UserAccessScope } from '@/lib/knowledge/access/types'
import { runSearchQuery, type SearchBudget } from '@/lib/knowledge/search/budget'
import {
  excludeSearchSources,
  getVisibilityConditions,
  type SearchParams,
  type SearchReadCandidate,
  type SearchResult,
  SOURCE_RANKING_CONCURRENCY,
  selectAuthorizedSearchResults,
} from '@/lib/knowledge/search/candidates'
import { annotateSearchDiagnostics } from '@/lib/knowledge/search/diagnostics'
import { searchDateFilterCondition } from '@/lib/knowledge/search/filter-conditions'
import {
  annotateVectorPoolPlanned,
  annotateVectorPoolSelected,
  CANDIDATE_HNSW_MAX_SCAN_TUPLES,
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
import type { SearchAccessPlan } from '@/lib/sim-search/indexed/retrieval/access-plan'
import {
  documentSatisfies,
  type IndexedRetrievalContext,
  PERMITTED_EXACT_DOCUMENT_LIMIT,
} from '@/lib/sim-search/indexed/retrieval/permitted'
import {
  excludeSearchSourcesOnRow,
  knowledgeCandidateAccessConditionForConnectors,
  projectionCandidateAccessCondition,
  projectionPending,
} from '@/lib/sim-search/indexed/retrieval/projection-access'
import { isProjectionFilled } from '@/lib/sim-search/indexed/retrieval/projection-fill'
import { indexedVectorSources } from '@/lib/sim-search/indexed/retrieval/source-vector-indexes'

/**
 * How far a walk that decides readability on the row may go before giving up: a cap, not a target,
 * since the scan stops as soon as the limit is met. The default cap was sized for a walk that looked
 * a document up per visited tuple; on the row a tuple costs a fraction of that, so a caller whose
 * neighbourhood is mostly unreadable can be carried past it for tens of milliseconds rather than
 * left with what the neighbourhood happened to hold.
 */
const ON_ROW_WALK_SCAN_TUPLES = 100_000

/**
 * How far a walk may go when readability is on the row: the on-row cap, unless the walk still
 * has to ask the document about tuples — a tag or date filter, or rows the source and ACL fill
 * has not reached yet — in which case such a tuple costs what it did before the columns were mirrored,
 * and the default cap keeps a walk through a mostly-excluded neighbourhood at a short answer
 * rather than a missed deadline.
 */
function onRowWalkScanTuples(
  documentCondition: SQL | undefined,
  projectionFilled: boolean
): number {
  return documentCondition === undefined && projectionFilled
    ? ON_ROW_WALK_SCAN_TUPLES
    : CANDIDATE_HNSW_MAX_SCAN_TUPLES
}

/**
 * A candidate's source: the row's, unless the row's document is marked for the projector, whose
 * source may have moved since the row was written — then the document's, read for that row only.
 */
function projectionCandidateSource(projection: {
  connectorId: AnyPgColumn | SQL
  documentId: AnyPgColumn | SQL
}): SQL {
  return sql`CASE WHEN ${projectionPending(projection.documentId)}
    THEN (SELECT ${document.connectorId} FROM ${document} WHERE ${document.id} = ${projection.documentId})
    ELSE ${projection.connectorId} END`
}

/**
 * The same identities read off a projection row in raw SQL: the aliases are what
 * `SearchReadCandidate` deserializes, so every walk reads them from one place.
 */
const PROJECTION_CANDIDATE_COLUMNS = sql`${embeddingSearch.id} AS id, ${embeddingSearch.documentId} AS "documentId", ${projectionCandidateSource(embeddingSearch)} AS "connectorId"`

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
  access: UserAccessScope
  knowledgeBaseIds: string[]
  plan: SearchAccessPlan
  tagCondition: SQL | undefined
  documentCondition: SQL | undefined
  /** Sources the caller turned out not to hold, kept out of every source's ranking. */
  exclusion: SQL | undefined
  /** Whether every projection row carries its mirrored columns, so a walk needs no document. */
  projectionFilled: boolean
  candidateDistance: SQL<number>
  candidateLimit: number
  budget?: SearchBudget
}): Promise<SearchReadCandidate[]> {
  const sources = planSourceVectorCandidates({
    plan: input.plan,
    indexedSources: await indexedVectorSources(input.budget),
  })
  annotateSearchDiagnostics({
    vectorRanking: 'per-source',
    vectorSourcesWalked: sources.walked.length,
    vectorSourcesSliced: sources.sliced.length,
  })
  const base = and(
    inArray(embeddingSearch.knowledgeBaseId, input.knowledgeBaseIds),
    eq(embeddingSearch.enabled, true),
    input.tagCondition,
    input.exclusion
  )
  type RankedChunks = Promise<Array<SearchReadCandidate & { distance: number }>>
  /**
   * Walks one source's own index, or the sliced sources together when their slice saturated.
   * Readability is decided on the row the walk visits — the source and ACL are mirrored there —
   * so the graph is not stalled by a document lookup per candidate; the tag filter, which lives on
   * the chunk, still joins.
   */
  const onRow = projectionCandidateAccessCondition(embeddingSearch, input.access, input.plan, {
    filled: input.projectionFilled,
  })
  const walk =
    (scope: SQL): (() => RankedChunks) =>
    () =>
      withVectorScanSettings(
        (executor) =>
          executor.execute<SearchReadCandidate & { distance: number }>(sql`
            SELECT ${PROJECTION_CANDIDATE_COLUMNS}, ${input.candidateDistance} AS distance
            FROM ${embeddingSearch} /* on-row visibility */
            WHERE ${and(
              base,
              scope,
              onRow,
              documentSatisfies(embeddingSearch.documentId, input.documentCondition)
            )}
            ORDER BY ${input.candidateDistance} LIMIT ${input.candidateLimit}`),
        input.budget,
        'vector.source_walk',
        onRowWalkScanTuples(input.documentCondition, input.projectionFilled)
      )
  const walks: Array<() => RankedChunks> = sources.walked.map((connectorId) =>
    walk(eq(embeddingSearch.connectorId, connectorId))
  )
  const slicedScope = sql`(${embeddingSearch.connectorId} IS NULL
    OR ${embeddingSearch.connectorId} = ANY(${textArrayLiteral([...sources.sliced])}))`
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
        documentSatisfies(embeddingSearch.documentId, input.documentCondition)
      )
      const rows = await runSearchQuery(input.budget, 'vector.source_exact', (executor) =>
        executor.execute<SearchReadCandidate & { distance: number; saturated: boolean }>(sql`
                WITH readable_chunks AS MATERIALIZED (
                  SELECT ${PROJECTION_CANDIDATE_COLUMNS}, ${input.candidateDistance} AS distance
                  FROM ${embeddingSearch}
                  WHERE ${readableChunks}
                  LIMIT ${SOURCE_EXACT_CHUNK_LIMIT + 1}
                )
                SELECT id, "documentId", "connectorId", distance + 0 AS distance,
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
  const ranked: Array<SearchReadCandidate & { distance: number }> = scored.flat()
  return ranked
    .sort((a, b) => Number(a.distance) - Number(b.distance))
    .slice(0, input.candidateLimit)
}

/**
 * The vector leg of a user-scoped search-index search: a bounded candidate pool decided on the
 * projection row through the caller's resolved plan, then hydrated under the full read predicate.
 *
 * A bounded permitted set is ranked exactly; a reader who is a member of indexed sources has each
 * walked on its own; a broad reader walks the whole graph once. Live source authorization and
 * content hydration still run after candidate ranking.
 */
export async function selectIndexedVectorResults(
  params: SearchParams,
  context: IndexedRetrievalContext
): Promise<SearchResult[]> {
  const setup = prepareVectorLeg(params)
  const { access, accessPlan: plan, permitted } = context
  /** Only live-verified readers may defer source authorization until after candidate ranking. */
  const candidateAccess = knowledgeCandidateAccessConditionForConnectors(access, plan)
  /**
   * What an on-row walk still has to ask the document: the tags, which live on chunks, and the
   * date filter, which the row does not carry. A bounded set never walks, so this only runs when
   * the filtered documents were too many to enumerate.
   */
  const dateCondition = searchDateFilterCondition(params.filters)
  const documentCondition =
    setup.documentTagCondition || dateCondition
      ? and(setup.documentTagCondition, dateCondition)
      : undefined
  /** `filled`: whether the pool's rows carry their source, so a page needs no read of its own. */
  let candidatePool: (VectorCandidatePool & { filled: boolean }) | undefined
  return selectAuthorizedSearchResults({
    leg: 'vector',
    access: params.access,
    liveSourceAccess: context.liveSourceAccess,
    signal: params.signal,
    budget: params.budget,
    topK: params.topK,
    compareResults: (a, b) => a.distance - b.distance,
    selectPage: async (limit, offset, excludedSources) => {
      if (params.filters?.documentIds?.length) {
        return selectExactVectorPage(
          setup,
          params.budget,
          [
            ...getVisibilityConditions(params.filters, candidateAccess),
            excludeSearchSources(excludedSources),
          ],
          limit,
          offset
        )
      }
      if (permitted?.kind === 'bounded' && permitted.documents.length === 0)
        return { candidates: [], nextOffset: offset }
      candidatePool = await readVectorCandidatePool(
        candidatePool,
        excludedSources,
        offset,
        limit,
        async ({ excludedKey, candidateLimit, previous: previousPool }) => {
          /** Two remembered facts, read together when neither is remembered. */
          const [filled, plannedIndexedSources] = await Promise.all([
            isProjectionFilled('embedding_search', 'vector.projection_filled', params.budget),
            plan.memberSources.length ? indexedVectorSources(params.budget) : undefined,
          ])
          /**
           * A source the caller turned out not to hold is left out where the pool is built: the
           * pool is the page's order now, so a denied source's chunks would otherwise keep their
           * slots. The row's mirrored source decides it, unless the row is decided on its document.
           */
          const excludedOnRow = excludeSearchSourcesOnRow(embeddingSearch, filled, excludedSources)
          annotateVectorPoolPlanned(setup, candidateLimit)
          /**
           * Exact ranking reads what the permitted set costs rather than re-deriving permission
           * across the whole index, and honours `statement_timeout`, which a traversal cannot.
           * `read` are chunks a pool already holds, ranked past.
           */
          const rankPermittedExactly = (documentIds: string[], read?: readonly string[]) =>
            rankVectorCandidatesExactly({
              setup,
              knowledgeBaseIds: params.knowledgeBaseIds,
              documentIds,
              columns: PROJECTION_CANDIDATE_COLUMNS,
              conditions: [
                read?.length
                  ? sql`NOT (${embeddingSearch.id} = ANY(${textArrayLiteral([...read])}))`
                  : undefined,
                excludedOnRow,
              ],
              candidateLimit,
              budget: params.budget,
            })
          let selected: SearchReadCandidate[]
          /** Set where a pool's end is known better than by its length. */
          let exhausted: boolean | undefined
          const walkGraph = () =>
            withVectorScanSettings(
              (executor) =>
                executor.execute<SearchReadCandidate>(sql`
            SELECT ${PROJECTION_CANDIDATE_COLUMNS}
            FROM ${embeddingSearch} /* on-row visibility */
            WHERE ${and(
              inArray(embeddingSearch.knowledgeBaseId, params.knowledgeBaseIds),
              eq(embeddingSearch.enabled, true),
              excludedOnRow,
              projectionCandidateAccessCondition(embeddingSearch, access, plan, { filled }),
              documentSatisfies(embeddingSearch.documentId, documentCondition)
            )}
            ORDER BY ${setup.distance} LIMIT ${candidateLimit}
          `),
              params.budget,
              'vector.candidate_search',
              onRowWalkScanTuples(documentCondition, filled)
            )
          /**
           * A source the caller is a member of that has its own index is walked on its own, which
           * beats ranking it exactly once it is large enough to have earned that index.
           */
          const walksASource = plan.memberSources.some(
            (id) => plannedIndexedSources?.has(id) ?? false
          )
          if (
            permitted?.kind === 'bounded' &&
            filled &&
            permitted.documents.length >= PERMITTED_EXACT_DOCUMENT_LIMIT
          ) {
            /**
             * A set this large costs more to rank exactly than to walk: exact ranking reads every
             * chunk of every document in it, while the walk decides readability on the rows it
             * visits and stops at its tuple cap. The walk answers whenever the set is a fair share
             * of the graph; where it is not, the walk underfills and the exact ranking that was
             * always complete takes over, so nothing is lost but the walk's bounded cost.
             *
             * The walk decides readability on the projection row, which is broader than the
             * document predicate hydration applies, so a pool it filled can still run short of
             * readable rows. That shortfall is what refills a pool: the refill is the exact ranking,
             * complete over the set, ranked past the rows already read and placed behind them, so
             * the pages keep their offsets and every refill is a full window of fresh rows.
             */
            const permittedIds = permitted.documents.map((entry) => entry.id)
            const previous = previousPool?.ids
            if (previous) {
              const exact = await rankPermittedExactly(
                permittedIds,
                previous.map((candidate) => candidate.id)
              )
              selected = [...previous, ...exact]
              exhausted = exact.length < candidateLimit
            } else {
              selected = await walkGraph()
              if (selected.length < candidateLimit)
                selected = await rankPermittedExactly(permittedIds)
            }
          } else if (permitted?.kind === 'bounded' && (!walksASource || context.filtered)) {
            /**
             * A bounded permitted set is ranked exactly without walking the graph first: the walk
             * post-filters, so when the caller reads a small share of the index it spends its whole
             * uninterruptible tuple budget and still returns almost none of their neighbours. A
             * member's indexed source is otherwise walked instead, but not under a filter: the walk
             * cannot see the date, and a filtered set is small by construction.
             */
            selected = await rankPermittedExactly(permitted.documents.map((entry) => entry.id))
          } else if (!(permitted?.kind === 'unbounded' && permitted.broad)) {
            /**
             * Readability follows sources, so each readable source is searched in its own index and
             * the results merged. A member reads a source whole or barely at all: walking one source
             * spends its budget among chunks they can read, where a walk over every source spends it
             * on the sources they cannot. A caller whose reach is broad skips this: for them the
             * whole graph's neighbours are mostly theirs already, and one walk is the cheaper answer.
             */
            selected = await selectSourceVectorCandidates({
              access,
              knowledgeBaseIds: params.knowledgeBaseIds,
              plan,
              exclusion: excludedOnRow,
              projectionFilled: filled,
              tagCondition: setup.candidateTagCondition,
              documentCondition,
              candidateDistance: setup.distance,
              candidateLimit,
              budget: params.budget,
            })
          } else {
            /**
             * A broad reader's nearest chunks are mostly theirs, so one walk over the whole graph,
             * deciding readability on the row, is the cheapest exact answer there is.
             */
            selected = await walkGraph()
          }
          const pool = {
            ...gatheredVectorCandidatePool(excludedKey, selected, candidateLimit, exhausted),
            filled,
          }
          annotateVectorPoolSelected(selected.length, candidateLimit)
          return pool
        }
      )
      /**
       * The walk carries each candidate's document and source, so a page is a slice of the pool.
       * Rescoring the pool against the original vectors here read one out-of-line vector per
       * candidate from storage no cache holds, seconds on a query nobody had run before; the page
       * is scored at hydration instead.
       */
      if (candidatePool.filled) return sliceVectorCandidatePool(candidatePool, offset, limit)
      /**
       * While the source and ACL fill runs, a row it has not reached carries no source, so the
       * page's identities are read off the documents; a slice whose documents all went away since
       * the walk is passed over, not mistaken for the pool's end.
       */
      for (let start = offset; start < candidatePool.ids.length; start += limit) {
        const slice = candidatePool.ids.slice(start, start + limit)
        const ranked = new Map(slice.map((candidate, index) => [candidate.id, index]))
        const identities = await runSearchQuery(params.budget, 'vector.page', (executor) =>
          executor.execute<SearchReadCandidate>(sql`
          SELECT ${embeddingSearch.id} AS id, ${document.id} AS "documentId",
            ${document.connectorId} AS "connectorId"
          FROM ${embeddingSearch}
          INNER JOIN ${document} ON ${document.id} = ${embeddingSearch.documentId}
          WHERE ${embeddingSearch.id} = ANY(${textArrayLiteral(slice.map((candidate) => candidate.id))})
        `)
        )
        if (!identities.length) continue
        const page = [...identities].sort(
          (a, b) => (ranked.get(a.id) ?? 0) - (ranked.get(b.id) ?? 0)
        )
        return { candidates: page, nextOffset: start + slice.length }
      }
      return { candidates: [], nextOffset: candidatePool.ids.length }
    },
    hydrate: (ids, authorized) =>
      hydrateVectorCandidates(ids, knowledgeAccessCondition(authorized), setup, params),
  })
}
