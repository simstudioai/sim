import { AuditAction, AuditResourceType } from '@sim/audit'
import { db } from '@sim/db'
import { document, knowledgeConnector, knowledgeConnectorSyncLog } from '@sim/db/schema'
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import { defineAuthorizedKnowledgeUseCase } from '@/lib/knowledge/application/authorized-knowledge-use-case'
import { resolveKnowledgeAttributedUserId } from '@/lib/knowledge/application/billing'
import {
  type ActiveKnowledgeBaseContext,
  resolveActiveKnowledgeBaseContext,
  resolveActiveKnowledgeConnectorContext,
} from '@/lib/knowledge/application/contexts'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
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

interface KnowledgeConnectorApplicationInput {
  assertedWorkspaceId?: string
  source?: KnowledgeOperationSource
}

export interface ListKnowledgeConnectorsInput extends KnowledgeConnectorApplicationInput {
  knowledgeBaseId: string
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
  resolveBillingAttribution(workspaceId: string): Promise<BillingAttributionSnapshot>
  resolveAccessToken(requestId: string, credentialId: string): Promise<string | null>
}

export interface UpdateKnowledgeConnectorInput extends KnowledgeConnectorApplicationInput {
  connectorId: string
  updates: {
    sourceConfig?: Record<string, unknown>
    syncIntervalMinutes?: number
    status?: 'active' | 'paused'
  }
  createSourceConfigValidator?(
    workspaceId: string,
    actingUserId: string
  ): (
    connector: KnowledgeConnectorRow,
    sourceConfig: Record<string, unknown>
  ) => Promise<SourceConfigRejection | null>
}

export interface DeleteKnowledgeConnectorInput extends KnowledgeConnectorApplicationInput {
  connectorId: string
  deleteDocuments?: boolean
}

export interface SyncKnowledgeConnectorInput extends KnowledgeConnectorApplicationInput {
  connectorId: string
  rehydrate?: boolean
  resolveBillingAttribution(workspaceId: string): Promise<BillingAttributionSnapshot>
}

export interface ListKnowledgeConnectorDocumentsInput extends ReadKnowledgeConnectorInput {
  includeExcluded?: boolean
}

export interface UpdateKnowledgeConnectorDocumentsInput extends ReadKnowledgeConnectorInput {
  operation: 'restore' | 'exclude'
  documentIds: string[]
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

function connectorTarget(context: ActiveKnowledgeBaseContext) {
  return {
    id: context.knowledgeBaseId,
    name: context.knowledgeBase.name,
    workspaceId: context.workspaceId,
  }
}

export const listKnowledgeConnectors = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.listConnectors,
  resolveContext: ({ input }: { input: ListKnowledgeConnectorsInput }) =>
    resolveActiveKnowledgeBaseContext(input),
  async execute({ context }) {
    const connectors = await db
      .select()
      .from(knowledgeConnector)
      .where(
        and(
          eq(knowledgeConnector.knowledgeBaseId, context.knowledgeBaseId),
          isNull(knowledgeConnector.archivedAt),
          isNull(knowledgeConnector.deletedAt)
        )
      )
      .orderBy(desc(knowledgeConnector.createdAt))
    return { connectors: connectors.map(({ encryptedApiKey: _encryptedApiKey, ...rest }) => rest) }
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
    resolveActiveKnowledgeBaseContext(input),
  async execute({ principal, input, context, request }) {
    const requestId = generateRequestId()
    const outcome = await performCreateKnowledgeConnector({
      knowledgeBase: connectorTarget(context),
      connectorType: input.connectorType,
      credentialId: input.credentialId,
      apiKey: input.apiKey,
      sourceConfig: input.sourceConfig,
      syncIntervalMinutes: input.syncIntervalMinutes,
      resolveBillingAttribution: () => input.resolveBillingAttribution(context.workspaceId),
      resolveAccessToken: (credentialId) => input.resolveAccessToken(requestId, credentialId),
      userId: resolveKnowledgeAttributedUserId(principal, context),
      source: input.source ?? 'agent',
      requestId,
      request,
      recordSemanticAudit: false,
    })
    requireSuccessfulOutcome(outcome, 'Knowledge connector creation failed')
    return { connector: outcome.connector }
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

export const updateKnowledgeConnector = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.updateConnector,
  resolveContext: ({ input }: { input: UpdateKnowledgeConnectorInput }) =>
    resolveActiveKnowledgeConnectorContext(input),
  async execute({ principal, input, context, request }) {
    const outcome = await performUpdateKnowledgeConnector({
      knowledgeBase: connectorTarget(context),
      connectorId: context.connectorId,
      updates: input.updates,
      validateSourceConfig: input.createSourceConfigValidator?.(
        context.workspaceId,
        resolveKnowledgeAttributedUserId(principal, context)
      ),
      userId: resolveKnowledgeAttributedUserId(principal, context),
      source: input.source ?? 'agent',
      requestId: generateRequestId(),
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
    })
    requireSuccessfulOutcome(outcome, 'Knowledge connector deletion failed')
    return {
      connectorId: context.connectorId,
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
    const outcome = await performSyncKnowledgeConnector({
      knowledgeBase: connectorTarget(context),
      connectorId: context.connectorId,
      resolveBillingAttribution: () => input.resolveBillingAttribution(context.workspaceId),
      rehydrate: input.rehydrate,
      userId: resolveKnowledgeAttributedUserId(principal, context),
      source: input.source ?? 'agent',
      requestId: generateRequestId(),
      request,
      recordSemanticAudit: false,
    })
    requireSuccessfulOutcome(outcome, 'Knowledge connector sync failed')
    return { connectorId: context.connectorId }
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
    const activeDocuments = await db
      .select(connectorDocumentSelection)
      .from(document)
      .where(
        and(
          eq(document.connectorId, context.connectorId),
          eq(document.userExcluded, false),
          isNull(document.archivedAt),
          isNull(document.deletedAt)
        )
      )
      .orderBy(document.filename)
    const excludedDocuments = input.includeExcluded
      ? await db
          .select(connectorDocumentSelection)
          .from(document)
          .where(
            and(
              eq(document.connectorId, context.connectorId),
              eq(document.userExcluded, true),
              isNull(document.archivedAt),
              isNull(document.deletedAt)
            )
          )
          .orderBy(document.filename)
      : []
    return {
      documents: [...activeDocuments, ...excludedDocuments],
      counts: { active: activeDocuments.length, excluded: excludedDocuments.length },
    }
  },
})

export const updateKnowledgeConnectorDocuments = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.updateConnectorDocuments,
  resolveContext: ({ input }: { input: UpdateKnowledgeConnectorDocumentsInput }) =>
    resolveActiveKnowledgeConnectorContext(input),
  async execute({ input, context }) {
    const restoring = input.operation === 'restore'
    const updated = await db
      .update(document)
      .set({ userExcluded: !restoring, enabled: restoring })
      .where(
        and(
          eq(document.connectorId, context.connectorId),
          inArray(document.id, input.documentIds),
          eq(document.userExcluded, !restoring),
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
