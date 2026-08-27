import {
  bulkKnowledgeDocumentsContract,
  createKnowledgeDocumentsContract,
  listKnowledgeDocumentsContract,
  parseDocumentTagFiltersParam,
} from '@/lib/api/contracts/knowledge'
import { defineInternalJsonRoute, internalRateLimits } from '@/lib/api/server/routes'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  internalKnowledgeAnalytics,
  internalKnowledgeAuthType,
  internalKnowledgeProvenanceUserId,
  resolveInternalKnowledgeBillingAttribution,
  toInternalKnowledgeDocument,
} from '@/lib/knowledge/api/internal-route'
import {
  internalKnowledgeErrorPolicies,
  internalKnowledgeSessionOrExecutorAuth,
} from '@/lib/knowledge/api/route-policies'
import {
  bulkUpdateKnowledgeDocuments,
  createKnowledgeDocuments,
  listKnowledgeDocuments,
} from '@/lib/knowledge/application/documents'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { createKnowledgeDocumentSourceValue } from '@/lib/knowledge/secret-provenance'
import {
  finalizeKnowledgePersistedResponse,
  finalizeKnowledgeProvenanceResponse,
  resolveKnowledgeDocumentWriteSecretProvenance,
} from '@/app/api/knowledge/secret-provenance'

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
      request,
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

export const POST = defineInternalJsonRoute({
  contract: createKnowledgeDocumentsContract,
  auth: internalKnowledgeSessionOrExecutorAuth,
  operation: knowledgeOperations.uploadDocument,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal document-create behavior',
  }),
  errorPolicy: internalKnowledgeErrorPolicies.uploads,
  mapInput: ({ params, body }, { principal, request }) => {
    const documents = body.bulk ? body.documents : [body]
    return {
      knowledgeBaseId: params.id,
      documents,
      bulk: body.bulk,
      processingOptions: body.bulk ? body.processingOptions : undefined,
      resolveBillingAttribution: (workspaceId: string) =>
        resolveInternalKnowledgeBillingAttribution(request, principal, workspaceId),
      resolveSecretProvenances: ({ userId, workspaceId }) => {
        const resolution = resolveKnowledgeDocumentWriteSecretProvenance({
          request,
          payload: body,
          authType: internalKnowledgeAuthType(principal),
          userId,
          workspaceId,
          documents,
        })
        if (!resolution.success) {
          throw new OrchestrationError('validation', 'Invalid knowledge secret provenance')
        }
        return resolution.provenances
      },
      source: 'ui' as const,
    }
  },
  useCase: createKnowledgeDocuments,
  onSuccess: internalKnowledgeAnalytics.documentsUploaded,
  present: (result) => ({
    success: true as const,
    data: result.kind === 'bulk' ? result.data : toInternalKnowledgeDocument(result.data),
  }),
  finalizeResponse: ({ request, principal, result, body }) =>
    finalizeKnowledgeProvenanceResponse({
      request,
      authType: internalKnowledgeAuthType(principal),
      userId: result.userId,
      workspaceId: result.workspaceId,
      provenances:
        result.secretProvenances?.flatMap((provenance) => [
          provenance.filename,
          ...provenance.tags.map((tag) => tag.provenance),
        ]) ?? [],
      body,
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
