import { isUserCredentialPrincipal } from '@sim/auth/principal'
import { v2CompleteKnowledgeDocumentUploadContract } from '@/lib/api/contracts/v2/knowledge'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { PlatformEvents } from '@/lib/core/telemetry'
import { v2KnowledgeErrorPolicies } from '@/lib/knowledge/api/route-policies'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { completeKnowledgeDocumentUpload } from '@/lib/knowledge/application/upload-sessions'
import { captureServerEvent } from '@/lib/posthog/server'
import { toV2KnowledgeDocumentUpload } from '@/app/api/v2/knowledge/[knowledgeBaseId]/documents/uploads/utils'

export const POST = defineV2JsonRoute({
  contract: v2CompleteKnowledgeDocumentUploadContract,
  auth: v2ApiKeyAuth,
  operation: knowledgeOperations.uploadComplete,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2KnowledgeErrorPolicies.concealKnowledgeBaseUploadAuthorization,
  mapInput: ({ params, query, headers }) => ({
    knowledgeBaseId: params.knowledgeBaseId,
    assertedWorkspaceId: query.workspaceId,
    uploadId: params.uploadId,
    uploadToken: headers['upload-token'],
    source: 'api' as const,
  }),
  useCase: completeKnowledgeDocumentUpload,
  onSuccess: ({ principal, result }) => {
    if (result.value.created && isUserCredentialPrincipal(principal)) {
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
    }
    if (result.value.created) {
      PlatformEvents.knowledgeBaseDocumentsUploaded({
        knowledgeBaseId: result.knowledgeBaseId,
        documentsCount: 1,
        uploadType: 'single',
        mimeType: result.value.document.mimeType,
        fileSize: result.value.document.fileSize,
      })
    }
  },
  present: (result) => ({
    data: toV2KnowledgeDocumentUpload(result.session, result.value.document),
  }),
})
