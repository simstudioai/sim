import { db } from '@sim/db'
import { document, embedding, knowledgeBase, knowledgeConnector, user } from '@sim/db/schema'
import { and, asc, eq, exists, inArray, isNull, sql } from 'drizzle-orm'
import { type ResourceOwner, resourceScopeFromOwner } from '@/lib/core/resource-scope'
import { resourceScopeCondition } from '@/lib/core/resource-scope.server'
import { resolveKnowledgeAccessAvailability } from '@/lib/knowledge/access/availability'
import { knowledgeAccessCondition } from '@/lib/knowledge/access/predicate'
import { createKnowledgeAccessProvider } from '@/lib/knowledge/access/scope'
import { defineAuthorizedKnowledgeUseCase } from '@/lib/knowledge/application/authorized-knowledge-use-case'
import { resolveKnowledgeOwnerContext } from '@/lib/knowledge/application/contexts'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { resolveViewerConnectorMemberships } from '@/lib/knowledge/connectors/member-provisioning'
import { listOrganizationSearchApprovals } from '@/lib/knowledge/search/integration-policy'
import { describeSearchSource } from '@/lib/sim-search/source-identity'
import { getConnectorMeta } from '@/connectors/registry'

export interface ListSearchSourcesInput extends ResourceOwner {}

/** Viewer-safe setup and indexing state; source credentials and other members never leave this use case. */
export const listSearchSources = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.listSearchSources,
  resolveContext: ({ input }: { input: ListSearchSourcesInput }) =>
    resolveKnowledgeOwnerContext(input),
  async execute({ principal, context }) {
    const rows = await db
      .select({
        id: knowledgeConnector.id,
        knowledgeBaseId: knowledgeConnector.knowledgeBaseId,
        connectorType: knowledgeConnector.connectorType,
        sourceConfig: knowledgeConnector.sourceConfig,
        accessMode: knowledgeConnector.accessMode,
        status: knowledgeConnector.status,
        memberSyncStatus: knowledgeConnector.memberSyncStatus,
        lastSyncAt: knowledgeConnector.lastSyncAt,
        lastMemberSyncAt: knowledgeConnector.lastMemberSyncAt,
        credentialGroupId: knowledgeConnector.credentialGroupId,
        credentialGroupOptionId: knowledgeConnector.credentialGroupOptionId,
      })
      .from(knowledgeConnector)
      .innerJoin(knowledgeBase, eq(knowledgeBase.id, knowledgeConnector.knowledgeBaseId))
      .where(
        and(
          resourceScopeCondition(knowledgeBase, resourceScopeFromOwner(context)),
          eq(knowledgeBase.isSearchIndex, true),
          isNull(knowledgeBase.deletedAt),
          inArray(knowledgeConnector.accessMode, ['admin', 'members']),
          isNull(knowledgeConnector.archivedAt),
          isNull(knowledgeConnector.deletedAt)
        )
      )
      .orderBy(asc(knowledgeConnector.createdAt), asc(knowledgeConnector.id))
    if (rows.length === 0) return { sources: [] }

    const [availability, memberships, viewers, access, approvals] = await Promise.all([
      resolveKnowledgeAccessAvailability(context),
      resolveViewerConnectorMemberships({
        userId: principal.userId,
        workspaceId: context.workspaceId,
        organizationId: context.organizationId,
        connectors: rows,
      }),
      db
        .select({ emailVerified: user.emailVerified })
        .from(user)
        .where(eq(user.id, principal.userId))
        .limit(1),
      createKnowledgeAccessProvider(principal, context).get(),
      context.organizationId ? listOrganizationSearchApprovals(context.organizationId) : null,
    ])
    const documentStates = await db
      .select({
        connectorId: document.connectorId,
        count: sql<number>`count(*) FILTER (
          WHERE ${document.processingStatus} = 'completed'
          AND ${exists(
            db
              .select({ id: embedding.id })
              .from(embedding)
              .where(and(eq(embedding.documentId, document.id), eq(embedding.enabled, true)))
          )}
        )::int`,
        isIndexing: sql<boolean>`bool_or(${document.processingStatus} IN ('pending', 'processing'))`,
      })
      .from(document)
      .where(
        and(
          inArray(
            document.connectorId,
            rows.map((row) => row.id)
          ),
          eq(document.enabled, true),
          eq(document.userExcluded, false),
          isNull(document.archivedAt),
          isNull(document.deletedAt),
          knowledgeAccessCondition(access)
        )
      )
      .groupBy(document.connectorId)
    const states = new Map(documentStates.map((state) => [state.connectorId, state]))

    return {
      sources: rows.flatMap((row) => {
        const meta = getConnectorMeta(row.connectorType)
        if (row.accessMode !== 'admin' && row.accessMode !== 'members') return []
        const connectionRequired =
          row.accessMode === 'members' || meta?.requiresMemberIdentity === true
        const available =
          Boolean(meta) &&
          (row.accessMode === 'members'
            ? availability.memberScoped
            : availability.sourceMirrored && (!connectionRequired || availability.memberScoped))
        const enabled =
          row.status !== 'paused' &&
          row.status !== 'disabled' &&
          (row.accessMode !== 'members' || row.memberSyncStatus !== 'disabled')
        const state = states.get(row.id)
        const source = {
          knowledgeBaseId: row.knowledgeBaseId,
          connectorId: row.id,
          connectorType: row.connectorType,
          sourceDescription: meta ? describeSearchSource(meta, row.sourceConfig) : '',
          accessMode: row.accessMode,
          availability: available ? ('available' as const) : ('unavailable' as const),
          enabled,
          ...(approvals ? { approved: approvals.get(row.connectorType) ?? true } : {}),
          isSyncing:
            available &&
            enabled &&
            (row.status === 'pending' ||
              row.status === 'syncing' ||
              (row.accessMode === 'members' &&
                (row.memberSyncStatus === 'pending' || row.memberSyncStatus === 'running')) ||
              state?.isIndexing === true),
          lastSyncAt:
            (row.accessMode === 'members' ? row.lastMemberSyncAt : row.lastSyncAt)?.toISOString() ??
            null,
          hasSyncError:
            row.status === 'error' ||
            (row.accessMode === 'members' && row.memberSyncStatus === 'error'),
          viewerDocumentCount: available ? (state?.count ?? 0) : 0,
          viewerEmailVerified: viewers[0]?.emailVerified === true,
        } as const
        return [
          {
            ...source,
            ...(connectionRequired
              ? {
                  connectionRequired: true as const,
                  viewerMembership: available ? (memberships.get(row.id) ?? null) : null,
                }
              : { connectionRequired: false as const, viewerMembership: null }),
          },
        ]
      }),
    }
  },
})
