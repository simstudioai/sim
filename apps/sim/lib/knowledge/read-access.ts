import { db } from '@sim/db'
import { document, knowledgeBase, knowledgeConnector } from '@sim/db/schema'
import { and, asc, eq, gt, inArray, isNotNull, not, type SQL } from 'drizzle-orm'
import {
  knowledgeAccessCondition,
  knowledgeMetadataCandidateAccessCondition,
} from '@/lib/knowledge/access/predicate'
import {
  type KnowledgeAccessProvider,
  type KnowledgeAccessScope,
  MAX_KNOWLEDGE_ACCESS_CANDIDATES,
  type SystemAccessScope,
} from '@/lib/knowledge/access/types'

export type KnowledgeReadAccess = KnowledgeAccessScope | SystemAccessScope | KnowledgeAccessProvider

/**
 * Streams disjoint, fully authorized document predicates for an existing reader's filters.
 * Only connector IDs are selected before live proof; totals and metadata use the yielded
 * full predicate. Paging avoids making unrelated sources a prerequisite for any one batch.
 */
export async function* knowledgeReadAccessBatches(
  access: KnowledgeReadAccess,
  conditions: readonly (SQL | undefined)[],
  signal?: AbortSignal
): AsyncGenerator<SQL> {
  signal?.throwIfAborted()
  const provider = 'get' in access ? access : undefined
  const scope = 'get' in access ? await access.get() : access
  const ordinary = knowledgeAccessCondition(scope)
  yield ordinary
  if (!provider || scope.kind !== 'user') return
  if (provider.hasLiveSourceReaders && !(await provider.hasLiveSourceReaders())) return

  let cursor: string | undefined
  while (true) {
    signal?.throwIfAborted()
    const rows = await db
      .selectDistinct({ connectorId: document.connectorId })
      .from(document)
      .innerJoin(knowledgeConnector, eq(document.connectorId, knowledgeConnector.id))
      .innerJoin(knowledgeBase, eq(document.knowledgeBaseId, knowledgeBase.id))
      .where(
        and(
          ...conditions,
          knowledgeMetadataCandidateAccessCondition(scope),
          not(ordinary),
          isNotNull(document.connectorId),
          cursor ? gt(document.connectorId, cursor) : undefined
        )
      )
      .orderBy(asc(document.connectorId))
      .limit(MAX_KNOWLEDGE_ACCESS_CANDIDATES)
    if (rows.length === 0) return
    const connectorIds = rows.flatMap(({ connectorId }) => (connectorId ? [connectorId] : []))
    if (connectorIds.length === 0) return
    const proof = await provider.getForConnectors(connectorIds, signal)
    yield and(
      not(ordinary),
      inArray(document.connectorId, connectorIds),
      knowledgeAccessCondition(proof)
    )!
    if (rows.length < MAX_KNOWLEDGE_ACCESS_CANDIDATES) return
    cursor = connectorIds[connectorIds.length - 1]
  }
}
