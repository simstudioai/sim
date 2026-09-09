import { db } from '@sim/db'
import {
  document,
  knowledgeBase,
  knowledgeConnector,
  knowledgeConnectorMember,
  knowledgeConnectorMemberSyncLog,
  knowledgeConnectorSyncLog,
  organizationSearchIntegration,
} from '@sim/db/schema'
import { and, eq, exists, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { resolveKnowledgeAccessAvailability } from '@/lib/knowledge/access/availability'
import { SOURCE_ACL_MAX_AGE_MS } from '@/lib/knowledge/access/freshness'
import { defineAuthorizedKnowledgeUseCase } from '@/lib/knowledge/application/authorized-knowledge-use-case'
import { resolveKnowledgeOwnerContext } from '@/lib/knowledge/application/contexts'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { MAX_SEARCH_SOURCE_PROVIDER_TYPES } from '@/lib/knowledge/constants'
import { SEARCH_SOURCE_TYPES } from '@/lib/sim-search/connectors'

interface OrganizationSearchOverviewInput {
  organizationId: string
}

interface ProviderHealth {
  sourceCount: number
  pausedCount: number
  hasError: boolean
  hasIndexing: boolean
  hasWaiting: boolean
  hasUnstarted: boolean
}

/** A successful empty crawl is active; neither this state nor its count describes readable documents. */
function organizationSearchProviderStatus(
  health: ProviderHealth | undefined,
  approved: boolean,
  mirrorsSourceAcls: boolean,
  available: boolean
) {
  if (!approved || !available) return 'paused' as const
  if (!health?.sourceCount)
    return mirrorsSourceAcls ? ('needs_setup' as const) : ('waiting_for_connections' as const)
  if (health.pausedCount === health.sourceCount) return 'paused' as const
  if (health.hasError) return 'needs_attention' as const
  if (health.hasIndexing) return 'indexing' as const
  if (health.hasWaiting) return 'waiting_for_connections' as const
  if (health.hasUnstarted) return 'needs_setup' as const
  return 'active' as const
}

/** Organization admins receive aggregate operational facts, never documents, account identities or raw errors. */
export const readOrganizationSearchOverview = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.readOrganizationSearchOverview,
  resolveContext: ({ input }: { input: OrganizationSearchOverviewInput }) =>
    resolveKnowledgeOwnerContext({ organizationId: input.organizationId }),
  async execute({ context }) {
    if (!context.organizationId)
      throw new OrchestrationError('validation', 'Organization is required')
    const providerTypes = SEARCH_SOURCE_TYPES.map(([connectorType]) => connectorType)
    if (providerTypes.length > MAX_SEARCH_SOURCE_PROVIDER_TYPES) {
      throw new Error('Search provider catalog exceeds the overview bound')
    }
    const availability = await resolveKnowledgeAccessAvailability(context)
    const identityRequiredTypes = SEARCH_SOURCE_TYPES.filter(
      ([, meta]) => meta.requiresMemberIdentity
    ).map(([connectorType]) => connectorType)

    const hasActiveMembers = exists(
      db
        .select({ id: knowledgeConnectorMember.id })
        .from(knowledgeConnectorMember)
        .where(
          and(
            eq(knowledgeConnectorMember.connectorId, knowledgeConnector.id),
            eq(knowledgeConnectorMember.status, 'active')
          )
        )
    )
    const hasMemberContinuation = exists(
      db
        .select({ id: knowledgeConnectorMember.id })
        .from(knowledgeConnectorMember)
        .where(
          and(
            eq(knowledgeConnectorMember.connectorId, knowledgeConnector.id),
            eq(knowledgeConnectorMember.status, 'active'),
            isNotNull(knowledgeConnectorMember.listingCheckpoint)
          )
        )
    )
    const continuing = sql`(
      ${knowledgeConnector.listingCheckpoint} IS NOT NULL
      OR (${knowledgeConnector.accessMode} = 'members' AND (
        ${knowledgeConnector.directoryCheckpoint} IS NOT NULL
        OR ${hasMemberContinuation}
        OR coalesce(${knowledgeConnector.nextMemberSyncAt} <= statement_timestamp(), false)
      ))
    )`
    const cutoff = sql`statement_timestamp() - (${SOURCE_ACL_MAX_AGE_MS} * interval '1 millisecond')`
    const hasMemberError = exists(
      db
        .select({ id: knowledgeConnectorMember.id })
        .from(knowledgeConnectorMember)
        .where(
          and(
            eq(knowledgeConnectorMember.connectorId, knowledgeConnector.id),
            sql`(
            ${knowledgeConnectorMember.status} = 'suspended'
            OR (${knowledgeConnectorMember.status} = 'active' AND (
              ${knowledgeConnectorMember.lastError} IS NOT NULL
              OR ${knowledgeConnectorMember.consecutiveFailures} > 0
              OR coalesce(${knowledgeConnectorMember.memberSyncedThrough}, ${knowledgeConnectorMember.lastCompleteListingAt}, ${knowledgeConnectorMember.createdAt}) < ${cutoff}
            ))
          )`
          )
        )
    )
    const hasMemberFirstListing = exists(
      db
        .select({ id: knowledgeConnectorMember.id })
        .from(knowledgeConnectorMember)
        .where(
          and(
            eq(knowledgeConnectorMember.connectorId, knowledgeConnector.id),
            eq(knowledgeConnectorMember.status, 'active'),
            isNull(knowledgeConnectorMember.lastCompleteListingAt)
          )
        )
    )
    const hasDocumentsInState = (statuses: string[]) =>
      exists(
        db
          .select({ id: document.id })
          .from(document)
          .where(
            and(
              eq(document.connectorId, knowledgeConnector.id),
              eq(document.knowledgeBaseId, knowledgeConnector.knowledgeBaseId),
              eq(document.enabled, true),
              eq(document.userExcluded, false),
              isNull(document.archivedAt),
              isNull(document.deletedAt),
              inArray(document.processingStatus, statuses)
            )
          )
      )
    /** Partial runs can be normal continuations; completed timestamps alone do not prove a complete crawl. */
    const latestMemberRunHasError = sql`coalesce((
      SELECT ${knowledgeConnectorMemberSyncLog.status} = 'failed'
        OR (${knowledgeConnectorMemberSyncLog.status} = 'partial' AND (
          ${knowledgeConnectorMemberSyncLog.membersFailed} > 0 OR NOT ${continuing}
        ))
      FROM ${knowledgeConnectorMemberSyncLog}
      WHERE ${knowledgeConnectorMemberSyncLog.connectorId} = ${knowledgeConnector.id}
        AND ${knowledgeConnectorMemberSyncLog.status} <> 'started'
      ORDER BY ${knowledgeConnectorMemberSyncLog.startedAt} DESC, ${knowledgeConnectorMemberSyncLog.id} DESC
      LIMIT 1
    ), false)`
    const latestCentralRunHasError = sql`coalesce((
      SELECT ${knowledgeConnectorSyncLog.status} = 'failed'
        OR (${knowledgeConnectorSyncLog.status} = 'partial' AND (
          ${knowledgeConnectorSyncLog.docsFailed} > 0 OR NOT ${continuing}
        ))
      FROM ${knowledgeConnectorSyncLog}
      WHERE ${knowledgeConnectorSyncLog.connectorId} = ${knowledgeConnector.id}
        AND ${knowledgeConnectorSyncLog.status} <> 'started'
      ORDER BY ${knowledgeConnectorSyncLog.startedAt} DESC, ${knowledgeConnectorSyncLog.id} DESC
      LIMIT 1
    ), false)`
    const paused = sql`(
      ${knowledgeConnector.status} IN ('paused', 'disabled')
      OR (${knowledgeConnector.accessMode} = 'members' AND ${knowledgeConnector.memberSyncStatus} = 'disabled')
      OR (${knowledgeConnector.accessMode} = 'members' AND ${!availability.memberScoped})
      OR (${knowledgeConnector.accessMode} = 'admin' AND (
        ${!availability.sourceMirrored}
        OR (${!availability.memberScoped} AND ${inArray(knowledgeConnector.connectorType, identityRequiredTypes)})
      ))
    )`
    const [health, decisions] = await Promise.all([
      db
        .select({
          connectorType: knowledgeConnector.connectorType,
          sourceCount: sql<number>`count(*)::int`,
          pausedCount: sql<number>`count(*) FILTER (WHERE ${paused})::int`,
          hasError: sql<boolean>`bool_or(NOT ${paused} AND (
          ${knowledgeConnector.status} = 'error'
          OR ${knowledgeConnector.lastSyncError} IS NOT NULL
          OR ${hasDocumentsInState(['failed'])}
          OR (${knowledgeConnector.accessMode} = 'admin' AND ${latestCentralRunHasError})
          OR (${knowledgeConnector.accessMode} = 'members' AND (
            ${knowledgeConnector.memberSyncStatus} = 'error'
            OR ${knowledgeConnector.lastMemberSyncError} IS NOT NULL
            OR ${hasMemberError} OR ${latestMemberRunHasError}
          ))
        ))`,
          hasIndexing: sql<boolean>`bool_or(NOT ${paused}
            AND (${knowledgeConnector.accessMode} <> 'members' OR ${hasActiveMembers} OR ${knowledgeConnector.credentialId} IS NOT NULL)
            AND (
          ${knowledgeConnector.status} IN ('pending', 'syncing')
          OR ${continuing} OR ${hasDocumentsInState(['pending', 'processing'])}
          OR (${knowledgeConnector.accessMode} = 'members' AND (
            ${knowledgeConnector.memberSyncStatus} IN ('pending', 'running') OR ${hasMemberFirstListing}
          ))
        ))`,
          hasWaiting: sql<boolean>`bool_or(NOT ${paused} AND ${knowledgeConnector.accessMode} = 'members' AND NOT ${hasActiveMembers})`,
          hasUnstarted: sql<boolean>`bool_or(NOT ${paused} AND ${knowledgeConnector.accessMode} = 'admin' AND ${knowledgeConnector.lastSyncAt} IS NULL)`,
        })
        .from(knowledgeConnector)
        .innerJoin(knowledgeBase, eq(knowledgeBase.id, knowledgeConnector.knowledgeBaseId))
        .where(
          and(
            eq(knowledgeBase.organizationId, context.organizationId),
            eq(knowledgeBase.isSearchIndex, true),
            isNull(knowledgeBase.deletedAt),
            inArray(knowledgeConnector.connectorType, providerTypes),
            inArray(knowledgeConnector.accessMode, ['admin', 'members']),
            isNull(knowledgeConnector.archivedAt),
            isNull(knowledgeConnector.deletedAt)
          )
        )
        .groupBy(knowledgeConnector.connectorType)
        .limit(MAX_SEARCH_SOURCE_PROVIDER_TYPES),
      db
        .select({
          connectorType: organizationSearchIntegration.connectorType,
          approved: organizationSearchIntegration.approved,
        })
        .from(organizationSearchIntegration)
        .where(
          and(
            eq(organizationSearchIntegration.organizationId, context.organizationId),
            inArray(organizationSearchIntegration.connectorType, providerTypes)
          )
        )
        .limit(MAX_SEARCH_SOURCE_PROVIDER_TYPES),
    ])
    const healthByType = new Map(health.map((provider) => [provider.connectorType, provider]))
    const approvals = new Map(
      decisions.map((decision) => [decision.connectorType, decision.approved])
    )
    return {
      providers: SEARCH_SOURCE_TYPES.flatMap(([connectorType, meta]) => {
        const state = healthByType.get(connectorType)
        if (!state && !approvals.has(connectorType)) return []
        const approved = approvals.get(connectorType) ?? Boolean(state?.sourceCount)
        const status = organizationSearchProviderStatus(
          state,
          approved,
          meta.mirrorsSourceAcls === true,
          Boolean(
            (meta.permissionScopedListing && availability.memberScoped) ||
              (meta.mirrorsSourceAcls &&
                availability.sourceMirrored &&
                (!meta.requiresMemberIdentity || availability.memberScoped))
          )
        )
        return [
          {
            connectorType,
            approved,
            sourceCount: state?.sourceCount ?? 0,
            status,
            isSyncing: status !== 'paused' && Boolean(state?.hasIndexing),
          },
        ]
      }),
    }
  },
})
