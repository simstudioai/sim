import { AuditAction, AuditResourceType } from '@sim/audit'
import type { Principal } from '@sim/auth/principal'
import { resolvePrincipalSubjectUserId } from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  credentialGroup,
  document,
  knowledgeBase,
  knowledgeConnector,
  knowledgeConnectorMember,
  knowledgeConnectorMemberSyncLog,
  knowledgeConnectorSyncLog,
} from '@sim/db/schema'
import { truncate } from '@sim/utils/string'
import { and, asc, count, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import type { ConnectorDocumentFilter } from '@/lib/api/contracts/knowledge/connectors'
import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import { requireCurrentHumanRole } from '@/lib/core/application'
import { requireOrganizationMembership } from '@/lib/core/application/organization-authorization'
import {
  OrchestrationError,
  type OrchestrationRequestContext,
} from '@/lib/core/orchestration/types'
import {
  type ResourceScope,
  resourceScopeFields,
  resourceScopeFromOwner,
  sameResourceScope,
} from '@/lib/core/resource-scope'
import { generateRequestId } from '@/lib/core/utils/request'
import {
  canUseCredential,
  getCredentialActorContext,
  resolveCredentialTokenIdentity,
} from '@/lib/credentials/access'
import { requireKnowledgeMemberAccessAvailable } from '@/lib/knowledge/access/availability'
import { knowledgeAccessCondition } from '@/lib/knowledge/access/predicate'
import { createKnowledgeAccessProvider } from '@/lib/knowledge/access/scope'
import type { KnowledgeAccessScope } from '@/lib/knowledge/access/types'
import { defineAuthorizedKnowledgeUseCase } from '@/lib/knowledge/application/authorized-knowledge-use-case'
import {
  resolveKnowledgeAttributedUserId,
  resolveKnowledgeBillingAttribution,
} from '@/lib/knowledge/application/billing'
import {
  type ActiveKnowledgeResourceBaseContext,
  resolveActiveKnowledgeConnectorContext,
  resolveActiveKnowledgeResourceContext,
  resolveKnowledgeWorkspaceContext,
} from '@/lib/knowledge/application/contexts'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import {
  type ConnectorAccessMode,
  mirrorsSourceAcls,
} from '@/lib/knowledge/connectors/access-modes'
import {
  type ConnectorAccessToken,
  resolveConnectorAccessToken,
  syncContextForToken,
} from '@/lib/knowledge/connectors/access-token'
import {
  provisionKnowledgeConnectorMembersBinding,
  resolveViewerConnectorMemberships,
  type ViewerConnectorMembership,
} from '@/lib/knowledge/connectors/member-provisioning'
import { assertConnectorMirrorsSourceAcls } from '@/lib/knowledge/connectors/mirrored-access'
import { MEMBER_OBSERVATION_STALE_AFTER_HOURS } from '@/lib/knowledge/connectors/sync-limits'
import {
  DEFAULT_KNOWLEDGE_CONNECTOR_DOCUMENT_PAGE_SIZE,
  MAX_KNOWLEDGE_CONNECTOR_DOCUMENT_MUTATION_ITEMS,
  MAX_KNOWLEDGE_CONNECTOR_DOCUMENT_PAGE_SIZE,
  MAX_KNOWLEDGE_CONNECTOR_DOCUMENT_SEARCH_LENGTH,
} from '@/lib/knowledge/constants'
import {
  type ResolvedMembersBinding,
  resolveKnowledgeConnectorMembersBinding,
} from '@/lib/knowledge/orchestration/connector-access'
import {
  getKnowledgeConnector,
  type KnowledgeConnectorRow,
  performCreateKnowledgeConnector,
  performDeleteKnowledgeConnector,
  performSyncKnowledgeConnector,
  performUpdateKnowledgeConnector,
  type SourceConfigRejection,
} from '@/lib/knowledge/orchestration/connectors'
import type {
  KnowledgeOperationSource,
  KnowledgeOrchestrationResult,
} from '@/lib/knowledge/orchestration/shared'
import { requireOrganizationSearchApproval } from '@/lib/knowledge/search/integration-policy'
import { escapeLikePattern } from '@/lib/knowledge/tags/utils'
import { isMemberSyncStatus } from '@/lib/knowledge/types'
import { credentialProviderMatchesService, type ServiceProviderIdentity } from '@/lib/oauth'
import { CAPABILITY_RULES, refuseCapability } from '@/lib/permission-groups/capabilities'
import { resolvePermissionGroupConfig } from '@/lib/permission-groups/config-scope.server'
import { getUserPermissionConfigForOrganization } from '@/lib/permission-groups/resolve.server'
import { canConnectPersonally, personalSetupFields } from '@/lib/sim-search/connectors'
import { SIM_SEARCH_SYNC_INTERVAL_MINUTES } from '@/lib/sim-search/constants'
import { describeSearchSource } from '@/lib/sim-search/source-identity'
import { getConnectorApiKeyConfig, isConnectorCredentialTypeAllowed } from '@/connectors/auth'
import { CONNECTOR_META_REGISTRY, getConnectorMeta } from '@/connectors/registry'
import type { ConnectorAuthConfig } from '@/connectors/types'
import { PER_MEMBER_LISTING_CONTEXT } from '@/connectors/utils'

interface KnowledgeConnectorApplicationInput {
  assertedWorkspaceId?: string
  assertedOrganizationId?: string
  source?: KnowledgeOperationSource
}

export interface ListKnowledgeConnectorsInput extends KnowledgeConnectorApplicationInput {
  knowledgeBaseId: string
  sortBy?: 'connectorType' | 'createdAt' | 'updatedAt'
  sortOrder?: 'asc' | 'desc'
  limit?: number
  offset?: number
}

export interface ReadKnowledgeConnectorInput extends KnowledgeConnectorApplicationInput {
  knowledgeBaseId: string
  connectorId: string
}

export interface CreateKnowledgeConnectorInput extends KnowledgeConnectorApplicationInput {
  knowledgeBaseId: string
  connectorType: string
  credentialId?: string
  apiKey?: string
  sourceConfig: Record<string, unknown>
  syncIntervalMinutes: number
  /**
   * How the connector derives document access; admin only for anything but
   * `workspace`. Defaults to `workspace`.
   */
  accessMode?: ConnectorAccessMode
  /** Trusted Search setup requests reuse an identical source within the locked insert transaction. */
  reuseSearchSource?: boolean
  resolveBillingAttribution?(workspaceId: string): Promise<BillingAttributionSnapshot>
}

export interface UpdateKnowledgeConnectorInput extends KnowledgeConnectorApplicationInput {
  connectorId: string
  updates: {
    sourceConfig?: Record<string, unknown>
    syncIntervalMinutes?: number
    status?: 'active' | 'paused'
  }
  resolveBillingAttribution?(workspaceId: string): Promise<BillingAttributionSnapshot>
}

export interface DeleteKnowledgeConnectorInput extends KnowledgeConnectorApplicationInput {
  connectorId: string
  deleteDocuments?: boolean
}

export interface SyncKnowledgeConnectorInput extends KnowledgeConnectorApplicationInput {
  connectorId: string
  rehydrate?: boolean
  resolveBillingAttribution?(workspaceId: string): Promise<BillingAttributionSnapshot>
}

export interface ListKnowledgeConnectorDocumentsInput extends ReadKnowledgeConnectorInput {
  filter?: ConnectorDocumentFilter
  search?: string
  failedOnly?: boolean
  includeExcluded?: boolean
  limit?: number
  offset?: number
}

export interface UpdateKnowledgeConnectorDocumentsInput extends ReadKnowledgeConnectorInput {
  operation: 'restore' | 'exclude'
  documentIds: string[]
}

const CONNECTOR_ALLOWLIST_RULE = CAPABILITY_RULES['knowledge.connectors']

/**
 * Refuses a connector the caller's permission group has not sanctioned.
 *
 * A connector pulls a whole external corpus into the workspace, so which source
 * a member may attach is a per-request decision — the authorization funnel
 * applies an operation's capability knowing only the principal, the workspace
 * and the operation, and never sees `connectorType`. Hence the assertion here,
 * ahead of the write, rather than a `capability` on `knowledge.connectors.create`.
 *
 * No-op when no permission group governs the caller, which is what keeps
 * non-enterprise and ungoverned organizations unaffected.
 *
 * A permission group is a membership of users, so an actorless caller — a
 * schedule, or a webhook with no external subject — resolves no group and
 * passes through, exactly as the authorization funnel treats one. Requiring a
 * subject here would turn every scheduled connector sync into a 500 rather than
 * a refusal anyone could act on.
 *
 * Refused through {@link refuseCapability} so the sentence reads exactly like
 * every other capability refusal. The error it throws is a
 * `ForbiddenOperationError` carrying this rule's own detail code, so the status
 * and error contract are the ones this already raised.
 */
async function assertConnectorTypeAllowed(
  userId: string | undefined,
  scope: ResourceScope,
  connectorType: string
): Promise<void> {
  if (!userId) return
  const config =
    scope.kind === 'organization'
      ? await getUserPermissionConfigForOrganization(scope.organizationId)
      : await resolvePermissionGroupConfig(userId, scope.workspaceId, undefined)
  if (!config || !CONNECTOR_ALLOWLIST_RULE.deniedBy(config, connectorType)) return

  refuseCapability('knowledge.connectors')
}

export function requireSuccessfulOutcome<T extends object>(
  outcome: KnowledgeOrchestrationResult<T>,
  fallback: string
): asserts outcome is { success: true } & T {
  if (outcome.success) return
  if (outcome.errorCode === 'internal') {
    throw new Error(fallback, { cause: new Error(outcome.error) })
  }
  throw new OrchestrationError(outcome.errorCode, outcome.error)
}

function connectorTarget(context: ActiveKnowledgeResourceBaseContext) {
  return {
    id: context.knowledgeBaseId,
    name: context.knowledgeBase.name,
    workspaceId: context.workspaceId ?? null,
    organizationId: context.organizationId ?? null,
  }
}

export function requireConnectorWorkspaceId(context: ActiveKnowledgeResourceBaseContext): string {
  if (!context.workspaceId) {
    throw new OrchestrationError('conflict', 'Knowledge base is missing workspace billing context')
  }
  return context.workspaceId
}

async function resolveAuthorizedConnectorCredentialIdentity(input: {
  credentialId: string
  workspaceId?: string
  organizationId?: string
  actingUserId: string
  service?: ServiceProviderIdentity
  auth: ConnectorAuthConfig
  accessMode: string
}) {
  const access = await getCredentialActorContext(input.credentialId, input.actingUserId)
  if (
    !access.credential ||
    !sameResourceScope(resourceScopeFromOwner(access.credential), resourceScopeFromOwner(input)) ||
    !canUseCredential(access)
  ) {
    throw new OrchestrationError(
      'validation',
      'Credential is not available to you in this workspace. Ask a credential administrator to grant access or select another credential.'
    )
  }
  if (
    input.service &&
    (!access.credential.providerId ||
      !credentialProviderMatchesService(access.credential.providerId, input.service))
  ) {
    throw new OrchestrationError(
      'validation',
      'Credential belongs to another service. Select a credential for the connector’s own provider.'
    )
  }
  const identity = await resolveCredentialTokenIdentity(
    input.credentialId,
    resourceScopeFromOwner(input)
  )
  if (identity && !isConnectorCredentialTypeAllowed(input.auth, input.accessMode, identity.kind)) {
    throw new OrchestrationError(
      'validation',
      'Administrator syncing requires a service account. Select one in source settings or use member accounts.'
    )
  }
  return identity
}

/**
 * The access token a connector syncs with, once the caller may use the
 * credential in this workspace. Pass `service` to also refuse a credential
 * of another provider.
 */
export async function resolveConnectorCredentialAccessToken(input: {
  credentialId: string
  workspaceId?: string
  organizationId?: string
  actingUserId: string
  requestId: string
  service?: ServiceProviderIdentity
  /** The connector the credential is being resolved for, so it mints exactly as a sync would. */
  auth: ConnectorAuthConfig
  accessMode: ConnectorAccessMode
  sourceConfig: Record<string, unknown>
}): Promise<ConnectorAccessToken | null> {
  const identity = await resolveAuthorizedConnectorCredentialIdentity(input)
  if (!identity) return null
  const resolved = await resolveConnectorAccessToken({
    auth: input.auth,
    connector: { credentialId: input.credentialId, encryptedApiKey: null },
    userId: identity.kind === 'oauth' ? identity.userId : input.actingUserId,
    requestId: input.requestId,
    sourceConfig: input.sourceConfig,
  })
  return resolved
}

export async function validateConnectorSourceConfig(input: {
  connector: KnowledgeConnectorRow
  sourceConfig: Record<string, unknown>
  workspaceId?: string
  organizationId?: string
  actingUserId: string
  requestId: string
}): Promise<SourceConfigRejection | null> {
  const { CONNECTOR_REGISTRY } = await import('@/connectors/registry.server')
  const connectorConfig = CONNECTOR_REGISTRY[input.connector.connectorType]
  if (!connectorConfig) {
    return {
      message: `Unknown connector type: ${input.connector.connectorType}`,
      errorCode: 'validation',
    }
  }
  /**
   * A mirroring connector must keep naming whose eyes it crawls through: a
   * config edit that blanked the administrator would mint a token with no
   * subject and silently stop mirroring on the next run.
   */
  if (mirrorsSourceAcls(input.connector.accessMode)) {
    try {
      await assertConnectorMirrorsSourceAcls(
        connectorConfig,
        input.sourceConfig,
        resourceScopeFromOwner(input)
      )
    } catch (error) {
      if (error instanceof OrchestrationError) {
        return { message: error.message, errorCode: error.code }
      }
      throw error
    }
  }

  /**
   * The user the token resolves under: whoever owns the OAuth account behind
   * the credential, since token reads are scoped to `account.userId`. An API
   * key and a service account both ignore it.
   */
  let tokenUserId = input.actingUserId
  const apiKeyConfig = getConnectorApiKeyConfig(connectorConfig.auth)
  if (
    connectorConfig.auth.mode === 'apiKey' ||
    (apiKeyConfig && !input.connector.credentialId && input.connector.encryptedApiKey)
  ) {
    if (!input.connector.encryptedApiKey && !apiKeyConfig?.optional) {
      return {
        message: 'API key not found. Please reconfigure the connector.',
        errorCode: 'validation',
      }
    }
  } else {
    if (!input.connector.credentialId) {
      return {
        message: 'OAuth credential not found. Please reconfigure the connector.',
        errorCode: 'validation',
      }
    }
    const identity = await resolveAuthorizedConnectorCredentialIdentity({
      credentialId: input.connector.credentialId,
      workspaceId: input.workspaceId,
      organizationId: input.organizationId,
      actingUserId: input.actingUserId,
      auth: connectorConfig.auth,
      accessMode: input.connector.accessMode,
    })
    if (!identity) {
      return {
        message: 'Credential is no longer usable in this workspace. Please reconnect it.',
        errorCode: 'validation',
      }
    }
    if (identity.kind === 'oauth') tokenUserId = identity.userId
  }

  const resolved = await resolveConnectorAccessToken({
    auth: connectorConfig.auth,
    connector: input.connector,
    userId: tokenUserId,
    requestId: input.requestId,
    sourceConfig: input.sourceConfig,
  })
  if (!resolved) {
    return {
      message: 'Failed to refresh access token. Please reconnect your account.',
      errorCode: 'unauthorized',
    }
  }

  const validation = await connectorConfig.validateConfig(
    resolved.accessToken,
    input.sourceConfig,
    {
      ...syncContextForToken(resolved),
      mirrorsSourceAcls: mirrorsSourceAcls(input.connector.accessMode),
      ...(input.connector.accessMode === 'members' ? PER_MEMBER_LISTING_CONTEXT : {}),
    }
  )
  return validation.valid
    ? null
    : { message: validation.error || 'Invalid source configuration', errorCode: 'validation' }
}

export const listKnowledgeConnectors = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.listConnectors,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: ListKnowledgeConnectorsInput
  }) => resolveActiveKnowledgeResourceContext(input, principal),
  async execute({ principal, input, context }) {
    const sortOrder = input.sortOrder === 'asc' ? asc : desc
    const sortColumn =
      input.sortBy === 'connectorType'
        ? knowledgeConnector.connectorType
        : input.sortBy === 'updatedAt'
          ? knowledgeConnector.updatedAt
          : knowledgeConnector.createdAt
    const orderedQuery = db
      .select()
      .from(knowledgeConnector)
      .where(
        and(
          eq(knowledgeConnector.knowledgeBaseId, context.knowledgeBaseId),
          isNull(knowledgeConnector.archivedAt),
          isNull(knowledgeConnector.deletedAt)
        )
      )
      .orderBy(sortOrder(sortColumn), sortOrder(knowledgeConnector.id))
    const offset = input.offset ?? 0
    const rows =
      input.limit === undefined
        ? await orderedQuery
        : await orderedQuery.limit(input.limit + 1).offset(offset)
    const hasMore = input.limit !== undefined && rows.length > input.limit
    const page = input.limit === undefined ? rows : rows.slice(0, input.limit)
    const viewerUserId = principal.kind === 'session' ? principal.userId : null
    const memberships =
      viewerUserId && (context.workspaceId || context.organizationId)
        ? await resolveViewerConnectorMemberships({
            userId: viewerUserId,
            workspaceId: context.workspaceId,
            organizationId: context.organizationId,
            connectors: page,
          })
        : new Map<string, ViewerConnectorMembership>()
    return {
      connectors: page.map(({ encryptedApiKey: _encryptedApiKey, ...rest }) => ({
        ...rest,
        viewerMembership: memberships.get(rest.id) ?? null,
      })),
      hasMore,
      offset,
      limit: input.limit ?? page.length,
    }
  },
})

