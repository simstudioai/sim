import { env } from '@/lib/core/config/env'
import { isBillingEnabled } from '@/lib/core/config/feature-flags'
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

export function getExecutionTimeout(
  plan: SubscriptionPlan | undefined,
  type: 'sync' | 'async' = 'sync'
): number {
  if (!isBillingEnabled) {
    return EXECUTION_TIMEOUTS.free[type]
  }
  return EXECUTION_TIMEOUTS[plan || 'free'][type]
}

export function getMaxExecutionTimeout(): number {
  return EXECUTION_TIMEOUTS.enterprise.async
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

export function createTimeoutAbortController(timeoutMs?: number): TimeoutAbortController {
  const abortController = new AbortController()
  let isTimedOut = false
  let timeoutId: NodeJS.Timeout | undefined

  if (timeoutMs) {
    timeoutId = setTimeout(() => {
      isTimedOut = true
      abortController.abort()
    }, timeoutMs)
  }

  return {
    signal: abortController.signal,
    isTimedOut: () => isTimedOut,
    cleanup: () => {
      if (timeoutId) clearTimeout(timeoutId)
    },
    abort: () => abortController.abort(),
    timeoutMs,
  }
}
