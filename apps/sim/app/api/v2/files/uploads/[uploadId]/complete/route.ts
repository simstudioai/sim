import { v2CompleteFileUploadContract } from '@/lib/api/contracts/v2/files'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { completeWorkspaceFileUploadOperation } from '@/lib/uploads/upload-session/application'
import { v2FileErrorPolicies } from '@/lib/workspace-files/api'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { toV2FileUpload } from '@/app/api/v2/files/uploads/utils'

export const POST = defineV2JsonRoute({
  contract: v2CompleteFileUploadContract,
  auth: v2ApiKeyAuth,
  operation: fileOperations.uploadComplete,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2FileErrorPolicies.concealUploadAuthorization,
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