export interface ListWorkspaceMemberConnectorsInput {
  workspaceId: string
}

/** Live documents per connector that the viewer's tokens match, for the Search tab's counts. */
async function countViewerDocuments(
  connectorIds: readonly string[],
  access: KnowledgeAccessScope
): Promise<Map<string, number>> {
  if (connectorIds.length === 0) return new Map()
  const rows = await db
    .select({ connectorId: document.connectorId, count: sql<number>`count(*)::int` })
    .from(document)
    .where(
      and(
        inArray(document.connectorId, [...connectorIds]),
        eq(document.userExcluded, false),
        isNull(document.archivedAt),
        isNull(document.deletedAt),
        knowledgeAccessCondition(access)
      )
    )
    .groupBy(document.connectorId)
  return new Map(rows.flatMap((row) => (row.connectorId ? [[row.connectorId, row.count]] : [])))
}

/** Live workspace sources that let the viewer connect a crawl account or a mirrored-ACL identity. */
export const listWorkspaceMemberConnectors = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.listWorkspaceMemberConnectors,
  resolveContext: ({ input }: { input: ListWorkspaceMemberConnectorsInput }) =>
    resolveKnowledgeWorkspaceContext(input),
  async execute({ principal, context }) {
    const viewerUserId = resolvePrincipalSubjectUserId(principal)
    if (!viewerUserId) return { connectors: [] }
    const rows = await db
      .select({
        knowledgeBaseId: knowledgeConnector.knowledgeBaseId,
        knowledgeBaseName: knowledgeBase.name,
        knowledgeBaseIsSearchIndex: knowledgeBase.isSearchIndex,
        id: knowledgeConnector.id,
        connectorType: knowledgeConnector.connectorType,
        accessMode: knowledgeConnector.accessMode,
        sourceConfig: knowledgeConnector.sourceConfig,
        credentialGroupName: credentialGroup.name,
        memberSyncStatus: knowledgeConnector.memberSyncStatus,
        credentialGroupId: knowledgeConnector.credentialGroupId,
        credentialGroupOptionId: knowledgeConnector.credentialGroupOptionId,
      })
      .from(knowledgeConnector)
      .innerJoin(knowledgeBase, eq(knowledgeBase.id, knowledgeConnector.knowledgeBaseId))
      .leftJoin(credentialGroup, eq(credentialGroup.id, knowledgeConnector.credentialGroupId))
      .where(
        and(
          eq(knowledgeBase.workspaceId, context.workspaceId),
          isNull(knowledgeBase.deletedAt),
          or(
            eq(knowledgeConnector.accessMode, 'members'),
            and(
              eq(knowledgeConnector.accessMode, 'admin'),
              inArray(
                knowledgeConnector.connectorType,
                Object.values(CONNECTOR_META_REGISTRY)
                  .filter((meta) => meta.mirrorsSourceAcls && meta.requiresMemberIdentity)
                  .map((meta) => meta.id)
              )
            )
          ),
          isNull(knowledgeConnector.archivedAt),
          isNull(knowledgeConnector.deletedAt)
        )
      )
      .orderBy(asc(knowledgeBase.name), asc(knowledgeConnector.createdAt))
    const [memberships, documentCounts] = await Promise.all([
      resolveViewerConnectorMemberships({
        userId: viewerUserId,
        workspaceId: context.workspaceId,
        connectors: rows,
      }),
      countViewerDocuments(
        rows.map((row) => row.id),
        await createKnowledgeAccessProvider(principal, { workspaceId: context.workspaceId }).get()
      ),
    ])
    return {
      connectors: rows.flatMap((row) => {
        const viewerMembership = memberships.get(row.id)
        if (!isMemberSyncStatus(row.memberSyncStatus)) {
          throw new OrchestrationError(
            'conflict',
            `Unexpected member sync status ${row.memberSyncStatus}`
          )
        }
        return viewerMembership
          ? [
              {
                knowledgeBaseId: row.knowledgeBaseId,
                knowledgeBaseName: row.knowledgeBaseName,
                knowledgeBaseIsSearchIndex: row.knowledgeBaseIsSearchIndex,
                connectorId: row.id,
                connectorType: row.connectorType,
                sourceDescription:
                  (getConnectorMeta(row.connectorType)
                    ? describeSearchSource(getConnectorMeta(row.connectorType)!, row.sourceConfig)
                    : '') || truncate(row.credentialGroupName ?? '', 237),
                memberSyncStatus: row.accessMode === 'members' ? row.memberSyncStatus : 'idle',
                viewerMembership,
                viewerDocumentCount: documentCounts.get(row.id) ?? 0,
              },
            ]
          : []
      }),
    }
  },
})

