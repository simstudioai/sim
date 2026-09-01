import {
  v2CreateKnowledgeConnectorContract,
  v2ListKnowledgeConnectorsContract,
} from '@/lib/api/contracts/v2/knowledge'
import { cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { internalKnowledgeAnalytics } from '@/lib/knowledge/api/internal-route'
import { v2KnowledgeErrorPolicies } from '@/lib/knowledge/api/route-policies'
import {
  createKnowledgeConnector,
  listKnowledgeConnectors,
} from '@/lib/knowledge/application/connectors'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { toV2KnowledgeConnector } from '@/app/api/v2/knowledge/connector-utils'
import { cursorSortKey, decodeOffsetCursor, encodeOffsetCursor } from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function connectorCursorScope(knowledgeBaseId: string, workspaceId: string) {
  return cursorScopeKey(cursorRoute(v2ListKnowledgeConnectorsContract, { knowledgeBaseId }), {
    workspaceId,
  })
}

export const GET = defineV2JsonRoute({
  contract: v2ListKnowledgeConnectorsContract,
  auth: v2ApiKeyAuth,
  operation: knowledgeOperations.listConnectors,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2KnowledgeErrorPolicies.concealKnowledgeBaseAuthorization,
  mapInput: ({ params, query }) => ({
    knowledgeBaseId: params.knowledgeBaseId,
    assertedWorkspaceId: query.workspaceId,
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
    limit: query.limit,
    offset: decodeOffsetCursor(
      query.cursor,
      cursorSortKey(query.sortBy, query.sortOrder),
      connectorCursorScope(params.knowledgeBaseId, query.workspaceId)
    ),
  }),
  useCase: listKnowledgeConnectors,
  present: ({ connectors, hasMore, offset, limit }, { params, query }) => ({
    data: connectors.map(toV2KnowledgeConnector),
    nextCursor: hasMore
      ? encodeOffsetCursor(
          cursorSortKey(query.sortBy, query.sortOrder),
          connectorCursorScope(params.knowledgeBaseId, query.workspaceId),
          offset + limit
        )
      : null,
  }),
})

export const POST = defineV2JsonRoute({
  contract: v2CreateKnowledgeConnectorContract,
  auth: v2ApiKeyAuth,
  operation: knowledgeOperations.createConnector,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2KnowledgeErrorPolicies.concealKnowledgeBaseAuthorization,
  mapInput: ({ params, body }) => ({
    knowledgeBaseId: params.knowledgeBaseId,
    assertedWorkspaceId: body.workspaceId,
    connectorType: body.connectorType,
    credentialId: body.credentialId,
    apiKey: body.apiKey,
    sourceConfig: body.sourceConfig,
    syncIntervalMinutes: body.syncIntervalMinutes,
    source: 'api' as const,
  }),
  useCase: createKnowledgeConnector,
  onSuccess: internalKnowledgeAnalytics.connectorAdded,
  present: ({ connector }) => ({ data: toV2KnowledgeConnector(connector) }),
})
