import { AuditAction, AuditResourceType } from '@sim/audit'
import { resolvePrincipalSubjectUserId } from '@sim/auth/principal'
import { db } from '@sim/db'
import { document, knowledgeConnector, knowledgeConnectorSyncLog } from '@sim/db/schema'
import { and, asc, count, desc, eq, inArray, isNull } from 'drizzle-orm'
import { decryptApiKey } from '@/lib/api-key/crypto'
import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import { ForbiddenOperationError } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import {
  canUseCredential,
  getCredentialActorContext,
  resolveCredentialTokenIdentity,
} from '@/lib/credentials/access'
import { defineAuthorizedKnowledgeUseCase } from '@/lib/knowledge/application/authorized-knowledge-use-case'
import {
  resolveKnowledgeAttributedUserId,
  resolveKnowledgeBillingAttribution,
} from '@/lib/knowledge/application/billing'
import {
  type ActiveKnowledgeResourceBaseContext,
  resolveActiveKnowledgeConnectorContext,
  resolveActiveKnowledgeResourceContext,
} from '@/lib/knowledge/application/contexts'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import {
  DEFAULT_KNOWLEDGE_CONNECTOR_DOCUMENT_PAGE_SIZE,
  MAX_KNOWLEDGE_CONNECTOR_DOCUMENT_MUTATION_ITEMS,
  MAX_KNOWLEDGE_CONNECTOR_DOCUMENT_PAGE_SIZE,
} from '@/lib/knowledge/constants'
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
import { refreshAccessTokenIfNeeded } from '@/lib/oauth/credential-service'
import { CAPABILITY_RULES } from '@/lib/permission-groups/capabilities'
import { resolvePermissionGroupConfig } from '@/lib/permission-groups/config-scope.server'

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
 */
async function assertConnectorTypeAllowed(
  userId: string | undefined,
  workspaceId: string,
  connectorType: string
): Promise<void> {
  if (!userId) return
  const config = await resolvePermissionGroupConfig(userId, workspaceId, undefined)
  if (!config || !CONNECTOR_ALLOWLIST_RULE.deniedBy(config, connectorType)) return

  throw new ForbiddenOperationError(
    CONNECTOR_ALLOWLIST_RULE.detailCode,
    `The ${connectorType} connector is not available under your organization's permission group`
  )
}

function requireSuccessfulOutcome<T extends object>(
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

function requireConnectorWorkspaceId(context: ActiveKnowledgeResourceBaseContext): string {
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

async function resolveConnectorCredentialAccessToken(input: {
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
  resolveContext: ({ input }: { input: ListKnowledgeConnectorsInput }) =>
    resolveActiveKnowledgeResourceContext(input),
  async execute({ input, context }) {
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
    return {
      connectors: page.map(({ encryptedApiKey: _encryptedApiKey, ...rest }) => rest),
      hasMore,
      offset,
      limit: input.limit ?? page.length,
    }
  },
})

export const readKnowledgeConnector = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.readConnector,
  resolveContext: ({ input }: { input: ReadKnowledgeConnectorInput }) =>
    resolveActiveKnowledgeConnectorContext(input),
  async execute({ context }) {
    const connector = await getKnowledgeConnector(context.knowledgeBaseId, context.connectorId)
    if (!connector) throw new OrchestrationError('not_found', 'Connector not found')
    const syncLogs = await db
      .select()
      .from(knowledgeConnectorSyncLog)
      .where(eq(knowledgeConnectorSyncLog.connectorId, context.connectorId))
      .orderBy(desc(knowledgeConnectorSyncLog.startedAt))
      .limit(10)
    const { encryptedApiKey: _encryptedApiKey, ...connectorData } = connector
    return { connector: { ...connectorData, syncLogs } }
  },
})

export const createKnowledgeConnector = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.createConnector,
  resolveContext: ({ input }: { input: CreateKnowledgeConnectorInput }) =>
    resolveActiveKnowledgeResourceContext(input),
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
    const outcome = await performCreateKnowledgeConnector({
      knowledgeBase: connectorTarget(context),
      connectorType: input.connectorType,
      credentialId: input.credentialId,
      apiKey: input.apiKey,
      sourceConfig: input.sourceConfig,
      syncIntervalMinutes: input.syncIntervalMinutes,
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
  resolveContext: ({ input }: { input: UpdateKnowledgeConnectorInput }) =>
    resolveActiveKnowledgeConnectorContext(input),
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
  resolveContext: ({ input }: { input: DeleteKnowledgeConnectorInput }) =>
    resolveActiveKnowledgeConnectorContext(input),
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

export const syncKnowledgeConnector = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.syncConnector,
  resolveContext: ({ input }: { input: SyncKnowledgeConnectorInput }) =>
    resolveActiveKnowledgeConnectorContext(input),
  async execute({ principal, input, context, request }) {
    const workspaceId = requireConnectorWorkspaceId(context)
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
  resolveContext: ({ input }: { input: ListKnowledgeConnectorDocumentsInput }) =>
    resolveActiveKnowledgeConnectorContext(input),
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
  resolveContext: ({ input }: { input: UpdateKnowledgeConnectorDocumentsInput }) =>
    resolveActiveKnowledgeConnectorContext(input),
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
          isNull(document.deletedAt)
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