export const readKnowledgeConnector = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.readConnector,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: ReadKnowledgeConnectorInput
  }) => resolveActiveKnowledgeConnectorContext(input, principal),
  async execute({ principal, context }) {
    const connector = await getKnowledgeConnector(context.knowledgeBaseId, context.connectorId)
    if (!connector) throw new OrchestrationError('not_found', 'Connector not found')
    const [syncLogs, memberSyncLogs, members] = await Promise.all([
      db
        .select()
        .from(knowledgeConnectorSyncLog)
        .where(eq(knowledgeConnectorSyncLog.connectorId, context.connectorId))
        .orderBy(desc(knowledgeConnectorSyncLog.startedAt))
        .limit(10),
      db
        .select()
        .from(knowledgeConnectorMemberSyncLog)
        .where(eq(knowledgeConnectorMemberSyncLog.connectorId, context.connectorId))
        .orderBy(desc(knowledgeConnectorMemberSyncLog.startedAt))
        .limit(10),
      connector.accessMode === 'members'
        ? summarizeConnectorMembers(context.connectorId, connector.syncIntervalMinutes)
        : { active: 0, suspended: 0, stale: 0 },
    ])
    const { encryptedApiKey: _encryptedApiKey, ...connectorData } = connector
    const viewerUserId = principal.kind === 'session' ? principal.userId : null
    const memberships =
      viewerUserId && (context.workspaceId || context.organizationId)
        ? await resolveViewerConnectorMemberships({
            userId: viewerUserId,
            workspaceId: context.workspaceId,
            organizationId: context.organizationId,
            connectors: [connector],
          })
        : new Map<string, ViewerConnectorMembership>()
    return {
      connector: {
        ...connectorData,
        viewerMembership: memberships.get(connector.id) ?? null,
        syncLogs,
        memberSyncLogs,
        members,
      },
    }
  },
})

