import { bulkArchiveWorkspaceFileItemsContract } from '@/lib/api/contracts/workspace-file-folders'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { captureServerEvent } from '@/lib/posthog/server'
import { internalFileErrorPolicy } from '@/lib/workspace-files/api'
import { archiveWorkspaceFileItemsOperation } from '@/lib/workspace-files/application/archive-workspace-file-items'
import { fileOperations } from '@/lib/workspace-files/application/operations'

export const POST = defineInternalJsonRoute({
  contract: bulkArchiveWorkspaceFileItemsContract,
  auth: internalSessionAuth,
  operation: fileOperations.delete,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal bulk archive behavior',
  }),
  errorPolicy: internalFileErrorPolicy,
  mapInput: ({ params, body }) => ({
    workspaceId: params.id,
    fileIds: body.fileIds,
    folderIds: body.folderIds,
  }),
  useCase: archiveWorkspaceFileItemsOperation,
  onSuccess: ({ principal, input }) => {
    captureServerEvent(
      principal.userId,
      'file_bulk_deleted',
      {
        workspace_id: input.workspaceId,
        file_count: input.fileIds?.length ?? 0,
        folder_count: input.folderIds?.length ?? 0,
      },
      { groups: { workspace: input.workspaceId } }
    )
  },
  present: ({ deletedItems }) => ({ success: true, deletedItems }),
})
