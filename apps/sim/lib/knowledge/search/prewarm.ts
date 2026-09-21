import { PROJECTION_SOURCE_ACL_TABLES } from '@sim/db/script-migrations/0021_embedding_search_connector'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'

const logger = createLogger('SearchProjectionPrewarm')

/**
 * The access methods a ranking touches at random: the vector graphs, the Tin keyword index, and
 * the GIN index the on-row permission test reads. The remaining b-trees serve hydration, which
 * reads a handful of rows by key and is fast cold.
 */
const RANKING_ACCESS_METHODS = ['hnsw', 'tin', 'gin'] as const

/** The one call the helper needs from a `postgres` connection or a reserved session. */
export interface PrewarmSession {
  unsafe(query: string, parameters?: string[]): PromiseLike<ArrayLike<Record<string, unknown>>>
}

export interface PrewarmedRelation {
  relation: string
  pages: number
  elapsedMs: number
}

/**
 * `pg_prewarm` is not a trusted extension, so the application role cannot create it and no
 * migration can; a superuser installs it once. Without it the projection warms only as searches
 * touch it, which is what a bulk operation leaves behind.
 */
export async function pgPrewarmInstalled(session: PrewarmSession): Promise<boolean> {
  const rows = await session.unsafe("SELECT 1 FROM pg_extension WHERE extname = 'pg_prewarm'")
  return rows.length > 0
}

/**
 * Reads one relation into the operating system's cache. `read` mode leaves shared buffers to the
 * workload, where `buffer` mode would evict them wholesale to make room.
 */
export async function prewarmRelation(
  session: PrewarmSession,
  relation: string
): Promise<PrewarmedRelation> {
  const startedAt = Date.now()
  const [row] = Array.from(
    await session.unsafe("SELECT pg_prewarm($1::regclass, 'read')::int AS pages", [relation])
  )
  return { relation, pages: Number(row?.pages ?? 0), elapsedMs: Date.now() - startedAt }
}

/**
 * Warms the ranking projections after something streamed through them. A backfill or index build
 * reads every heap page in order and pushes the vector graphs out of cache; the next searches
 * then fetch the graph one random page at a time from disk, take seconds, and end at their
 * deadline with partial results. Reading the projections back in makes the first search after a
 * bulk operation as fast as the thousandth.
 *
 * Heaps go first and the ranking indexes last, so where the cache cannot hold everything the
 * indexes are what survives: a walk reads far more index pages than heap pages. Relations are
 * resolved through the search path, so a schema that carries its own copy warms its own copy.
 * A relation that fails to warm is logged and skipped; warming is never worth failing the
 * operation that asked for it.
 */
export async function prewarmSearchProjection(
  session: PrewarmSession
): Promise<PrewarmedRelation[]> {
  if (!(await pgPrewarmInstalled(session))) {
    logger.warn('pg_prewarm is not installed; the search projection warms only as it is searched')
    return []
  }
  let relations: string[]
  try {
    relations = await rankingRelations(session)
  } catch (error) {
    logger.warn('Search projection relations could not be listed', {
      error: getErrorMessage(error),
    })
    return []
  }
  const warmed: PrewarmedRelation[] = []
  for (const relation of relations) {
    try {
      warmed.push(await prewarmRelation(session, relation))
    } catch (error) {
      logger.warn('Search projection relation failed to warm', {
        relation,
        error: getErrorMessage(error),
      })
    }
  }
  logger.info('Search projection warmed', {
    relations: warmed.length,
    pages: warmed.reduce((sum, item) => sum + item.pages, 0),
    elapsedMs: warmed.reduce((sum, item) => sum + item.elapsedMs, 0),
  })
  return warmed
}

/** The projections' heaps, then their ranking indexes smallest first, as the search path finds them. */
async function rankingRelations(session: PrewarmSession): Promise<string[]> {
  const rows = await session.unsafe(
    `WITH heaps AS (
       SELECT to_regclass(name) AS oid FROM unnest($1::text[]) AS name
     )
     SELECT c.oid::regclass::text AS relation
     FROM pg_class c
     JOIN pg_am am ON am.oid = c.relam
     LEFT JOIN pg_index i ON i.indexrelid = c.oid
     WHERE c.oid IN (SELECT oid FROM heaps)
        OR (
          i.indrelid IN (SELECT oid FROM heaps)
          AND i.indisvalid
          AND am.amname = ANY($2::text[])
        )
     ORDER BY c.relkind = 'r' DESC, pg_relation_size(c.oid)`,
    [toArrayLiteral(PROJECTION_SOURCE_ACL_TABLES), toArrayLiteral(RANKING_ACCESS_METHODS)]
  )
  return Array.from(rows, (row) => String(row.relation))
}

/** Postgres array literal for identifiers that carry no quotes, commas or braces. */
function toArrayLiteral(values: readonly string[]): string {
  return `{${values.join(',')}}`
}
