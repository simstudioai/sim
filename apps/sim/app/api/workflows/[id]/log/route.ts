import { db } from '@sim/db'
import { workflowExecutionLogs } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { workflowLogContract } from '@/lib/api/contracts/workflows'
import { parseRequest } from '@/lib/api/server'
import {
  assertBillingAttributionSnapshot,
  type BillingAttributionSnapshot,
} from '@/lib/billing/core/billing-attribution'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import { validateWorkflowAccess } from '@/app/api/workflows/middleware'
import { createErrorResponse, createSuccessResponse } from '@/app/api/workflows/utils'
import type { ExecutionResult } from '@/executor/types'

const logger = createLogger('WorkflowLogAPI')

export const dynamic = 'force-dynamic'

export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const requestId = generateRequestId()
    const { id } = await context.params

    try {
      const accessValidation = await validateWorkflowAccess(request, id, false)
      if (accessValidation.error) {
        logger.warn(
          `[${requestId}] Workflow access validation failed: ${accessValidation.error.message}`
        )
        return createErrorResponse(accessValidation.error.message, accessValidation.error.status)
      }

      const parsed = await parseRequest(workflowLogContract, request, context)
      if (!parsed.success) return parsed.response

      const { logs, executionId, result } = parsed.data.body

      if (result) {
        if (!executionId) {
          logger.warn(`[${requestId}] Missing executionId for result logging`)
          return createErrorResponse('executionId is required when logging results', 400)
        }

        const [existingLog] = await db
          .select({
            workflowId: workflowExecutionLogs.workflowId,
            workspaceId: workflowExecutionLogs.workspaceId,
            executionData: workflowExecutionLogs.executionData,
          })
          .from(workflowExecutionLogs)
          .where(eq(workflowExecutionLogs.executionId, executionId))
          .limit(1)

        if (!existingLog) {
          logger.warn(`[${requestId}] No persisted start found for execution ${executionId}`)
          return createErrorResponse('Execution not found', 404)
        }

        if (existingLog.workflowId !== id) {
          logger.warn(
            `[${requestId}] executionId ${executionId} belongs to workflow ${existingLog.workflowId}, not ${id}`
          )
          return createErrorResponse('Execution not found', 404)
        }

        const storedBillingAttributionValue =
          existingLog.executionData &&
          typeof existingLog.executionData === 'object' &&
          'billingAttribution' in existingLog.executionData &&
          existingLog.executionData.billingAttribution
            ? existingLog.executionData.billingAttribution
            : undefined
        if (!storedBillingAttributionValue) {
          logger.error(
            `[${requestId}] Existing execution ${executionId} is missing immutable billing attribution`
          )
          return createErrorResponse('Execution billing attribution is unavailable', 500)
        }

        let billingAttribution: BillingAttributionSnapshot
        try {
          billingAttribution = assertBillingAttributionSnapshot(storedBillingAttributionValue)
        } catch (error) {
          logger.error(
            `[${requestId}] Existing execution ${executionId} has invalid immutable billing attribution`,
            { error }
          )
          return createErrorResponse('Execution billing attribution is unavailable', 500)
        }

        if (
          !existingLog.workspaceId ||
          billingAttribution.workspaceId !== existingLog.workspaceId
        ) {
          logger.error(
            `[${requestId}] Existing execution ${executionId} has inconsistent workspace attribution`
          )
          return createErrorResponse('Execution billing attribution is unavailable', 500)
        }

        const actorUserId = accessValidation.auth?.userId
        if (!actorUserId || actorUserId !== billingAttribution.actorUserId) {
          logger.warn(
            `[${requestId}] Authenticated actor does not match execution ${executionId} attribution`
          )
          return createErrorResponse('Execution is not authorized for this caller', 403)
        }

        logger.info(`[${requestId}] Persisting execution result for workflow: ${id}`, {
          executionId,
          success: result.success,
        })

        const isChatExecution = result.metadata?.source === 'chat'
        const triggerType = isChatExecution ? 'chat' : 'manual'
        const loggingSession = new LoggingSession(id, executionId, triggerType, requestId)

        await loggingSession.start({
          userId: actorUserId,
          actorUserId,
          billingAttribution,
          workspaceId: existingLog.workspaceId,
          variables: {},
          skipLogCreation: true,
        })

        const resultWithOutput = {
          ...result,
          output: result.output ?? {},
        }

        const { traceSpans, totalDuration } = buildTraceSpans(resultWithOutput as ExecutionResult)

        if (result.success === false) {
          const message = result.error || 'Workflow run failed'
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
          message: 'Run logs persisted successfully',
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
)
