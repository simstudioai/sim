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
  type: 'sync' | 'async' = 'sync'
): number {
  if (!isBillingEnabled) {
    const override = Number.parseInt(
      (type === 'sync' ? env.EXECUTION_TIMEOUT_FREE : env.EXECUTION_TIMEOUT_ASYNC_FREE) || ''
    )
    return Number.isFinite(override) && override > 0 ? EXECUTION_TIMEOUTS.free[type] : 0
  }
  return EXECUTION_TIMEOUTS[getPlanTypeForLimits(plan)][type]
}

export function getMaxExecutionTimeout(): number {
  return EXECUTION_TIMEOUTS.enterprise.async
}

/** Safety buffer added beyond the max execution timeout for execution-lifetime TTLs. */
export const RESERVATION_TTL_BUFFER_MS = 60_000

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

export function createTimeoutAbortController(timeoutMs?: number): TimeoutAbortController {
  const abortController = new AbortController()
  let isTimedOut = false
  let timeoutId: NodeJS.Timeout | undefined

  if (timeoutMs) {
    timeoutId = setTimeout(() => {
      isTimedOut = true
      // AbortError with a typed message — see isTimeoutAbortReason.
      abortController.abort(new DOMException('timeout', 'AbortError'))
    }, timeoutMs)
  }

  return {
    signal: abortController.signal,
    isTimedOut: () => isTimedOut,
    cleanup: () => {
      if (timeoutId) clearTimeout(timeoutId)
    },
    // Manual abort is user/client cancellation (disconnect, Stop, registerManualExecutionAborter).
    abort: () => abortController.abort(new DOMException('user', 'AbortError')),
    timeoutMs,
  }
}
