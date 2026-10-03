import {
  listKnowledgeConnectorDocumentsContract,
  patchKnowledgeConnectorDocumentsContract,
} from '@/lib/api/contracts/knowledge'
import { defineInternalJsonRoute, internalRateLimits } from '@/lib/api/server/routes'
import {
  internalKnowledgeErrorPolicies,
  internalKnowledgeSessionOrExecutorAuth,
} from '@/lib/knowledge/api/route-policies'
import {
  listKnowledgeConnectorDocuments,
  updateKnowledgeConnectorDocuments,
} from '@/lib/knowledge/application/connectors'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'

export const GET = defineInternalJsonRoute({
  contract: listKnowledgeConnectorDocumentsContract,
  auth: internalKnowledgeSessionOrExecutorAuth,
  operation: knowledgeOperations.listConnectorDocuments,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal connector-document list behavior',
  }),
  errorPolicy: internalKnowledgeErrorPolicies.connectors,
  mapInput: ({ params, query }) => ({
    knowledgeBaseId: params.id,
    connectorId: params.connectorId,
    filter: query.filter,
    search: query.search,
    includeExcluded: query.includeExcluded,
    failedOnly: query.failedOnly,
    limit: query.limit,
    offset: query.offset,
  }),
  useCase: listKnowledgeConnectorDocuments,
  present: ({ documents, counts, hasMore }) => ({
    success: true as const,
    data: {
      documents: documents.map((document) => ({
        ...document,
        deletedAt: null,
        uploadedAt: document.uploadedAt.toISOString(),
      })),
      counts,
      hasMore,
    },
  }),
})

export const PATCH = defineInternalJsonRoute({
  contract: patchKnowledgeConnectorDocumentsContract,
  auth: internalKnowledgeSessionOrExecutorAuth,
  operation: knowledgeOperations.updateConnectorDocuments,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal connector-document update behavior',
  }),
  errorPolicy: internalKnowledgeErrorPolicies.connectors,
  mapInput: ({ params, body }) => ({
    knowledgeBaseId: params.id,
    connectorId: params.connectorId,
    ...body,
  }),
  useCase: updateKnowledgeConnectorDocuments,
  present: ({ operation, count, documentIds }) => ({
    success: true as const,
    data:
      operation === 'restore'
        ? { restoredCount: count, documentIds }
        : { excludedCount: count, documentIds },
  }),
})
