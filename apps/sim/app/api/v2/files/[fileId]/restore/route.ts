import { v2RestoreFileContract } from '@/lib/api/contracts/v2/files'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2FileErrorPolicies } from '@/lib/workspace-files/api'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { restoreWorkspaceFileOperation } from '@/lib/workspace-files/application/restore-workspace-file'
import { toV2File } from '@/app/api/v2/files/utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * POST /api/v2/files/[fileId]/restore — Bring an archived file back.
 *
 * `DELETE /api/v2/files/[fileId]` is a soft delete; this reverses it. Find the
 * ids to pass here with `GET /api/v2/files?scope=archived`.
 *
 * Restore is not a pure undo: the file returns to the folder it was deleted
 * from while that folder is still active, and to the workspace root once the
 * folder has been archived; it is renamed when its original name is no longer
 * free there. The response is therefore the post-restore record, not the one
 * the caller deleted. Restoring an already-active file is a no-op that returns
 * that file, so a retried request is safe.
 */
export const POST = defineV2JsonRoute({
  contract: v2RestoreFileContract,
  auth: v2ApiKeyAuth,
  operation: fileOperations.restore,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2FileErrorPolicies.concealResourceAuthorization,
  mapInput: ({ params, body }) => ({
    fileId: params.fileId,
    assertedWorkspaceId: body.workspaceId,
  }),
  useCase: restoreWorkspaceFileOperation,
  present: async ({ file }) => ({ data: await toV2File(file) }),
})
