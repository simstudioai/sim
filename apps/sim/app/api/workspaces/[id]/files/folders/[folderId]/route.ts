import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import {
  deleteWorkspaceFileFolderContract,
  updateWorkspaceFileFolderContract,
} from '@/lib/api/contracts/workspace-file-folders'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  archiveWorkspaceFileFolderRecursive,
  updateWorkspaceFileFolder,
  WorkspaceFileFolderConflictError,
} from '@/lib/uploads/contexts/workspace'
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
      const folder = await updateWorkspaceFileFolder({
        workspaceId,
        folderId,
        ...parsed.data.body,
      })
      return NextResponse.json({ success: true, folder })
    } catch (error) {
      logger.error('Failed to update workspace file folder:', error)
      const message = error instanceof Error ? error.message : 'Failed to update folder'
      return NextResponse.json(
        { success: false, error: message },
        { status: error instanceof WorkspaceFileFolderConflictError ? 409 : 400 }
      )
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
      const deletedItems = await archiveWorkspaceFileFolderRecursive(workspaceId, folderId)
      return NextResponse.json({ success: true, deletedItems })
    } catch (error) {
      logger.error('Failed to delete workspace file folder:', error)
      return NextResponse.json(
        {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to delete folder',
        },
        { status: 400 }
      )
    }
  }
)
