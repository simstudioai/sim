import { createKnowledgeDocumentUploadContract } from '@/lib/api/contracts/knowledge/upload-sessions'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { toInternalKnowledgeDocumentUpload } from '@/lib/knowledge/api/internal-route'
import { internalKnowledgeErrorPolicies } from '@/lib/knowledge/api/route-policies'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { createKnowledgeDocumentUpload } from '@/lib/knowledge/application/upload-sessions'

export const POST = defineInternalJsonRoute({
  contract: createKnowledgeDocumentUploadContract,
  auth: internalSessionAuth,
  operation: knowledgeOperations.uploadCreate,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal upload-session creation behavior',
  }),
  errorPolicy: internalKnowledgeErrorPolicies.uploads,
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
  present: (upload) => ({
    data: {
      session: toInternalKnowledgeDocumentUpload(upload, null),
      uploadToken: upload.uploadToken,
      transfer: upload.transfer,
    },
  }),
})