/**
 * How many members a connector has in each state, for the settings surface.
 * Stale mirrors the scheduler's sweep window: an active member whose last
 * complete listing is older than `max(24 h, 2 × interval)`.
 */
async function summarizeConnectorMembers(
  connectorId: string,
  syncIntervalMinutes: number
): Promise<{ active: number; suspended: number; stale: number }> {
  const staleWindowMs = Math.max(
    MEMBER_OBSERVATION_STALE_AFTER_HOURS * 60 * 60 * 1000,
    2 * syncIntervalMinutes * 60 * 1000
  )
  const staleCutoff = new Date(Date.now() - staleWindowMs)
  const [row] = await db
    .select({
      active: sql<number>`count(*) FILTER (WHERE ${knowledgeConnectorMember.status} = 'active')::int`,
      suspended: sql<number>`count(*) FILTER (WHERE ${knowledgeConnectorMember.status} <> 'active')::int`,
      stale: sql<number>`count(*) FILTER (WHERE ${knowledgeConnectorMember.status} = 'active' AND ${or(
        isNull(knowledgeConnectorMember.lastCompleteListingAt),
        lt(knowledgeConnectorMember.lastCompleteListingAt, staleCutoff)
      )})::int`,
    })
    .from(knowledgeConnectorMember)
    .where(eq(knowledgeConnectorMember.connectorId, connectorId))
  return { active: row?.active ?? 0, suspended: row?.suspended ?? 0, stale: row?.stale ?? 0 }
}

