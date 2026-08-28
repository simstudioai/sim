import type { workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getActiveWorkflowRecord } from '@sim/platform-authz/workflow'
import { getActivelyBannedUserIds } from '@/lib/auth/ban'
import {
  reserveExecutionSlot,
  UsageReservationUnavailableError,
} from '@/lib/billing/calculations/usage-reservation'
import {
  assertBillingAttributionSnapshot,
  type BillingAttributionSnapshot,
  checkAttributedUsageLimits,
  resolveBillingAttribution,
  resolveSystemBillingAttribution,
} from '@/lib/billing/core/billing-attribution'
import type { HighestPrioritySubscription } from '@/lib/billing/core/plan'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import {
  type AdmissionErrorDescriptor,
  getReservationDenialDescriptor,
  type ReservationDenialReason,
} from '@/lib/core/admission/transient-failure'
import {
  describeRetryableInfrastructureError,
  isRetryableInfrastructureError,
} from '@/lib/core/errors/retryable-infrastructure'
import {
  getExecutionTimeout,
  RESERVATION_TTL_BUFFER_MS,
  resolveAsyncExecutionTimeout,
} from '@/lib/core/execution-limits'
import {
  type ExecutionTimeoutSource,
  recordExecutionTimeoutResolution,
} from '@/lib/core/execution-limits/metrics'
import { RateLimiter } from '@/lib/core/rate-limiter/rate-limiter'
import type { SubscriptionPlan } from '@/lib/core/rate-limiter/types'
import { LoggingSession, type SessionStartParams } from '@/lib/logs/execution/logging-session'
import type { CoreTriggerType } from '@/stores/logs/filters/types'

const logger = createLogger('ExecutionPreprocessing')

const BILLING_ERROR_MESSAGES = {
  BILLING_REQUIRED:
    'Unable to resolve billing account. This workflow cannot execute without a valid billing account.',
  BILLING_ERROR_GENERIC: 'Error resolving billing account',
} as const

const RESERVATION_DENIAL_MESSAGE = {
  payer_concurrency:
    'Too many concurrent executions are in progress for this billing account. Please wait for them to finish and try again.',
  payer_headroom:
    'This billing account has no guaranteed base-charge headroom. Wait for in-progress executions to finish or raise the usage limit.',
  member_headroom:
    'Your organization member usage limit has no guaranteed base-charge headroom. Wait for in-progress executions to finish or ask an administrator to raise your limit.',
} as const satisfies Record<ReservationDenialReason, string>

export interface PreprocessExecutionOptions {
  workflowId: string
  userId: string
  triggerType: CoreTriggerType
  executionId: string
  /** Reservation identity; defaults to `executionId` for initial executions. */
  reservationId?: string
  requestId: string

  checkRateLimit?: boolean
  /**
   * Which execution token bucket the rate-limit gate debits. Ignored when
   * `checkRateLimit` is false. Defaults to `'sync'` — the historical behavior
   * for every surface, including async-queued v1 runs.
   */
  rateLimitCounter?: 'sync' | 'async'
  checkDeployment?: boolean
  skipUsageLimits?: boolean
  /**
   * Skip the atomic in-flight concurrency reservation while still enforcing the
   * usage-cost cap. Default: false. Set by surfaces that already bound and pace
   * their own fan-out (e.g. table-cell dispatch, which is row-bounded, async
   * rate-limited, and surfaces a graceful "wait/upgrade" state) so the
   * reservation's 429 can't surface as a hard error there.
   */
  skipConcurrencyReservation?: boolean
  /** Skip execution-log error rows when the caller presents the failure itself. */
  logPreprocessingErrors?: boolean
  /**
   * Skip execution-log error rows ONLY for retryable infrastructure failures
   * (`statusCode >= 500 && retryable`). Set by callers that requeue such
   * failures under the same execution id, so an attempt that will be retried
   * does not leave a terminal failed row behind; the caller passes `false`
   * again on its final attempt so an exhausted retry still records the row.
   */
  suppressRetryableFailureLogs?: boolean

