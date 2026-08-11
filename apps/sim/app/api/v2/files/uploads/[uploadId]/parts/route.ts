import { v2CreateFileUploadPartUrlsContract } from '@/lib/api/contracts/v2/files'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { issueWorkspaceFileUploadPartsOperation } from '@/lib/uploads/upload-session/application'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { v2UploadControlError } from '@/app/api/v2/files/uploads/utils'

export const POST = defineV2JsonRoute({
  contract: v2CreateFileUploadPartUrlsContract,
  auth: v2ApiKeyAuth,
  operation: fileOperations.uploadParts,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: { render: v2UploadControlError },
  mapInput: ({ params, query, headers, body }) => ({
    uploadId: params.uploadId,
    workspaceId: query.workspaceId,
    uploadToken: headers['upload-token'],
    partNumbers: body.partNumbers,
  }),
  useCase: issueWorkspaceFileUploadPartsOperation,
  present: ({ parts }) => ({ data: { parts } }),
})
