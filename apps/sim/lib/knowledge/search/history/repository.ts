import { db } from '@sim/db'
import { document, knowledgeConnector, organizationSearchHistory } from '@sim/db/schema'
import { truncateAtCodePoint } from '@sim/utils/string'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import {
  knowledgeAccessCondition,
  knowledgeMetadataCandidateAccessCondition,
} from '@/lib/knowledge/access/predicate'
import {
  type KnowledgeAccessProvider,
  MAX_KNOWLEDGE_ACCESS_CANDIDATES,
} from '@/lib/knowledge/access/types'
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
      .slice(0, SEARCH_HISTORY_LIMIT)
      .map(({ url, viewedAt }) => ({ url, viewedAt })),
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
        { url: event.source.url, viewedAt: now },
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

/** Only current indexed metadata can leave the server; an unprovable saved URL is omitted. */
export async function readAccessibleHistorySources(
  knowledgeBaseId: string,
  sources: SearchHistory['sources'],
  access: KnowledgeAccessProvider,
  signal?: AbortSignal
) {
  if (!sources.length) return []
  signal?.throwIfAborted()
  const conditions = [
    eq(document.knowledgeBaseId, knowledgeBaseId),
    inArray(
      sql<string>`md5(${document.sourceUrl})`,
      sources.map(({ url }) => sql`md5(${url})`)
    ),
    inArray(
      document.sourceUrl,
      sources.map(({ url }) => url)
    ),
    eq(document.enabled, true),
    eq(document.userExcluded, false),
    isNull(document.archivedAt),
    isNull(document.deletedAt),
  ]
  let scope = await access.get()
  let ids: string[] | undefined
  if (await access.liveSourceConnectorCondition()) {
    const candidates = await db
      .select({ id: document.id, connectorId: document.connectorId })
      .from(document)
      .where(and(...conditions, knowledgeMetadataCandidateAccessCondition(scope)))
      .orderBy(asc(document.id))
      .limit(MAX_KNOWLEDGE_ACCESS_CANDIDATES)
    if (!candidates.length) return []
    ids = candidates.map(({ id }) => id)
    scope = await access.getForConnectors(
      candidates.flatMap(({ connectorId }) => (connectorId ? [connectorId] : [])),
      signal
    )
  }
  signal?.throwIfAborted()
  const rows = await db
    .select({
      url: document.sourceUrl,
      title: sql<string>`left(${document.filename}, 512)`,
      connectorType: knowledgeConnector.connectorType,
    })
    .from(document)
    .leftJoin(knowledgeConnector, eq(knowledgeConnector.id, document.connectorId))
    .where(
      and(
        ...conditions,
        ids ? inArray(document.id, ids) : undefined,
        knowledgeAccessCondition(scope)
      )
    )
    .orderBy(asc(document.id))
    .limit(MAX_KNOWLEDGE_ACCESS_CANDIDATES)
  const byUrl = new Map(rows.map((row) => [row.url, row]))
  return sources.flatMap(({ url, viewedAt }) => {
    const row = byUrl.get(url)
    return row
      ? [
          {
            url,
            viewedAt,
            title: truncateAtCodePoint(row.title.trim(), 512, '') || undefined,
            connectorType: row.connectorType
              ? truncateAtCodePoint(row.connectorType, 64, '')
              : undefined,
          },
        ]
      : []
  })
}
