import {
  v2ListKnowledgeConnectorDocumentsContract,
  v2UpdateKnowledgeConnectorDocumentsContract,
} from '@/lib/api/contracts/v2/knowledge'
import { cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2KnowledgeErrorPolicies } from '@/lib/knowledge/api/route-policies'
import {
  listKnowledgeConnectorDocuments,
  updateKnowledgeConnectorDocuments,
} from '@/lib/knowledge/application/connectors'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { toV2KnowledgeConnectorDocument } from '@/app/api/v2/knowledge/connector-utils'
import { decodeOffsetCursor, encodeOffsetCursor } from '@/app/api/v2/lib/response'

const CONNECTOR_DOCUMENT_SORT = 'userExcluded:asc,filename:asc'

function connectorDocumentCursorScope(
  knowledgeBaseId: string,
  connectorId: string,
  query: { workspaceId: string; includeExcluded: boolean }
) {
  return cursorScopeKey(
    cursorRoute(v2ListKnowledgeConnectorDocumentsContract, {
      knowledgeBaseId,
      connectorId,
    }),
    {
      workspaceId: query.workspaceId,
      includeExcluded: query.includeExcluded,
    }
  )
}

export const GET = defineV2JsonRoute({
  contract: v2ListKnowledgeConnectorDocumentsContract,
  auth: v2ApiKeyAuth,
  operation: knowledgeOperations.listConnectorDocuments,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2KnowledgeErrorPolicies.concealKnowledgeBaseAuthorization,
  mapInput: ({ params, query }) => ({
    knowledgeBaseId: params.knowledgeBaseId,
    connectorId: params.connectorId,
    assertedWorkspaceId: query.workspaceId,
    includeExcluded: query.includeExcluded,
    limit: query.limit,
    offset: decodeOffsetCursor(
      query.cursor,
      CONNECTOR_DOCUMENT_SORT,
      connectorDocumentCursorScope(params.knowledgeBaseId, params.connectorId, query)
    ),
  }),
  useCase: listKnowledgeConnectorDocuments,
  present: ({ documents, hasMore, offset, limit }, { params, query }) => ({
    data: documents.map(toV2KnowledgeConnectorDocument),
    nextCursor: hasMore
      ? encodeOffsetCursor(
          CONNECTOR_DOCUMENT_SORT,
          connectorDocumentCursorScope(params.knowledgeBaseId, params.connectorId, query),
          offset + limit
        )
      : null,
  }),
})

export const PATCH = defineV2JsonRoute({
  contract: v2UpdateKnowledgeConnectorDocumentsContract,
  auth: v2ApiKeyAuth,
  operation: knowledgeOperations.updateConnectorDocuments,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2KnowledgeErrorPolicies.concealKnowledgeBaseAuthorization,
  mapInput: ({ params, body }) => ({
    knowledgeBaseId: params.knowledgeBaseId,
    connectorId: params.connectorId,
    assertedWorkspaceId: body.workspaceId,
    operation: body.operation,
    documentIds: body.documentIds,
  }),
  useCase: updateKnowledgeConnectorDocuments,
  present: ({ operation, count, documentIds }) => ({
    data: { operation, updatedCount: count, documentIds },
  }),
})
