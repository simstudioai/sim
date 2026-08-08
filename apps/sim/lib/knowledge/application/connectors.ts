import { AuditAction, AuditResourceType } from '@sim/audit'
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
  performCreateKnowledgeConnector,
  performDeleteKnowledgeConnector,
  performSyncKnowledgeConnector,
  performUpdateKnowledgeConnector,
} from '@/lib/knowledge/orchestration/connectors'
import type {
  KnowledgeOperationSource,
  KnowledgeOrchestrationResult,
} from '@/lib/knowledge/orchestration/shared'

interface KnowledgeConnectorApplicationInput {
  assertedWorkspaceId?: string
  source?: KnowledgeOperationSource
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
