import { db } from '@sim/db'
import { copilotFeedback } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { submitCopilotFeedbackContract } from '@/lib/api/contracts'
import {
  defineInternalJsonRoute,
  internalJsonPresenters,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { submitChatFeedback } from '@/lib/mothership/chat/application/submit-feedback'
import {
  authenticateCopilotRequestSessionOnly,
  createInternalServerErrorResponse,
  createRequestTracker,
  createUnauthorizedResponse,
} from '@/lib/mothership/request/http'
import { captureServerEvent } from '@/lib/posthog/server'

const logger = createLogger('CopilotFeedbackAPI')

/** Records the caller's rating of an assistant reply in one of their own chats. */
export const POST = defineInternalJsonRoute({
  contract: submitCopilotFeedbackContract,
  operation: submitChatFeedback.operation,
  auth: internalSessionAuth,
  rateLimit: internalRateLimits.none({
    reason: 'Each rated reply in the caller’s own chat adds one feedback row.',
  }),
  errorPolicy: internalOrchestrationErrorPolicy,
  mapInput: ({ body }) => ({
    chatId: body.chatId,
    userQuery: body.userQuery,
    agentResponse: body.agentResponse,
    isPositive: body.isPositiveFeedback,
    feedback: body.feedback,
    workflowYaml: body.workflowYaml,
  }),
  useCase: submitChatFeedback,
  present: internalJsonPresenters.withSuccess,
  onSuccess: ({ principal, input }) => {
    captureServerEvent(principal.userId, 'copilot_feedback_submitted', {
      is_positive: input.isPositive,
      has_text_feedback: !!input.feedback,
      has_workflow_yaml: !!input.workflowYaml,
    })
  },
})

/**
 * GET /api/copilot/feedback
 * Get feedback records for the authenticated user
 */
export const GET = withRouteHandler(async () => {
  const tracker = createRequestTracker()

  try {
    // Authenticate user
    const { userId: authenticatedUserId, isAuthenticated } =
      await authenticateCopilotRequestSessionOnly()

    if (!isAuthenticated || !authenticatedUserId) {
      return createUnauthorizedResponse()
    }

    // Get feedback records for the authenticated user only
    const feedbackRecords = await db
      .select({
        feedbackId: copilotFeedback.feedbackId,
        userId: copilotFeedback.userId,
        chatId: copilotFeedback.chatId,
        userQuery: copilotFeedback.userQuery,
        agentResponse: copilotFeedback.agentResponse,
        isPositive: copilotFeedback.isPositive,
        feedback: copilotFeedback.feedback,
        workflowYaml: copilotFeedback.workflowYaml,
        createdAt: copilotFeedback.createdAt,
      })
      .from(copilotFeedback)
      .where(eq(copilotFeedback.userId, authenticatedUserId))

    logger.info(`Retrieved ${feedbackRecords.length} feedback records`, {
      requestId: tracker.requestId,
    })

    return NextResponse.json({
      success: true,
      feedback: feedbackRecords,
      metadata: {
        requestId: tracker.requestId,
        duration: tracker.getDuration(),
      },
    })
  } catch (error) {
    logger.error('Error retrieving copilot feedback:', error, { requestId: tracker.requestId })
    return createInternalServerErrorResponse('Failed to retrieve feedback')
  }
})
