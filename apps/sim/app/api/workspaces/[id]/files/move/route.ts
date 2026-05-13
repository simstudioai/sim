import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { moveWorkspaceFileItemsContract } from '@/lib/api/contracts/workspace-file-folders'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import {
  moveWorkspaceFileItems,
  WorkspaceFileFolderConflictError,
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
      if (fileIds.length > 0) {
        recordAudit({
          workspaceId,
          actorId: session.user.id,
          actorName: session.user.name,
          actorEmail: session.user.email,
          action: AuditAction.FILE_MOVED,
          resourceType: AuditResourceType.FILE,
          description: `Moved ${fileIds.length} file${fileIds.length === 1 ? '' : 's'}${targetFolderId ? ' to folder' : ' to root'}`,
          metadata: { fileIds, targetFolderId },
        })
      }
      if (folderIds.length > 0) {
        recordAudit({
          workspaceId,
          actorId: session.user.id,
          actorName: session.user.name,
          actorEmail: session.user.email,
          action: AuditAction.FOLDER_MOVED,
          resourceType: AuditResourceType.FOLDER,
          description: `Moved ${folderIds.length} folder${folderIds.length === 1 ? '' : 's'}${targetFolderId ? ' to folder' : ' to root'}`,
          metadata: { folderIds, targetFolderId },
        })
      }
      return NextResponse.json({
        success: true,
        movedItems: { files: moved.movedFiles, folders: moved.movedFolders },
      })
    } catch (error) {
      logger.error('Failed to move workspace file items:', error)
      if (
        error instanceof WorkspaceFileMoveConflictError ||
        error instanceof WorkspaceFileFolderConflictError
      ) {
        return NextResponse.json({ success: false, error: error.message }, { status: 409 })
      }
      if (getPostgresErrorCode(error) === '23505') {
        return NextResponse.json(
          {
            success: false,
            error: 'A file or folder with this name already exists in the destination folder',
          },
          { status: 409 }
        )
      }
      return NextResponse.json(
        { success: false, error: error instanceof Error ? error.message : 'Failed to move items' },
        { status: 400 }
      )
    }
  }
)
