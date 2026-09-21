import { EMBEDDING_KEYWORD_TIN_INDEX, knowledgeBase } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { inArray, sql } from 'drizzle-orm'
import { LRUCache } from 'lru-cache'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { runSearchQuery, type SearchBudget } from '@/lib/knowledge/search/budget'
import { tinQueryFromTsquery } from '@/lib/knowledge/search/tin-query'

const logger = createLogger('TinKeywordSearch')

/**
 * How long a readiness answer holds. The index only becomes valid once the projection is fully
 * backfilled, and never invalid again; the flag is checked on every search regardless, so a
 * long hold costs nothing but the one read it saves each search.
 */
const READINESS_TTL_MS = 10 * 60 * 1000
const SEARCH_INDEX_TTL_MS = 10 * 60 * 1000

/**
 * Whether the Tin index exists and finished building, i.e. the projection is complete. The read
 * spends the budget of the search that missed the cache.
 */
const indexReadiness = new LRUCache<'index', boolean, SearchBudget | undefined>({
  max: 1,
  ttl: READINESS_TTL_MS,
  fetchMethod: async (_key, _stale, { context }) => {
    const [row] = await runSearchQuery(context, 'keyword.tin_readiness', (executor) =>
      executor.execute<{ valid: boolean }>(sql`
        SELECT i.indisvalid AS valid FROM pg_index i
        WHERE i.indexrelid = to_regclass(${EMBEDDING_KEYWORD_TIN_INDEX})`)
    )
    return row?.valid === true
  },
})

/**
 * Only organization search indexes are projected. `is_search_index` is only ever turned on, when a
 * legacy base is adopted, so a stale answer just keeps that base on the GIN projection for one TTL.
 */
const searchIndexBases = new LRUCache<string, boolean>({
  max: 10_000,
  ttl: SEARCH_INDEX_TTL_MS,
})

async function allSearchIndexes(
  knowledgeBaseIds: readonly string[],
  budget: SearchBudget | undefined
): Promise<boolean> {
  const unknown = knowledgeBaseIds.filter((id) => searchIndexBases.get(id) === undefined)
  if (unknown.length > 0) {
    const rows = await runSearchQuery(budget, 'keyword.tin_readiness', (executor) =>
      executor
        .select({ id: knowledgeBase.id, isSearchIndex: knowledgeBase.isSearchIndex })
        .from(knowledgeBase)
        .where(inArray(knowledgeBase.id, unknown))
    )
    for (const row of rows) searchIndexBases.set(row.id, row.isSearchIndex)
  }
  return knowledgeBaseIds.every((id) => searchIndexBases.get(id) === true)
}

/**
 * The TINQL query that ranks `query` inside `knowledgeBaseIds`, or null when keyword search must
 * keep the GIN projection: the rollout flag is off, the database has no complete Tin index, a
 * base is not an organization search index (only those are projected), or the query uses a shape
 * TINQL cannot express. The text is analyzed by the same `websearch_to_tsquery` the GIN path
 * uses, so both engines match the same stemmed terms.
 *
 * Every read runs under the keyword leg's `budget`, so deciding the engine cannot outlast the leg's
 * deadline. A read that fails for another reason, including a shared cache read cut short by
 * another search's deadline, keeps the GIN projection; this search's own expired deadline or
 * cancellation propagates like any other keyword query's.
 */
export async function resolveTinKeywordQuery(
  knowledgeBaseIds: readonly string[],
  query: string,
  ftsConfig: string,
  budget: SearchBudget | undefined
): Promise<string | null> {
  if (knowledgeBaseIds.length === 0) return null
  try {
    if (!(await isFeatureEnabled('knowledge-tin-keyword'))) return null
    if (!(await indexReadiness.fetch('index', { context: budget }))) return null
    if (!(await allSearchIndexes(knowledgeBaseIds, budget))) return null
    const [{ rendered }] = await runSearchQuery(budget, 'keyword.tin_query', (executor) =>
      executor.execute<{ rendered: string }>(
        sql`SELECT websearch_to_tsquery(${ftsConfig}::regconfig, ${query})::text AS rendered`
      )
    )
    return tinQueryFromTsquery(rendered)
  } catch (error) {
    budget?.remaining()
    logger.warn('Tin keyword readiness check failed; using the GIN projection', {
      error: getErrorMessage(error),
    })
    return null
  }
}
