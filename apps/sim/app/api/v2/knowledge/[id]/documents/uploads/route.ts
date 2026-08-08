import { v2CreateKnowledgeDocumentUploadContract } from '@/lib/api/contracts/v2/knowledge'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { createKnowledgeDocumentUpload } from '@/lib/knowledge/application/upload-sessions'
import {
  toV2KnowledgeDocumentUpload,
  v2KnowledgeDocumentUploadError,
} from '@/app/api/v2/knowledge/[id]/documents/uploads/utils'

export const POST = defineV2JsonRoute({
  contract: v2CreateKnowledgeDocumentUploadContract,
  auth: v2ApiKeyAuth,
  operation: knowledgeOperations.uploadCreate,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: { render: v2KnowledgeDocumentUploadError },
  mapInput: ({ params, body }) => {
    const { workspaceId, name, contentType, size, ...metadata } = body
    return {
      knowledgeBaseId: params.id,
      assertedWorkspaceId: workspaceId,
      name,
      contentType,
      size,
      metadata,
    }
  },
  useCase: createKnowledgeDocumentUpload,
  present: (session) => ({
    data: {
      session: toV2KnowledgeDocumentUpload(session, null),
      uploadToken: session.uploadToken,
      transfer: session.transfer,
    },
  }),
})
