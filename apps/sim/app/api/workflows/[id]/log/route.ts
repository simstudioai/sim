import type { NextRequest } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import { generateRequestId } from '@/lib/utils'
import { validateWorkflowAccess } from '@/app/api/workflows/middleware'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'

const logger = createLogger('WorkflowLogAPI')

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  const { id } = await params

  try {
    const validation = await validateWorkflowAccess(request, id, false)
    if (validation.error) {
      logger.warn(`[${requestId}] Workflow access validation failed: ${validation.error.message}`)
      return createErrorResponse(validation.error.message, validation.error.status)
    }

    const body = await request.json()
    const { logs, executionId, result } = body

    if (result) {
      logger.info(`[${requestId}] Persisting execution result for workflow: ${id}`, {
        executionId,
        success: result.success,
      })

      const isChatExecution = result.metadata?.source === 'chat'

      const triggerType = isChatExecution ? 'chat' : 'manual'
      const loggingSession = new LoggingSession(id, executionId, triggerType, requestId)

      const userId = validation.workflow.userId
      const workspaceId = validation.workflow.workspaceId || ''

      await loggingSession.safeStart({
        userId,
        workspaceId,
        variables: {},
      })

      const { traceSpans } = buildTraceSpans(result)

      if (result.success === false) {
        const message = result.error || 'Workflow execution failed'
        await loggingSession.safeCompleteWithError({
          endedAt: new Date().toISOString(),
          totalDurationMs: result.metadata?.duration || 0,
          error: { message },
          traceSpans,
        })
      } else {
        await loggingSession.safeComplete({
          endedAt: new Date().toISOString(),
          totalDurationMs: result.metadata?.duration || 0,
          finalOutput: result.output || {},
          traceSpans,
        })
      }

      return createSuccessResponse({
        message: 'Execution logs persisted successfully',
      })
    }

    if (!logs || !Array.isArray(logs) || logs.length === 0) {
      logger.warn(`[${requestId}] No logs provided for workflow: ${id}`)
      return createErrorResponse('No logs provided', 400)
    }

    logger.info(`[${requestId}] Persisting ${logs.length} logs for workflow: ${id}`, {
      executionId,
    })

    return createSuccessResponse({ message: 'Logs persisted successfully' })
  } catch (error: any) {
    logger.error(`[${requestId}] Error persisting logs for workflow: ${id}`, error)
    return createErrorResponse(error.message || 'Failed to persist logs', 500)
  }
}
