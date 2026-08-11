import { upsertKnowledgeDocumentContract } from '@/lib/api/contracts/knowledge'
import { defineInternalJsonRoute, internalRateLimits } from '@/lib/api/server/routes'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  internalKnowledgeAnalytics,
  internalKnowledgeAuthType,
  resolveInternalKnowledgeBillingAttribution,
} from '@/lib/knowledge/api/internal-route'
import {
  internalKnowledgeErrorPolicies,
  internalKnowledgeSessionOrExecutorAuth,
} from '@/lib/knowledge/api/route-policies'
import { upsertKnowledgeDocument } from '@/lib/knowledge/application/documents'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import {
  finalizeKnowledgeProvenanceResponse,
  resolveKnowledgeDocumentWriteSecretProvenance,
} from '@/app/api/knowledge/secret-provenance'

export const POST = defineInternalJsonRoute({
  contract: upsertKnowledgeDocumentContract,
  auth: internalKnowledgeSessionOrExecutorAuth,
  operation: knowledgeOperations.uploadDocument,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal document-upsert behavior',
  }),
  errorPolicy: internalKnowledgeErrorPolicies.upsert,
  parseOptions: { maxBodyBytes: 2 * 1024 * 1024 },
  mapInput: ({ params, body }, { principal, request }) => ({
    knowledgeBaseId: params.id,
    documentId: body.documentId,
    filename: body.filename,
    fileUrl: body.fileUrl,
    fileSize: body.fileSize,
    mimeType: body.mimeType,
    documentTagsData: body.documentTagsData,
    processingOptions: body.processingOptions,
    resolveBillingAttribution: (workspaceId: string) =>
      resolveInternalKnowledgeBillingAttribution(request, principal, workspaceId),
    resolveSecretProvenances: ({
      userId,
      workspaceId,
    }: {
      userId: string
      workspaceId: string
    }) => {
      const resolved = resolveKnowledgeDocumentWriteSecretProvenance({
        request,
        payload: body,
        authType: internalKnowledgeAuthType(principal),
        userId,
        workspaceId,
        documents: [body],
      })
      if (!resolved.success) {
        throw new OrchestrationError('validation', 'Invalid knowledge secret provenance')
      }
      return resolved.provenances
    },
  }),
  useCase: upsertKnowledgeDocument,
  onSuccess: internalKnowledgeAnalytics.documentUpserted,
  present: ({ document, isUpdate, previousDocumentId, processingConfig }) => ({
    success: true as const,
    data: {
      documentsCreated: [
        {
          documentId: document.documentId,
          filename: document.filename,
          status: 'pending' as const,
        },
      ],
      isUpdate,
      previousDocumentId,
      processingMethod: 'background' as const,
      processingConfig,
    },
  }),
  finalizeResponse: ({ request, principal, result, body }) =>
    finalizeKnowledgeProvenanceResponse({
      request,
      authType: internalKnowledgeAuthType(principal),
      userId: result.userId,
      workspaceId: result.workspaceId,
      body,
      provenances:
        result.secretProvenances?.flatMap((provenance) => [
          provenance.filename,
          ...provenance.tags.map((tag) => tag.provenance),
        ]) ?? [],
    }),
})
