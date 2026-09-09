import { db } from '@sim/db'
import { document, embedding, knowledgeBase, knowledgeConnector, user } from '@sim/db/schema'
import { and, desc, eq, exists, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import {
  listSearchSourcesContract,
  searchSourceCursorSchema,
} from '@/lib/api/contracts/knowledge/connectors'
import { cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { type ResourceOwner, resourceScopeFromOwner } from '@/lib/core/resource-scope'
import { resourceScopeCondition } from '@/lib/core/resource-scope.server'
import { resolveKnowledgeAccessAvailability } from '@/lib/knowledge/access/availability'
import { knowledgeAccessCondition } from '@/lib/knowledge/access/predicate'
import { createKnowledgeAccessProvider } from '@/lib/knowledge/access/scope'
import { defineAuthorizedKnowledgeUseCase } from '@/lib/knowledge/application/authorized-knowledge-use-case'
import { resolveKnowledgeOwnerContext } from '@/lib/knowledge/application/contexts'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { resolveViewerConnectorMemberships } from '@/lib/knowledge/connectors/member-provisioning'
import {
  SEARCH_SOURCE_CANDIDATE_PAGE_SIZE,
  SEARCH_SOURCE_PAGE_SIZE,
} from '@/lib/knowledge/constants'
import { listOrganizationSearchApprovals } from '@/lib/knowledge/search/integration-policy'
import { describeSearchSource } from '@/lib/sim-search/source-identity'
import { getConnectorMeta } from '@/connectors/registry'

export interface ListSearchSourcesInput extends ResourceOwner {
  cursor?: string
  connectorType?: string
  search?: string
  mine?: boolean
}

/** Viewer-safe setup and indexing state; source credentials and other members never leave this use case. */
export const listSearchSources = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.listSearchSources,
  resolveContext: ({ input }: { input: ListSearchSourcesInput }) =>
    resolveKnowledgeOwnerContext(input),
  async execute({ principal, input, context }) {
    const search = input.search?.trim().toLowerCase() ?? ''
    const connectorType = input.connectorType?.trim()
    const cursorScope = cursorScopeKey(cursorRoute(listSearchSourcesContract), {
      workspaceId: context.workspaceId,
      organizationId: context.organizationId,
      userId: principal.userId,
      search,
      connectorType: connectorType ?? '',
      mine: input.mine === true,
      order: 'newest',
    })
    const cursor = (() => {
      if (!input.cursor) return null
      try {
        const parsed = searchSourceCursorSchema.parse(
          JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8'))
        )
        if (parsed.scope !== cursorScope) throw new Error('Cursor scope mismatch')
        return parsed
      } catch {
        throw new OrchestrationError(
          'validation',
          'Restart source pagination after changing your filters.'
        )
      }
    })()
    const candidates = await db
      .select({
        id: knowledgeConnector.id,
        createdAt: sql<string>`to_char(${knowledgeConnector.createdAt}, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        knowledgeBaseId: knowledgeConnector.knowledgeBaseId,
        connectorType: knowledgeConnector.connectorType,
        sourceConfig: knowledgeConnector.sourceConfig,
        accessMode: knowledgeConnector.accessMode,
        status: knowledgeConnector.status,
        memberSyncStatus: knowledgeConnector.memberSyncStatus,
        lastSyncAt: knowledgeConnector.lastSyncAt,
        hasRetainedSyncError: sql<boolean>`${knowledgeConnector.lastSyncError} IS NOT NULL`,
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
          isNull(knowledgeConnector.deletedAt),
          connectorType ? eq(knowledgeConnector.connectorType, connectorType) : undefined,
          cursor
            ? or(
                sql`${knowledgeConnector.createdAt} < ${cursor.createdAt}::timestamp`,
                and(
                  sql`${knowledgeConnector.createdAt} = ${cursor.createdAt}::timestamp`,
                  lt(knowledgeConnector.id, cursor.id)
                )
              )
            : undefined
        )
      )
      .orderBy(desc(knowledgeConnector.createdAt), desc(knowledgeConnector.id))
      .limit(SEARCH_SOURCE_CANDIDATE_PAGE_SIZE + 1)
    if (candidates.length === 0) return { sources: [], nextCursor: null }
    const scanned = candidates.slice(0, SEARCH_SOURCE_CANDIDATE_PAGE_SIZE)

    const [availability, memberships, viewers, access, approvals] = await Promise.all([
      resolveKnowledgeAccessAvailability(context),
      resolveViewerConnectorMemberships({
        userId: principal.userId,
        workspaceId: context.workspaceId,
        organizationId: context.organizationId,
        connectors: scanned,
      }),
      db
        .select({ emailVerified: user.emailVerified })
        .from(user)
        .where(eq(user.id, principal.userId))
        .limit(1),
      createKnowledgeAccessProvider(principal, context).get(),
      context.organizationId ? listOrganizationSearchApprovals(context.organizationId) : null,
    ])
    /** Filtering uses the same safe display labels and verified membership as the source rows. */
    const matches = scanned.filter((row) => {
      if (input.mine && memberships.get(row.id) !== 'connected') return false
      const meta = getConnectorMeta(row.connectorType)
      const label = meta
        ? `${meta.name ?? row.connectorType} ${describeSearchSource(meta, row.sourceConfig)}`
        : row.connectorType
      return label.toLowerCase().includes(search)
    })
    const rows = matches.slice(0, SEARCH_SOURCE_PAGE_SIZE)
    const last = matches.length > SEARCH_SOURCE_PAGE_SIZE ? rows.at(-1) : scanned.at(-1)
    const hasMore = matches.length > SEARCH_SOURCE_PAGE_SIZE || candidates.length > scanned.length
    const nextCursor =
      hasMore && last
        ? Buffer.from(
            JSON.stringify({
              createdAt: last.createdAt,
              id: last.id,
              scope: cursorScope,
            })
          ).toString('base64url')
        : null
    if (rows.length === 0) return { sources: [], nextCursor }
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
        failedCount: sql<number>`count(*) FILTER (WHERE ${document.processingStatus} = 'failed')::int`,
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
      nextCursor,
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
            approvals?.get(row.connectorType) !== false &&
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
            row.hasRetainedSyncError === true ||
            (row.accessMode === 'members' && row.memberSyncStatus === 'error'),
          viewerDocumentCount: available ? (state?.count ?? 0) : 0,
          viewerFailedDocumentCount: available ? (state?.failedCount ?? 0) : 0,
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
