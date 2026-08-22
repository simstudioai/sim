import { completeKnowledgeDocumentUploadContract } from '@/lib/api/contracts/knowledge/upload-sessions'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { PlatformEvents } from '@/lib/core/telemetry'
import { toInternalKnowledgeDocumentUpload } from '@/lib/knowledge/api/internal-route'
import { internalKnowledgeErrorPolicies } from '@/lib/knowledge/api/route-policies'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { completeKnowledgeDocumentUpload } from '@/lib/knowledge/application/upload-sessions'
import { captureServerEvent } from '@/lib/posthog/server'

export const POST = defineInternalJsonRoute({
  contract: completeKnowledgeDocumentUploadContract,
  auth: internalSessionAuth,
  operation: knowledgeOperations.uploadComplete,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal upload-session completion behavior',
  }),
  errorPolicy: internalKnowledgeErrorPolicies.uploads,
  mapInput: ({ params, query, headers }) => ({
    knowledgeBaseId: params.id,
    assertedWorkspaceId: query.workspaceId,
    uploadId: params.uploadId,
    uploadToken: headers['upload-token'],
    source: 'ui' as const,
  }),
  useCase: completeKnowledgeDocumentUpload,
  onSuccess: ({ principal, result }) => {
    if (!result.value.created) return
    captureServerEvent(
      principal.userId,
      'knowledge_base_document_uploaded',
      {
        knowledge_base_id: result.knowledgeBaseId,
        workspace_id: result.workspaceId,
        document_count: 1,
        upload_type: 'single',
      },
      {
        groups: { workspace: result.workspaceId },
        setOnce: { first_document_uploaded_at: new Date().toISOString() },
      }
    )
    PlatformEvents.knowledgeBaseDocumentsUploaded({
      knowledgeBaseId: result.knowledgeBaseId,
      documentsCount: 1,
      uploadType: 'single',
      mimeType: result.value.document.mimeType,
      fileSize: result.value.document.fileSize,
    })
  },
  present: (result) => ({
    data: toInternalKnowledgeDocumentUpload(result.session, result.value.document),
  }),
})