  workspaceId?: string
  loggingSession?: LoggingSession
  triggerData?: SessionStartParams['triggerData']
  /** Use the authenticated user as actor for client executions and personal API keys. */
  useAuthenticatedUserAsActor?: boolean
  /** Pre-fetched workflow row for caller context; preprocessing still re-checks active state. */
  workflowRecord?: WorkflowRecord
  /**
   * Immutable attribution captured by an upstream execution boundary. Background
   * and resume paths pass this through so payer ownership cannot change while
   * work is queued or paused. Only initial execution entry points may omit it
   * and resolve the workspace-selected payer here; serialized boundaries require
   * the previously captured snapshot before calling preprocessing.
   */
  billingAttribution?: BillingAttributionSnapshot
  /** Attempt type used to size its reservation and return the applicable timeout. */
  executionType?: 'sync' | 'async'
  /** Async API-only request cap in seconds. */
  requestedTimeoutSeconds?: number
  /** Absolute active-attempt deadline, when the caller already started its timeout clock. */
  executionDeadlineAt?: number
}

export interface PreprocessExecutionError {
  message: string
  statusCode: number
  code?: string
  retryable?: boolean
  /**
   * How long the caller should wait before retrying, so surfaces can emit
   * `Retry-After`. Set by rate-limit denials from the token bucket, and by
   * admission denials from their descriptor's declared `retryAfterSeconds`.
   */
  retryAfterMs?: number
  cause?: Record<string, unknown>
}

/**
 * Carries an admission descriptor's declared retry pacing to the transport,
 * which speaks milliseconds.
 *
 * The descriptors in `lib/core/admission/transient-failure` already decide how
 * long each denial should hold a caller off, but that value used to stop here:
 * only `statusCode`, `code`, and `retryable` were copied onto the preprocess
 * error, so a concurrency denial reached the client as a bare `429` with no
 * `Retry-After` despite the policy layer having named the wait. The transport
 * is not the right place to re-guess a number the policy already owns.
 */
function retryAfterMsFrom(retryAfterSeconds: number | undefined): { retryAfterMs?: number } {
  return retryAfterSeconds === undefined ? {} : { retryAfterMs: retryAfterSeconds * 1000 }
}

export const WORKFLOW_NOT_DEPLOYED_CODE = 'WORKFLOW_NOT_DEPLOYED'

export interface PreprocessExecutionSuccess {
  success: true
  actorUserId: string
  workflowRecord: WorkflowRecord
  actorSubscription: SubscriptionInfo
  billingAttribution: BillingAttributionSnapshot
  executionTimeout: {
    sync: number
    async: number
  }
}

export interface PreprocessExecutionFailure {
  success: false
  error: PreprocessExecutionError
}

