import { db } from '@sim/db'
import { document, knowledgeBase, knowledgeConnector } from '@sim/db/schema'
import { and, eq, exists, inArray, isNull, sql } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { type ResourceOwner, resourceScopeFromOwner } from '@/lib/core/resource-scope'
import { resourceScopeCondition } from '@/lib/core/resource-scope.server'
import { knowledgeAccessCondition } from '@/lib/knowledge/access/predicate'
import { createKnowledgeAccessProvider } from '@/lib/knowledge/access/scope'
import { defineAuthorizedKnowledgeUseCase } from '@/lib/knowledge/application/authorized-knowledge-use-case'
import { resolveKnowledgeOwnerContext } from '@/lib/knowledge/application/contexts'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { MAX_SEARCH_SOURCE_PROGRESS_ITEMS } from '@/lib/knowledge/constants'
import { searchIntegrationAccessCondition } from '@/lib/knowledge/search/integration-policy'

interface ReadSearchSourceProgressInput extends ResourceOwner {
  connectorIds: string[]
}

/** Progress probes stop at the first visible document, without recounting completed chunks. */
export const readSearchSourceProgress = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.readSearchSourceProgress,
  resolveContext: ({ input }: { input: ReadSearchSourceProgressInput }) =>
    resolveKnowledgeOwnerContext(input),
  async execute({ principal, input, context }) {
    if (
      input.connectorIds.length === 0 ||
      input.connectorIds.length > MAX_SEARCH_SOURCE_PROGRESS_ITEMS
    ) {
      throw new OrchestrationError(
        'validation',
        `Provide between 1 and ${MAX_SEARCH_SOURCE_PROGRESS_ITEMS} sources`
      )
    }
    const access = await createKnowledgeAccessProvider(principal, context).get()
    const hasDocumentsInState = (statuses: string[]) =>
      sql<boolean>`${exists(
        db
          .select({ id: document.id })
          .from(document)
          .where(
            and(
              eq(document.knowledgeBaseId, knowledgeConnector.knowledgeBaseId),
              eq(document.connectorId, knowledgeConnector.id),
              inArray(document.processingStatus, statuses),
              eq(document.enabled, true),
              eq(document.userExcluded, false),
              isNull(document.archivedAt),
              isNull(document.deletedAt),
              knowledgeAccessCondition(access)
            )
          )
      )}`
    const rows = await db
      .select({
        connectorId: knowledgeConnector.id,
        status: knowledgeConnector.status,
        accessMode: knowledgeConnector.accessMode,
        memberSyncStatus: knowledgeConnector.memberSyncStatus,
        hasRetainedSyncError: sql<boolean>`${knowledgeConnector.lastSyncError} IS NOT NULL`,
        approved: sql<boolean>`${searchIntegrationAccessCondition()}`,
        isIndexing: hasDocumentsInState(['pending', 'processing']),
        hasIndexingError: hasDocumentsInState(['failed']),
      })
      .from(knowledgeConnector)
      .innerJoin(knowledgeBase, eq(knowledgeBase.id, knowledgeConnector.knowledgeBaseId))
      .where(
        and(
          resourceScopeCondition(knowledgeBase, resourceScopeFromOwner(context)),
          eq(knowledgeBase.isSearchIndex, true),
          isNull(knowledgeBase.deletedAt),
          inArray(knowledgeConnector.id, [...new Set(input.connectorIds)]),
          inArray(knowledgeConnector.accessMode, ['admin', 'members']),
          isNull(knowledgeConnector.archivedAt),
          isNull(knowledgeConnector.deletedAt)
        )
      )
      .limit(MAX_SEARCH_SOURCE_PROGRESS_ITEMS)
    return {
      sources: rows.map((row) => ({
        connectorId: row.connectorId,
        isSyncing:
          row.approved &&
          row.status !== 'paused' &&
          row.status !== 'disabled' &&
          !(row.accessMode === 'members' && row.memberSyncStatus === 'disabled') &&
          (row.status === 'pending' ||
            row.status === 'syncing' ||
            (row.accessMode === 'members' &&
              (row.memberSyncStatus === 'pending' || row.memberSyncStatus === 'running')) ||
            row.isIndexing),
        hasSyncError:
          row.status === 'error' ||
          row.hasRetainedSyncError === true ||
          (row.accessMode === 'members' && row.memberSyncStatus === 'error'),
        hasIndexingError: row.hasIndexingError,
      })),
    }
  },
})
