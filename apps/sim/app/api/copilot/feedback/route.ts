import { db } from '@sim/db'
import { copilotFeedback } from '@sim/db/schema'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  authenticateCopilotRequestSessionOnly,
  createBadRequestResponse,
  createInternalServerErrorResponse,
  createRequestTracker,
  createUnauthorizedResponse,
} from '@/lib/copilot/auth'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('CopilotFeedbackAPI')

// Schema for feedback submission
const FeedbackSchema = z.object({
  chatId: z.string().uuid('Chat ID must be a valid UUID'),
  userQuery: z.string().min(1, 'User query is required'),
  agentResponse: z.string().min(1, 'Agent response is required'),
  isPositiveFeedback: z.boolean(),
  feedback: z.string().optional(),
  workflowYaml: z.string().optional(), // Optional workflow YAML when edit/build workflow tools were used
})

/**
 * POST /api/copilot/feedback
 * Submit feedback for a copilot interaction
 */
export async function POST(req: NextRequest) {
  const tracker = createRequestTracker()

  try {
    // Authenticate user using the same pattern as other copilot routes
    const { userId: authenticatedUserId, isAuthenticated } =
      await authenticateCopilotRequestSessionOnly()

    if (!isAuthenticated || !authenticatedUserId) {
      return createUnauthorizedResponse()
    }

    const body = await req.json()
    const { chatId, userQuery, agentResponse, isPositiveFeedback, feedback, workflowYaml } =
      FeedbackSchema.parse(body)

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

    if (error instanceof z.ZodError) {
      logger.error(`[${tracker.requestId}] Validation error:`, {
        duration,
        errors: error.errors,
      })
      return createBadRequestResponse(
        `Invalid request data: ${error.errors.map((e) => e.message).join(', ')}`
      )
    }

    logger.error(`[${tracker.requestId}] Error submitting copilot feedback:`, {
      duration,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    })

    return createInternalServerErrorResponse('Failed to submit feedback')
  }
}

/**
 * GET /api/copilot/feedback
 * Get all feedback records (for analytics)
 */
export async function GET(req: NextRequest) {
  const tracker = createRequestTracker()

  try {
    // Authenticate user
    const { userId: authenticatedUserId, isAuthenticated } =
      await authenticateCopilotRequestSessionOnly()

    if (!isAuthenticated || !authenticatedUserId) {
      return createUnauthorizedResponse()
    }

    // Get all feedback records
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
}
