import { NextRequest } from 'next/server'
import { createLogger } from '@/lib/logs/console-logger'
import { validateWorkflowAccess } from '../../middleware'
import { createErrorResponse, createSuccessResponse } from '../../utils'

const logger = createLogger('WorkflowStatusAPI')

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const { id } = await params

    const validation = await validateWorkflowAccess(request, id, false)
    if (validation.error) {
      logger.warn(`[${requestId}] Workflow access validation failed: ${validation.error.message}`)
      return createErrorResponse(validation.error.message, validation.error.status)
    }

    logger.info(`[${requestId}] Retrieved status for workflow: ${id}`, {
      isDeployed: validation.workflow.isDeployed,
    })

    return createSuccessResponse({
      isDeployed: validation.workflow.isDeployed,
      deployedAt: validation.workflow.deployedAt,
    })
  } catch (error) {
    logger.error(`[${requestId}] Error getting status for workflow: ${(await params).id}`, error)
    return createErrorResponse('Failed to get status', 500)
  }
}
