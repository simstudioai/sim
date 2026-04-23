import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getTableById, restoreTable, TableConflictError } from '@/lib/table'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('RestoreTableAPI')

export const POST = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<{ tableId: string }> }) => {
    const requestId = generateRequestId()
    const { tableId } = await params

    try {
      const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
      if (!auth.success || !auth.userId) {
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
      }

      const table = await getTableById(tableId, { includeArchived: true })
      if (!table) {
        return NextResponse.json({ error: 'Table not found' }, { status: 404 })
      }

      const permission = await getUserEntityPermissions(auth.userId, 'workspace', table.workspaceId)
      if (permission !== 'admin' && permission !== 'write') {
        return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
      }

      await restoreTable(tableId, requestId)

      logger.info(`[${requestId}] Restored table ${tableId}`)

      recordAudit({
        workspaceId: table.workspaceId,
        actorId: auth.userId,
        actorName: auth.userName,
        actorEmail: auth.userEmail,
        action: AuditAction.TABLE_RESTORED,
        resourceType: AuditResourceType.TABLE,
        resourceId: tableId,
        resourceName: table.name,
        description: `Restored table "${table.name}"`,
        metadata: {
          tableName: table.name,
          workspaceId: table.workspaceId,
        },
        request,
      })

      return NextResponse.json({ success: true })
    } catch (error) {
      if (error instanceof TableConflictError) {
        return NextResponse.json({ error: error.message }, { status: 409 })
      }

      logger.error(`[${requestId}] Error restoring table ${tableId}`, error)
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Internal server error' },
        { status: 500 }
      )
    }
  }
)
