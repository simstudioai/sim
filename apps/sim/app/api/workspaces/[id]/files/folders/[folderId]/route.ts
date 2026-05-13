import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { getPostgresErrorCode } from '@sim/utils/errors'
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
      captureServerEvent(
        session.user.id,
        'folder_renamed',
        { workspace_id: workspaceId },
        { groups: { workspace: workspaceId } }
      )
      recordAudit({
        workspaceId,
        actorId: session.user.id,
        actorName: session.user.name,
        actorEmail: session.user.email,
        action: AuditAction.FOLDER_UPDATED,
        resourceType: AuditResourceType.FOLDER,
        resourceId: folderId,
        resourceName: folder.name,
        description: `Updated folder "${folder.name}"`,
      })
      return NextResponse.json({ success: true, folder })
    } catch (error) {
      logger.error('Failed to update workspace file folder:', error)
      if (error instanceof WorkspaceFileFolderConflictError) {
        return NextResponse.json({ success: false, error: error.message }, { status: 409 })
      }
      if (getPostgresErrorCode(error) === '23505') {
        return NextResponse.json(
          {
            success: false,
            error: 'A folder with this name already exists in this location',
          },
          { status: 409 }
        )
      }
      return NextResponse.json(
        {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to update folder',
        },
        { status: 400 }
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
      captureServerEvent(
        session.user.id,
        'folder_deleted',
        { workspace_id: workspaceId },
        { groups: { workspace: workspaceId } }
      )
      recordAudit({
        workspaceId,
        actorId: session.user.id,
        actorName: session.user.name,
        actorEmail: session.user.email,
        action: AuditAction.FOLDER_DELETED,
        resourceType: AuditResourceType.FOLDER,
        resourceId: folderId,
        description: `Deleted folder`,
      })
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
