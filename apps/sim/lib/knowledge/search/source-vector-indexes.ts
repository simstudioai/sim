import { db } from '@sim/db'
import { document, embeddingSearch } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { and, count, eq, isNull, sql } from 'drizzle-orm'
import { LRUCache } from 'lru-cache'

const logger = createLogger('SourceVectorIndexes')

/**
 * Documents a source needs before it earns its own vector index. Below it, the caller's documents
 * in that source are few enough to rank exactly, which is faster than a graph walk and exact by
 * construction.
 */
export const SOURCE_INDEX_MIN_DOCUMENTS = 15_000

/**
 * An index's name and predicate are spelled into DDL, which takes no parameters, so a connector id
 * is only ever used after it matches the shape connectors carry.
 */
const CONNECTOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Derived, never stored, so a dropped source leaves nothing to reconcile. */
function indexName(connectorId: string): string {
  return `embedding_search_src_${connectorId.replaceAll('-', '')}_hnsw`
}

/**
 * The sources that have their own index, cached briefly: every unbounded ranking asks, and the
 * answer changes only when a sync builds one or a deletion drops one.
 */
const indexedSources = new LRUCache<'sources', ReadonlySet<string>>({ max: 1, ttl: 60 * 1000 })

export async function indexedVectorSources(): Promise<ReadonlySet<string>> {
  const cached = indexedSources.get('sources')
  if (cached) return cached
  const rows = await db.execute<{ connectorId: string | null }>(sql`
    SELECT substring(pg_get_expr(i.indpred, i.indrelid) from '''([0-9a-f-]+)''') AS "connectorId"
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    WHERE i.indrelid = 'embedding_search'::regclass
      AND c.relname LIKE 'embedding_search_src_%' AND i.indisvalid AND i.indisready`)
  const sources = new Set(
    rows.map((row) => row.connectorId).filter((id): id is string => id !== null)
  )
  indexedSources.set('sources', sources)
  return sources
}

/** The projection column a source's chunks rank on, or null where its base spans several widths. */
async function projectionColumn(connectorId: string): Promise<string | null> {
  const [row] = await db.execute<{ column: string | null }>(sql`
    SELECT CASE count(DISTINCT width) WHEN 1 THEN min(width) END AS column FROM (
      SELECT CASE
        WHEN s.vector_512 IS NOT NULL THEN 'vector_512'
        WHEN s.vector_384 IS NOT NULL THEN 'vector_384'
        WHEN s.vector_768 IS NOT NULL THEN 'vector_768'
        WHEN s.vector_1024 IS NOT NULL THEN 'vector_1024'
        WHEN s.vector_3072 IS NOT NULL THEN 'vector_3072'
        ELSE 'vector'
      END AS width
      FROM ${embeddingSearch} s
      WHERE s.connector_id = ${connectorId} AND s.enabled
      LIMIT 500
    ) sampled`)
  return row?.column ?? null
}

/**
 * Drops an index only while it is unusable — a failed build leaves one behind, and the next build
 * must clear it. Overlapping syncs make this the difference between clearing a leftover and
 * dropping the index the other one just built: only the caller whose build failed removes
 * anything, so a valid index always survives.
 */
async function dropInvalidIndex(name: string): Promise<void> {
  const [row] = await db.execute<{ invalid: boolean }>(sql`
    SELECT NOT i.indisvalid OR NOT i.indisready AS invalid
    FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
    WHERE c.relname = ${name}`)
  if (row?.invalid) await db.execute(sql.raw(`DROP INDEX CONCURRENTLY IF EXISTS "${name}"`))
}

/**
 * Gives a source its own vector index once it holds enough documents to need one, called after a
 * sync that may have grown it. A member reads a source whole, so walking that source's index
 * returns their own neighbours, where a walk over every source spends its scan budget on chunks
 * they cannot read.
 *
 * Retrieval never waits on this: a source without an index is ranked exactly, which is what a
 * smaller source affords anyway, so a build that is skipped, fails, or has not happened yet costs
 * recall nothing. Builds run `CONCURRENTLY` and outside a transaction, so writers keep going; a
 * failed build leaves an invalid index, which this drops before building again.
 */
export async function ensureSourceVectorIndex(connectorId: string): Promise<boolean> {
  if (!CONNECTOR_ID.test(connectorId)) return false
  if ((await indexedVectorSources()).has(connectorId)) return false
  const [{ documents }] = await db
    .select({ documents: count() })
    .from(document)
    .where(and(eq(document.connectorId, connectorId), isNull(document.deletedAt)))
  if (documents < SOURCE_INDEX_MIN_DOCUMENTS) return false
  const column = await projectionColumn(connectorId)
  if (!column) return false
  const name = indexName(connectorId)
  const startedAt = Date.now()
  try {
    await dropInvalidIndex(name)
    await db.execute(sql`SET maintenance_work_mem = '2GB'`)
    await db.execute(
      sql.raw(`CREATE INDEX CONCURRENTLY "${name}" ON embedding_search
        USING hnsw (${column} halfvec_cosine_ops) WITH (m = 16, ef_construction = 64)
        WHERE connector_id = '${connectorId}' AND enabled`)
    )
    logger.info('Built a source vector index', {
      connectorId,
      documents,
      elapsedMs: Date.now() - startedAt,
    })
    indexedSources.clear()
    return true
  } catch (error) {
    logger.error('Source vector index build failed', { connectorId, error: getErrorMessage(error) })
    await dropInvalidIndex(name)
    return false
  } finally {
    await db.execute(sql`RESET maintenance_work_mem`)
  }
}

/** Drops a source's index when the source goes away; ranking falls back to the exact path. */
export async function dropSourceVectorIndex(connectorId: string): Promise<void> {
  if (!CONNECTOR_ID.test(connectorId)) return
  await db.execute(sql.raw(`DROP INDEX CONCURRENTLY IF EXISTS "${indexName(connectorId)}"`))
  indexedSources.clear()
}
