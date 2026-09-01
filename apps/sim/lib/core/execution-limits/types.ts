import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import {
  MAX_WORKFLOW_EXECUTION_TIMEOUT_SECONDS,
  parseWorkflowExecutionTimeoutSeconds,
  resolveEnterpriseWorkflowExecutionTimeoutFallbackSeconds,
} from '@/lib/billing/execution-timeout-defaults'
import { getPlanTypeForLimits } from '@/lib/billing/plan-helpers'
import { env } from '@/lib/core/config/env'
import { isBillingEnabled } from '@/lib/core/config/env-flags'
import type { SubscriptionPlan } from '@/lib/core/rate-limiter/types'

interface ExecutionTimeoutConfig {
  sync: number
  async: number
}

const DEFAULT_SYNC_TIMEOUTS_SECONDS = {
  free: 300,
  pro: 3000,
  team: 3000,
  enterprise: 3000,
} as const

const DEFAULT_ASYNC_TIMEOUTS_SECONDS = {
  free: 5400,
  pro: 5400,
  team: 5400,
  enterprise: 5400,
} as const

function getSyncTimeoutForPlan(plan: SubscriptionPlan): number {
  const envVarMap: Record<SubscriptionPlan, string | undefined> = {
    free: env.EXECUTION_TIMEOUT_FREE,
    pro: env.EXECUTION_TIMEOUT_PRO,
    team: env.EXECUTION_TIMEOUT_TEAM,
    enterprise: env.EXECUTION_TIMEOUT_ENTERPRISE,
  }
  return (Number.parseInt(envVarMap[plan] || '') || DEFAULT_SYNC_TIMEOUTS_SECONDS[plan]) * 1000
}

function getAsyncTimeoutForPlan(plan: SubscriptionPlan): number {
  const envVarMap: Record<SubscriptionPlan, string | undefined> = {
    free: env.EXECUTION_TIMEOUT_ASYNC_FREE,
    pro: env.EXECUTION_TIMEOUT_ASYNC_PRO,
    team: env.EXECUTION_TIMEOUT_ASYNC_TEAM,
    enterprise: env.EXECUTION_TIMEOUT_ASYNC_ENTERPRISE,
  }
  if (plan === 'enterprise') {
    return resolveEnterpriseWorkflowExecutionTimeoutFallbackSeconds(envVarMap[plan]) * 1000
  }

  return (Number.parseInt(envVarMap[plan] || '') || DEFAULT_ASYNC_TIMEOUTS_SECONDS[plan]) * 1000
}

const EXECUTION_TIMEOUTS: Record<SubscriptionPlan, ExecutionTimeoutConfig> = {
  free: {
    sync: getSyncTimeoutForPlan('free'),
    async: getAsyncTimeoutForPlan('free'),
  },
  pro: {
    sync: getSyncTimeoutForPlan('pro'),
    async: getAsyncTimeoutForPlan('pro'),
  },
  team: {
    sync: getSyncTimeoutForPlan('team'),
    async: getAsyncTimeoutForPlan('team'),
  },
  enterprise: {
    sync: getSyncTimeoutForPlan('enterprise'),
    async: getAsyncTimeoutForPlan('enterprise'),
  },
}

/**
 * Per-plan execution timeout in milliseconds; `0` means no timeout.
 * Billing-disabled deployments run untimed unless the operator explicitly set
 * the free-tier env var (`EXECUTION_TIMEOUT_FREE` /
 * `EXECUTION_TIMEOUT_ASYNC_FREE`), which opts back into that bound.
 */
export function getExecutionTimeout(
  plan: SubscriptionPlan | string | undefined,
  type: 'sync' | 'async' = 'sync',
  enterpriseWorkflowExecutionTimeoutSeconds?: number
): number {
  if (!isBillingEnabled) {
    const override = Number.parseInt(
      (type === 'sync' ? env.EXECUTION_TIMEOUT_FREE : env.EXECUTION_TIMEOUT_ASYNC_FREE) || ''
    )
    return Number.isFinite(override) && override > 0 ? EXECUTION_TIMEOUTS.free[type] : 0
  }
  const planType = getPlanTypeForLimits(plan)
  if (type === 'async' && planType === 'enterprise') {
    const configuredTimeout = parseWorkflowExecutionTimeoutSeconds(
      enterpriseWorkflowExecutionTimeoutSeconds
    )
    if (configuredTimeout !== null) return configuredTimeout * 1000
  }
  return EXECUTION_TIMEOUTS[planType][type]
}

