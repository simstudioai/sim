import { createLogger } from '@sim/logger'
import { authorizeWorkflowByWorkspacePermission } from '@sim/platform-authz/workflow'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { cancelWorkflowExecutionContract } from '@/lib/api/contracts/workflows'
import { parseRequest } from '@/lib/api/server'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  cancelWorkflowExecution,
  WorkflowExecutionNotFoundError,
} from '@/lib/execution/cancel-workflow-execution'

const logger = createLogger('CancelExecutionAPI')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = withRouteHandler(
  async (req: NextRequest, context: { params: Promise<{ id: string; executionId: string }> }) => {
    const parsed = await parseRequest(cancelWorkflowExecutionContract, req, context)
    if (!parsed.success) return parsed.response
    const { id: workflowId, executionId } = parsed.data.params

    try {
      const auth = await checkHybridAuth(req, { requireWorkflowId: false })
      if (!auth.success || !auth.userId) {
        return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
      }

      const workflowAuthorization = await authorizeWorkflowByWorkspacePermission({
        workflowId,
        userId: auth.userId,
        action: 'write',
      })
      if (!workflowAuthorization.allowed) {
        return NextResponse.json(
          { error: workflowAuthorization.message || 'Access denied' },
          { status: workflowAuthorization.status }
        )
      }

      if (
        auth.apiKeyType === 'workspace' &&
        workflowAuthorization.workflow?.workspaceId !== auth.workspaceId
      ) {
        return NextResponse.json(
          { error: 'API key is not authorized for this workspace' },
          { status: 403 }
        )
      }

      logger.info('Cancel execution requested', { workflowId, executionId, userId: auth.userId })

      const result = await cancelWorkflowExecution({
        executionId,
        workflowId,
        userId: auth.userId,
        workspaceId: workflowAuthorization.workflow?.workspaceId ?? undefined,
      })

      return NextResponse.json(result)
    } catch (error) {
      if (error instanceof WorkflowExecutionNotFoundError) {
        return NextResponse.json({ error: error.message }, { status: 404 })
      }
      logger.error('Failed to cancel execution', {
        workflowId,
        executionId,
        error: toError(error).message,
      })
      return NextResponse.json(
        { error: toError(error).message || 'Failed to cancel execution' },
        { status: 500 }
      )
    }
  }
)
