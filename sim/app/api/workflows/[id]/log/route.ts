import { NextRequest } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { createLogger } from '@/lib/logs/console-logger'
import { persistExecutionLogs, persistLog } from '@/lib/logs/execution-logger'
import { validateWorkflowAccess } from '../../middleware'
import { createErrorResponse, createSuccessResponse } from '../../utils'

const logger = createLogger('WorkflowLogAPI')

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const { id } = await params

  try {
    const validation = await validateWorkflowAccess(request, id, false)
    if (validation.error) {
      logger.warn(`[${requestId}] Workflow access validation failed: ${validation.error.message}`)
      return createErrorResponse(validation.error.message, validation.error.status)
    }

    const body = await request.json()
    const { logs, executionId, result } = body

    // If result is provided, use persistExecutionLogs for full tool call extraction
    if (result) {
      logger.info(`[${requestId}] Persisting execution result for workflow: ${id}`, {
        executionId,
        success: result.success,
      })

      // Use persistExecutionLogs which handles tool call extraction
      await persistExecutionLogs(id, executionId, result, 'manual')

      return createSuccessResponse({
        message: 'Execution logs persisted successfully',
      })
    }

    // Fall back to the original log format if 'result' isn't provided
    if (!logs || !Array.isArray(logs) || logs.length === 0) {
      logger.warn(`[${requestId}] No logs provided for workflow: ${id}`)
      return createErrorResponse('No logs provided', 400)
    }

    logger.info(`[${requestId}] Persisting ${logs.length} logs for workflow: ${id}`, {
      executionId,
    })

    // Persist each log using the original method
    for (const log of logs) {
      await persistLog({
        id: uuidv4(),
        workflowId: id,
        executionId,
        level: log.level,
        message: log.message,
        duration: log.duration,
        trigger: log.trigger || 'manual',
        createdAt: new Date(log.createdAt || new Date()),
        metadata: log.metadata,
      })
    }

    return createSuccessResponse({ message: 'Logs persisted successfully' })
  } catch (error: any) {
    logger.error(`[${requestId}] Error persisting logs for workflow: ${id}`, error)
    return createErrorResponse(error.message || 'Failed to persist logs', 500)
  }
}
