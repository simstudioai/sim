import {
  v2DeleteKnowledgeConnectorContract,
  v2GetKnowledgeConnectorContract,
  v2UpdateKnowledgeConnectorContract,
} from '@/lib/api/contracts/v2/knowledge'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { internalKnowledgeAnalytics } from '@/lib/knowledge/api/internal-route'
import { v2KnowledgeErrorPolicies } from '@/lib/knowledge/api/route-policies'
import {
  deleteKnowledgeConnector,
  readKnowledgeConnector,
  updateKnowledgeConnector,
} from '@/lib/knowledge/application/connectors'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import {
  toV2KnowledgeConnector,
  toV2KnowledgeConnectorDetail,
} from '@/app/api/v2/knowledge/connector-utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = defineV2JsonRoute({
  contract: v2GetKnowledgeConnectorContract,
  auth: v2ApiKeyAuth,
  operation: knowledgeOperations.readConnector,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2KnowledgeErrorPolicies.concealKnowledgeBaseAuthorization,
  mapInput: ({ params, query }) => ({
    knowledgeBaseId: params.id,
    connectorId: params.connectorId,
    assertedWorkspaceId: query.workspaceId,
  }),
  useCase: readKnowledgeConnector,
  present: ({ connector }) => ({ data: toV2KnowledgeConnectorDetail(connector) }),
})

export const PATCH = defineV2JsonRoute({
  contract: v2UpdateKnowledgeConnectorContract,
  auth: v2ApiKeyAuth,
  operation: knowledgeOperations.updateConnector,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2KnowledgeErrorPolicies.concealKnowledgeBaseAuthorization,
  mapInput: ({ params, body }) => ({
    knowledgeBaseId: params.id,
    connectorId: params.connectorId,
    assertedWorkspaceId: body.workspaceId,
    updates: {
      sourceConfig: body.sourceConfig,
      syncIntervalMinutes: body.syncIntervalMinutes,
      status: body.status,
    },
    source: 'api' as const,
  }),
  useCase: updateKnowledgeConnector,
  present: ({ connector }) => ({ data: toV2KnowledgeConnector(connector) }),
})

export const DELETE = defineV2JsonRoute({
  contract: v2DeleteKnowledgeConnectorContract,
  auth: v2ApiKeyAuth,
  operation: knowledgeOperations.deleteConnector,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2KnowledgeErrorPolicies.concealKnowledgeBaseAuthorization,
  mapInput: ({ params, query }) => ({
    knowledgeBaseId: params.id,
    connectorId: params.connectorId,
    assertedWorkspaceId: query.workspaceId,
    deleteDocuments: query.deleteDocuments,
    source: 'api' as const,
  }),
  useCase: deleteKnowledgeConnector,
  onSuccess: internalKnowledgeAnalytics.connectorRemoved,
  present: ({ connectorId, documentsDeleted, documentsKept }) => ({
    data: {
      id: connectorId,
      deleted: true as const,
      documentsDeleted,
      documentsKept,
    },
  }),
})
