import { v2CompleteFileUploadContract } from '@/lib/api/contracts/v2/files'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { completeWorkspaceFileUploadOperation } from '@/lib/uploads/upload-session/application'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { toV2FileUpload, v2UploadControlError } from '@/app/api/v2/files/uploads/utils'

export const POST = defineV2JsonRoute({
  contract: v2CompleteFileUploadContract,
  auth: v2ApiKeyAuth,
  operation: fileOperations.uploadComplete,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: { render: v2UploadControlError },
  mapInput: ({ params, query, headers }) => ({
    uploadId: params.uploadId,
    workspaceId: query.workspaceId,
    uploadToken: headers['upload-token'],
  }),
  useCase: completeWorkspaceFileUploadOperation,
  present: async (result) => ({
    data: await toV2FileUpload(result.session, result.value),
  }),
})
