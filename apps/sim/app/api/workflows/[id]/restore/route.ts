import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import { restoreWorkflow } from '@/lib/workflows/lifecycle'
import { getWorkflowById } from '@/lib/workflows/utils'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('RestoreWorkflowAPI')

export const POST = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()
    const { id: workflowId } = await params

    try {
      const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
      if (!auth.success || !auth.userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const workflowData = await getWorkflowById(workflowId, { includeArchived: true })
      if (!workflowData) {
        return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
      }

      if (workflowData.workspaceId) {
        const permission = await getUserEntityPermissions(
          auth.userId,
          'workspace',
          workflowData.workspaceId
        )
        if (permission !== 'admin' && permission !== 'write') {
          return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
        }
      } else if (workflowData.userId !== auth.userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const result = await restoreWorkflow(workflowId, { requestId })

      if (!result.restored) {
        return NextResponse.json({ error: 'Workflow is not archived' }, { status: 400 })
      }

      logger.info(`[${requestId}] Restored workflow ${workflowId}`)

      recordAudit({
        workspaceId: workflowData.workspaceId,
        actorId: auth.userId,
        actorName: auth.userName,
        actorEmail: auth.userEmail,
        action: AuditAction.WORKFLOW_RESTORED,
        resourceType: AuditResourceType.WORKFLOW,
        resourceId: workflowId,
        resourceName: workflowData.name,
        description: `Restored workflow "${workflowData.name}"`,
        metadata: {
          workflowName: workflowData.name,
          workspaceId: workflowData.workspaceId || undefined,
        },
        request,
      })

      captureServerEvent(
        auth.userId,
        'workflow_restored',
        { workflow_id: workflowId, workspace_id: workflowData.workspaceId ?? '' },
        workflowData.workspaceId ? { groups: { workspace: workflowData.workspaceId } } : undefined
      )

      return NextResponse.json({ success: true })
    } catch (error) {
      logger.error(`[${requestId}] Error restoring workflow ${workflowId}`, error)
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Internal server error' },
        { status: 500 }
      )
    }
  }
)
