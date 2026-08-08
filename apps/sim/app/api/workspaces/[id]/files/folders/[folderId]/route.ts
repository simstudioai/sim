import {
  deleteWorkspaceFileFolderContract,
  updateWorkspaceFileFolderContract,
} from '@/lib/api/contracts/workspace-file-folders'
import {
  defineInternalJsonRoute,
  internalFileErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { captureServerEvent } from '@/lib/posthog/server'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import {
  deleteWorkspaceFileFolderOperation,
  updateWorkspaceFileFolderOperation,
} from '@/lib/workspace-files/application/workspace-file-folders'

export const PATCH = defineInternalJsonRoute({
  contract: updateWorkspaceFileFolderContract,
  auth: internalSessionAuth,
  operation: fileOperations.updateFolder,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal folder update behavior',
  }),
  errorPolicy: internalFileErrorPolicy,
  mapInput: ({ params, body }) => ({ workspaceId: params.id, folderId: params.folderId, ...body }),
  useCase: updateWorkspaceFileFolderOperation,
  onSuccess: ({ principal, input }) => {
    captureServerEvent(
      principal.userId,
      'folder_renamed',
      { workspace_id: input.workspaceId },
      { groups: { workspace: input.workspaceId } }
    )
  },
  present: ({ folder }) => ({ success: true, folder }),
})

export const DELETE = defineInternalJsonRoute({
  contract: deleteWorkspaceFileFolderContract,
  auth: internalSessionAuth,
  operation: fileOperations.deleteFolder,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal folder deletion behavior',
  }),
  errorPolicy: internalFileErrorPolicy,
  mapInput: ({ params }) => ({ workspaceId: params.id, folderId: params.folderId }),
  useCase: deleteWorkspaceFileFolderOperation,
  onSuccess: ({ principal, input }) => {
    captureServerEvent(
      principal.userId,
      'folder_deleted',
      { workspace_id: input.workspaceId },
      { groups: { workspace: input.workspaceId } }
    )
  },
  present: ({ deletedItems }) => ({ success: true, deletedItems }),
})
