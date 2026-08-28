import {
  bulkKnowledgeDocumentsContract,
  listKnowledgeDocumentsContract,
  parseDocumentTagFiltersParam,
} from '@/lib/api/contracts/knowledge'
import { defineInternalJsonRoute, internalRateLimits } from '@/lib/api/server/routes'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  internalKnowledgeAuthType,
  internalKnowledgeProvenanceUserId,
  toInternalKnowledgeDocument,
} from '@/lib/knowledge/api/internal-route'
import {
  internalKnowledgeErrorPolicies,
  internalKnowledgeSessionOrExecutorAuth,
} from '@/lib/knowledge/api/route-policies'
import { finalizeKnowledgePersistedResponse } from '@/lib/knowledge/api/secret-provenance'
import {
  bulkUpdateKnowledgeDocuments,
  listKnowledgeDocuments,
} from '@/lib/knowledge/application/documents'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { createKnowledgeDocumentSourceValue } from '@/lib/knowledge/secret-provenance'

export const GET = defineInternalJsonRoute({
  contract: listKnowledgeDocumentsContract,
  auth: internalKnowledgeSessionOrExecutorAuth,
  operation: knowledgeOperations.listDocuments,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal document-list behavior',
  }),
  errorPolicy: internalKnowledgeErrorPolicies.documents,
  mapInput: ({ params, query }) => {
    let tagFilters
    try {
      tagFilters = parseDocumentTagFiltersParam(query.tagFilters)
    } catch {
      throw new OrchestrationError('validation', 'tagFilters must be a valid JSON array')
    }
    return {
      knowledgeBaseId: params.id,
      enabledFilter: query.enabledFilter,
      search: query.search,
      limit: query.limit,
      offset: query.offset,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
      tagFilters,
    }
  },
  useCase: listKnowledgeDocuments,
  present: ({ documents, pagination }) => ({
    success: true as const,
    data: {
      documents: documents.map(toInternalKnowledgeDocument),
      pagination,
    },
  }),
  finalizeResponse: ({ request, principal, result, body }) =>
    finalizeKnowledgePersistedResponse({
      headers: request.headers,
      authType: internalKnowledgeAuthType(principal),
      userId: internalKnowledgeProvenanceUserId(request, principal, result.workspaceId),
      workspaceId: result.workspaceId,
      body,
      documents: result.documents.map((document) => ({
        id: document.id,
        source: createKnowledgeDocumentSourceValue(document),
        value: document,
      })),
    }),
})

export const PATCH = defineInternalJsonRoute({
  contract: bulkKnowledgeDocumentsContract,
  auth: internalKnowledgeSessionOrExecutorAuth,
  operation: knowledgeOperations.bulkDocuments,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal bulk-document behavior',
  }),
  errorPolicy: internalKnowledgeErrorPolicies.documents,
  mapInput: ({ params, body }) => ({
    knowledgeBaseId: params.id,
    operation: body.operation,
    documentIds: body.documentIds,
    selectAll: body.selectAll,
    enabledFilter: body.enabledFilter,
  }),
  useCase: bulkUpdateKnowledgeDocuments,
  present: (result) => ({ success: true as const, data: result }),
})
