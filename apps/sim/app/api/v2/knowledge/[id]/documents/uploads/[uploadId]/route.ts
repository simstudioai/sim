import { v2AbortKnowledgeDocumentUploadContract } from '@/lib/api/contracts/v2/knowledge'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { cancelKnowledgeDocumentUpload } from '@/lib/knowledge/application/upload-sessions'
import {
  toV2KnowledgeDocumentUpload,
  v2KnowledgeDocumentUploadError,
} from '@/app/api/v2/knowledge/[id]/documents/uploads/utils'

export const DELETE = defineV2JsonRoute({
  contract: v2AbortKnowledgeDocumentUploadContract,
  auth: v2ApiKeyAuth,
  operation: knowledgeOperations.uploadCancel,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: { render: v2KnowledgeDocumentUploadError },
  mapInput: ({ params, query, headers }) => ({
    knowledgeBaseId: params.id,
    assertedWorkspaceId: query.workspaceId,
    uploadId: params.uploadId,
    uploadToken: headers['upload-token'],
  }),
  useCase: cancelKnowledgeDocumentUpload,
  present: (session) => ({ data: toV2KnowledgeDocumentUpload(session, null) }),
})
