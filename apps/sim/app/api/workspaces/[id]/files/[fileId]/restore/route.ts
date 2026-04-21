import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { AuditAction, AuditResourceType, recordAudit } from '@/lib/audit/log'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { FileConflictError, restoreWorkspaceFile } from '@/lib/uploads/contexts/workspace'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('RestoreWorkspaceFileAPI')

export const POST = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string; fileId: string }> }) => {
    const requestId = generateRequestId()
    const { id: workspaceId, fileId } = await params

    try {
      const session = await getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const userPermission = await getUserEntityPermissions(
        session.user.id,
        'workspace',
        workspaceId
      )
      if (userPermission !== 'admin' && userPermission !== 'write') {
        return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
      }

      await restoreWorkspaceFile(workspaceId, fileId)

      logger.info(`[${requestId}] Restored workspace file ${fileId}`)

      recordAudit({
        workspaceId,
        actorId: session.user.id,
        actorName: session.user.name,
        actorEmail: session.user.email,
        action: AuditAction.FILE_RESTORED,
        resourceType: AuditResourceType.FILE,
        resourceId: fileId,
        resourceName: fileId,
        description: `Restored workspace file ${fileId}`,
        request,
      })

      return NextResponse.json({ success: true })
    } catch (error) {
      if (error instanceof FileConflictError) {
        return NextResponse.json({ error: error.message }, { status: 409 })
      }
      logger.error(`[${requestId}] Error restoring workspace file ${fileId}`, error)
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Internal server error' },
        { status: 500 }
      )
    }
  }
)