async function executeCreateKnowledgeConnector(
  {
    principal,
    input,
    context,
    request,
  }: {
    principal: Principal
    input: CreateKnowledgeConnectorInput
    context: ActiveKnowledgeResourceBaseContext
    request?: OrchestrationRequestContext
  },
  approvedMemberSetup = false
) {
  const requestId = generateRequestId()
  const scope = resourceScopeFromOwner(context)
  const owner = resourceScopeFields(scope)
  const workspaceId = context.workspaceId
  const actingUserId = resolveKnowledgeAttributedUserId(principal, context)
  // permission-group-enforced: knowledge.connectors — needs the request's connector id, which the funnel never sees
  await assertConnectorTypeAllowed(
    resolvePrincipalSubjectUserId(principal),
    scope,
    input.connectorType
  )
  const connectorMeta = getConnectorMeta(input.connectorType)
  if (!connectorMeta) {
    throw new OrchestrationError('validation', `Unknown connector type: ${input.connectorType}`)
  }
  if (
    input.apiKey &&
    (!getConnectorApiKeyConfig(connectorMeta.auth) || input.accessMode === 'members')
  ) {
    throw new OrchestrationError('validation', 'This connection method requires an OAuth account')
  }
  if (input.apiKey && input.credentialId) {
    throw new OrchestrationError('validation', 'Choose either an OAuth account or an API key')
  }
  if (
    context.knowledgeBase.isSearchIndex &&
    (!connectorMeta.search || !input.accessMode || input.accessMode === 'workspace')
  ) {
    throw new OrchestrationError(
      'validation',
      'Search sources must support per-person access or source permissions'
    )
  }
  let membersBinding: ResolvedMembersBinding | undefined
  if (input.accessMode && input.accessMode !== 'workspace') {
    /**
     * Every mode but `workspace` decides whose data the workspace indexes —
     * members mode grants the connector every enrolled member's credential,
     * admin mode indexes a whole source through an administrator's eyes — so
     * both take the admin role, even though creating a connector does not.
     */
    const subjectUserId = resolvePrincipalSubjectUserId(principal)
    if (context.workspaceId === undefined && !context.organizationId) {
      throw new OrchestrationError(
        'validation',
        'Permission-scoped access needs a workspace knowledge base'
      )
    }
    if (!subjectUserId) {
      throw new OrchestrationError('forbidden', 'Permission-scoped access needs a signed-in admin')
    }
    if (approvedMemberSetup && context.organizationId) {
      await requireOrganizationSearchApproval(context.organizationId, input.connectorType)
    } else if (context.organizationId)
      await requireOrganizationMembership(
        principal,
        context.organizationId,
        'admin',
        'knowledge.use'
      )
    else if (context.workspaceId) await requireCurrentHumanRole(subjectUserId, context, 'admin')

    if (input.accessMode === 'admin') {
      await assertConnectorMirrorsSourceAcls(connectorMeta, input.sourceConfig, scope)
      if (connectorMeta.requiresMemberIdentity) {
        await requireKnowledgeMemberAccessAvailable(owner)
        await provisionKnowledgeConnectorMembersBinding({
          ...owner,
          connectorMeta,
          userId: subjectUserId,
        })
      }
    } else {
      membersBinding = await resolveKnowledgeConnectorMembersBinding({
        ...owner,
        connectorMeta,
        actingUserId: subjectUserId,
        sourceConfig: input.sourceConfig,
      })
    }
  }
  const outcome = await performCreateKnowledgeConnector({
    knowledgeBase: connectorTarget(context),
    connectorType: input.connectorType,
    credentialId: input.credentialId,
    apiKey: input.apiKey,
    /** Members mode stores the config with its listing caps cleared. */
    sourceConfig: membersBinding?.sourceConfig ?? input.sourceConfig,
    syncIntervalMinutes: input.syncIntervalMinutes,
    membersBinding,
    accessMode: input.accessMode,
    reuseSearchSource: input.reuseSearchSource,
    resolveBillingAttribution: () =>
      (workspaceId ? input.resolveBillingAttribution?.(workspaceId) : undefined) ??
      resolveKnowledgeBillingAttribution(principal, context),
    resolveAccessToken: (credentialId) =>
      resolveConnectorCredentialAccessToken({
        credentialId,
        ...owner,
        actingUserId,
        requestId,
        auth: connectorMeta.auth,
        accessMode: input.accessMode ?? 'workspace',
        sourceConfig: input.sourceConfig,
      }),
    userId: actingUserId,
    source: input.source ?? 'agent',
    requestId,
    request,
    recordSemanticAudit: false,
    recordProductAnalytics: false,
  })
  requireSuccessfulOutcome(outcome, 'Knowledge connector creation failed')
  return {
    connector: outcome.connector,
    workspaceId,
    ...(outcome.reused ? { reused: true } : {}),
  }
}

