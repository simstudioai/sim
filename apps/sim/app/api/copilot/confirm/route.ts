import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  ASYNC_TOOL_CONFIRMATION_STATUS,
  ASYNC_TOOL_STATUS,
  type AsyncCompletionData,
  type AsyncConfirmationStatus,
} from '@/lib/copilot/async-runs/lifecycle'
import {
  completeAsyncToolCall,
  getAsyncToolCall,
  getRunSegment,
  upsertAsyncToolCall,
} from '@/lib/copilot/async-runs/repository'
import { CopilotConfirmOutcome } from '@/lib/copilot/generated/trace-attribute-values-v1'
import { TraceAttr } from '@/lib/copilot/generated/trace-attributes-v1'
import { TraceSpan } from '@/lib/copilot/generated/trace-spans-v1'
import { publishToolConfirmation } from '@/lib/copilot/persistence/tool-confirm'
import {
  authenticateCopilotRequestSessionOnly,
  createBadRequestResponse,
  createInternalServerErrorResponse,
  createNotFoundResponse,
  createRequestTracker,
  createUnauthorizedResponse,
} from '@/lib/copilot/request/http'
import { withIncomingGoSpan } from '@/lib/copilot/request/otel'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('CopilotConfirmAPI')

// Schema for confirmation request
const ConfirmationSchema = z.object({
  toolCallId: z.string().min(1, 'Tool call ID is required'),
  status: z.enum(
    Object.values(ASYNC_TOOL_CONFIRMATION_STATUS) as [
      AsyncConfirmationStatus,
      ...AsyncConfirmationStatus[],
    ],
    {
      errorMap: () => ({ message: 'Invalid notification status' }),
    }
  ),
  message: z.string().optional(),
  data: z.unknown().optional(),
})

/**
 * Persist terminal durable tool status, then publish a wakeup event.
 *
 * `background` remains a live detach signal in the current browser workflow
 * runtime, so it should not rewrite the durable async row.
 */
async function updateToolCallStatus(
  existing: NonNullable<Awaited<ReturnType<typeof getAsyncToolCall>>>,
  status: AsyncConfirmationStatus,
  message?: string,
  data?: AsyncCompletionData
): Promise<boolean> {
  const toolCallId = existing.toolCallId
  if (status === ASYNC_TOOL_CONFIRMATION_STATUS.background) {
    publishToolConfirmation({
      toolCallId,
      status,
      message: message || undefined,
      timestamp: new Date().toISOString(),
      data,
    })
    return true
  }
  const durableStatus =
    status === 'success'
      ? ASYNC_TOOL_STATUS.completed
      : status === 'cancelled'
        ? ASYNC_TOOL_STATUS.cancelled
        : status === 'error'
          ? ASYNC_TOOL_STATUS.failed
          : ASYNC_TOOL_STATUS.pending
  try {
    if (
      durableStatus === ASYNC_TOOL_STATUS.completed ||
      durableStatus === ASYNC_TOOL_STATUS.failed ||
      durableStatus === ASYNC_TOOL_STATUS.cancelled
    ) {
      await completeAsyncToolCall({
        toolCallId,
        status: durableStatus,
        result: data ?? null,
        error: status === 'success' ? null : message || status,
      })
    } else if (existing.runId) {
      await upsertAsyncToolCall({
        runId: existing.runId,
        checkpointId: existing.checkpointId ?? null,
        toolCallId,
        toolName: existing.toolName || 'client_tool',
        args: (existing.args as Record<string, unknown> | null) ?? {},
        status: durableStatus,
      })
    }
    publishToolConfirmation({
      toolCallId,
      status,
      message: message || undefined,
      timestamp: new Date().toISOString(),
      data,
    })
    return true
  } catch (error) {
    logger.error('Failed to update tool call status', {
      toolCallId,
      status,
      error: toError(error).message,
    })
    return false
  }
}

