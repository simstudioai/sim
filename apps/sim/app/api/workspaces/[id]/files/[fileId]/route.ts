import {
  deleteWorkspaceFileContract,
  renameWorkspaceFileContract,
} from '@/lib/api/contracts/workspace-files'
import {
  defineInternalJsonRoute,
  internalJsonPresenters,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  internalFileAnalytics,
  internalFileErrorPolicies,
  internalFilePresenters,
} from '@/lib/workspace-files/api'
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
  errorPolicy: internalFileErrorPolicies.concealResourceAuthorization,
  mapInput: ({ params, body }) => ({
    fileId: params.fileId,
    assertedWorkspaceId: params.id,
    name: body.name,
  }),
  useCase: renameWorkspaceFile,
  onSuccess: internalFileAnalytics.renamed,
  present: internalFilePresenters.successFile,
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
  errorPolicy: internalFileErrorPolicies.concealResourceAuthorization,
  mapInput: ({ params }) => ({ fileId: params.fileId, assertedWorkspaceId: params.id }),
  useCase: deleteWorkspaceFileOperation,
  onSuccess: internalFileAnalytics.deleted,
  present: internalJsonPresenters.successFrom('deleted'),
})
