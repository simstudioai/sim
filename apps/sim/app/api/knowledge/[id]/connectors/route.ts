import {
  createKnowledgeConnectorContract,
  listKnowledgeConnectorsContract,
} from '@/lib/api/contracts/knowledge'
import { defineInternalJsonRoute, internalRateLimits } from '@/lib/api/server/routes'
import {
  internalKnowledgeAnalytics,
  resolveInternalKnowledgeBillingAttribution,
  toInternalKnowledgeConnector,
} from '@/lib/knowledge/api/internal-route'
import {
  internalKnowledgeErrorPolicies,
  internalKnowledgeSessionOrExecutorAuth,
} from '@/lib/knowledge/api/route-policies'
import {
  createKnowledgeConnector,
  listKnowledgeConnectors,
} from '@/lib/knowledge/application/connectors'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'

export const GET = defineInternalJsonRoute({
  contract: listKnowledgeConnectorsContract,
  auth: internalKnowledgeSessionOrExecutorAuth,
  operation: knowledgeOperations.listConnectors,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal connector-list behavior',
  }),
  errorPolicy: internalKnowledgeErrorPolicies.connectors,
  mapInput: ({ params }) => ({ knowledgeBaseId: params.id }),
  useCase: listKnowledgeConnectors,
  present: ({ connectors }) => ({
    success: true as const,
    data: connectors.map(toInternalKnowledgeConnector),
  }),
})

export const POST = defineInternalJsonRoute({
  contract: createKnowledgeConnectorContract,
  auth: internalKnowledgeSessionOrExecutorAuth,
  operation: knowledgeOperations.createConnector,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal connector-create behavior',
  }),
  errorPolicy: internalKnowledgeErrorPolicies.connectors,
  mapInput: ({ params, body }, { principal, request }) => ({
    knowledgeBaseId: params.id,
    connectorType: body.connectorType,
    credentialId: body.credentialId,
    apiKey: body.apiKey,
    sourceConfig: body.sourceConfig,
    syncIntervalMinutes: body.syncIntervalMinutes,
    accessMode: body.accessMode,
    resolveBillingAttribution: (workspaceId: string) =>
      resolveInternalKnowledgeBillingAttribution(request, principal, workspaceId),
    source: 'ui' as const,
  }),
  useCase: createKnowledgeConnector,
  onSuccess: internalKnowledgeAnalytics.connectorAdded,
  present: ({ connector }) => ({
    success: true as const,
    data: toInternalKnowledgeConnector(connector),
  }),
})
