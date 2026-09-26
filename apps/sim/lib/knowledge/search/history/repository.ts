import { db } from '@sim/db'
import { organizationSearchHistory } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import {
  SEARCH_HISTORY_LIMIT,
  SEARCH_HISTORY_MAX_AGE_MS,
} from '@/lib/knowledge/search/history/limits'

type HistoryRow = typeof organizationSearchHistory.$inferSelect
export type SearchHistory = Pick<HistoryRow, 'sources' | 'queries'>
export type SearchHistoryEvent =
  | { kind: 'source'; source: Omit<HistoryRow['sources'][number], 'viewedAt'> }
  | { kind: 'query'; query: string }

interface HistoryOwner {
  organizationId: string
  userId: string
}

function ownerCondition(owner: HistoryOwner) {
  return and(
    eq(organizationSearchHistory.organizationId, owner.organizationId),
    eq(organizationSearchHistory.userId, owner.userId)
  )
}

function recentHistory(history: SearchHistory): SearchHistory {
  const cutoff = Date.now() - SEARCH_HISTORY_MAX_AGE_MS
  return {
    sources: history.sources
      .filter((source) => Date.parse(source.viewedAt) > cutoff)
      .slice(0, SEARCH_HISTORY_LIMIT),
    queries: history.queries
      .filter((entry) => Date.parse(entry.searchedAt) > cutoff)
      .slice(0, SEARCH_HISTORY_LIMIT),
  }
}

export async function readSearchHistory(owner: HistoryOwner): Promise<SearchHistory> {
  const [row] = await db
    .select({
      sources: organizationSearchHistory.sources,
      queries: organizationSearchHistory.queries,
    })
    .from(organizationSearchHistory)
    .where(ownerCondition(owner))
    .limit(1)
  return recentHistory(row ?? { sources: [], queries: [] })
}

/** One locked row per person and organization makes deduplication, bounds and clearing atomic. */
export async function updateSearchHistory(
  owner: HistoryOwner,
  event: SearchHistoryEvent | null
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(organizationSearchHistory).values(owner).onConflictDoNothing()
    const [row] = await tx
      .select()
      .from(organizationSearchHistory)
      .where(ownerCondition(owner))
      .for('update')
    const history = event ? recentHistory(row) : { sources: [], queries: [] }
    const now = new Date().toISOString()
    if (event?.kind === 'source') {
      history.sources = [
        { ...event.source, viewedAt: now },
        ...history.sources.filter((source) => source.url !== event.source.url),
      ].slice(0, SEARCH_HISTORY_LIMIT)
    } else if (event?.kind === 'query') {
      history.queries = [
        { query: event.query, searchedAt: now },
        ...history.queries.filter((entry) => entry.query !== event.query),
      ].slice(0, SEARCH_HISTORY_LIMIT)
    }
    await tx.update(organizationSearchHistory).set(history).where(ownerCondition(owner))
  })
}
