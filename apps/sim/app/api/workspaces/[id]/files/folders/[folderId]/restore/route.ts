import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { restoreWorkspaceFileFolderContract } from '@/lib/api/contracts/workspace-file-folders'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import { restoreWorkspaceFileFolder } from '@/lib/uploads/contexts/workspace'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('WorkspaceFileFolderRestoreAPI')

export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string; folderId: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(restoreWorkspaceFileFolderContract, request, context)
    if (!parsed.success) return parsed.response
    const { id: workspaceId, folderId } = parsed.data.params

    const permission = await getUserEntityPermissions(session.user.id, 'workspace', workspaceId)
    if (permission !== 'admin' && permission !== 'write') {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    try {
      const folder = await restoreWorkspaceFileFolder(workspaceId, folderId)

      logger.info(`Restored workspace file folder: ${folderId}`)

      captureServerEvent(
        session.user.id,
        'folder_restored',
        { folder_id: folderId, workspace_id: workspaceId },
        { groups: { workspace: workspaceId } }
      )
      recordAudit({
        workspaceId,
        actorId: session.user.id,
        actorName: session.user.name,
        actorEmail: session.user.email,
        action: AuditAction.FOLDER_RESTORED,
        resourceType: AuditResourceType.FOLDER,
        resourceId: folderId,
        resourceName: folder.name,
        description: `Restored folder "${folder.name}"`,
        request,
      })

      return NextResponse.json({ success: true, folder })
    } catch (error) {
      logger.error('Failed to restore workspace file folder:', error)
      return NextResponse.json(
        {
          success: false,
          error: toError(error).message,
        },
        { status: 400 }
      )
    }
  }
)
