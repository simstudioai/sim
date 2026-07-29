import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { copilotToolPermissionContract } from '@/lib/api/contracts/copilot'
import { parseRequest, validationErrorResponse } from '@/lib/api/server'
import {
  getAsyncToolCall,
  getRunSegment,
  recordToolPermissionDecision,
} from '@/lib/copilot/async-runs/repository'
import { TraceAttr } from '@/lib/copilot/generated/trace-attributes-v1'
import { TraceSpan } from '@/lib/copilot/generated/trace-spans-v1'
import {
  publishToolPermissionDecision,
  TOOL_PERMISSION_DECISION,
  type ToolPermissionDecision,
} from '@/lib/copilot/persistence/tool-permission'
import {
  addAutoAllowedTool,
  addChatAutoAllowedTool,
} from '@/lib/copilot/persistence/tool-permission/auto-allow'
import {
  authenticateCopilotRequestSessionOnly,
  createInternalServerErrorResponse,
  createNotFoundResponse,
  createRequestTracker,
  createUnauthorizedResponse,
} from '@/lib/copilot/request/http'
import { withIncomingGoSpan } from '@/lib/copilot/request/otel'
import { isCopilotToolPermissionsEnabled } from '@/lib/core/config/env-flags'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('CopilotToolPermissionAPI')

interface DecisionResult {
  toolCallId: string
  decision: ToolPermissionDecision
  applied: boolean
}

/**
 * Records one prompt answer and wakes the orchestrator waiting on it.
 *
 * Returns the decision that is actually in force: when this call lost the race
 * to another tab, the already-persisted answer wins and `applied` is false, so
 * the caller's UI can settle on what really happened.
 */
async function applyDecision(
  toolCallId: string,
  decision: ToolPermissionDecision,
  userId: string
): Promise<DecisionResult | null> {
  const existing = await getAsyncToolCall(toolCallId).catch((err) => {
    logger.warn('Failed to fetch async tool call', { toolCallId, error: getErrorMessage(err) })
    return null
  })
  if (!existing) return null

  const run = await getRunSegment(existing.runId).catch((err) => {
    logger.warn('Failed to fetch run segment', {
      runId: existing.runId,
      error: getErrorMessage(err),
    })
    return null
  })
  if (!run || run.userId !== userId) return null

  const claimed = await recordToolPermissionDecision(toolCallId, decision)
  if (!claimed) {
    // Someone already answered. Report their decision rather than pretending
    // ours took effect, and do not republish: the waiter has been woken.
    return existing.permissionDecision
      ? { toolCallId, decision: existing.permissionDecision, applied: false }
      : null
  }

  // Best-effort: failing to remember the preference must not block the tool the
  // user just allowed. Worst case they get prompted again next time.
  if (decision === TOOL_PERMISSION_DECISION.always_allow) {
    await addAutoAllowedTool(userId, claimed.toolName).catch((err) => {
      logger.error('Failed to persist always-allow preference', {
        toolCallId,
        toolName: claimed.toolName,
        error: getErrorMessage(err),
      })
    })
  } else if (decision === TOOL_PERMISSION_DECISION.allow_chat && run.chatId) {
    await addChatAutoAllowedTool(run.chatId, claimed.toolName).catch((err) => {
      logger.error('Failed to persist chat-scoped allow preference', {
        toolCallId,
        chatId: run.chatId,
        toolName: claimed.toolName,
        error: getErrorMessage(err),
      })
    })
  }

  publishToolPermissionDecision({
    toolCallId,
    decision,
    toolName: claimed.toolName,
    decidedAt: claimed.permissionDecidedAt?.toISOString(),
  })

  return { toolCallId, decision, applied: true }
}

// POST /api/copilot/tool-permission — the user's answer to one or more
// "Allow / Always allow / Skip" prompts. Batched so answering several
// simultaneous prompts at once is a single round trip.
export const POST = withRouteHandler((req: NextRequest) => {
  const tracker = createRequestTracker()

  return withIncomingGoSpan(
    req.headers,
    TraceSpan.CopilotToolPermissionDecide,
    { [TraceAttr.RequestId]: tracker.requestId },
    async (span) => {
      try {
        // Nothing can legitimately be awaiting a decision while the feature is
        // off, so close the endpoint rather than letting it write decisions
        // onto rows no orchestrator is waiting on.
        if (!isCopilotToolPermissionsEnabled) {
          return createNotFoundResponse('Tool permissions are not enabled')
        }

        const { userId: authenticatedUserId, isAuthenticated } =
          await authenticateCopilotRequestSessionOnly()

        if (!isAuthenticated || !authenticatedUserId) {
          return createUnauthorizedResponse()
        }

        const parsed = await parseRequest(
          copilotToolPermissionContract,
          req,
          {},
          {
            validationErrorResponse: (error) =>
              validationErrorResponse(
                error,
                `Invalid request data: ${error.issues.map((e) => e.message).join(', ')}`
              ),
          }
        )
        if (!parsed.success) return parsed.response

        const { decisions } = parsed.data.body
        span.setAttributes({
          [TraceAttr.UserId]: authenticatedUserId,
          [TraceAttr.CopilotAsyncToolIdsCount]: decisions.length,
        })

        const results: DecisionResult[] = []
        for (const { toolCallId, decision } of decisions) {
          const result = await applyDecision(toolCallId, decision, authenticatedUserId)
          if (result) results.push(result)
        }

        if (results.length === 0) {
          return createNotFoundResponse('No matching tool calls found')
        }

        return NextResponse.json({ success: true, results })
      } catch (error) {
        logger.error(`[${tracker.requestId}] Unexpected error:`, {
          duration: tracker.getDuration(),
          error: getErrorMessage(error, 'Unknown error'),
          stack: error instanceof Error ? error.stack : undefined,
        })
        return createInternalServerErrorResponse(getErrorMessage(error, 'Internal server error'))
      }
    }
  )
})
