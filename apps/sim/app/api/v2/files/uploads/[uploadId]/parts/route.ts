import { v2CreateFileUploadPartUrlsContract } from '@/lib/api/contracts/v2/files'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { issueWorkspaceFileUploadPartsOperation } from '@/lib/uploads/upload-session/application'
import { v2FileErrorPolicies } from '@/lib/workspace-files/api'
import { fileOperations } from '@/lib/workspace-files/application/operations'

export const POST = defineV2JsonRoute({
  contract: v2CreateFileUploadPartUrlsContract,
  auth: v2ApiKeyAuth,
  operation: fileOperations.uploadParts,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2FileErrorPolicies.concealUploadAuthorization,
  mapInput: ({ params, query, headers, body }) => ({
    uploadId: params.uploadId,
    workspaceId: query.workspaceId,
    uploadToken: headers['upload-token'],
    partNumbers: body.partNumbers,
  }),
  useCase: issueWorkspaceFileUploadPartsOperation,
  present: ({ parts }) => ({ data: { parts } }),
})
