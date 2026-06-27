import type { workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getActiveWorkflowRecord } from '@sim/platform-authz/workflow'
import { getActivelyBannedUserIds } from '@/lib/auth/ban'
import {
  checkOrgMemberUsageLimit,
  checkServerSideUsageLimits,
} from '@/lib/billing/calculations/usage-monitor'
import { reserveExecutionSlot } from '@/lib/billing/calculations/usage-reservation'
import type { HighestPrioritySubscription } from '@/lib/billing/core/plan'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import {
  describeRetryableInfrastructureError,
  isRetryableInfrastructureError,
} from '@/lib/core/errors/retryable-infrastructure'
import { getExecutionTimeout } from '@/lib/core/execution-limits'
import { RateLimiter } from '@/lib/core/rate-limiter/rate-limiter'
import type { SubscriptionPlan } from '@/lib/core/rate-limiter/types'
import { LoggingSession, type SessionStartParams } from '@/lib/logs/execution/logging-session'
import { getWorkspaceBilledAccountUserId } from '@/lib/workspaces/utils'
import type { CoreTriggerType } from '@/stores/logs/filters/types'

const logger = createLogger('ExecutionPreprocessing')

const BILLING_ERROR_MESSAGES = {
  BILLING_REQUIRED:
    'Unable to resolve billing account. This workflow cannot execute without a valid billing account.',
  BILLING_ERROR_GENERIC: 'Error resolving billing account',
} as const

export interface PreprocessExecutionOptions {
  // Required fields
  workflowId: string
  userId: string // The authenticated user ID
  triggerType: CoreTriggerType
  executionId: string
  requestId: string

  // Optional checks configuration
  checkRateLimit?: boolean // Default: false for manual/chat, true for others
  checkDeployment?: boolean // Default: true for non-manual triggers
  skipUsageLimits?: boolean // Default: false (only use for test mode)
  /**
   * Skip the atomic in-flight concurrency reservation while still enforcing the
   * usage-cost cap. Default: false. Set by surfaces that already bound and pace
   * their own fan-out (e.g. table-cell dispatch, which is row-bounded, async
   * rate-limited, and surfaces a graceful "wait/upgrade" state) so the
   * reservation's 429 can't surface as a hard error there.
   */
  skipConcurrencyReservation?: boolean
  logPreprocessingErrors?: boolean // Default: true. When false, skip writing workflow_execution_logs error rows (caller surfaces failures itself, e.g. table cells)

  // Context information
  workspaceId?: string // If known, used for billing resolution
  loggingSession?: LoggingSession // If provided, will be used for error logging
  triggerData?: SessionStartParams['triggerData']
  isResumeContext?: boolean // Deprecated: no billing fallback is allowed
  useAuthenticatedUserAsActor?: boolean // If true, use the authenticated userId as actorUserId (for client-side executions and personal API keys)
  /** @deprecated No longer used - background/async executions always use deployed state */
  useDraftState?: boolean
  /** Pre-fetched workflow row for caller context; preprocessing still re-checks active state. */
  workflowRecord?: WorkflowRecord
  /**
   * Billing actor already resolved by an upstream gate earlier in the same
   * request (e.g. the webhook route's preprocessing pass, whose result is carried
   * as the job's userId). When provided, the redundant workspace billed-account
   * lookup is skipped. The ban, deployment, usage, and rate-limit gates still run
   * against this actor — only the resolution is reused, never a gate.
   */
  resolvedActorUserId?: string
}

/**
 * Result of preprocessing checks
 */
export interface PreprocessExecutionResult {
  success: boolean
  error?: {
    message: string
    statusCode: number
    logCreated: boolean
    retryable?: boolean
    cause?: Record<string, unknown>
  }
  actorUserId?: string
  workflowRecord?: WorkflowRecord
  userSubscription?: SubscriptionInfo | null
  rateLimitInfo?: {
    allowed: boolean
    remaining: number
    resetAt: Date
  }
  executionTimeout?: {
    sync: number
    async: number
  }
}

