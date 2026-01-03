import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { syncMcpToolsForWorkflow } from '@/lib/mcp/workflow-mcp-sync'
import { activateWorkflowVersion } from '@/lib/workflows/persistence/utils'
import { validateWorkflowPermissions } from '@/lib/workflows/utils'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('WorkflowActivateDeploymentAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; version: string }> }
) {
  const requestId = generateRequestId()
  const { id, version } = await params

  try {
    const { error } = await validateWorkflowPermissions(id, requestId, 'admin')
    if (error) {
      return createErrorResponse(error.message, error.status)
    }

    const versionNum = Number(version)
    if (!Number.isFinite(versionNum)) {
      return createErrorResponse('Invalid version number', 400)
    }

    const result = await activateWorkflowVersion({ workflowId: id, version: versionNum })
    if (!result.success) {
      return createErrorResponse(result.error || 'Failed to activate deployment', 400)
    }

    if (result.state) {
      await syncMcpToolsForWorkflow({
        workflowId: id,
        requestId,
        state: result.state,
        context: 'activate',
      })
    }

    return createSuccessResponse({ success: true, deployedAt: result.deployedAt })
  } catch (error: any) {
    logger.error(`[${requestId}] Error activating deployment for workflow: ${id}`, error)
    return createErrorResponse(error.message || 'Failed to activate deployment', 500)
  }
}
