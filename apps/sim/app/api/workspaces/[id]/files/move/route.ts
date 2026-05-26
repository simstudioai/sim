import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { moveWorkspaceFileItemsContract } from '@/lib/api/contracts/workspace-file-folders'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import { performMoveWorkspaceFileItems } from '@/lib/workspace-files/orchestration'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('WorkspaceFileMoveAPI')

export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(moveWorkspaceFileItemsContract, request, context)
    if (!parsed.success) return parsed.response
    const { id: workspaceId } = parsed.data.params
    const { fileIds, folderIds, targetFolderId } = parsed.data.body

    const permission = await getUserEntityPermissions(session.user.id, 'workspace', workspaceId)
    if (permission !== 'admin' && permission !== 'write') {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    try {
      const result = await performMoveWorkspaceFileItems({
        workspaceId,
        userId: session.user.id,
        fileIds,
        folderIds,
        targetFolderId,
      })
      if (!result.success || !result.movedItems) {
        return NextResponse.json(
          { success: false, error: result.error },
          {
            status:
              result.errorCode === 'conflict'
                ? 409
                : result.errorCode === 'not_found'
                  ? 404
                  : result.errorCode === 'validation'
                    ? 400
                    : 500,
          }
        )
      }
      if (fileIds.length > 0) {
        captureServerEvent(
          session.user.id,
          'file_moved',
          { workspace_id: workspaceId, file_count: fileIds.length, folder_count: folderIds.length },
          { groups: { workspace: workspaceId } }
        )
      }
      if (folderIds.length > 0) {
        captureServerEvent(
          session.user.id,
          'folder_moved',
          { workspace_id: workspaceId, file_count: fileIds.length, folder_count: folderIds.length },
          { groups: { workspace: workspaceId } }
        )
      }
      return NextResponse.json({
        success: true,
        movedItems: result.movedItems,
      })
    } catch (error) {
      logger.error('Failed to move workspace file items:', error)
      return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
    }
  }
)