export const createKnowledgeConnector = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.createConnector,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: CreateKnowledgeConnectorInput
  }) => resolveActiveKnowledgeResourceContext(input, principal),
  execute: (args) => executeCreateKnowledgeConnector(args),
  projectAudit: ({ input, context, result }) =>
    result.reused
      ? []
      : {
          action: AuditAction.CONNECTOR_CREATED,
          resourceType: AuditResourceType.CONNECTOR,
          resourceId: result.connector.id,
          resourceName: result.connector.connectorType,
          description: `Created ${result.connector.connectorType} connector for knowledge base "${context.knowledgeBase.name}"`,
          metadata: {
            source: input.source,
            knowledgeBaseId: context.knowledgeBaseId,
            knowledgeBaseName: context.knowledgeBase.name,
            connectorType: result.connector.connectorType,
            syncIntervalMinutes: result.connector.syncIntervalMinutes,
            authMode: result.connector.credentialId ? 'oauth' : 'apiKey',
            accessMode: result.connector.accessMode,
          },
        },
})

/** Members may create only a personal-account source in an approved organization index. */
export const createApprovedSearchSource = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.createApprovedSearchSource,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: {
      knowledgeBaseId: string
      assertedOrganizationId: string
      connectorType: string
      sourceConfig: Record<string, string>
    }
  }) => resolveActiveKnowledgeResourceContext(input, principal),
  async execute({ principal, input, context, request }) {
    const meta = getConnectorMeta(input.connectorType)
    if (
      !context.organizationId ||
      !context.knowledgeBase.isSearchIndex ||
      !meta ||
      !canConnectPersonally(meta)
    ) {
      throw new OrchestrationError(
        'forbidden',
        'Only approved personal Search sources may be connected'
      )
    }
    const allowedFields = new Set(personalSetupFields(meta).map((field) => field.id))
    if (Object.keys(input.sourceConfig).some((field) => !allowedFields.has(field))) {
      throw new OrchestrationError(
        'validation',
        'Only the personal connection settings may be supplied'
      )
    }
    return executeCreateKnowledgeConnector(
      {
        principal,
        context,
        request,
        input: {
          knowledgeBaseId: input.knowledgeBaseId,
          assertedOrganizationId: input.assertedOrganizationId,
          connectorType: input.connectorType,
          sourceConfig: input.sourceConfig,
          accessMode: 'members',
          syncIntervalMinutes: SIM_SEARCH_SYNC_INTERVAL_MINUTES,
          reuseSearchSource: true,
          source: 'ui',
        },
      },
      true
    )
  },
  projectAudit: ({ result, context }) =>
    result.reused
      ? []
      : {
          action: AuditAction.CONNECTOR_CREATED,
          resourceType: AuditResourceType.CONNECTOR,
          resourceId: result.connector.id,
          resourceName: result.connector.connectorType,
          metadata: {
            knowledgeBaseId: context.knowledgeBaseId,
            accessMode: 'members',
            approvedMemberSetup: true,
          },
        },
})

/**
 * Deliberately not gated by `knowledge.connectors`: an update may change the
 * source config, sync interval or status, never the connector type. The
 * sanctioned-source decision was made when the connector was created, and
 * re-asserting it here would strand an existing connector — including the
 * ability to pause it — the moment an admin narrowed the allowlist.
 */
