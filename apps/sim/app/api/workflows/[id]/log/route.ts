import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@/lib/logs/console/logger'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import { generateRequestId } from '@/lib/utils'
import { validateWorkflowAccess } from '@/app/api/workflows/middleware'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'
import type { ExecutionResult } from '@/executor/types'

const logger = createLogger('WorkflowLogAPI')

const postBodySchema = z.object({
  logs: z.array(z.any()).optional(),
  executionId: z.string().min(1, 'Execution ID is required').optional(),
  result: z
    .object({
      success: z.boolean(),
      error: z.string().optional(),
      output: z.any(),
      metadata: z
        .object({
          source: z.string().optional(),
          duration: z.number().optional(),
        })
        .optional(),
    })
    .optional(),
})

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()
  const { id } = await params

  try {
    const accessValidation = await validateWorkflowAccess(request, id, false)
    if (accessValidation.error) {
      logger.warn(
        `[${requestId}] Workflow access validation failed: ${accessValidation.error.message}`
      )
      return createErrorResponse(accessValidation.error.message, accessValidation.error.status)
    }

    const body = await request.json()
    const validation = postBodySchema.safeParse(body)

    if (!validation.success) {
      logger.warn(`[${requestId}] Invalid request body: ${validation.error.message}`)
      return createErrorResponse(validation.error.errors[0]?.message || 'Invalid request body', 400)
    }

    const { logs, executionId, result } = validation.data

    if (result) {
      if (!executionId) {
        logger.warn(`[${requestId}] Missing executionId for result logging`)
        return createErrorResponse('executionId is required when logging results', 400)
      }

      logger.info(`[${requestId}] Persisting execution result for workflow: ${id}`, {
        executionId,
        success: result.success,
      })

      const isChatExecution = result.metadata?.source === 'chat'

      const triggerType = isChatExecution ? 'chat' : 'manual'
      const loggingSession = new LoggingSession(id, executionId, triggerType, requestId)

      const userId = accessValidation.workflow.userId
      const workspaceId = accessValidation.workflow.workspaceId || ''

      await loggingSession.safeStart({
        userId,
        workspaceId,
        variables: {},
      })

      const resultWithOutput = {
        ...result,
        output: result.output ?? {},
      }

      const { traceSpans, totalDuration } = buildTraceSpans(resultWithOutput as ExecutionResult)

      if (result.success === false) {
        const message = result.error || 'Workflow execution failed'
        await loggingSession.safeCompleteWithError({
          endedAt: new Date().toISOString(),
          totalDurationMs: totalDuration || result.metadata?.duration || 0,
          error: { message },
          traceSpans,
        })
      } else {
        await loggingSession.safeComplete({
          endedAt: new Date().toISOString(),
          totalDurationMs: totalDuration || result.metadata?.duration || 0,
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
