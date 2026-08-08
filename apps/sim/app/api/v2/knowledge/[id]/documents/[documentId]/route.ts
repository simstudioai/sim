import {
  v2DeleteKnowledgeDocumentContract,
  v2GetKnowledgeDocumentContract,
} from '@/lib/api/contracts/v2/knowledge'
import {
  defineV2JsonRoute,
  type V2ErrorPolicy,
  v2ApiKeyAuth,
  v2OrchestrationErrorPolicy,
  v2RateLimits,
} from '@/lib/api/server/routes'
import {
  deleteKnowledgeDocument,
  readKnowledgeDocument,
} from '@/lib/knowledge/application/documents'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { captureServerEvent } from '@/lib/posthog/server'
import { serializeDate } from '@/app/api/v1/knowledge/utils'
import { v2Error } from '@/app/api/v2/lib/response'

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

const concealKnowledgeDocumentReadAuthorization = {
  render(error) {
    const response = v2OrchestrationErrorPolicy.render(error)
    if (response?.status === 403) return v2Error('NOT_FOUND', 'Knowledge base not found')
    return response
  },
} satisfies V2ErrorPolicy

/** GET /api/v2/knowledge/[id]/documents/[documentId] — Get document details. */
export const GET = defineV2JsonRoute({
  contract: v2GetKnowledgeDocumentContract,
  auth: v2ApiKeyAuth,
  operation: knowledgeOperations.readDocument,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: concealKnowledgeDocumentReadAuthorization,
  mapInput: ({ params, query }) => ({
    knowledgeBaseId: params.id,
    documentId: params.documentId,
    assertedWorkspaceId: query.workspaceId,
  }),
  useCase: readKnowledgeDocument,
  present: ({ document }) => ({
    data: {
      document: {
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
      },
    },
  }),
})

/** DELETE /api/v2/knowledge/[id]/documents/[documentId] — Delete a document. */
export const DELETE = defineV2JsonRoute({
  contract: v2DeleteKnowledgeDocumentContract,
  auth: v2ApiKeyAuth,
  operation: knowledgeOperations.deleteDocument,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
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
