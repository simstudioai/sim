import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  completeAsyncToolCall,
  getAsyncToolCall,
  getRunSegment,
  upsertAsyncToolCall,
} from '@/lib/copilot/async-runs/repository'
import { publishToolConfirmation } from '@/lib/copilot/orchestrator/persistence'
import {
  authenticateCopilotRequestSessionOnly,
  createBadRequestResponse,
  createInternalServerErrorResponse,
  createNotFoundResponse,
  createRequestTracker,
  createUnauthorizedResponse,
  type NotificationStatus,
} from '@/lib/copilot/request-helpers'

const logger = createLogger('CopilotConfirmAPI')

// Schema for confirmation request
const ConfirmationSchema = z.object({
  toolCallId: z.string().min(1, 'Tool call ID is required'),
  status: z.enum(['success', 'error', 'accepted', 'rejected', 'background', 'cancelled'] as const, {
    errorMap: () => ({ message: 'Invalid notification status' }),
  }),
  message: z.string().optional(),
  data: z.record(z.unknown()).optional(),
})

/**
 * Persist the durable tool status, then publish a wakeup event.
 */
async function updateToolCallStatus(
  existing: NonNullable<Awaited<ReturnType<typeof getAsyncToolCall>>>,
  status: NotificationStatus,
  message?: string,
  data?: Record<string, unknown>
): Promise<boolean> {
  const toolCallId = existing.toolCallId
  const durableStatus =
    status === 'success'
      ? 'completed'
      : status === 'cancelled'
        ? 'cancelled'
        : status === 'error' || status === 'rejected'
          ? 'failed'
          : 'pending'
  try {
    if (
      durableStatus === 'completed' ||
      durableStatus === 'failed' ||
      durableStatus === 'cancelled'
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
    const timestamp = new Date().toISOString()
    publishToolConfirmation({
      toolCallId,
      status,
      message: message || undefined,
      timestamp,
      data,
    })
    return true
  } catch (error) {
    logger.error('Failed to update tool call status', {
      toolCallId,
      status,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

/**
 * POST /api/copilot/confirm
 * Update tool call status (Accept/Reject)
 */
export async function POST(req: NextRequest) {
  const tracker = createRequestTracker()

  try {
    // Authenticate user using consolidated helper
    const { userId: authenticatedUserId, isAuthenticated } =
      await authenticateCopilotRequestSessionOnly()

    if (!isAuthenticated) {
      return createUnauthorizedResponse()
    }

    const body = await req.json()
    const { toolCallId, status, message, data } = ConfirmationSchema.parse(body)
    const existing = await getAsyncToolCall(toolCallId).catch(() => null)

    if (!existing) {
      return createNotFoundResponse('Tool call not found')
    }

    const run = await getRunSegment(existing.runId).catch(() => null)
    if (!run) {
      return createNotFoundResponse('Tool call run not found')
    }
    if (run.userId !== authenticatedUserId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Update the durable tool call status and wake any waiters.
    const updated = await updateToolCallStatus(existing, status, message, data)

    if (!updated) {
      logger.error(`[${tracker.requestId}] Failed to update tool call status`, {
        userId: authenticatedUserId,
        toolCallId,
        status,
        internalStatus: status,
        message,
      })
      return createBadRequestResponse('Failed to update tool call status or tool call not found')
    }

    const duration = tracker.getDuration()

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
      return createBadRequestResponse(
        `Invalid request data: ${error.errors.map((e) => e.message).join(', ')}`
      )
    }

    logger.error(`[${tracker.requestId}] Unexpected error:`, {
      duration,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    })

    return createInternalServerErrorResponse(
      error instanceof Error ? error.message : 'Internal server error'
    )
  }
}