// POST /api/copilot/confirm — delivery path for client-executed tool
// results. Correlate via `toolCallId` when the awaiting chat stream
// stalls.
export const POST = withRouteHandler((req: NextRequest) => {
  const tracker = createRequestTracker()

  return withIncomingGoSpan(
    req.headers,
    TraceSpan.CopilotConfirmToolResult,
    { [TraceAttr.RequestId]: tracker.requestId },
    async (span) => {
      try {
        const { userId: authenticatedUserId, isAuthenticated } =
          await authenticateCopilotRequestSessionOnly()

        if (!isAuthenticated || !authenticatedUserId) {
          span.setAttribute(TraceAttr.CopilotConfirmOutcome, CopilotConfirmOutcome.Unauthorized)
          return createUnauthorizedResponse()
        }

        const body = await req.json()
        const { toolCallId, status, message, data } = ConfirmationSchema.parse(body)
        span.setAttributes({
          [TraceAttr.ToolCallId]: toolCallId,
          [TraceAttr.ToolConfirmationStatus]: status,
          [TraceAttr.UserId]: authenticatedUserId,
        })

        const existing = await getAsyncToolCall(toolCallId).catch((err) => {
          logger.warn('Failed to fetch async tool call', {
            toolCallId,
            error: err instanceof Error ? err.message : String(err),
          })
          return null
        })

        if (!existing) {
          span.setAttribute(TraceAttr.CopilotConfirmOutcome, CopilotConfirmOutcome.ToolCallNotFound)
          return createNotFoundResponse('Tool call not found')
        }
        if (existing.toolName) span.setAttribute(TraceAttr.ToolName, existing.toolName)
        if (existing.runId) span.setAttribute(TraceAttr.RunId, existing.runId)

        const run = await getRunSegment(existing.runId).catch((err) => {
          logger.warn('Failed to fetch run segment', {
            runId: existing.runId,
            error: err instanceof Error ? err.message : String(err),
          })
          return null
        })
        if (!run) {
          span.setAttribute(TraceAttr.CopilotConfirmOutcome, CopilotConfirmOutcome.RunNotFound)
          return createNotFoundResponse('Tool call run not found')
        }
        if (run.userId !== authenticatedUserId) {
          span.setAttribute(TraceAttr.CopilotConfirmOutcome, CopilotConfirmOutcome.Forbidden)
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }

        const updated = await updateToolCallStatus(existing, status, message, data)

        if (!updated) {
          logger.error(`[${tracker.requestId}] Failed to update tool call status`, {
            userId: authenticatedUserId,
            toolCallId,
            status,
            internalStatus: status,
            message,
          })
          span.setAttribute(TraceAttr.CopilotConfirmOutcome, CopilotConfirmOutcome.UpdateFailed)
          // DB write failed — 500, not 400. 400 is a client-shape error.
          return createInternalServerErrorResponse('Failed to update tool call status')
        }

        span.setAttribute(TraceAttr.CopilotConfirmOutcome, CopilotConfirmOutcome.Delivered)
        return NextResponse.json({
          success: true,
          message: message || `Tool call ${toolCallId} has been ${status.toLowerCase()}`,
          toolCallId,
          status,
        })
      } catch (error) {
        const duration = tracker.getDuration()

        if (error instanceof z.ZodError) {
          logger.error(`[${tracker.requestId}] Request validation error:`, {
            duration,
            errors: error.errors,
          })
          span.setAttribute(TraceAttr.CopilotConfirmOutcome, CopilotConfirmOutcome.ValidationError)
          return createBadRequestResponse(
            `Invalid request data: ${error.errors.map((e) => e.message).join(', ')}`
          )
        }

        logger.error(`[${tracker.requestId}] Unexpected error:`, {
          duration,
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
        })

        span.setAttribute(TraceAttr.CopilotConfirmOutcome, CopilotConfirmOutcome.InternalError)
        return createInternalServerErrorResponse(
          error instanceof Error ? error.message : 'Internal server error'
        )
      }
    }
  )
})
