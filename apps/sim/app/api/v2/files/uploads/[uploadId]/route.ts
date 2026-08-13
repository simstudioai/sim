import { v2AbortFileUploadContract } from '@/lib/api/contracts/v2/files'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { abortWorkspaceFileUploadOperation } from '@/lib/uploads/upload-session/application'
import { v2FileErrorPolicies } from '@/lib/workspace-files/api'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { toV2FileUpload } from '@/app/api/v2/files/uploads/utils'

export const DELETE = defineV2JsonRoute({
  contract: v2AbortFileUploadContract,
  auth: v2ApiKeyAuth,
  operation: fileOperations.uploadCancel,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2FileErrorPolicies.concealUploadAuthorization,
  mapInput: ({ params, query, headers }) => ({
    uploadId: params.uploadId,
    workspaceId: query.workspaceId,
    uploadToken: headers['upload-token'],
  }),
  useCase: abortWorkspaceFileUploadOperation,
  present: async (session) => ({ data: await toV2FileUpload(session, null) }),
})
