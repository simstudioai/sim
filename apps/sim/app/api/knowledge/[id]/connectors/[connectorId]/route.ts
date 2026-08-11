import {
  deleteKnowledgeConnectorContract,
  getKnowledgeConnectorContract,
  updateKnowledgeConnectorContract,
} from '@/lib/api/contracts/knowledge'
import { defineInternalJsonRoute, internalRateLimits } from '@/lib/api/server/routes'
import {
  internalKnowledgeAnalytics,
  toInternalKnowledgeConnector,
  toInternalKnowledgeConnectorDetail,
} from '@/lib/knowledge/api/internal-route'
import {
  internalKnowledgeErrorPolicies,
  internalKnowledgeSessionOrExecutorAuth,
} from '@/lib/knowledge/api/route-policies'
import {
  deleteKnowledgeConnector,
  readKnowledgeConnector,
  updateKnowledgeConnector,
} from '@/lib/knowledge/application/connectors'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'

export const GET = defineInternalJsonRoute({
  contract: getKnowledgeConnectorContract,
  auth: internalKnowledgeSessionOrExecutorAuth,
  operation: knowledgeOperations.readConnector,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal connector-read behavior',
  }),
  errorPolicy: internalKnowledgeErrorPolicies.connectors,
  mapInput: ({ params }) => ({
    knowledgeBaseId: params.id,
    connectorId: params.connectorId,
  }),
  useCase: readKnowledgeConnector,
  present: ({ connector }) => ({
    success: true as const,
    data: toInternalKnowledgeConnectorDetail(connector),
  }),
})

export const PATCH = defineInternalJsonRoute({
  contract: updateKnowledgeConnectorContract,
  auth: internalKnowledgeSessionOrExecutorAuth,
  operation: knowledgeOperations.updateConnector,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal connector-update behavior',
  }),
  errorPolicy: internalKnowledgeErrorPolicies.connectors,
  mapInput: ({ params, body }) => ({
    connectorId: params.connectorId,
    knowledgeBaseId: params.id,
    updates: body,
    source: 'ui' as const,
  }),
  useCase: updateKnowledgeConnector,
  present: ({ connector }) => ({
    success: true as const,
    data: toInternalKnowledgeConnector(connector),
  }),
})

export const DELETE = defineInternalJsonRoute({
  contract: deleteKnowledgeConnectorContract,
  auth: internalKnowledgeSessionOrExecutorAuth,
  operation: knowledgeOperations.deleteConnector,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal connector-delete behavior',
  }),
  errorPolicy: internalKnowledgeErrorPolicies.connectors,
  mapInput: ({ params, query }) => ({
    connectorId: params.connectorId,
    knowledgeBaseId: params.id,
    deleteDocuments: query.deleteDocuments,
    source: 'ui' as const,
  }),
  useCase: deleteKnowledgeConnector,
  onSuccess: internalKnowledgeAnalytics.connectorRemoved,
  present: () => ({ success: true as const }),
})
