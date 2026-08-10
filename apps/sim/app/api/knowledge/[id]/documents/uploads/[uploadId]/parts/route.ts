import { createKnowledgeDocumentUploadPartUrlsContract } from '@/lib/api/contracts/knowledge/upload-sessions'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalKnowledgeErrorPolicies } from '@/lib/knowledge/api/route-policies'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { issueKnowledgeDocumentUploadParts } from '@/lib/knowledge/application/upload-sessions'

export const POST = defineInternalJsonRoute({
  contract: createKnowledgeDocumentUploadPartUrlsContract,
  auth: internalSessionAuth,
  operation: knowledgeOperations.uploadParts,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal upload-part issuance behavior',
  }),
  errorPolicy: internalKnowledgeErrorPolicies.uploads,
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
