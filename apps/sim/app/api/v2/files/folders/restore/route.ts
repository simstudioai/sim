import { v2RestoreFileFolderContract } from '@/lib/api/contracts/v2/files'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2FileErrorPolicies } from '@/lib/workspace-files/api'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { restoreWorkspaceFileFolderOperation } from '@/lib/workspace-files/application/workspace-file-folders'
import { toWorkspaceFileFolderPathView } from '@/lib/workspace-files/folder-display-path'
export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * POST /api/v2/files/folders/restore — restore a soft-deleted folder tree.
 *
 * `DELETE /api/v2/files/folders` archives recursively, so without this a
 * recursive delete was unrecoverable over the API: the archived files stayed
 * visible through `GET /api/v2/files?scope=archived`, but nothing could put the
 * folder structure back.
 *
 * Path-addressed, matching the rest of the v2 folder family. Find the path with
 * `GET /api/v2/files/folders?scope=archived`.
 */
export const POST = defineV2JsonRoute({
  contract: v2RestoreFileFolderContract,
  auth: v2ApiKeyAuth,
  operation: fileOperations.restoreFolder,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2FileErrorPolicies.default,
  mapInput: ({ body }) => ({ workspaceId: body.workspaceId, path: body.path }),
  useCase: restoreWorkspaceFileFolderOperation,
  present: ({ folder, restoredItems }) => ({
    data: {
      folder: toWorkspaceFileFolderPathView(folder),
      restoredItems: { files: restoredItems.files, folders: restoredItems.folders },
    },
  }),
})
