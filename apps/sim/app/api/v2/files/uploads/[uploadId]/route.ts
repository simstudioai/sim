import { v2AbortFileUploadContract, v2GetFileUploadContract } from '@/lib/api/contracts/v2/files'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import {
  abortWorkspaceFileUploadOperation,
  readWorkspaceFileUploadOperation,
} from '@/lib/uploads/upload-session/application'
import { v2FileErrorPolicies } from '@/lib/workspace-files/api'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { toV2FileUpload } from '@/app/api/v2/files/uploads/utils'

/**
 * GET /api/v2/files/uploads/[uploadId] — read an upload session's state.
 *
 * Lets a caller that lost track of a transfer ask whether the session is still
 * alive, already finalized, or failed, instead of only being able to abort it.
 * Runs on its own `read` operation rather than reusing the cancel operation, so
 * asking does not require permission to destroy.
 */
export const GET = defineV2JsonRoute({
  contract: v2GetFileUploadContract,
  auth: v2ApiKeyAuth,
  operation: fileOperations.uploadRead,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2FileErrorPolicies.concealUploadAuthorization,
  mapInput: ({ params, query, headers }) => ({
    uploadId: params.uploadId,
    workspaceId: query.workspaceId,
    uploadToken: headers['upload-token'],
  }),
  useCase: readWorkspaceFileUploadOperation,
  present: async (session) => ({ data: await toV2FileUpload(session, null) }),
})

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
