import { db } from '@sim/db'
import { sql } from 'drizzle-orm'

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
 * Drops a deleted source's per-source vector index, where an earlier build left one. Nothing
 * builds these any more; the dormant indexed search (`lib/sim-search/indexed/retrieval/`) still
 * reads the ones that exist, and its brief cache of them only names sources a search can no
 * longer reach once their connector is deleted.
 */
export async function dropSourceVectorIndex(connectorId: string): Promise<void> {
  if (!CONNECTOR_ID.test(connectorId)) return
  await db.execute(sql.raw(`DROP INDEX CONCURRENTLY IF EXISTS "${indexName(connectorId)}"`))
}