export const updateKnowledgeConnector = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.updateConnector,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: UpdateKnowledgeConnectorInput
  }) => resolveActiveKnowledgeConnectorContext(input, principal),
  async execute({ principal, input, context, request }) {
    const requestId = generateRequestId()
    const actingUserId = resolveKnowledgeAttributedUserId(principal, context)
    const outcome = await performUpdateKnowledgeConnector({
      knowledgeBase: connectorTarget(context),
      connectorId: context.connectorId,
      updates: input.updates,
      resolveBillingAttribution: () => {
        const workspaceId = context.workspaceId
        return (
          (workspaceId ? input.resolveBillingAttribution?.(workspaceId) : undefined) ??
          resolveKnowledgeBillingAttribution(principal, context)
        )
      },
      validateSourceConfig: (connector, sourceConfig) => {
        const owner = resourceScopeFields(resourceScopeFromOwner(context))
        return validateConnectorSourceConfig({
          connector,
          sourceConfig,
          ...owner,
          actingUserId,
          requestId,
        })
      },
      userId: actingUserId,
      source: input.source ?? 'agent',
      requestId,
      request,
      recordSemanticAudit: false,
    })
    requireSuccessfulOutcome(outcome, 'Knowledge connector update failed')
    return { connector: outcome.connector }
  },
  projectAudit: ({ input, context, result }) => ({
    action: AuditAction.CONNECTOR_UPDATED,
    resourceType: AuditResourceType.CONNECTOR,
    resourceId: result.connector.id,
    resourceName: result.connector.connectorType,
    description: `Updated connector for knowledge base "${context.knowledgeBase.name}"`,
    metadata: {
      source: input.source,
      knowledgeBaseId: context.knowledgeBaseId,
      knowledgeBaseName: context.knowledgeBase.name,
      connectorType: result.connector.connectorType,
      updatedFields: Object.keys(input.updates).filter(
        (key) => input.updates[key as keyof UpdateKnowledgeConnectorInput['updates']] !== undefined
      ),
      ...(input.updates.syncIntervalMinutes !== undefined && {
        syncIntervalMinutes: input.updates.syncIntervalMinutes,
      }),
      ...(input.updates.status !== undefined && { newStatus: input.updates.status }),
    },
  }),
})

export const deleteKnowledgeConnector = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.deleteConnector,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: DeleteKnowledgeConnectorInput
  }) => resolveActiveKnowledgeConnectorContext(input, principal),
  async execute({ principal, input, context, request }) {
    const outcome = await performDeleteKnowledgeConnector({
      knowledgeBase: connectorTarget(context),
      connectorId: context.connectorId,
      deleteDocuments: input.deleteDocuments,
      userId: resolveKnowledgeAttributedUserId(principal, context),
      source: input.source ?? 'agent',
      requestId: generateRequestId(),
      request,
      recordSemanticAudit: false,
      recordProductAnalytics: false,
    })
    requireSuccessfulOutcome(outcome, 'Knowledge connector deletion failed')
    return {
      knowledgeBaseId: context.knowledgeBaseId,
      workspaceId: context.workspaceId,
      connectorId: context.connectorId,
      connectorType: context.connector.connectorType,
      documentsDeleted: outcome.documentsDeleted,
      documentsKept: outcome.documentsKept,
    }
  },
  projectAudit: ({ input, context, result }) => ({
    action: AuditAction.CONNECTOR_DELETED,
    resourceType: AuditResourceType.CONNECTOR,
    resourceId: result.connectorId,
    resourceName: context.connector.connectorType,
    description: `Deleted connector from knowledge base "${context.knowledgeBase.name}"`,
    metadata: {
      source: input.source,
      knowledgeBaseId: context.knowledgeBaseId,
      knowledgeBaseName: context.knowledgeBase.name,
      connectorType: context.connector.connectorType,
      deleteDocuments: input.deleteDocuments ?? false,
      documentsDeleted: result.documentsDeleted,
      documentsKept: result.documentsKept,
    },
  }),
})

/**
 * Gated by `knowledge.connectors` on the *persisted* type, unlike
 * {@link updateKnowledgeConnector}: a manual sync is a fresh act by a person
 * pulling the external corpus in again, so an admin who has since removed the
 * source from the allowlist has withdrawn it. Pausing and deleting stay
 * available for the reason recorded on the update use case — nothing here
 * strands a connector, it only stops a member re-running the pull by hand.
 *
 * Only the manual path passes through this use case. The scheduled continuation
 * of an existing connector runs `executeSync` from the sync engine directly
 * (`background/knowledge-connector-sync.ts`) and is untouched, matching the
 * webhook precedent: passive continuation keeps running, a person re-initiating
 * it is gated. An actorless caller resolves no group and passes through, as
 * {@link assertConnectorTypeAllowed} documents.
 */
export const syncKnowledgeConnector = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.syncConnector,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: SyncKnowledgeConnectorInput
  }) => resolveActiveKnowledgeConnectorContext(input, principal),
  async execute({ principal, input, context, request }) {
    const workspaceId = context.workspaceId
    const scope = resourceScopeFromOwner(context)
    // permission-group-enforced: knowledge.connectors — needs the persisted connector type, which the funnel never sees
    await assertConnectorTypeAllowed(
      resolvePrincipalSubjectUserId(principal),
      scope,
      context.connector.connectorType
    )
    const outcome = await performSyncKnowledgeConnector({
      knowledgeBase: connectorTarget(context),
      connectorId: context.connectorId,
      resolveBillingAttribution: () =>
        (workspaceId ? input.resolveBillingAttribution?.(workspaceId) : undefined) ??
        resolveKnowledgeBillingAttribution(principal, context),
      rehydrate: input.rehydrate,
      userId: resolveKnowledgeAttributedUserId(principal, context),
      source: input.source ?? 'agent',
      requestId: generateRequestId(),
      request,
      recordSemanticAudit: false,
      recordProductAnalytics: false,
    })
    requireSuccessfulOutcome(outcome, 'Knowledge connector sync failed')
    return {
      knowledgeBaseId: context.knowledgeBaseId,
      workspaceId,
      ...(context.organizationId ? { organizationId: context.organizationId } : {}),
      connectorId: context.connectorId,
      connectorType: context.connector.connectorType,
    }
  },
  projectAudit: ({ input, context, result }) => ({
    action: AuditAction.CONNECTOR_SYNCED,
    resourceType: AuditResourceType.CONNECTOR,
    resourceId: result.connectorId,
    resourceName: context.connector.connectorType,
    description: `Triggered manual sync for connector on knowledge base "${context.knowledgeBase.name}"`,
    metadata: {
      source: input.source,
      knowledgeBaseId: context.knowledgeBaseId,
      knowledgeBaseName: context.knowledgeBase.name,
      connectorType: context.connector.connectorType,
      connectorStatus: context.connector.status,
      syncType: input.rehydrate ? 'manual-rehydrate' : 'manual',
    },
  }),
})

