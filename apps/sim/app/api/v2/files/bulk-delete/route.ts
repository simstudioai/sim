import { v2BulkDeleteFilesContract } from '@/lib/api/contracts/v2/files'
import { messageForOrchestrationError } from '@/lib/core/orchestration/types'
import { performDeleteWorkspaceFileItems } from '@/lib/workspace-files/orchestration'
import { withPublicApiRouteHandler } from '@/app/api/public-api-route-handler'
import { resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import { v2Data, v2ErrorForOrchestration, v2WorkspaceAccessError } from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * POST /api/v2/files/bulk-delete — Delete files. Folder deletion is owned by
 * `/api/v2/files/folders` so this resource operation never accepts folder ids.
 */
export const POST = withPublicApiRouteHandler({
  contract: v2BulkDeleteFilesContract,
  rateLimitEndpoint: 'file-bulk-delete',
  handler: async ({ request, input, auth: { userId, rateLimit } }) => {
    const { workspaceId, fileIds } = input.body

    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'write')
    if (access) return v2WorkspaceAccessError(access)

    const result = await performDeleteWorkspaceFileItems({
      workspaceId,
      userId,
      fileIds,
      request,
    })

    if (!result.success || !result.deletedItems) {
      return v2ErrorForOrchestration(
        result.errorCode,
        messageForOrchestrationError(result, 'Failed to delete files')
      )
    }

    return v2Data({ deletedItems: { files: result.deletedItems.files } }, { rateLimit })
  },
})
