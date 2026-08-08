import { v2CreateFileUploadContract } from '@/lib/api/contracts/v2/files'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { ROOT_FOLDER_PATH } from '@/lib/folders/paths'
import { createWorkspaceFileUploadOperation } from '@/lib/uploads/upload-session/application'
import { v2FileErrorPolicies } from '@/lib/workspace-files/api'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { toV2FileUpload } from '@/app/api/v2/files/uploads/utils'

export const POST = defineV2JsonRoute({
  contract: v2CreateFileUploadContract,
  auth: v2ApiKeyAuth,
  operation: fileOperations.uploadCreate,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2FileErrorPolicies.default,
  mapInput: ({ body }) => ({
    workspaceId: body.workspaceId,
    name: body.name,
    contentType: body.contentType,
    size: body.size,
    folderPath: body.folderPath ?? ROOT_FOLDER_PATH,
  }),
  useCase: createWorkspaceFileUploadOperation,
  present: async (session) => ({
    data: {
      session: await toV2FileUpload(session, null),
      uploadToken: session.uploadToken,
      transfer: session.transfer,
    },
  }),
})
