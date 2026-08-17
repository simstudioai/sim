import {
  deleteWorkspaceFileContract,
  extractWorkspaceFileContract,
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
import { extractWorkspaceFile } from '@/lib/workspace-files/application/extract-workspace-file'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { renameWorkspaceFile } from '@/lib/workspace-files/application/rename-workspace-file'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * POST /api/workspaces/[id]/files/[fileId]
 * Unzip an archive file into a new folder beside it (requires write permission)
 */
export const POST = defineInternalJsonRoute({
  contract: extractWorkspaceFileContract,
  auth: internalSessionAuth,
  operation: fileOperations.extractArchive,
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing internal file behavior' }),
  errorPolicy: internalFileErrorPolicies.extractArchive,
  mapInput: ({ params }) => ({ fileId: params.fileId, assertedWorkspaceId: params.id }),
  useCase: extractWorkspaceFile,
  present: (result) => ({ success: true, ...result }),
})

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
