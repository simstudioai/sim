import { AuditAction, AuditResourceType } from '@sim/audit'
import type { Principal } from '@sim/auth/principal'
import { resolvePrincipalSubjectUserId } from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  document,
  knowledgeBase,
  knowledgeConnector,
  knowledgeConnectorMember,
  knowledgeConnectorMemberSyncLog,
  knowledgeConnectorSyncLog,
} from '@sim/db/schema'
import { and, asc, count, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import { decryptApiKey } from '@/lib/api-key/crypto'
import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import { requireCurrentHumanRole } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import {
  canUseCredential,
  getCredentialActorContext,
  resolveCredentialTokenIdentity,
} from '@/lib/credentials/access'
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
  resolveViewerConnectorMemberships,
  type ViewerConnectorMembership,
} from '@/lib/knowledge/connectors/member-provisioning'
import { MEMBER_OBSERVATION_STALE_AFTER_HOURS } from '@/lib/knowledge/connectors/sync-limits'
import {
  DEFAULT_KNOWLEDGE_CONNECTOR_DOCUMENT_PAGE_SIZE,
  MAX_KNOWLEDGE_CONNECTOR_DOCUMENT_MUTATION_ITEMS,
  MAX_KNOWLEDGE_CONNECTOR_DOCUMENT_PAGE_SIZE,
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
import { isMemberSyncStatus } from '@/lib/knowledge/types'
import { refreshAccessTokenIfNeeded } from '@/lib/oauth/credential-service'
import { CAPABILITY_RULES, refuseCapability } from '@/lib/permission-groups/capabilities'
import { resolvePermissionGroupConfig } from '@/lib/permission-groups/config-scope.server'
import { getConnectorMeta } from '@/connectors/registry'

interface KnowledgeConnectorApplicationInput {
  assertedWorkspaceId?: string
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
  /** `members` crawls per Credential Group member; admin only. Defaults to `workspace`. */
  accessMode?: 'workspace' | 'members'
  credentialGroupId?: string
  credentialGroupOptionId?: string
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
  workspaceId: string,
  connectorType: string
): Promise<void> {
  if (!userId) return
  const config = await resolvePermissionGroupConfig(userId, workspaceId, undefined)
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
  workspaceId: string
  actingUserId: string
}) {
  const access = await getCredentialActorContext(input.credentialId, input.actingUserId)
  if (
    !access.credential ||
    access.credential.workspaceId !== input.workspaceId ||
    !canUseCredential(access)
  ) {
    throw new OrchestrationError(
      'validation',
      'Credential is not available to you in this workspace. Ask a credential administrator to grant access or select another credential.'
    )
  }
  return resolveCredentialTokenIdentity(input.credentialId, input.workspaceId)
}

export async function resolveConnectorCredentialAccessToken(input: {
  credentialId: string
  workspaceId: string
  actingUserId: string
  requestId: string
}): Promise<string | null> {
  const identity = await resolveAuthorizedConnectorCredentialIdentity(input)
  if (!identity) return null
  return refreshAccessTokenIfNeeded(
    input.credentialId,
    identity.kind === 'oauth' ? identity.userId : input.actingUserId,
    input.requestId
  )
}

