import { db } from '@sim/db'
import { workflow } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { checkServerSideUsageLimits } from '@/lib/billing/calculations/usage-monitor'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import { createLogger } from '@/lib/logs/console/logger'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import { getWorkspaceBilledAccountUserId } from '@/lib/workspaces/utils'
import { RateLimiter } from '@/services/queue/RateLimiter'

const logger = createLogger('ExecutionPreprocessing')

const BILLING_ERROR_MESSAGES = {
  BILLING_REQUIRED:
    'Unable to resolve billing account. This workflow cannot execute without a valid billing account.',
  BILLING_ERROR_GENERIC: 'Error resolving billing account',
} as const

/**
 * Attempts to resolve billing actor with fallback for resume contexts.
 * Returns the resolved actor user ID or null if resolution fails and should block execution.
 *
 * For resume contexts, this function allows fallback to the workflow owner if workspace
 * billing cannot be resolved, ensuring users can complete their paused workflows even
 * if billing configuration changes mid-execution.
 *
 * @returns Object containing actorUserId (null if should block) and shouldBlock flag
 */
async function resolveBillingActorWithFallback(params: {
  requestId: string
  workflowId: string
  workspaceId: string
  executionId: string
  triggerType: string
  workflowRecord: WorkflowRecord
  userId: string
  isResumeContext: boolean
  baseActorUserId: string | null
  failureReason: 'null' | 'error'
  error?: unknown
  loggingSession?: LoggingSession
}): Promise<
  { actorUserId: string; shouldBlock: false } | { actorUserId: null; shouldBlock: true }
> {
  const {
    requestId,
    workflowId,
    workspaceId,
    executionId,
    triggerType,
    workflowRecord,
    userId,
    isResumeContext,
    baseActorUserId,
    failureReason,
    error,
    loggingSession,
  } = params

  if (baseActorUserId) {
    return { actorUserId: baseActorUserId, shouldBlock: false }
  }

  const workflowOwner = workflowRecord.userId?.trim()
  if (isResumeContext && workflowOwner) {
    const logMessage =
      failureReason === 'null'
        ? '[BILLING_FALLBACK] Workspace billing account is null. Using workflow owner for billing.'
        : '[BILLING_FALLBACK] Exception during workspace billing resolution. Using workflow owner for billing.'

    logger.warn(`[${requestId}] ${logMessage}`, {
      workflowId,
      workspaceId,
      fallbackUserId: workflowOwner,
      ...(error ? { error } : {}),
    })

    return { actorUserId: workflowOwner, shouldBlock: false }
  }

  const fallbackUserId = workflowRecord.userId || userId || 'unknown'
  const errorMessage =
    failureReason === 'null'
      ? BILLING_ERROR_MESSAGES.BILLING_REQUIRED
      : BILLING_ERROR_MESSAGES.BILLING_ERROR_GENERIC

  logger.warn(`[${requestId}] ${errorMessage}`, {
    workflowId,
    workspaceId,
    ...(error ? { error } : {}),
  })

  await logPreprocessingError({
    workflowId,
    executionId,
    triggerType,
    requestId,
    userId: fallbackUserId,
    workspaceId,
    errorMessage,
    loggingSession,
  })

  return { actorUserId: null, shouldBlock: true }
}

export interface PreprocessExecutionOptions {
  // Required fields
  workflowId: string
  userId: string // The authenticated user ID
  triggerType: 'manual' | 'api' | 'webhook' | 'schedule' | 'chat'
  executionId: string
  requestId: string

  // Optional checks configuration
  checkRateLimit?: boolean // Default: false for manual/chat, true for others
  checkDeployment?: boolean // Default: true for non-manual triggers
  skipUsageLimits?: boolean // Default: false (only use for test mode)

  // Context information
  workspaceId?: string // If known, used for billing resolution
  loggingSession?: LoggingSession // If provided, will be used for error logging
  isResumeContext?: boolean // If true, allows fallback billing on resolution failure (for paused workflow resumes)
}

/**
 * Result of preprocessing checks
 */
export interface PreprocessExecutionResult {
  success: boolean
  error?: {
    message: string
    statusCode: number // HTTP status code (401, 402, 403, 404, 429, 500)
    logCreated: boolean // Whether error was logged to execution_logs
  }
  actorUserId?: string // The user ID that will be billed
  workflowRecord?: WorkflowRecord
  userSubscription?: SubscriptionInfo | null
  rateLimitInfo?: {
    allowed: boolean
    remaining: number
    resetAt: Date
  }
}

type WorkflowRecord = typeof workflow.$inferSelect
type SubscriptionInfo = Awaited<ReturnType<typeof getHighestPrioritySubscription>>

