import { v2MoveFileItemsContract } from '@/lib/api/contracts/v2/files'
import { messageForOrchestrationError } from '@/lib/core/orchestration/types'
import { performMoveWorkspaceFileItems } from '@/lib/workspace-files/orchestration'
import { withPublicApiRouteHandler } from '@/app/api/public-api-route-handler'
import { resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import { v2Data, v2ErrorForOrchestration, v2WorkspaceAccessError } from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * POST /api/v2/files/move — Move files into a folder.
 *
 * An omitted `targetFolderPath` moves the selection to the
 * workspace root. The whole selection moves under one advisory lock, so a name
 * collision at the destination fails the request as `CONFLICT` rather than
 * partially applying.
 */
export const POST = withPublicApiRouteHandler({
  contract: v2MoveFileItemsContract,
  rateLimitEndpoint: 'file-move',
  handler: async ({ input, auth: { userId, rateLimit } }) => {
    const { workspaceId, fileIds, targetFolderPath } = input.body

    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'write')
    if (access) return v2WorkspaceAccessError(access)

    const result = await performMoveWorkspaceFileItems({
      workspaceId,
      userId,
      fileIds,
      targetFolderPath: targetFolderPath ?? '/',
    })

    if (!result.success || !result.movedItems) {
      return v2ErrorForOrchestration(
        result.errorCode,
        messageForOrchestrationError(result, 'Failed to move file items')
      )
    }

    return v2Data({ movedItems: { files: result.movedItems.files } }, { rateLimit })
  },
})
