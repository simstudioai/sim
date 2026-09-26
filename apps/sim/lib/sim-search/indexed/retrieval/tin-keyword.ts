import { EMBEDDING_KEYWORD_TIN_INDEX } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { sql } from 'drizzle-orm'
import { LRUCache } from 'lru-cache'
import { runSearchQuery, type SearchBudget } from '@/lib/knowledge/search/budget'
import { tinQueryFromTsquery } from '@/lib/sim-search/indexed/retrieval/tin-query'

const logger = createLogger('TinKeywordSearch')

/**
 * How long a readiness answer holds. The index only becomes valid once the projection is fully
 * backfilled, and a newly valid or dropped index is noticed within this window.
 */
const READINESS_TTL_MS = 60 * 1000

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
 * The TINQL query that ranks `query` inside a search index's bases, or null when keyword search
 * must keep the GIN projection: the database has no complete Tin index, or the query uses a shape
 * TINQL cannot express. The text is analyzed by the same `websearch_to_tsquery` the GIN path
 * uses, so both engines match the same stemmed terms.
 *
 * Every read runs under the keyword leg's `budget`, so deciding the engine cannot outlast the leg's
 * deadline. A read that fails for another reason, including a shared cache read cut short by
 * another search's deadline, keeps the GIN projection; this search's own expired deadline or
 * cancellation propagates like any other keyword query's.
 */
export async function resolveTinKeywordQuery(
  query: string,
  ftsConfig: string,
  budget: SearchBudget | undefined
): Promise<string | null> {
  try {
    if (!(await indexReadiness.fetch('index', { context: budget }))) return null
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
