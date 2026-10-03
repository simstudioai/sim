import { db } from '@sim/db'
import { document, knowledgeBase, knowledgeConnector } from '@sim/db/schema'
import { and, asc, eq, exists, gt, inArray, not, type SQL } from 'drizzle-orm'
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
import { annotateSearchDiagnostics, measureSearchStage } from '@/lib/knowledge/search/diagnostics'

export type KnowledgeReadAccess = KnowledgeAccessScope | SystemAccessScope | KnowledgeAccessProvider

/**
 * Streams disjoint, fully authorized document predicates for an existing reader's filters.
 * Only connector IDs are selected before live proof, and only from sources a live grant could
 * authorize, stopping at each source's first candidate document; any other source keeps the
 * ordinary predicate's decision. Totals and metadata use the yielded full predicate. Paging
 * avoids making unrelated sources a prerequisite for any one batch.
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
  /** Recorded before the yield so the count survives a caller that stops consuming here. */
  annotateSearchDiagnostics({ accessBatchCount: 1, liveProofConnectorCount: 0 })
  yield ordinary
  if (!provider || scope.kind !== 'user') return
  const liveSources = await provider.liveSourceConnectorCondition()
  if (!liveSources) return

  let cursor: string | undefined
  let batches = 1
  let liveProofConnectors = 0
  while (true) {
    signal?.throwIfAborted()
    const rows = await measureSearchStage('access_batch.connectors', () =>
      db
        .select({ connectorId: knowledgeConnector.id })
        .from(knowledgeConnector)
        .where(
          and(
            liveSources,
            cursor ? gt(knowledgeConnector.id, cursor) : undefined,
            exists(
              db
                .select({ id: document.id })
                .from(document)
                .innerJoin(knowledgeBase, eq(document.knowledgeBaseId, knowledgeBase.id))
                .where(
                  and(
                    eq(document.connectorId, knowledgeConnector.id),
                    ...conditions,
                    knowledgeMetadataCandidateAccessCondition(scope),
                    not(ordinary)
                  )
                )
            )
          )
        )
        .orderBy(asc(knowledgeConnector.id))
        .limit(MAX_KNOWLEDGE_ACCESS_CANDIDATES)
    )
    if (rows.length === 0) return
    const connectorIds = rows.map(({ connectorId }) => connectorId)
    liveProofConnectors += connectorIds.length
    batches += 1
    annotateSearchDiagnostics({
      accessBatchCount: batches,
      liveProofConnectorCount: liveProofConnectors,
    })
    /** Live proof reaches the source over the network, once per connector it cannot already prove. */
    const proof = await measureSearchStage('access_batch.live_proof', () =>
      provider.getForConnectors(connectorIds, signal)
    )
    yield and(
      not(ordinary),
      inArray(document.connectorId, connectorIds),
      knowledgeAccessCondition(proof)
    )!
    if (rows.length < MAX_KNOWLEDGE_ACCESS_CANDIDATES) return
    cursor = connectorIds[connectorIds.length - 1]
  }
}
