import { restoreWorkspaceFileFolderContract } from '@/lib/api/contracts/workspace-file-folders'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { captureServerEvent } from '@/lib/posthog/server'
import { internalFileErrorPolicy } from '@/lib/workspace-files/api'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { restoreWorkspaceFileFolderOperation } from '@/lib/workspace-files/application/workspace-file-folders'

export const POST = defineInternalJsonRoute({
  contract: restoreWorkspaceFileFolderContract,
  auth: internalSessionAuth,
  operation: fileOperations.restoreFolder,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing internal folder restore behavior',
  }),
  errorPolicy: internalFileErrorPolicy,
  mapInput: ({ params }) => ({ workspaceId: params.id, folderId: params.folderId }),
  useCase: restoreWorkspaceFileFolderOperation,
  onSuccess: ({ principal, input }) => {
    captureServerEvent(
      principal.userId,
      'folder_restored',
      { folder_id: input.folderId, workspace_id: input.workspaceId },
      { groups: { workspace: input.workspaceId } }
    )
  },
  present: ({ folder, restoredItems }) => ({ success: true, folder, restoredItems }),
})
