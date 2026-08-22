import { moveWorkspaceFileItemsContract } from '@/lib/api/contracts/workspace-file-folders'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalFileAnalytics, internalFileErrorPolicies } from '@/lib/workspace-files/api'
import { moveWorkspaceFileItemsOperation } from '@/lib/workspace-files/application/move-workspace-file-items'
import { fileOperations } from '@/lib/workspace-files/application/operations'

export const POST = defineInternalJsonRoute({
  contract: moveWorkspaceFileItemsContract,
  auth: internalSessionAuth,
  operation: fileOperations.move,
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing internal file move behavior' }),
  errorPolicy: internalFileErrorPolicies.default,
  mapInput: ({ params, body }) => ({
    workspaceId: params.id,
    fileIds: body.fileIds,
    folderIds: body.folderIds,
    targetFolderId: body.targetFolderId,
  }),
  useCase: moveWorkspaceFileItemsOperation,
  onSuccess: internalFileAnalytics.moved,
  present: ({ movedItems }) => ({ success: true, movedItems }),
})