async function validateConnectorSourceConfig(input: {
  connector: KnowledgeConnectorRow
  sourceConfig: Record<string, unknown>
  workspaceId: string
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

  let accessToken: string | null = null
  if (connectorConfig.auth.mode === 'apiKey') {
    if (!input.connector.encryptedApiKey) {
      if (!connectorConfig.auth.optional) {
        return {
          message: 'API key not found. Please reconfigure the connector.',
          errorCode: 'validation',
        }
      }
      accessToken = ''
    } else {
      accessToken = (await decryptApiKey(input.connector.encryptedApiKey)).decrypted
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
      actingUserId: input.actingUserId,
    })
    if (!identity) {
      return {
        message: 'Credential is no longer usable in this workspace. Please reconnect it.',
        errorCode: 'validation',
      }
    }
    accessToken = await refreshAccessTokenIfNeeded(
      input.connector.credentialId,
      identity.kind === 'oauth' ? identity.userId : input.actingUserId,
      input.requestId
    )
    if (!accessToken) {
      return {
        message: 'Failed to refresh access token. Please reconnect your account.',
        errorCode: 'unauthorized',
      }
    }
  }

  const validation = await connectorConfig.validateConfig(accessToken, input.sourceConfig)
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
      viewerUserId && context.workspaceId
        ? await resolveViewerConnectorMemberships({
            userId: viewerUserId,
            workspaceId: context.workspaceId,
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

/**
 * Every per-member connector in the workspace and where the viewer stands
 * with each, so a surface outside the knowledge base — Sim Search — can ask
 * them to connect. Only connectors the viewer could actually read documents
 * from are listed: the knowledge base must be live and in the workspace.
 */
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
        id: knowledgeConnector.id,
        connectorType: knowledgeConnector.connectorType,
        accessMode: knowledgeConnector.accessMode,
        memberSyncStatus: knowledgeConnector.memberSyncStatus,
        credentialGroupId: knowledgeConnector.credentialGroupId,
        credentialGroupOptionId: knowledgeConnector.credentialGroupOptionId,
      })
      .from(knowledgeConnector)
      .innerJoin(knowledgeBase, eq(knowledgeBase.id, knowledgeConnector.knowledgeBaseId))
      .where(
        and(
          eq(knowledgeBase.workspaceId, context.workspaceId),
          isNull(knowledgeBase.deletedAt),
          eq(knowledgeConnector.accessMode, 'members'),
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
                connectorId: row.id,
                connectorType: row.connectorType,
                memberSyncStatus: row.memberSyncStatus,
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
      viewerUserId && context.workspaceId
        ? await resolveViewerConnectorMemberships({
            userId: viewerUserId,
            workspaceId: context.workspaceId,
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

export const createKnowledgeConnector = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.createConnector,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: CreateKnowledgeConnectorInput
  }) => resolveActiveKnowledgeResourceContext(input, principal),
  async execute({ principal, input, context, request }) {
    const requestId = generateRequestId()
    const workspaceId = requireConnectorWorkspaceId(context)
    const actingUserId = resolveKnowledgeAttributedUserId(principal, context)
    // permission-group-enforced: knowledge.connectors — needs the request's connector id, which the funnel never sees
    await assertConnectorTypeAllowed(
      resolvePrincipalSubjectUserId(principal),
      workspaceId,
      input.connectorType
    )
    let membersBinding: ResolvedMembersBinding | undefined
    if (input.accessMode === 'members') {
      /**
       * Members mode grants the connector every enrolled member's credential,
       * which is an admin decision even though creating a connector is not.
       */
      const subjectUserId = resolvePrincipalSubjectUserId(principal)
      if (context.workspaceId === undefined) {
        throw new OrchestrationError(
          'validation',
          'Per-member access needs a workspace knowledge base'
        )
      }
      if (!subjectUserId) {
        throw new OrchestrationError(
          'forbidden',
          'A members-mode connector needs a signed-in admin'
        )
      }
      await requireCurrentHumanRole(subjectUserId, context, 'admin')
      const connectorMeta = getConnectorMeta(input.connectorType)
      if (!connectorMeta) {
        throw new OrchestrationError('validation', `Unknown connector type: ${input.connectorType}`)
      }
      membersBinding = await resolveKnowledgeConnectorMembersBinding({
        workspaceId,
        connectorMeta,
        binding:
          input.credentialGroupId && input.credentialGroupOptionId
            ? {
                credentialGroupId: input.credentialGroupId,
                credentialGroupOptionId: input.credentialGroupOptionId,
              }
            : null,
        actingUserId: subjectUserId,
        sourceConfig: input.sourceConfig,
      })
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
      resolveBillingAttribution: () =>
        input.resolveBillingAttribution?.(workspaceId) ??
        resolveKnowledgeBillingAttribution(principal, context),
      resolveAccessToken: (credentialId) =>
        resolveConnectorCredentialAccessToken({
          credentialId,
          workspaceId,
          actingUserId,
          requestId,
        }),
      userId: actingUserId,
      source: input.source ?? 'agent',
      requestId,
      request,
      recordSemanticAudit: false,
      recordProductAnalytics: false,
    })
    requireSuccessfulOutcome(outcome, 'Knowledge connector creation failed')
    return { connector: outcome.connector, workspaceId }
  },
  projectAudit: ({ input, context, result }) => ({
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
  }),
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
        const workspaceId = requireConnectorWorkspaceId(context)
        return (
          input.resolveBillingAttribution?.(workspaceId) ??
          resolveKnowledgeBillingAttribution(principal, context)
        )
      },
      validateSourceConfig: (connector, sourceConfig) => {
        const workspaceId = requireConnectorWorkspaceId(context)
        return validateConnectorSourceConfig({
          connector,
          sourceConfig,
          workspaceId,
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
    const workspaceId = requireConnectorWorkspaceId(context)
    // permission-group-enforced: knowledge.connectors — needs the persisted connector type, which the funnel never sees
    await assertConnectorTypeAllowed(
      resolvePrincipalSubjectUserId(principal),
      workspaceId,
      context.connector.connectorType
    )
    const outcome = await performSyncKnowledgeConnector({
      knowledgeBase: connectorTarget(context),
      connectorId: context.connectorId,
      resolveBillingAttribution: () =>
        input.resolveBillingAttribution?.(workspaceId) ??
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
    const baseConditions = [
      eq(document.connectorId, context.connectorId),
      isNull(document.archivedAt),
      isNull(document.deletedAt),
      knowledgeAccessCondition(await context.access.get()),
    ] as const
    const [[activeCount], excludedCountRows] = await Promise.all([
      db
        .select({ value: count() })
        .from(document)
        .where(and(...baseConditions, eq(document.userExcluded, false))),
      input.includeExcluded
        ? db
            .select({ value: count() })
            .from(document)
            .where(and(...baseConditions, eq(document.userExcluded, true)))
        : Promise.resolve([{ value: 0 }]),
    ])
    const excludedCount = excludedCountRows[0]
    const rows = await db
      .select(connectorDocumentSelection)
      .from(document)
      .where(
        and(...baseConditions, input.includeExcluded ? undefined : eq(document.userExcluded, false))
      )
      .orderBy(asc(document.userExcluded), asc(document.filename))
      .limit(limit + 1)
      .offset(offset)
    const hasMore = rows.length > limit
    const documents = rows.slice(0, limit)
    return {
      documents,
      counts: { active: activeCount?.value ?? 0, excluded: excludedCount?.value ?? 0 },
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
