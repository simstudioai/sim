import { sql } from 'drizzle-orm'
import { LRUCache } from 'lru-cache'
import { runSearchQuery, type SearchBudget } from '@/lib/knowledge/search/budget'

/**
 * The sources that have their own index, cached briefly: every unbounded ranking asks, and the
 * answer changes only when a connector deletion drops one.
 */
const indexedSources = new LRUCache<'sources', ReadonlySet<string>>({ max: 1, ttl: 60 * 1000 })

/** Forgets the cached answer. */
export function forgetIndexedVectorSources(): void {
  indexedSources.clear()
}

/** The sources with a graph of their own; a search that misses the memo reads under its own deadline. */
export async function indexedVectorSources(budget?: SearchBudget): Promise<ReadonlySet<string>> {
  const cached = indexedSources.get('sources')
  if (cached) return cached
  const rows = await runSearchQuery(budget, 'vector.source_indexes', (executor) =>
    executor.execute<{ connectorId: string | null }>(sql`
    SELECT substring(pg_get_expr(i.indpred, i.indrelid) from '''([0-9a-f-]+)''') AS "connectorId"
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    WHERE i.indrelid = 'embedding_search'::regclass
      AND c.relname LIKE 'embedding_search_src_%' AND i.indisvalid AND i.indisready`)
  )
  const sources = new Set(
    rows.map((row) => row.connectorId).filter((id): id is string => id !== null)
  )
  indexedSources.set('sources', sources)
  return sources
}
