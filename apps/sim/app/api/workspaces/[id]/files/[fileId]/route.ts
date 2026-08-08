import {
  deleteWorkspaceFileContract,
  renameWorkspaceFileContract,
} from '@/lib/api/contracts/workspace-files'
import {
  defineInternalJsonRoute,
  internalFileErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { captureServerEvent } from '@/lib/posthog/server'
import { deleteWorkspaceFileOperation } from '@/lib/workspace-files/application/delete-workspace-file'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { renameWorkspaceFile } from '@/lib/workspace-files/application/rename-workspace-file'

export const dynamic = 'force-dynamic'

/**
 * PATCH /api/workspaces/[id]/files/[fileId]
 * Rename a workspace file (requires write permission)
 */
export const PATCH = defineInternalJsonRoute({
  contract: renameWorkspaceFileContract,
  auth: internalSessionAuth,
  operation: fileOperations.rename,
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing internal rename behavior' }),
  errorPolicy: internalFileErrorPolicy,
  mapInput: ({ params, body }) => ({
    fileId: params.fileId,
    assertedWorkspaceId: params.id,
    name: body.name,
  }),
  useCase: renameWorkspaceFile,
  onSuccess: ({ principal, result }) => {
    captureServerEvent(
      principal.userId,
      'file_renamed',
      { workspace_id: result.file.workspaceId },
      { groups: { workspace: result.file.workspaceId } }
    )
  },
  present: ({ file }) => ({ success: true, file: { ...file, folderId: file.folderId ?? null } }),
})

/**
 * DELETE /api/workspaces/[id]/files/[fileId]
 * Archive a workspace file (requires write permission)
 */
export const DELETE = defineInternalJsonRoute({
  contract: deleteWorkspaceFileContract,
  auth: internalSessionAuth,
  operation: fileOperations.delete,
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing internal delete behavior' }),
  errorPolicy: internalFileErrorPolicy,
  mapInput: ({ params }) => ({ fileId: params.fileId, assertedWorkspaceId: params.id }),
  useCase: deleteWorkspaceFileOperation,
  onSuccess: ({ principal, result }) => {
    captureServerEvent(
      principal.userId,
      'file_deleted',
      { workspace_id: result.workspaceId },
      { groups: { workspace: result.workspaceId } }
    )
  },
  present: ({ deleted }) => ({ success: deleted }),
})