/** Resolves the async execution policy captured in a trusted billing snapshot. */
export function getAsyncExecutionTimeoutForBillingAttribution(
  billingAttribution: BillingAttributionSnapshot
): number {
  const payerSubscription = billingAttribution.payerSubscription
  return getExecutionTimeout(
    payerSubscription?.plan,
    'async',
    payerSubscription?.enterpriseWorkflowExecutionTimeoutSeconds
  )
}

export function getMaxExecutionTimeout(): number {
  return MAX_WORKFLOW_EXECUTION_TIMEOUT_SECONDS * 1000
}

/** Applies an async API request cap without allowing it to exceed account policy. */
export function resolveAsyncExecutionTimeout(
  policyTimeoutMs: number,
  requestedTimeoutSeconds?: number
): number {
  const requested = parseWorkflowExecutionTimeoutSeconds(requestedTimeoutSeconds)
  if (requested === null) return policyTimeoutMs

  const requestedTimeoutMs = requested * 1000
  return policyTimeoutMs > 0 ? Math.min(policyTimeoutMs, requestedTimeoutMs) : requestedTimeoutMs
}

/** Caps an already-normalized timeout while preserving an untimed policy. */
export function capExecutionTimeoutMs(
  policyTimeoutMs: number,
  requestedTimeoutMs?: number
): number {
  if (
    requestedTimeoutMs === undefined ||
    !Number.isFinite(requestedTimeoutMs) ||
    requestedTimeoutMs <= 0
  ) {
    return policyTimeoutMs
  }
  return policyTimeoutMs > 0 ? Math.min(policyTimeoutMs, requestedTimeoutMs) : requestedTimeoutMs
}

/** Trigger.dev requires per-run max durations to be integer seconds and at least five seconds. */
export function toTriggerMaxDurationSeconds(timeoutMs?: number): number | undefined {
  if (!timeoutMs || timeoutMs <= 0) return undefined
  return Math.max(5, Math.ceil((timeoutMs + RESERVATION_TTL_BUFFER_MS) / 1000))
}

/** Safety buffer added beyond the max execution timeout for execution-lifetime TTLs. */
export const RESERVATION_TTL_BUFFER_MS = 5 * 60_000

/**
 * TTL (ms) bounding how long a single execution can remain in flight: the max
 * execution timeout plus a safety buffer. Shared source of truth for the
 * admission-reservation key and the live progress-marker key so they expire on
 * the same timeline.
 */
export function getExecutionReservationTtlMs(): number {
  return getMaxExecutionTimeout() + RESERVATION_TTL_BUFFER_MS
}

export const DEFAULT_EXECUTION_TIMEOUT_MS = EXECUTION_TIMEOUTS.free.sync

export function isTimeoutError(error: unknown): boolean {
  if (!error) return false

  if (error instanceof Error) {
    return error.name === 'TimeoutError'
  }

  if (typeof error === 'object' && 'name' in error) {
    return (error as { name: string }).name === 'TimeoutError'
  }

  return false
}

export function getTimeoutErrorMessage(error: unknown, timeoutMs?: number): string {
  if (timeoutMs) {
    const timeoutSeconds = Math.floor(timeoutMs / 1000)
    const timeoutMinutes = Math.floor(timeoutSeconds / 60)
    const displayTime =
      timeoutMinutes > 0
        ? `${timeoutMinutes} minute${timeoutMinutes > 1 ? 's' : ''}`
        : `${timeoutSeconds} seconds`
    return `Execution timed out after ${displayTime}`
  }

  return 'Execution timed out'
}

/**
 * Helper to create an AbortController with timeout handling.
 * Centralizes the timeout abort pattern used across execution paths.
 */
export interface TimeoutAbortController {
  /** The AbortSignal to pass to execution functions */
  signal: AbortSignal
  /** Returns true if the abort was triggered by timeout (not user cancellation) */
  isTimedOut: () => boolean
  /** Cleanup function - call in finally block to clear the timeout */
  cleanup: () => void
  /** Manually abort the execution (for user cancellation) */
  abort: () => void
  /** The timeout duration in milliseconds (undefined if no timeout) */
  timeoutMs: number | undefined
}

/**
 * True when an abort signal's reason marks an execution timeout. Abort reasons
 * are `DOMException('timeout' | 'user', 'AbortError')` so code that passes the
 * signal straight into `fetch` still sees a standard AbortError, while pumps
 * and executors can discriminate timeout from user Stop via the message.
 */
