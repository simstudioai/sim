import { abortKnowledgeDocumentUploadContract } from '@/lib/api/contracts/knowledge/upload-sessions'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { toInternalKnowledgeDocumentUpload } from '@/lib/knowledge/api/internal-route'
import { internalKnowledgeErrorPolicies } from '@/lib/knowledge/api/route-policies'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { cancelKnowledgeDocumentUpload } from '@/lib/knowledge/application/upload-sessions'

export const DELETE = defineInternalJsonRoute({
  contract: abortKnowledgeDocumentUploadContract,
  auth: internalSessionAuth,
  operation: knowledgeOperations.uploadCancel,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal upload-session cancellation behavior',
  }),
  errorPolicy: internalKnowledgeErrorPolicies.uploads,
  mapInput: ({ params, query, headers }) => ({
    knowledgeBaseId: params.id,
    assertedWorkspaceId: query.workspaceId,
    uploadId: params.uploadId,
    uploadToken: headers['upload-token'],
  }),
  useCase: cancelKnowledgeDocumentUpload,
  present: (session) => ({ data: toInternalKnowledgeDocumentUpload(session, null) }),
})
