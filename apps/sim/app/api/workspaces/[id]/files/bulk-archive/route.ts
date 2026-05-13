import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { bulkArchiveWorkspaceFileItemsContract } from '@/lib/api/contracts/workspace-file-folders'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import { bulkArchiveWorkspaceFileItems } from '@/lib/uploads/contexts/workspace'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('WorkspaceFileBulkArchiveAPI')

export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(bulkArchiveWorkspaceFileItemsContract, request, context)
    if (!parsed.success) return parsed.response
    const { id: workspaceId } = parsed.data.params
    const { fileIds, folderIds } = parsed.data.body

    const permission = await getUserEntityPermissions(session.user.id, 'workspace', workspaceId)
    if (permission !== 'admin' && permission !== 'write') {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    try {
      const deletedItems = await bulkArchiveWorkspaceFileItems({ workspaceId, fileIds, folderIds })
      captureServerEvent(
        session.user.id,
        'file_bulk_deleted',
        { workspace_id: workspaceId, file_count: fileIds.length, folder_count: folderIds.length },
        { groups: { workspace: workspaceId } }
      )
      if (fileIds.length > 0) {
        recordAudit({
          workspaceId,
          actorId: session.user.id,
          actorName: session.user.name,
          actorEmail: session.user.email,
          action: AuditAction.FILE_DELETED,
          resourceType: AuditResourceType.FILE,
          description: `Deleted ${fileIds.length} file${fileIds.length === 1 ? '' : 's'}`,
          metadata: { fileIds },
        })
      }
      if (folderIds.length > 0) {
        recordAudit({
          workspaceId,
          actorId: session.user.id,
          actorName: session.user.name,
          actorEmail: session.user.email,
          action: AuditAction.FOLDER_DELETED,
          resourceType: AuditResourceType.FOLDER,
          description: `Deleted ${folderIds.length} folder${folderIds.length === 1 ? '' : 's'}`,
          metadata: { folderIds },
        })
      }
      return NextResponse.json({ success: true, deletedItems })
    } catch (error) {
      logger.error('Failed to bulk archive workspace file items:', error)
      return NextResponse.json(
        {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to archive items',
        },
        { status: 400 }
      )
    }
  }
)