export function isTimeoutAbortReason(reason: unknown): boolean {
  if (reason === 'timeout') return true
  return (
    reason instanceof DOMException && reason.name === 'AbortError' && reason.message === 'timeout'
  )
}

/**
 * Absolute deadline of each timeout signal, keyed by the signal that enforces it.
 *
 * Recorded here rather than threaded through {@link ExecutionContext} so the
 * number can never disagree with the timer that acts on it: both are established
 * in the one place the timeout exists. Every entry point already hands the
 * executor `timeoutController.signal`, so a block that holds the signal can ask
 * how long it really has without any call site remembering to pass a second
 * field. Weakly keyed, so an finished execution's entry is collectable.
 */
const signalDeadlines = new WeakMap<AbortSignal, number>()

export function getExecutionDeadlineAt(signal?: AbortSignal): Date | undefined {
  if (!signal) return undefined
  const deadline = signalDeadlines.get(signal)
  return deadline === undefined ? undefined : new Date(deadline)
}

/** Combines cancellation sources and carries their earliest known execution deadline. */
export function combineExecutionAbortSignals(signals: readonly AbortSignal[]): AbortSignal {
  if (signals.length === 0) return new AbortController().signal
  if (signals.length === 1) return signals[0]

  const combined = AbortSignal.any([...signals])
  let earliestDeadline: number | undefined
  for (const signal of signals) {
    const deadline = signalDeadlines.get(signal)
    if (deadline !== undefined && (earliestDeadline === undefined || deadline < earliestDeadline)) {
      earliestDeadline = deadline
    }
  }
  if (earliestDeadline !== undefined) signalDeadlines.set(combined, earliestDeadline)
  return combined
}

/**
 * Wall-clock milliseconds left before `signal`'s own timeout fires.
 *
 * `undefined` means the deadline is unknown — an untimed execution, or a derived
 * signal rather than the one {@link createTimeoutAbortController} produced. Treat
 * that as "no information", not as "no limit": callers that need a bound should
 * keep their own conservative fallback rather than assume the run is untimed.
 *
 * Use this instead of {@link getMaxExecutionTimeout} when the question is "how
 * much time does *this* run have left" — that function answers the different
 * question of how long the longest-lived plan may ever run, and is a large
 * overestimate for a sync run or a lower-tier plan.
 */
export function getRemainingExecutionMs(signal?: AbortSignal): number | undefined {
  if (!signal) return undefined
  const deadline = signalDeadlines.get(signal)
  if (deadline === undefined) return undefined
  return Math.max(0, deadline - Date.now())
}

export function createTimeoutAbortController(
  timeoutMs?: number,
  parentSignal?: AbortSignal
): TimeoutAbortController {
  const abortController = new AbortController()
  let isTimedOut = false
  let timeoutId: NodeJS.Timeout | undefined
  const abortFromParent = () => {
    if (isTimeoutAbortReason(parentSignal?.reason)) isTimedOut = true
    abortController.abort(parentSignal?.reason ?? new DOMException('user', 'AbortError'))
  }

  if (timeoutMs) {
    signalDeadlines.set(abortController.signal, Date.now() + timeoutMs)
    timeoutId = setTimeout(() => {
      isTimedOut = true
      // AbortError with a typed message — see isTimeoutAbortReason.
      abortController.abort(new DOMException('timeout', 'AbortError'))
    }, timeoutMs)
  }

  if (parentSignal) {
    const parentDeadline = signalDeadlines.get(parentSignal)
    const ownDeadline = signalDeadlines.get(abortController.signal)
    if (
      parentDeadline !== undefined &&
      (ownDeadline === undefined || parentDeadline < ownDeadline)
    ) {
      signalDeadlines.set(abortController.signal, parentDeadline)
    }
    if (parentSignal.aborted) abortFromParent()
    else parentSignal.addEventListener('abort', abortFromParent, { once: true })
  }

  return {
    signal: abortController.signal,
    isTimedOut: () => isTimedOut,
    cleanup: () => {
      if (timeoutId) clearTimeout(timeoutId)
      parentSignal?.removeEventListener('abort', abortFromParent)
    },
    // Manual abort is user/client cancellation (disconnect, Stop, registerManualExecutionAborter).
    abort: () => abortController.abort(new DOMException('user', 'AbortError')),
    timeoutMs,
  }
}