const connectorDocumentSelection = {
  id: document.id,
  filename: document.filename,
  externalId: document.externalId,
  sourceUrl: document.sourceUrl,
  enabled: document.enabled,
  userExcluded: document.userExcluded,
  uploadedAt: document.uploadedAt,
  processingStatus: document.processingStatus,
}

export const listKnowledgeConnectorDocuments = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.listConnectorDocuments,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: ListKnowledgeConnectorDocumentsInput
  }) => resolveActiveKnowledgeConnectorContext(input, principal),
  async execute({ input, context }) {
    const limit = input.limit ?? DEFAULT_KNOWLEDGE_CONNECTOR_DOCUMENT_PAGE_SIZE
    const offset = input.offset ?? 0
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > MAX_KNOWLEDGE_CONNECTOR_DOCUMENT_PAGE_SIZE
    ) {
      throw new OrchestrationError(
        'validation',
        `Connector document limit must be between 1 and ${MAX_KNOWLEDGE_CONNECTOR_DOCUMENT_PAGE_SIZE}`
      )
    }
    if (!Number.isInteger(offset) || offset < 0) {
      throw new OrchestrationError(
        'validation',
        'Connector document offset must be a non-negative integer'
      )
    }
    const search = input.search?.trim()
    if (search && search.length > MAX_KNOWLEDGE_CONNECTOR_DOCUMENT_SEARCH_LENGTH) {
      throw new OrchestrationError(
        'validation',
        `Connector document search must be at most ${MAX_KNOWLEDGE_CONNECTOR_DOCUMENT_SEARCH_LENGTH} characters`
      )
    }
    const filter =
      input.filter ?? (input.failedOnly ? 'failed' : input.includeExcluded ? undefined : 'active')
    const baseConditions = [
      eq(document.connectorId, context.connectorId),
      isNull(document.archivedAt),
      isNull(document.deletedAt),
      knowledgeAccessCondition(await context.access.get()),
      search
        ? sql`${document.filename} ILIKE ${`%${escapeLikePattern(search)}%`} ESCAPE '\\'`
        : undefined,
    ] as const
    const [[activeCount], excludedCountRows, [failedCount]] = await Promise.all([
      db
        .select({ value: count() })
        .from(document)
        .where(and(...baseConditions, eq(document.userExcluded, false))),
      input.filter || input.includeExcluded
        ? db
            .select({ value: count() })
            .from(document)
            .where(and(...baseConditions, eq(document.userExcluded, true)))
        : Promise.resolve([{ value: 0 }]),
      db
        .select({ value: count() })
        .from(document)
        .where(
          and(
            ...baseConditions,
            eq(document.userExcluded, false),
            eq(document.processingStatus, 'failed')
          )
        ),
    ])
    const excludedCount = excludedCountRows[0]
    const rows = await db
      .select(connectorDocumentSelection)
      .from(document)
      .where(
        and(
          ...baseConditions,
          filter ? eq(document.userExcluded, filter === 'excluded') : undefined,
          filter === 'failed' ? eq(document.processingStatus, 'failed') : undefined
        )
      )
      .orderBy(asc(document.userExcluded), asc(document.filename), asc(document.id))
      .limit(limit + 1)
      .offset(offset)
    const hasMore = rows.length > limit
    const documents = rows.slice(0, limit)
    return {
      documents,
      counts: {
        active: activeCount?.value ?? 0,
        excluded: excludedCount?.value ?? 0,
        failed: failedCount?.value ?? 0,
      },
      hasMore,
      offset,
      limit,
    }
  },
})

export const updateKnowledgeConnectorDocuments = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.updateConnectorDocuments,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: UpdateKnowledgeConnectorDocumentsInput
  }) => resolveActiveKnowledgeConnectorContext(input, principal),
  async execute({ input, context }) {
    if (input.documentIds.length === 0) {
      throw new OrchestrationError('validation', 'At least one connector document is required')
    }
    if (input.documentIds.length > MAX_KNOWLEDGE_CONNECTOR_DOCUMENT_MUTATION_ITEMS) {
      throw new OrchestrationError(
        'validation',
        `At most ${MAX_KNOWLEDGE_CONNECTOR_DOCUMENT_MUTATION_ITEMS} connector documents may be updated at once`
      )
    }
    const documentIds = [...new Set(input.documentIds)]
    const restoring = input.operation === 'restore'
    const updated = await db
      .update(document)
      .set({ userExcluded: !restoring, enabled: restoring })
      .where(
        and(
          eq(document.connectorId, context.connectorId),
          inArray(document.id, documentIds),
          eq(document.userExcluded, restoring),
          isNull(document.archivedAt),
          isNull(document.deletedAt),
          knowledgeAccessCondition(await context.access.get())
        )
      )
      .returning({ id: document.id })
    return {
      operation: input.operation,
      count: updated.length,
      documentIds: updated.map(({ id }) => id),
    }
  },
  projectAudit: ({ input, context, result }) => ({
    action:
      input.operation === 'restore'
        ? AuditAction.CONNECTOR_DOCUMENT_RESTORED
        : AuditAction.CONNECTOR_DOCUMENT_EXCLUDED,
    resourceType: AuditResourceType.CONNECTOR,
    resourceId: context.connectorId,
    description:
      input.operation === 'restore'
        ? `Restored ${result.count} excluded document(s) for knowledge base "${context.knowledgeBase.name}"`
        : `Excluded ${result.count} document(s) from knowledge base "${context.knowledgeBase.name}"`,
    metadata: {
      knowledgeBaseId: context.knowledgeBaseId,
      knowledgeBaseName: context.knowledgeBase.name,
      operation: input.operation,
      documentCount: result.count,
      documentIds: result.documentIds,
    },
  }),
})