export type PreprocessExecutionResult = PreprocessExecutionSuccess | PreprocessExecutionFailure

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
    reservationId = executionId,
    requestId,
    checkRateLimit = triggerType !== 'manual' && triggerType !== 'chat',
    rateLimitCounter = 'sync',
    checkDeployment = triggerType !== 'manual',
    skipUsageLimits = false,
    skipConcurrencyReservation = false,
    logPreprocessingErrors = true,
    suppressRetryableFailureLogs = false,
    workspaceId: providedWorkspaceId,
    loggingSession: providedLoggingSession,
    triggerData,
    useAuthenticatedUserAsActor = false,
    workflowRecord: prefetchedWorkflowRecord,
    billingAttribution: providedBillingAttribution,
    executionType = 'sync',
    requestedTimeoutSeconds,
    executionDeadlineAt,
  } = options

  /** Suppresses log rows when the caller surfaces preprocessing failures itself. */
  const recordPreprocessingError: typeof logPreprocessingError = (args) =>
    logPreprocessingErrors ? logPreprocessingError(args) : Promise.resolve()

  /** True when this failure's log row is deferred to a caller that will requeue it. */
  const isFailureLogSuppressed = (failure: PreprocessExecutionError): boolean =>
    suppressRetryableFailureLogs && failure.statusCode >= 500 && failure.retryable === true

  logger.info(`[${requestId}] Starting execution preprocessing`, {
    workflowId,
    userId,
    triggerType,
    executionId,
  })

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
          },
        }
      }
    } catch (error) {
      logger.error(`[${requestId}] Error fetching workflow`, { error, workflowId })

      const failure: PreprocessExecutionError = {
        message: 'Internal error while fetching workflow',
        statusCode: 500,
        retryable: isRetryableInfrastructureError(error),
        cause: describeRetryableInfrastructureError(error),
      }
      if (!isFailureLogSuppressed(failure)) {
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
      }

      return { success: false, error: failure }
    }
  } else if (workflowRecord.archivedAt) {
    logger.warn(`[${requestId}] Prefetched workflow is archived: ${workflowId}`)
    return {
      success: false,
      error: {
        message: 'Workflow not found',
        statusCode: 404,
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
      },
    }
  }

  /** Undeployed workflows are rejected without creating an execution or cost log. */
  if (checkDeployment && !workflowRecord.isDeployed) {
    logger.warn(`[${requestId}] Workflow not deployed: ${workflowId}`)

    return {
      success: false,
      error: {
        message: 'Workflow is not deployed',
        statusCode: 403,
        code: WORKFLOW_NOT_DEPLOYED_CODE,
      },
    }
  }

  /** Resolves the initiating actor and exact workspace payer. */
  let actorUserId: string | null = null
  let billingAttribution: BillingAttributionSnapshot | null = null

  try {
    if (providedBillingAttribution) {
      const validatedAttribution = assertBillingAttributionSnapshot(providedBillingAttribution)
      if (validatedAttribution.workspaceId !== workspaceId) {
        throw new Error(
          `Billing attribution workspace mismatch: expected ${workspaceId}, received ${validatedAttribution.workspaceId}`
        )
      }
      actorUserId = validatedAttribution.actorUserId
      billingAttribution = validatedAttribution
      logger.info(`[${requestId}] Reusing serialized billing attribution`, {
        actorUserId,
        billingEntity: billingAttribution.billingEntity,
      })
    }

    if (!actorUserId && useAuthenticatedUserAsActor && userId) {
      actorUserId = userId
      logger.info(`[${requestId}] Using authenticated user as actor: ${actorUserId}`)
    }

    if (!actorUserId) {
      billingAttribution = await resolveSystemBillingAttribution(workspaceId)
      actorUserId = billingAttribution.actorUserId
      logger.info(`[${requestId}] Using atomically resolved system actor and payer`, {
        actorUserId,
        billingEntity: billingAttribution.billingEntity,
      })
    }

    if (!actorUserId) {
      const errorLogUserId = userId || 'unknown'
      logger.warn(`[${requestId}] ${BILLING_ERROR_MESSAGES.BILLING_REQUIRED}`, {
        workflowId,
        workspaceId,
      })

      await recordPreprocessingError({
        workflowId,
        executionId,
        triggerType,
        requestId,
        userId: errorLogUserId,
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
        },
      }
    }

    if (!billingAttribution) {
      billingAttribution = await resolveBillingAttribution({ actorUserId, workspaceId })
    }
  } catch (error) {
    logger.error(`[${requestId}] Error resolving billing attribution`, { error, workflowId })
    const errorLogUserId = userId || 'unknown'
    const failure: PreprocessExecutionError = {
      message: 'Error resolving billing account',
      statusCode: 500,
      retryable: isRetryableInfrastructureError(error),
      cause: describeRetryableInfrastructureError(error),
    }
    if (!isFailureLogSuppressed(failure)) {
      await recordPreprocessingError({
        workflowId,
        executionId,
        triggerType,
        requestId,
        userId: errorLogUserId,
        workspaceId,
        errorMessage: BILLING_ERROR_MESSAGES.BILLING_ERROR_GENERIC,
        loggingSession: providedLoggingSession,
        triggerData,
      })
    }

    return { success: false, error: failure }
  }

  const plan = billingAttribution.payerSubscription?.plan as SubscriptionPlan | undefined
  const policyAsyncTimeout = getExecutionTimeout(
    plan,
    'async',
    billingAttribution.payerSubscription?.enterpriseWorkflowExecutionTimeoutSeconds
  )
  const executionTimeout = {
    sync: getExecutionTimeout(plan, 'sync'),
    async: resolveAsyncExecutionTimeout(policyAsyncTimeout, requestedTimeoutSeconds),
  }

  /**
   * A failing gate's deferred outcome: the response to return, plus an optional
   * error-log write to flush before returning. Evaluated in precedence order.
   */
  interface GateFailure {
    response: PreprocessExecutionFailure
    recordError?: Parameters<typeof recordPreprocessingError>[0]
  }

  /** Usage figures captured by the read gate and reused by the atomic reservation. */
  interface UsageSnapshot {
    currentUsage: number
    limit: number
    memberUsage?: {
      currentUsage: number
      limit: number
    }
  }

  const banCheck = (async (): Promise<GateFailure | null> => {
    /**
     * Blocks when the resolved actor, workflow owner, or caller-provided user
     * has an active ban or blocked email domain. Including the workflow owner
     * covers system-triggered executions.
     */
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

  const subscriptionFetch = getHighestPrioritySubscription(actorUserId)

  /**
   * Returns the usage failure and reservation snapshot together so concurrent
   * read gates do not communicate through mutable outer state.
   */
  const usageCheckTask = (async (): Promise<{
    failure: GateFailure | null
    snapshot: UsageSnapshot | null
  }> => {
    if (skipUsageLimits) return { failure: null, snapshot: null }
    let snapshot: UsageSnapshot | null = null
    try {
      const usageCheck = await checkAttributedUsageLimits(billingAttribution)
      snapshot = usageCheck.payerUsage
        ? {
            ...usageCheck.payerUsage,
            ...(usageCheck.memberUsage?.limit !== null &&
            usageCheck.memberUsage?.limit !== undefined
              ? {
                  memberUsage: {
                    currentUsage: usageCheck.memberUsage.currentUsage,
                    limit: usageCheck.memberUsage.limit,
                  },
                }
              : {}),
          }
        : null
      if (usageCheck.isExceeded) {
        logger.warn(`[${requestId}] Attributed usage gate blocked actor ${actorUserId}.`, {
          currentUsage: snapshot?.currentUsage,
          limit: snapshot?.limit,
          scope: usageCheck.scope,
          workflowId,
          triggerType,
        })

        return {
          failure: {
            response: {
              success: false,
              error: {
                message:
                  usageCheck.message ||
                  'Usage limit exceeded. Please upgrade your plan to continue.',
                statusCode: 402,
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
                `Usage limit exceeded: $${snapshot?.currentUsage.toFixed(2) ?? '0.00'} used of $${snapshot?.limit.toFixed(2) ?? '0.00'} limit. Please upgrade your plan to continue.`,
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

  /**
   * Ban, subscription, and usage checks are read-only and start together. Their
   * completion order must not affect the fixed ban → usage rejection precedence.
   */
  const [banFailure, actorSubscription, usageResult] = await Promise.all([
    banCheck,
    subscriptionFetch,
    usageCheckTask,
  ])

  /**
   * Rate limiting consumes a token, so it remains sequential and runs only after
   * the ban and usage gates pass.
   */
  const runRateLimitGate = async (): Promise<GateFailure | null> => {
    if (!checkRateLimit) return null
    try {
      const rateLimiter = new RateLimiter()
      const info = await rateLimiter.checkRateLimitWithSubscription(
        actorUserId,
        actorSubscription,
        triggerType,
        rateLimitCounter === 'async'
      )

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
              /**
               * Distinguishes quota exhaustion from the concurrency-slot 429
               * (`EXECUTION_CONCURRENCY_LIMIT`, retryable in seconds) — the two
               * need different caller behavior.
               */
              code: 'RATE_LIMIT_EXCEEDED',
              retryAfterMs: info.retryAfterMs ?? Math.max(0, info.resetAt.getTime() - Date.now()),
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

  const usageSnapshot = usageResult.snapshot

  const readGateFailure = banFailure ?? usageResult.failure
  if (readGateFailure) {
    if (readGateFailure.recordError && !isFailureLogSuppressed(readGateFailure.response.error)) {
      await recordPreprocessingError(readGateFailure.recordError)
    }
    return readGateFailure.response
  }

  const rateLimitFailure = await runRateLimitGate()
  if (rateLimitFailure) {
    if (rateLimitFailure.recordError && !isFailureLogSuppressed(rateLimitFailure.response.error)) {
      await recordPreprocessingError(rateLimitFailure.recordError)
    }
    return rateLimitFailure.response
  }

  /**
   * Cost lands only after execution, so the atomic reservation closes the
   * check-then-use race for concurrent uncosted work. It runs last to ensure an
   * earlier rejection cannot leave a slot held.
   */
  if (!skipUsageLimits && !skipConcurrencyReservation && usageSnapshot) {
    try {
      const reservation = await reserveExecutionSlot({
        billingEntity: billingAttribution.billingEntity,
        reservationId,
        plan: billingAttribution.payerSubscription?.plan,
        enterpriseConcurrencyLimit:
          billingAttribution.payerSubscription?.enterpriseConcurrencyLimit,
        currentUsage: usageSnapshot.currentUsage,
        limit: usageSnapshot.limit,
        ...(executionTimeout[executionType] > 0
          ? {
              expiresAt:
                (executionDeadlineAt ?? Date.now() + executionTimeout[executionType]) +
                RESERVATION_TTL_BUFFER_MS,
            }
          : {}),
        ...(billingAttribution.organizationId && usageSnapshot.memberUsage
          ? {
              member: {
                organizationId: billingAttribution.organizationId,
                actorUserId: billingAttribution.actorUserId,
                currentUsage: usageSnapshot.memberUsage.currentUsage,
                limit: usageSnapshot.memberUsage.limit,
              },
            }
          : {}),
      })

      if (!reservation.reserved) {
        /**
         * Widened to the declared interface so the optional `retryAfterSeconds`
         * is readable: the const descriptors narrow to literal shapes where the
         * non-retryable 402 members simply omit the key.
         */
        const descriptor: AdmissionErrorDescriptor = getReservationDenialDescriptor(
          reservation.reason
        )
        const message = RESERVATION_DENIAL_MESSAGE[reservation.reason]
        logger.warn(`[${requestId}] Admission reservation full for user ${actorUserId}`, {
          workflowId,
          triggerType,
          constraint: reservation.reason,
        })

        await recordPreprocessingError({
          workflowId,
          executionId,
          triggerType,
          requestId,
          userId: actorUserId,
          workspaceId,
          errorMessage: message,
          loggingSession: providedLoggingSession,
          triggerData,
        })

        return {
          success: false,
          error: {
            message,
            statusCode: descriptor.statusCode,
            code: descriptor.code,
            retryable: descriptor.retryable,
            ...retryAfterMsFrom(descriptor.retryAfterSeconds),
            cause: {
              code: descriptor.code,
              constraint: reservation.reason,
            },
          },
        }
      }
    } catch (error) {
      logger.error(`[${requestId}] Admission reservation infrastructure unavailable`, {
        error,
        actorUserId,
      })
      const unavailable =
        error instanceof UsageReservationUnavailableError
          ? error
          : new UsageReservationUnavailableError(
              'Usage admission is temporarily unavailable. Please retry.',
              error
            )

      /**
       * Matches the denial path above. Without this a run rejected because the
       * admission infrastructure was unreachable left no execution log at all,
       * so it disappeared from the workspace's logs rather than showing as a
       * failure — the denial branch twenty lines up always recorded one.
       */
      await recordPreprocessingError({
        workflowId,
        executionId,
        triggerType,
        requestId,
        userId: actorUserId,
        workspaceId,
        errorMessage: unavailable.message,
        loggingSession: providedLoggingSession,
        triggerData,
      })

      return {
        success: false,
        error: {
          message: unavailable.message,
          statusCode: unavailable.statusCode,
          code: unavailable.code,
          retryable: unavailable.retryable,
          ...retryAfterMsFrom(unavailable.retryAfterSeconds),
          cause: {
            code: unavailable.code,
          },
        },
      }
    }
  }

  logger.info(`[${requestId}] All preprocessing checks passed`, {
    workflowId,
    actorUserId,
    triggerType,
  })

  const requestedTimeoutMs = requestedTimeoutSeconds ? requestedTimeoutSeconds * 1000 : undefined
  const timeoutSource: ExecutionTimeoutSource =
    executionType === 'async' &&
    requestedTimeoutMs !== undefined &&
    (policyAsyncTimeout === 0 || requestedTimeoutMs < policyAsyncTimeout)
      ? 'async_request_override'
      : executionType === 'async' &&
          plan?.toLowerCase() === 'enterprise' &&
          billingAttribution.payerSubscription?.enterpriseWorkflowExecutionTimeoutSeconds !==
            undefined
        ? 'enterprise_metadata'
        : executionTimeout[executionType] === 0
          ? 'unbounded'
          : 'plan_default'
  recordExecutionTimeoutResolution({
    source: timeoutSource,
    executionType,
    effectiveTimeoutMs: executionTimeout[executionType],
  })

  return {
    success: true,
    actorUserId,
    workflowRecord,
    actorSubscription,
    billingAttribution,
    executionTimeout,
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
      skipCost: true,
    })
  } catch (error) {
    logger.error(`[${requestId}] Failed to log preprocessing error`, {
      error,
      workflowId,
      executionId,
    })
  }
}
