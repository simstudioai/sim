import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { moveWorkspaceFileItemsContract } from '@/lib/api/contracts/workspace-file-folders'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  moveWorkspaceFileItems,
  WorkspaceFileMoveConflictError,
} from '@/lib/uploads/contexts/workspace'
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
      const moved = await moveWorkspaceFileItems({
        workspaceId,
        fileIds,
        folderIds,
        targetFolderId,
      })
      return NextResponse.json({
        success: true,
        movedItems: { files: moved.movedFiles, folders: moved.movedFolders },
      })
    } catch (error) {
      logger.error('Failed to move workspace file items:', error)
      return NextResponse.json(
        { success: false, error: error instanceof Error ? error.message : 'Failed to move items' },
        { status: error instanceof WorkspaceFileMoveConflictError ? 409 : 400 }
      )
    }
  }
)
