import { db } from '@sim/db'
import { copilotFeedback } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { submitCopilotFeedbackContract } from '@/lib/api/contracts'
import { parseRequest, validationErrorResponse } from '@/lib/api/server'
import {
  authenticateCopilotRequestSessionOnly,
  createInternalServerErrorResponse,
  createRequestTracker,
  createUnauthorizedResponse,
} from '@/lib/copilot/request/http'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'

const logger = createLogger('CopilotFeedbackAPI')

/**
 * POST /api/copilot/feedback
 * Submit feedback for a copilot interaction
 */
export const POST = withRouteHandler(async (req: NextRequest) => {
  const tracker = createRequestTracker()

  try {
    // Authenticate user using the same pattern as other copilot routes
    const { userId: authenticatedUserId, isAuthenticated } =
      await authenticateCopilotRequestSessionOnly()

    if (!isAuthenticated || !authenticatedUserId) {
      return createUnauthorizedResponse()
    }

    const parsed = await parseRequest(
      submitCopilotFeedbackContract,
      req,
      {},
      {
        invalidJson: 'throw',
        validationErrorResponse: (error) => {
          logger.error(`[${tracker.requestId}] Validation error:`, {
            duration: tracker.getDuration(),
            errors: error.issues,
          })
          return validationErrorResponse(error, 'Invalid request data')
        },
      }
    )
    if (!parsed.success) return parsed.response

    const { chatId, userQuery, agentResponse, isPositiveFeedback, feedback, workflowYaml } =
      parsed.data.body

    logger.info(`[${tracker.requestId}] Processing copilot feedback submission`, {
      userId: authenticatedUserId,
      chatId,
      isPositiveFeedback,
      userQueryLength: userQuery.length,
      agentResponseLength: agentResponse.length,
      hasFeedback: !!feedback,
      hasWorkflowYaml: !!workflowYaml,
      workflowYamlLength: workflowYaml?.length || 0,
    })

    // Insert feedback into the database
    const [feedbackRecord] = await db
      .insert(copilotFeedback)
      .values({
        userId: authenticatedUserId,
        chatId,
        userQuery,
        agentResponse,
        isPositive: isPositiveFeedback,
        feedback: feedback || null,
        workflowYaml: workflowYaml || null,
      })
      .returning()

    logger.info(`[${tracker.requestId}] Successfully saved copilot feedback`, {
      feedbackId: feedbackRecord.feedbackId,
      userId: authenticatedUserId,
      isPositive: isPositiveFeedback,
      duration: tracker.getDuration(),
    })

    captureServerEvent(authenticatedUserId, 'copilot_feedback_submitted', {
      is_positive: isPositiveFeedback,
      has_text_feedback: !!feedback,
      has_workflow_yaml: !!workflowYaml,
    })

    return NextResponse.json({
      success: true,
      feedbackId: feedbackRecord.feedbackId,
      message: 'Feedback submitted successfully',
      metadata: {
        requestId: tracker.requestId,
        duration: tracker.getDuration(),
      },
    })
  } catch (error) {
    const duration = tracker.getDuration()

    logger.error(`[${tracker.requestId}] Error submitting copilot feedback:`, {
      duration,
      error: getErrorMessage(error, 'Unknown error'),
      stack: error instanceof Error ? error.stack : undefined,
    })

    return createInternalServerErrorResponse('Failed to submit feedback')
  }
})

/**
 * GET /api/copilot/feedback
 * Get feedback records for the authenticated user
 */
export const GET = withRouteHandler(async (req: NextRequest) => {
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

    logger.info(`[${tracker.requestId}] Retrieved ${feedbackRecords.length} feedback records`)

    return NextResponse.json({
      success: true,
      feedback: feedbackRecords,
      metadata: {
        requestId: tracker.requestId,
        duration: tracker.getDuration(),
      },
    })
  } catch (error) {
    logger.error(`[${tracker.requestId}] Error retrieving copilot feedback:`, error)
    return createInternalServerErrorResponse('Failed to retrieve feedback')
  }
})
