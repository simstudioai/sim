import { env } from '@/lib/core/config/env'
import type { SubscriptionPlan } from '@/lib/core/rate-limiter/types'

interface ExecutionTimeoutConfig {
  sync: number
  async: number
}

const DEFAULT_SYNC_TIMEOUTS = {
  free: 300,
  pro: 3600,
  team: 3600,
  enterprise: 3600,
} as const

const ASYNC_TIMEOUT_SECONDS = 5400

function getSyncTimeoutForPlan(plan: SubscriptionPlan): number {
  const envVarMap: Record<SubscriptionPlan, string | undefined> = {
    free: env.EXECUTION_TIMEOUT_FREE,
    pro: env.EXECUTION_TIMEOUT_PRO,
    team: env.EXECUTION_TIMEOUT_TEAM,
    enterprise: env.EXECUTION_TIMEOUT_ENTERPRISE,
  }
  return (Number.parseInt(envVarMap[plan] || '') || DEFAULT_SYNC_TIMEOUTS[plan]) * 1000
}

const EXECUTION_TIMEOUTS: Record<SubscriptionPlan, ExecutionTimeoutConfig> = {
  free: {
    sync: getSyncTimeoutForPlan('free'),
    async: ASYNC_TIMEOUT_SECONDS * 1000,
  },
  pro: {
    sync: getSyncTimeoutForPlan('pro'),
    async: ASYNC_TIMEOUT_SECONDS * 1000,
  },
  team: {
    sync: getSyncTimeoutForPlan('team'),
    async: ASYNC_TIMEOUT_SECONDS * 1000,
  },
  enterprise: {
    sync: getSyncTimeoutForPlan('enterprise'),
    async: ASYNC_TIMEOUT_SECONDS * 1000,
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
  if (!(error instanceof Error)) return false

  const name = error.name.toLowerCase()
  const message = error.message.toLowerCase()

  return (
    name === 'timeouterror' ||
    name === 'aborterror' ||
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('aborted')
  )
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
