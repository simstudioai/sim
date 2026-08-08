import { moveWorkspaceFileItemsContract } from '@/lib/api/contracts/workspace-file-folders'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { captureServerEvent } from '@/lib/posthog/server'
import { internalFileErrorPolicy } from '@/lib/workspace-files/api'
import { moveWorkspaceFileItemsOperation } from '@/lib/workspace-files/application/move-workspace-file-items'
import { fileOperations } from '@/lib/workspace-files/application/operations'

export const POST = defineInternalJsonRoute({
  contract: moveWorkspaceFileItemsContract,
  auth: internalSessionAuth,
  operation: fileOperations.move,
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing internal file move behavior' }),
  errorPolicy: internalFileErrorPolicy,
  mapInput: ({ params, body }) => ({
    workspaceId: params.id,
    fileIds: body.fileIds,
    folderIds: body.folderIds,
    targetFolderId: body.targetFolderId,
  }),
  useCase: moveWorkspaceFileItemsOperation,
  onSuccess: ({ principal, input }) => {
    if (input.fileIds && input.fileIds.length > 0) {
      captureServerEvent(
        principal.userId,
        'file_moved',
        {
          workspace_id: input.workspaceId,
          file_count: input.fileIds.length,
          folder_count: input.folderIds?.length ?? 0,
        },
        { groups: { workspace: input.workspaceId } }
      )
    }
    if (input.folderIds && input.folderIds.length > 0) {
      captureServerEvent(
        principal.userId,
        'folder_moved',
        {
          workspace_id: input.workspaceId,
          file_count: input.fileIds?.length ?? 0,
          folder_count: input.folderIds.length,
        },
        { groups: { workspace: input.workspaceId } }
      )
    }
  },
  present: ({ movedItems }) => ({ success: true, movedItems }),
})
