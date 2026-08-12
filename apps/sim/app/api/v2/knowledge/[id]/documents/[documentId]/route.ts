import {
  v2DeleteKnowledgeDocumentContract,
  v2GetKnowledgeDocumentContract,
  v2UpdateKnowledgeDocumentContract,
} from '@/lib/api/contracts/v2/knowledge'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2KnowledgeErrorPolicies } from '@/lib/knowledge/api/route-policies'
import {
  deleteKnowledgeDocument,
  readKnowledgeDocument,
  updateKnowledgeDocument,
} from '@/lib/knowledge/application/documents'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { captureServerEvent } from '@/lib/posthog/server'
import { serializeDate } from '@/app/api/v1/knowledge/utils'
import { toV2DocumentTags, toV2TaggedDocument } from '@/app/api/v2/knowledge/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function toProcessingStatus(status: string): 'pending' | 'processing' | 'completed' | 'failed' {
  switch (status) {
    case 'pending':
    case 'processing':
    case 'completed':
    case 'failed':
      return status
    default:
      throw new Error(`Unexpected knowledge document processing status: ${status}`)
  }
}

/** GET /api/v2/knowledge/[id]/documents/[documentId] — Get document details. */
export const GET = defineV2JsonRoute({
  contract: v2GetKnowledgeDocumentContract,
  auth: v2ApiKeyAuth,
  operation: knowledgeOperations.readDocument,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2KnowledgeErrorPolicies.concealKnowledgeBaseAuthorization,
  mapInput: ({ params, query }) => ({
    knowledgeBaseId: params.id,
    documentId: params.documentId,
    assertedWorkspaceId: query.workspaceId,
  }),
  useCase: readKnowledgeDocument,
  present: ({ document, tagDefinitions }) => ({
    data: {
      id: document.id,
      knowledgeBaseId: document.knowledgeBaseId,
      filename: document.filename,
      fileSize: document.fileSize,
      mimeType: document.mimeType,
      processingStatus: toProcessingStatus(document.processingStatus),
      processingError: document.processingError,
      processingStartedAt: serializeDate(document.processingStartedAt),
      processingCompletedAt: serializeDate(document.processingCompletedAt),
      chunkCount: document.chunkCount,
      tokenCount: document.tokenCount,
      characterCount: document.characterCount,
      enabled: document.enabled,
      connectorId: document.connectorId,
      connectorType: document.connectorType,
      sourceUrl: document.sourceUrl,
      createdAt: serializeDate(document.uploadedAt),
      tags: toV2DocumentTags(document, tagDefinitions),
    },
  }),
})

/**
 * PATCH /api/v2/knowledge/[id]/documents/[documentId] — Update a document.
 *
 * Renames, enables or disables, retags, or requeues processing. Derived
 * indexing state is not writable; the contract records why.
 *
 * The updated document is returned without connector provenance because the
 * update writes and returns the document row alone. A caller that needs the full
 * detail re-reads it with GET.
 */
export const PATCH = defineV2JsonRoute({
  contract: v2UpdateKnowledgeDocumentContract,
  auth: v2ApiKeyAuth,
  operation: knowledgeOperations.updateDocument,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2KnowledgeErrorPolicies.concealKnowledgeBaseAuthorization,
  mapInput: ({ params, body }) => {
    const { workspaceId, retryProcessing, ...updates } = body
    return {
      knowledgeBaseId: params.id,
      documentId: params.documentId,
      assertedWorkspaceId: workspaceId,
      ...(retryProcessing ? { retryProcessing } : { updates }),
      source: 'api',
    }
  },
  useCase: updateKnowledgeDocument,
  present: (result) =>
    result.kind === 'processing'
      ? {
          data: {
            id: result.documentId,
            queued: true as const,
            processingStatus: result.status,
            message: result.message,
          },
        }
      : { data: toV2TaggedDocument(result.document, result.tagDefinitions) },
})

/** DELETE /api/v2/knowledge/[id]/documents/[documentId] — Delete a document. */
export const DELETE = defineV2JsonRoute({
  contract: v2DeleteKnowledgeDocumentContract,
  auth: v2ApiKeyAuth,
  operation: knowledgeOperations.deleteDocument,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2KnowledgeErrorPolicies.concealKnowledgeBaseAuthorization,
  mapInput: ({ params, query }) => ({
    knowledgeBaseId: params.id,
    documentId: params.documentId,
    assertedWorkspaceId: query.workspaceId,
    source: 'api',
  }),
  useCase: deleteKnowledgeDocument,
  onSuccess: ({ principal, input }) => {
    if (principal.kind === 'personal_api_key') {
      captureServerEvent(
        principal.userId,
        'knowledge_base_document_deleted',
        {
          knowledge_base_id: input.knowledgeBaseId,
          workspace_id: input.assertedWorkspaceId ?? '',
        },
        input.assertedWorkspaceId ? { groups: { workspace: input.assertedWorkspaceId } } : undefined
      )
    }
  },
  present: ({ id }) => ({ data: { id, deleted: true as const } }),
})
