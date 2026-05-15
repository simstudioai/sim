import { createLogger } from '@sim/logger'
import { assertFolderMutable, FolderLockedError, WorkflowLockedError } from '@sim/workflow-authz'
import { type NextRequest, NextResponse } from 'next/server'
import { restoreWorkflowContract } from '@/lib/api/contracts/workflows'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import { performRestoreWorkflow } from '@/lib/workflows/orchestration'
import { getWorkflowById } from '@/lib/workflows/utils'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('RestoreWorkflowAPI')

export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()
    const parsed = await parseRequest(restoreWorkflowContract, request, context)
    if (!parsed.success) return parsed.response
    const { id: workflowId } = parsed.data.params

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

      if (workflowData.locked) {
        throw new WorkflowLockedError('Workflow is locked')
      }
      await assertFolderMutable(workflowData.folderId)

      const result = await performRestoreWorkflow({
        workflowId,
        userId: auth.userId,
        requestId,
      })

      if (!result.success) {
        const status =
          result.errorCode === 'not_found' ? 404 : result.errorCode === 'validation' ? 400 : 500
        return NextResponse.json({ error: result.error }, { status })
      }

      logger.info(`[${requestId}] Restored workflow ${workflowId}`)

      captureServerEvent(
        auth.userId,
        'workflow_restored',
        { workflow_id: workflowId, workspace_id: workflowData.workspaceId ?? '' },
        workflowData.workspaceId ? { groups: { workspace: workflowData.workspaceId } } : undefined
      )

      return NextResponse.json({ success: true })
    } catch (error) {
      if (error instanceof WorkflowLockedError || error instanceof FolderLockedError) {
        return NextResponse.json({ error: error.message }, { status: error.status })
      }

      logger.error(`[${requestId}] Error restoring workflow ${workflowId}`, error)
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Internal server error' },
        { status: 500 }
      )
    }
  }
)