type WorkflowRecord = typeof workflow.$inferSelect
type SubscriptionInfo = HighestPrioritySubscription

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
    skipConcurrencyReservation = false,
    logPreprocessingErrors = true,
    workspaceId: providedWorkspaceId,
    loggingSession: providedLoggingSession,
    triggerData,
    isResumeContext: _isResumeContext = false,
    useAuthenticatedUserAsActor = false,
    workflowRecord: prefetchedWorkflowRecord,
    resolvedActorUserId,
  } = options

  // When `logPreprocessingErrors` is false the caller surfaces failures itself
  // (e.g. table cells use cell state / SSE), so skip the execution-log writes.
  const recordPreprocessingError: typeof logPreprocessingError = (args) =>
    logPreprocessingErrors ? logPreprocessingError(args) : Promise.resolve()

  logger.info(`[${requestId}] Starting execution preprocessing`, {
    workflowId,
    userId,
    triggerType,
    executionId,
  })

  // ========== STEP 1: Validate Workflow Exists ==========
  if (prefetchedWorkflowRecord && prefetchedWorkflowRecord.id !== workflowId) {
    logger.error(`[${requestId}] Prefetched workflow record ID mismatch`, {
      expected: workflowId,
      received: prefetchedWorkflowRecord.id,
    })
    throw new Error(
      `Prefetched workflow record ID mismatch: expected ${workflowId}, got ${prefetchedWorkflowRecord.id}`
    )
  }
  let workflowRecord: WorkflowRecord | null = prefetchedWorkflowRecord ?? null
  if (!workflowRecord) {
    try {
      workflowRecord = await getActiveWorkflowRecord(workflowId)

      if (!workflowRecord) {
        logger.warn(`[${requestId}] Workflow not found: ${workflowId}`)

        await recordPreprocessingError({
          workflowId,
          executionId,
          triggerType,
          requestId,
          userId: 'unknown',
          workspaceId: '',
          errorMessage:
            'Workflow not found. The workflow may have been deleted or is no longer accessible.',
          loggingSession: providedLoggingSession,
          triggerData,
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
    } catch (error) {
      logger.error(`[${requestId}] Error fetching workflow`, { error, workflowId })

      await recordPreprocessingError({
        workflowId,
        executionId,
        triggerType,
        requestId,
        userId: userId || 'unknown',
        workspaceId: providedWorkspaceId || '',
        errorMessage: 'Internal error while fetching workflow',
        loggingSession: providedLoggingSession,
        triggerData,
      })

      return {
        success: false,
        error: {
          message: 'Internal error while fetching workflow',
          statusCode: 500,
          logCreated: true,
          retryable: isRetryableInfrastructureError(error),
          cause: describeRetryableInfrastructureError(error),
        },
      }
    }
  } else if (workflowRecord.archivedAt) {
    logger.warn(`[${requestId}] Prefetched workflow is archived: ${workflowId}`)
    return {
      success: false,
      error: {
        message: 'Workflow not found',
        statusCode: 404,
        logCreated: false,
      },
    }
  } else {
    const activeWorkflow = await getActiveWorkflowRecord(workflowId)
    if (!activeWorkflow) {
      logger.warn(`[${requestId}] Workflow archived before execution started: ${workflowId}`)
      return {
        success: false,
        error: {
          message: 'Workflow not found',
          statusCode: 404,
          logCreated: false,
        },
      }
    }
    workflowRecord = activeWorkflow
  }

  const workspaceId = workflowRecord.workspaceId || providedWorkspaceId || ''

  if (!workspaceId) {
    logger.warn(`[${requestId}] Workflow ${workflowId} has no workspaceId; execution blocked`)
    return {
      success: false,
      error: {
        message:
          'This workflow is not attached to a workspace. Personal workflows are deprecated and cannot execute.',
        statusCode: 403,
        logCreated: false,
      },
    }
  }

  // ========== STEP 2: Check Deployment Status ==========
  // If workflow is not deployed and deployment is required, reject without logging.
  // No log entry or cost should be created for calls to undeployed workflows
  // since the workflow was never intended to run.
  if (checkDeployment && !workflowRecord.isDeployed) {
    logger.warn(`[${requestId}] Workflow not deployed: ${workflowId}`)

    return {
      success: false,
      error: {
        message: 'Workflow is not deployed',
        statusCode: 403,
        logCreated: false,
      },
    }
  }

  // ========== STEP 3: Resolve Billing Actor ==========
  let actorUserId: string | null = null

  try {
    // For client-side executions and personal API keys, the authenticated
    // user is the billing and permission actor — not the workspace owner.
    if (useAuthenticatedUserAsActor && userId) {
      actorUserId = userId
      logger.info(`[${requestId}] Using authenticated user as actor: ${actorUserId}`)
    }

    /**
     * Reuse an actor already resolved upstream this request (e.g. the webhook
     * route's preprocessing) to skip the redundant workspace billed-account
     * lookup. Gates below still run against this actor.
     */
    if (!actorUserId && resolvedActorUserId) {
      actorUserId = resolvedActorUserId
      logger.info(`[${requestId}] Using pre-resolved billing actor: ${actorUserId}`)
    }

    if (!actorUserId && workspaceId) {
      actorUserId = await getWorkspaceBilledAccountUserId(workspaceId)
      if (actorUserId) {
        logger.info(`[${requestId}] Using workspace billed account: ${actorUserId}`)
      }
    }

    if (!actorUserId) {
      const fallbackUserId = userId || 'unknown'
      logger.warn(`[${requestId}] ${BILLING_ERROR_MESSAGES.BILLING_REQUIRED}`, {
        workflowId,
        workspaceId,
      })

      await recordPreprocessingError({
        workflowId,
        executionId,
        triggerType,
        requestId,
        userId: fallbackUserId,
        workspaceId,
        errorMessage: BILLING_ERROR_MESSAGES.BILLING_REQUIRED,
        loggingSession: providedLoggingSession,
        triggerData,
      })

      return {
        success: false,
        error: {
          message: 'Unable to resolve billing account',
          statusCode: 500,
          logCreated: true,
        },
      }
    }
  } catch (error) {
    logger.error(`[${requestId}] Error resolving billing actor`, { error, workflowId })
    const fallbackUserId = userId || 'unknown'
    await recordPreprocessingError({
      workflowId,
      executionId,
      triggerType,
      requestId,
      userId: fallbackUserId,
      workspaceId,
      errorMessage: BILLING_ERROR_MESSAGES.BILLING_ERROR_GENERIC,
      loggingSession: providedLoggingSession,
      triggerData,
    })

    return {
      success: false,
      error: {
        message: 'Error resolving billing account',
        statusCode: 500,
        logCreated: true,
        retryable: isRetryableInfrastructureError(error),
        cause: describeRetryableInfrastructureError(error),
      },
    }
  }

  // ========== STEPS 3.5–6: Preflight Gates ==========
  // Read-only gates (ban, subscription, usage) run concurrently; the stateful
  // rate-limit gate runs after they pass. Precedence: ban 403 → usage 402 → rate 429.

  /**
   * A failing gate's deferred outcome: the response to return, plus an optional
   * error-log write to flush before returning. Evaluated in precedence order.
   */
  interface GateFailure {
    response: PreprocessExecutionResult
    recordError?: Parameters<typeof recordPreprocessingError>[0]
  }

  /** Usage figures captured by STEP 5 and reused by the STEP 7 reservation. */
  interface UsageSnapshot {
    currentUsage: number
    limit: number
  }

  const banCheck = (async (): Promise<GateFailure | null> => {
    // Blocks executions when the billing actor, the workflow owner, or the
    // caller-provided userId (chat deployer, authenticated caller) has an
    // active ban or a blocked email domain. The owner comes from the workflow
    // record so schedules — which pass the 'unknown' sentinel — are covered.
    const banCandidateIds = [actorUserId]
    if (userId && userId !== 'unknown' && userId !== actorUserId) {
      banCandidateIds.push(userId)
    }
    if (workflowRecord.userId && !banCandidateIds.includes(workflowRecord.userId)) {
      banCandidateIds.push(workflowRecord.userId)
    }
    try {
      const bannedUserIds = await getActivelyBannedUserIds(banCandidateIds)
      if (bannedUserIds.length > 0) {
        logger.warn(`[${requestId}] Execution blocked: banned account`, {
          workflowId,
          bannedUserIds,
          triggerType,
        })

        return {
          response: {
            success: false,
            error: {
              message: 'Account suspended',
              statusCode: 403,
              logCreated: true,
            },
          },
          recordError: {
            workflowId,
            executionId,
            triggerType,
            requestId,
            userId: actorUserId,
            workspaceId,
            errorMessage: 'This account has been suspended. Workflow executions are blocked.',
            loggingSession: providedLoggingSession,
            triggerData,
          },
        }
      }
      return null
    } catch (error) {
      logger.error(`[${requestId}] Error checking account ban status`, { error, actorUserId })

      return {
        response: {
          success: false,
          error: {
            message: 'Unable to verify account status. Execution blocked for security.',
            statusCode: 500,
            logCreated: true,
            retryable: isRetryableInfrastructureError(error),
            cause: describeRetryableInfrastructureError(error),
          },
        },
        recordError: {
          workflowId,
          executionId,
          triggerType,
          requestId,
          userId: actorUserId,
          workspaceId,
          errorMessage: 'Unable to verify account status. Execution blocked for security.',
          loggingSession: providedLoggingSession,
          triggerData,
        },
      }
    }
  })()

  // ========== STEP 4: Get Subscription ==========
  const subscriptionFetch = getHighestPrioritySubscription(actorUserId)

  const [banFailure, userSubscription] = await Promise.all([banCheck, subscriptionFetch])

  /**
   * STEP 5: usage + per-member org usage gate. Returns the failure outcome (or
   * `null` on pass/skip) plus the usage snapshot reused by the STEP 7 admission
   * reservation. The snapshot is returned rather than written to an outer
   * variable so concurrent gate tasks share no mutable state.
   */
  const usageCheckTask = (async (): Promise<{
    failure: GateFailure | null
    snapshot: UsageSnapshot | null
  }> => {
    if (skipUsageLimits) return { failure: null, snapshot: null }
    let snapshot: UsageSnapshot | null = null
    try {
      const usageCheck = await checkServerSideUsageLimits(actorUserId, userSubscription)
      snapshot = { currentUsage: usageCheck.currentUsage, limit: usageCheck.limit }
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

        return {
          failure: {
            response: {
              success: false,
              error: {
                message:
                  usageCheck.message ||
                  'Usage limit exceeded. Please upgrade your plan to continue.',
                statusCode: 402,
                logCreated: true,
              },
            },
            recordError: {
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
              triggerData,
            },
          },
          snapshot,
        }
      }

      // Per-member org-workspace cap (hosted-only). Independent, additive gate:
      // blocks an individual member's executions in org-owned workspaces once
      // their personal credit limit for the org is reached, even if the pooled
      // org limit still has room.
      const memberUsageCheck = await checkOrgMemberUsageLimit(actorUserId, workspaceId)
      if (memberUsageCheck.isExceeded) {
        const memberLimitMessage =
          memberUsageCheck.message ||
          'Member usage limit exceeded for this organization. Ask an organization admin to raise your credit limit to continue.'

        logger.warn(
          `[${requestId}] User ${actorUserId} exceeded their per-member org usage limit. Blocking execution.`,
          {
            currentUsage: memberUsageCheck.currentUsage,
            limit: memberUsageCheck.limit,
            workflowId,
            triggerType,
          }
        )

        return {
          failure: {
            response: {
              success: false,
              error: {
                message: memberLimitMessage,
                statusCode: 402,
                logCreated: true,
              },
            },
            recordError: {
              workflowId,
              executionId,
              triggerType,
              requestId,
              userId: actorUserId,
              workspaceId,
              errorMessage: memberLimitMessage,
              loggingSession: providedLoggingSession,
              triggerData,
            },
          },
          snapshot,
        }
      }
      return { failure: null, snapshot }
    } catch (error) {
      logger.error(`[${requestId}] Error checking usage limits`, {
        error,
        actorUserId,
      })

      return {
        failure: {
          response: {
            success: false,
            error: {
              message: 'Unable to determine usage limits. Execution blocked for security.',
              statusCode: 500,
              logCreated: true,
              retryable: isRetryableInfrastructureError(error),
              cause: describeRetryableInfrastructureError(error),
            },
          },
          recordError: {
            workflowId,
            executionId,
            triggerType,
            requestId,
            userId: actorUserId,
            workspaceId,
            errorMessage:
              'Unable to determine usage limits. Execution blocked for security. Please contact support.',
            loggingSession: providedLoggingSession,
            triggerData,
          },
        },
        snapshot,
      }
    }
  })()

  // ========== STEP 6: Check Rate Limits ==========
  let rateLimitInfo: { allowed: boolean; remaining: number; resetAt: Date } | undefined

  /**
   * STEP 6: rate-limit gate. Unlike the other gates this one is NOT read-only —
   * `checkRateLimitWithSubscription` consumes a token — so it is invoked
   * sequentially only after the ban and usage gates pass, matching the original
   * order. Running it eagerly or in parallel would debit rate-limit quota for
   * requests that ban or usage rejects. Returns the failure outcome, or `null`
   * on pass/skip; on a non-error outcome it populates `rateLimitInfo`.
   */
  const runRateLimitGate = async (): Promise<GateFailure | null> => {
    if (!checkRateLimit) return null
    try {
      const rateLimiter = new RateLimiter()
      const info = await rateLimiter.checkRateLimitWithSubscription(
        actorUserId,
        userSubscription,
        triggerType,
        false // not async
      )
      rateLimitInfo = info

      if (!info.allowed) {
        logger.warn(`[${requestId}] Rate limit exceeded for user ${actorUserId}`, {
          triggerType,
          remaining: info.remaining,
          resetAt: info.resetAt,
        })

        return {
          response: {
            success: false,
            error: {
              message: `Rate limit exceeded. Please try again later.`,
              statusCode: 429,
              logCreated: true,
            },
          },
          recordError: {
            workflowId,
            executionId,
            triggerType,
            requestId,
            userId: actorUserId,
            workspaceId,
            errorMessage: `Rate limit exceeded. ${info.remaining} requests remaining. Resets at ${info.resetAt.toISOString()}.`,
            loggingSession: providedLoggingSession,
            triggerData,
          },
        }
      }
      return null
    } catch (error) {
      logger.error(`[${requestId}] Error checking rate limits`, { error, actorUserId })

      return {
        response: {
          success: false,
          error: {
            message: 'Error checking rate limits',
            statusCode: 500,
            logCreated: true,
            retryable: isRetryableInfrastructureError(error),
            cause: describeRetryableInfrastructureError(error),
          },
        },
        recordError: {
          workflowId,
          executionId,
          triggerType,
          requestId,
          userId: actorUserId,
          workspaceId,
          errorMessage: 'Error checking rate limits. Execution blocked for safety.',
          loggingSession: providedLoggingSession,
          triggerData,
        },
      }
    }
  }

  const usageResult = await usageCheckTask
  const usageSnapshot = usageResult.snapshot

  const readGateFailure = banFailure ?? usageResult.failure
  if (readGateFailure) {
    if (readGateFailure.recordError) {
      await recordPreprocessingError(readGateFailure.recordError)
    }
    return readGateFailure.response
  }

  const rateLimitFailure = await runRateLimitGate()
  if (rateLimitFailure) {
    if (rateLimitFailure.recordError) {
      await recordPreprocessingError(rateLimitFailure.recordError)
    }
    return rateLimitFailure.response
  }

  /**
   * STEP 7: Atomic admission reservation. Cost is only recorded once an
   * execution finishes, so without this a burst of concurrent executions all
   * observe the same pre-burst usage and all pass the gate above. Reserving
   * bounds in-flight (un-costed) executions per billing entity. Done last so an
   * earlier rejection never leaves a slot held; the slot is released at
   * execution completion (see {@link LoggingSession}).
   */
  if (!skipUsageLimits && !skipConcurrencyReservation && usageSnapshot) {
    try {
      const { reserved } = await reserveExecutionSlot({
        userId: actorUserId,
        executionId,
        subscription: userSubscription,
        currentUsage: usageSnapshot.currentUsage,
        limit: usageSnapshot.limit,
      })

      if (!reserved) {
        logger.warn(`[${requestId}] Admission reservation full for user ${actorUserId}`, {
          workflowId,
          triggerType,
        })

        await recordPreprocessingError({
          workflowId,
          executionId,
          triggerType,
          requestId,
          userId: actorUserId,
          workspaceId,
          errorMessage:
            'Too many concurrent executions in flight for this account. Please wait for in-progress runs to finish and try again.',
          loggingSession: providedLoggingSession,
          triggerData,
        })

        return {
          success: false,
          error: {
            message:
              'Too many concurrent executions in flight. Please wait for in-progress runs to finish and try again.',
            statusCode: 429,
            logCreated: true,
            retryable: true,
          },
        }
      }
    } catch (error) {
      logger.error(`[${requestId}] Unexpected error reserving admission slot`, {
        error,
        actorUserId,
      })
    }
  }

  // ========== SUCCESS: All Checks Passed ==========
  logger.info(`[${requestId}] All preprocessing checks passed`, {
    workflowId,
    actorUserId,
    triggerType,
  })

  const plan = userSubscription?.plan as SubscriptionPlan | undefined
  return {
    success: true,
    actorUserId,
    workflowRecord,
    userSubscription,
    rateLimitInfo,
    executionTimeout: {
      sync: getExecutionTimeout(plan, 'sync'),
      async: getExecutionTimeout(plan, 'async'),
    },
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
  triggerData?: SessionStartParams['triggerData']
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
    triggerData,
  } = params

  if (!workspaceId) {
    logger.warn(`[${requestId}] Cannot log preprocessing error: no workspaceId available`, {
      workflowId,
      executionId,
      errorMessage,
    })
    return
  }

  try {
    const session =
      loggingSession || new LoggingSession(workflowId, executionId, triggerType, requestId)

    await session.safeStart({
      userId,
      workspaceId,
      variables: {},
      triggerData,
    })

    await session.safeCompleteWithError({
      error: {
        message: errorMessage,
        stackTrace: undefined,
      },
      traceSpans: [],
      skipCost: true, // Preprocessing errors should not charge - no execution occurred
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
