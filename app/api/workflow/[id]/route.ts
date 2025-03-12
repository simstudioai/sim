import { NextRequest } from 'next/server'
import { createLogger } from '@/lib/logs/console-logger'
import { Executor } from '@/executor'
import { SerializedWorkflow } from '@/serializer/types'
import { validateWorkflowAccess } from '../middleware'
import { createErrorResponse, createSuccessResponse } from '../utils'

const logger = createLogger('WorkflowAPI')

export const dynamic = 'force-dynamic'

async function executeWorkflow(workflow: any, requestId: string, input?: any) {
  try {
    logger.info(`[${requestId}] Executing workflow: ${workflow.id}`)
    const executor = new Executor(workflow.state as SerializedWorkflow, input)
    const result = await executor.execute(workflow.id)

    logger.info(`[${requestId}] Workflow execution completed: ${workflow.id}`, {
      success: result.success,
    })

    return result
  } catch (error: any) {
    logger.error(`[${requestId}] Workflow execution failed: ${workflow.id}`, error)
    throw new Error(`Execution failed: ${error.message}`)
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const { id } = await params
    logger.debug(`[${requestId}] GET request for workflow: ${id}`)

    const validation = await validateWorkflowAccess(request, id)

    if (validation.error) {
      logger.warn(`[${requestId}] Workflow access validation failed: ${validation.error.message}`)
      return createErrorResponse(validation.error.message, validation.error.status)
    }

    const result = await executeWorkflow(validation.workflow, requestId)
    return createSuccessResponse(result)
  } catch (error: any) {
    logger.error(`[${requestId}] Error executing workflow: ${(await params).id}`, error)
    return createErrorResponse('Failed to execute workflow', 500, 'EXECUTION_ERROR')
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const { id } = await params
    logger.debug(`[${requestId}] POST request for workflow: ${id}`)

    const validation = await validateWorkflowAccess(request, id)

    if (validation.error) {
      logger.warn(`[${requestId}] Workflow access validation failed: ${validation.error.message}`)
      return createErrorResponse(validation.error.message, validation.error.status)
    }

    const body = await request.json().catch(() => ({}))
    const result = await executeWorkflow(validation.workflow, requestId, body)
    return createSuccessResponse(result)
  } catch (error: any) {
    logger.error(`[${requestId}] Error executing workflow: ${(await params).id}`, error)
    return createErrorResponse('Failed to execute workflow', 500, 'EXECUTION_ERROR')
  }
}
