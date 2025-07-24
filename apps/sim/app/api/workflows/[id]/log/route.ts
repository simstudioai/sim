import type { NextRequest } from 'next/server'
import { createLogger } from '@/lib/logs/console-logger'
import { EnhancedLoggingSession } from '@/lib/logs/enhanced-logging-session'
import { buildTraceSpans } from '@/lib/logs/trace-spans'
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

    // If result is provided, use enhanced logging system for full tool call extraction
    if (result) {
      logger.info(`[${requestId}] Persisting execution result for workflow: ${id}`, {
        executionId,
        success: result.success,
      })

      // Check if this execution is from chat using only the explicit source flag
      const isChatExecution = result.metadata?.source === 'chat'

      // Also log to enhanced system
      const triggerType = isChatExecution ? 'chat' : 'manual'
      const loggingSession = new EnhancedLoggingSession(id, executionId, triggerType, requestId)

      await loggingSession.safeStart({
        userId: '', // TODO: Get from session
        workspaceId: '', // TODO: Get from workflow
        variables: {},
      })

      // Build trace spans from execution logs
      const { traceSpans } = buildTraceSpans(result)

      await loggingSession.safeComplete({
        endedAt: new Date().toISOString(),
        totalDurationMs: result.metadata?.duration || 0,
        finalOutput: result.output || {},
        traceSpans,
      })

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

    return createSuccessResponse({ message: 'Logs persisted successfully' })
  } catch (error: any) {
    logger.error(`[${requestId}] Error persisting logs for workflow: ${id}`, error)
    return createErrorResponse(error.message || 'Failed to persist logs', 500)
  }
}
