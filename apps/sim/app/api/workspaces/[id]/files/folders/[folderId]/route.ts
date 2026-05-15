import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import {
  deleteWorkspaceFileFolderContract,
  updateWorkspaceFileFolderContract,
} from '@/lib/api/contracts/workspace-file-folders'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import {
  performDeleteWorkspaceFileItems,
  performUpdateWorkspaceFileFolder,
  workspaceFilesOrchestrationStatus,
} from '@/lib/workspace-files/orchestration'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('WorkspaceFileFolderAPI')

async function assertWritePermission(userId: string, workspaceId: string) {
  const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
  return permission === 'admin' || permission === 'write'
}

export const PATCH = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string; folderId: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(updateWorkspaceFileFolderContract, request, context)
    if (!parsed.success) return parsed.response
    const { id: workspaceId, folderId } = parsed.data.params

    if (!(await assertWritePermission(session.user.id, workspaceId))) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    try {
      const result = await performUpdateWorkspaceFileFolder({
        workspaceId,
        folderId,
        userId: session.user.id,
        ...parsed.data.body,
      })
      if (!result.success || !result.folder) {
        return NextResponse.json(
          { success: false, error: result.error },
          { status: workspaceFilesOrchestrationStatus(result.errorCode) }
        )
      }
      captureServerEvent(
        session.user.id,
        'folder_renamed',
        { workspace_id: workspaceId },
        { groups: { workspace: workspaceId } }
      )
      return NextResponse.json({ success: true, folder: result.folder })
    } catch (error) {
      logger.error('Failed to update workspace file folder:', error)
      return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
    }
  }
)

export const DELETE = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string; folderId: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(deleteWorkspaceFileFolderContract, request, context)
    if (!parsed.success) return parsed.response
    const { id: workspaceId, folderId } = parsed.data.params

    if (!(await assertWritePermission(session.user.id, workspaceId))) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    try {
      const result = await performDeleteWorkspaceFileItems({
        workspaceId,
        userId: session.user.id,
        folderIds: [folderId],
      })
      if (!result.success) {
        return NextResponse.json(
          { success: false, error: result.error },
          {
            status:
              result.errorCode === 'validation'
                ? 400
                : result.errorCode === 'not_found'
                  ? 404
                  : 500,
          }
        )
      }
      if (!result.deletedItems) {
        return NextResponse.json(
          { success: false, error: 'Failed to delete workspace file folder' },
          { status: 500 }
        )
      }

      captureServerEvent(
        session.user.id,
        'folder_deleted',
        { workspace_id: workspaceId },
        { groups: { workspace: workspaceId } }
      )

      return NextResponse.json({ success: true, deletedItems: result.deletedItems })
    } catch (error) {
      logger.error('Failed to delete workspace file folder:', error)
      return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
    }
  }
)
