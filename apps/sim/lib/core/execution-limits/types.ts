import { env } from '@/lib/core/config/env'
import type { SubscriptionPlan } from '@/lib/core/rate-limiter/types'

interface ExecutionTimeoutConfig {
  sync: number
  async: number
}

const DEFAULT_SYNC_TIMEOUTS_SECONDS = {
  free: 300,
  pro: 3600,
  team: 3600,
  enterprise: 3600,
} as const

const ASYNC_MULTIPLIER = 2
const MAX_ASYNC_TIMEOUT_SECONDS = 5400

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
  const syncMs = getSyncTimeoutForPlan(plan)
  const asyncMs = syncMs * ASYNC_MULTIPLIER
  const maxAsyncMs = MAX_ASYNC_TIMEOUT_SECONDS * 1000
  return Math.min(asyncMs, maxAsyncMs)
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
