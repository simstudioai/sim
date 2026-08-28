import {
  deleteKnowledgeDocumentContract,
  getKnowledgeDocumentContract,
  updateKnowledgeDocumentContract,
} from '@/lib/api/contracts/knowledge'
import { defineInternalJsonRoute, internalRateLimits } from '@/lib/api/server/routes'
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
  deleteKnowledgeDocument,
  readKnowledgeDocument,
  updateKnowledgeDocument,
} from '@/lib/knowledge/application/documents'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { createKnowledgeDocumentSourceValue } from '@/lib/knowledge/secret-provenance'
import { finalizeKnowledgePersistedResponse } from '@/app/api/knowledge/secret-provenance'

export const GET = defineInternalJsonRoute({
  contract: getKnowledgeDocumentContract,
  auth: internalKnowledgeSessionOrExecutorAuth,
  operation: knowledgeOperations.readDocument,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal document-read behavior',
  }),
  errorPolicy: internalKnowledgeErrorPolicies.documents,
  mapInput: ({ params }) => ({
    knowledgeBaseId: params.id,
    documentId: params.documentId,
  }),
  useCase: readKnowledgeDocument,
  present: ({ document }) => ({
    success: true as const,
    data: toInternalKnowledgeDocument(document),
  }),
  finalizeResponse: ({ request, principal, result, body }) =>
    finalizeKnowledgePersistedResponse({
      request,
      authType: internalKnowledgeAuthType(principal),
      userId: internalKnowledgeProvenanceUserId(request, principal, result.workspaceId),
      workspaceId: result.workspaceId,
      body,
      documents: [
        {
          id: result.document.id,
          source: createKnowledgeDocumentSourceValue(result.document),
          value: result.document,
        },
      ],
    }),
})

export const PUT = defineInternalJsonRoute({
  contract: updateKnowledgeDocumentContract,
  auth: internalKnowledgeSessionOrExecutorAuth,
  operation: knowledgeOperations.updateDocument,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal document-update behavior',
  }),
  errorPolicy: internalKnowledgeErrorPolicies.documents,
  mapInput: ({ params, body }, { principal, request }) => {
    const { markFailedDueToTimeout, retryProcessing, ...updates } = body
    return {
      knowledgeBaseId: params.id,
      documentId: params.documentId,
      updates,
      markFailedDueToTimeout,
      retryProcessing,
      resolveBillingAttribution: (workspaceId: string) =>
        resolveInternalKnowledgeBillingAttribution(request, principal, workspaceId),
      source: 'ui',
    }
  },
  useCase: updateKnowledgeDocument,
  present: (result) =>
    result.kind === 'processing'
      ? {
          success: true as const,
          data: {
            documentId: result.documentId,
            status: result.status,
            message: result.message,
          },
        }
      : { success: true as const, data: toInternalKnowledgeDocument(result.document) },
})

export const DELETE = defineInternalJsonRoute({
  contract: deleteKnowledgeDocumentContract,
  auth: internalKnowledgeSessionOrExecutorAuth,
  operation: knowledgeOperations.deleteDocument,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal document-delete behavior',
  }),
  errorPolicy: internalKnowledgeErrorPolicies.documents,
  mapInput: ({ params }) => ({
    knowledgeBaseId: params.id,
    documentId: params.documentId,
    source: 'ui',
  }),
  useCase: deleteKnowledgeDocument,
  onSuccess: internalKnowledgeAnalytics.documentDeleted,
  present: () => ({
    success: true as const,
    data: { success: true, message: 'Document deleted successfully' },
  }),
})