export async function preprocessExecution(
  options: PreprocessExecutionOptions
): Promise<PreprocessExecutionResult> {
  const {
    workflowId,
    userId,
    triggerType,
    executionId,
    requestId,
    checkRateLimit = triggerType !== 'manual' && triggerType !== 'chat',
    checkDeployment = triggerType !== 'manual',
    skipUsageLimits = false,
    workspaceId: providedWorkspaceId,
    loggingSession: providedLoggingSession,
    isResumeContext = false,
  } = options

  logger.info(`[${requestId}] Starting execution preprocessing`, {
    workflowId,
    userId,
    triggerType,
    executionId,
  })

  // ========== STEP 1: Validate Workflow Exists ==========
  let workflowRecord: WorkflowRecord | null = null
  try {
    const records = await db.select().from(workflow).where(eq(workflow.id, workflowId)).limit(1)

    if (records.length === 0) {
      logger.warn(`[${requestId}] Workflow not found: ${workflowId}`)

      await logPreprocessingError({
        workflowId,
        executionId,
        triggerType,
        requestId,
        userId: 'unknown',
        workspaceId: '',
        errorMessage:
          'Workflow not found. The workflow may have been deleted or is no longer accessible.',
        loggingSession: providedLoggingSession,
      })

      return {
        success: false,
        error: {
          message: 'Workflow not found',
          statusCode: 404,
          logCreated: true,
        },
      }
    }

    workflowRecord = records[0]
  } catch (error) {
    logger.error(`[${requestId}] Error fetching workflow`, { error, workflowId })

    await logPreprocessingError({
      workflowId,
      executionId,
      triggerType,
      requestId,
      userId: userId || 'unknown',
      workspaceId: providedWorkspaceId || '',
      errorMessage: 'Internal error while fetching workflow',
      loggingSession: providedLoggingSession,
    })

    return {
      success: false,
      error: {
        message: 'Internal error while fetching workflow',
        statusCode: 500,
        logCreated: true,
      },
    }
  }

  const workspaceId = workflowRecord.workspaceId || providedWorkspaceId || ''

  // ========== STEP 2: Check Deployment Status ==========
  if (checkDeployment && !workflowRecord.isDeployed) {
    logger.warn(`[${requestId}] Workflow not deployed: ${workflowId}`)

    await logPreprocessingError({
      workflowId,
      executionId,
      triggerType,
      requestId,
      userId: workflowRecord.userId || userId,
      workspaceId,
      errorMessage: 'Workflow is not deployed. Please deploy the workflow before triggering it.',
      loggingSession: providedLoggingSession,
    })

    return {
      success: false,
      error: {
        message: 'Workflow is not deployed',
        statusCode: 403,
        logCreated: true,
      },
    }
  }

  // ========== STEP 3: Resolve Billing Actor ==========
  let actorUserId: string | null = null

  try {
    if (workspaceId) {
      actorUserId = await getWorkspaceBilledAccountUserId(workspaceId)
      if (actorUserId) {
        logger.info(`[${requestId}] Using workspace billed account: ${actorUserId}`)
      }
    }

    if (!actorUserId) {
      actorUserId = workflowRecord.userId || userId
      logger.info(`[${requestId}] Using workflow owner as actor: ${actorUserId}`)
    }

    if (!actorUserId) {
      const result = await resolveBillingActorWithFallback({
        requestId,
        workflowId,
        workspaceId,
        executionId,
        triggerType,
        workflowRecord,
        userId,
        isResumeContext,
        baseActorUserId: actorUserId,
        failureReason: 'null',
        loggingSession: providedLoggingSession,
      })

      if (result.shouldBlock) {
        return {
          success: false,
          error: {
            message: 'Unable to resolve billing account',
            statusCode: 500,
            logCreated: true,
          },
        }
      }

      actorUserId = result.actorUserId
    }
  } catch (error) {
    logger.error(`[${requestId}] Error resolving billing actor`, { error, workflowId })

    const result = await resolveBillingActorWithFallback({
      requestId,
      workflowId,
      workspaceId,
      executionId,
      triggerType,
      workflowRecord,
      userId,
      isResumeContext,
      baseActorUserId: null,
      failureReason: 'error',
      error,
      loggingSession: providedLoggingSession,
    })

    if (result.shouldBlock) {
      return {
        success: false,
        error: {
          message: 'Error resolving billing account',
          statusCode: 500,
          logCreated: true,
        },
      }
    }

    actorUserId = result.actorUserId
  }

  // ========== STEP 4: Get User Subscription ==========
  let userSubscription: SubscriptionInfo = null
  try {
    userSubscription = await getHighestPrioritySubscription(actorUserId)
    logger.debug(`[${requestId}] User subscription retrieved`, {
      actorUserId,
      hasSub: !!userSubscription,
      plan: userSubscription?.plan,
    })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching subscription`, { error, actorUserId })
  }

  // ========== STEP 5: Check Rate Limits ==========
  let rateLimitInfo: { allowed: boolean; remaining: number; resetAt: Date } | undefined

  if (checkRateLimit) {
    try {
      const rateLimiter = new RateLimiter()
      rateLimitInfo = await rateLimiter.checkRateLimitWithSubscription(
        actorUserId,
        userSubscription,
        triggerType,
        false // not async
      )

      if (!rateLimitInfo.allowed) {
        logger.warn(`[${requestId}] Rate limit exceeded for user ${actorUserId}`, {
          triggerType,
          remaining: rateLimitInfo.remaining,
          resetAt: rateLimitInfo.resetAt,
        })

        await logPreprocessingError({
          workflowId,
          executionId,
          triggerType,
          requestId,
          userId: actorUserId,
          workspaceId,
          errorMessage: `Rate limit exceeded. ${rateLimitInfo.remaining} requests remaining. Resets at ${rateLimitInfo.resetAt.toISOString()}.`,
          loggingSession: providedLoggingSession,
        })

        return {
          success: false,
          error: {
            message: `Rate limit exceeded. Please try again later.`,
            statusCode: 429,
            logCreated: true,
          },
        }
      }

      logger.debug(`[${requestId}] Rate limit check passed`, {
        remaining: rateLimitInfo.remaining,
      })
    } catch (error) {
      logger.error(`[${requestId}] Error checking rate limits`, { error, actorUserId })

      await logPreprocessingError({
        workflowId,
        executionId,
        triggerType,
        requestId,
        userId: actorUserId,
        workspaceId,
        errorMessage: 'Error checking rate limits. Execution blocked for safety.',
        loggingSession: providedLoggingSession,
      })

      return {
        success: false,
        error: {
          message: 'Error checking rate limits',
          statusCode: 500,
          logCreated: true,
        },
      }
    }
  }

  // ========== STEP 6: Check Usage Limits (CRITICAL) ==========
  if (!skipUsageLimits) {
    try {
      const usageCheck = await checkServerSideUsageLimits(actorUserId)

      if (usageCheck.isExceeded) {
        logger.warn(
          `[${requestId}] User ${actorUserId} has exceeded usage limits. Blocking execution.`,
          {
            currentUsage: usageCheck.currentUsage,
            limit: usageCheck.limit,
            workflowId,
            triggerType,
          }
        )

        await logPreprocessingError({
          workflowId,
          executionId,
          triggerType,
          requestId,
          userId: actorUserId,
          workspaceId,
          errorMessage:
            usageCheck.message ||
            `Usage limit exceeded: $${usageCheck.currentUsage?.toFixed(2)} used of $${usageCheck.limit?.toFixed(2)} limit. Please upgrade your plan to continue.`,
          loggingSession: providedLoggingSession,
        })

        return {
          success: false,
          error: {
            message:
              usageCheck.message || 'Usage limit exceeded. Please upgrade your plan to continue.',
            statusCode: 402,
            logCreated: true,
          },
        }
      }

      logger.debug(`[${requestId}] Usage limit check passed`, {
        currentUsage: usageCheck.currentUsage,
        limit: usageCheck.limit,
      })
    } catch (error) {
      logger.error(`[${requestId}] Error checking usage limits`, { error, actorUserId })

      await logPreprocessingError({
        workflowId,
        executionId,
        triggerType,
        requestId,
        userId: actorUserId,
        workspaceId,
        errorMessage:
          'Unable to determine usage limits. Execution blocked for security. Please contact support.',
        loggingSession: providedLoggingSession,
      })

      return {
        success: false,
        error: {
          message: 'Unable to determine usage limits. Execution blocked for security.',
          statusCode: 500,
          logCreated: true,
        },
      }
    }
  } else {
    logger.debug(`[${requestId}] Skipping usage limits check (test mode)`)
  }

  // ========== SUCCESS: All Checks Passed ==========
  logger.info(`[${requestId}] All preprocessing checks passed`, {
    workflowId,
    actorUserId,
    triggerType,
  })

  return {
    success: true,
    actorUserId,
    workflowRecord,
    userSubscription,
    rateLimitInfo,
  }
}

/**
 * Helper function to log preprocessing errors to the database
 *
 * This ensures users can see why their workflow execution was blocked.
 */
async function logPreprocessingError(params: {
  workflowId: string
  executionId: string
  triggerType: string
  requestId: string
  userId: string
  workspaceId: string
  errorMessage: string
  loggingSession?: LoggingSession
}): Promise<void> {
  const {
    workflowId,
    executionId,
    triggerType,
    requestId,
    userId,
    workspaceId,
    errorMessage,
    loggingSession,
  } = params

  try {
    const session =
      loggingSession || new LoggingSession(workflowId, executionId, triggerType as any, requestId)

    await session.safeStart({
      userId,
      workspaceId,
      variables: {},
    })

    await session.safeCompleteWithError({
      error: {
        message: errorMessage,
        stackTrace: undefined,
      },
      traceSpans: [],
    })

    logger.debug(`[${requestId}] Logged preprocessing error to database`, {
      workflowId,
      executionId,
    })
  } catch (error) {
    logger.error(`[${requestId}] Failed to log preprocessing error`, {
      error,
      workflowId,
      executionId,
    })
    // Don't throw - error logging should not block the error response
  }
}
