import { createLogger } from '@sim/logger'
import { isFullstackDemoModeClient } from '@/lib/apps/demo/flags'
import { SIM_AGENT_API_URL } from '@/lib/copilot/constants'
import { env, isTruthy } from '@/lib/core/config/env'
import { getRedisClient } from '@/lib/core/config/redis'

const logger = createLogger('FullstackDemoRuntime')

/** Server-side demo gate: server flag OR the public client mirror. */
export function isFullstackDemoModeEnabled(): boolean {
  return isTruthy(env.FULLSTACK_DEMO_MODE) || isFullstackDemoModeClient()
}

function isLocalhostAgentUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return (
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '0.0.0.0' ||
      parsed.hostname === '::1'
    )
  } catch {
    return true
  }
}

/**
 * Fail clearly when the demo path is enabled but hosted Copilot/Redis are misconfigured.
 * Keeps COPILOT_API_KEY server-only — never returns the key value.
 */
export async function assertHostedDemoRuntime(): Promise<
  { ok: true } | { ok: false; error: string; code: string }
> {
  if (!isFullstackDemoModeEnabled()) {
    return {
      ok: false,
      error: 'FULLSTACK_DEMO_MODE is not enabled',
      code: 'DEMO_DISABLED',
    }
  }

  if (!env.COPILOT_API_KEY) {
    return {
      ok: false,
      error: 'COPILOT_API_KEY is required for the hosted Full-stack demo',
      code: 'COPILOT_KEY_MISSING',
    }
  }

  if (isLocalhostAgentUrl(SIM_AGENT_API_URL)) {
    return {
      ok: false,
      error: `SIM_AGENT_API_URL must point at hosted Copilot (got ${SIM_AGENT_API_URL}). Set it to https://www.copilot.sim.ai or remove the override.`,
      code: 'COPILOT_URL_LOCAL',
    }
  }

  if (!env.REDIS_URL) {
    return {
      ok: false,
      error: 'REDIS_URL is required for durable Copilot streams during the demo',
      code: 'REDIS_MISSING',
    }
  }

  const redis = getRedisClient()
  if (!redis) {
    return {
      ok: false,
      error: 'Redis client could not be initialized from REDIS_URL',
      code: 'REDIS_UNAVAILABLE',
    }
  }

  try {
    await redis.ping()
  } catch (error) {
    logger.error('Redis ping failed for Full-stack demo', { error })
    return {
      ok: false,
      error: 'Redis is unavailable; start Redis before running the hosted Full-stack demo',
      code: 'REDIS_UNAVAILABLE',
    }
  }

  return { ok: true }
}
