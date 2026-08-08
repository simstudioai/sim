import { v2CreateKnowledgeDocumentUploadPartUrlsContract } from '@/lib/api/contracts/v2/knowledge'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { issueKnowledgeDocumentUploadParts } from '@/lib/knowledge/application/upload-sessions'
import { v2KnowledgeDocumentUploadError } from '@/app/api/v2/knowledge/[id]/documents/uploads/utils'

export const POST = defineV2JsonRoute({
  contract: v2CreateKnowledgeDocumentUploadPartUrlsContract,
  auth: v2ApiKeyAuth,
  operation: knowledgeOperations.uploadParts,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: { render: v2KnowledgeDocumentUploadError },
  mapInput: ({ params, query, headers, body }) => ({
    knowledgeBaseId: params.id,
    assertedWorkspaceId: query.workspaceId,
    uploadId: params.uploadId,
    uploadToken: headers['upload-token'],
    partNumbers: body.partNumbers,
  }),
  useCase: issueKnowledgeDocumentUploadParts,
  present: ({ parts }) => ({ data: { parts } }),
})
