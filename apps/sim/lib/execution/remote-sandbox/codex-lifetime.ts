/** Lifetime policy for the isolated Codex coding-agent sandbox. */

import { createLogger } from '@sim/logger'
import { env } from '@/lib/core/config/env'
import { inspectCapability, SANDBOX_CAPABILITY } from '@/lib/core/config/env-capabilities'
import { getMaxExecutionTimeout, getRemainingExecutionMs } from '@/lib/core/execution-limits'

const logger = createLogger('CodexSandboxLifetime')
const E2B_CODEX_SANDBOX_PROVIDER_LIMIT_MS = 24 * 60 * 60 * 1000

export const CODEX_SANDBOX_MAX_LIFETIME_MS = getMaxExecutionTimeout()

/** Clone, config verification, two finalize phases, and at least one minute for Codex. */
export const CODEX_SANDBOX_MIN_LIFETIME_MS = 32 * 60 * 1000

function providerLifetimeCeilingMs(): number {
  const providerId = inspectCapability(SANDBOX_CAPABILITY, env).providerId
  return providerId === 'daytona'
    ? CODEX_SANDBOX_MAX_LIFETIME_MS
    : Math.min(CODEX_SANDBOX_MAX_LIFETIME_MS, E2B_CODEX_SANDBOX_PROVIDER_LIMIT_MS)
}

/** Resolves the provider lifetime ceiling plus an optional lowering override. */
export function resolveCodexSandboxLifetimeMs(): number {
  const providerCeilingMs = providerLifetimeCeilingMs()
  const configured = Number.parseInt(env.CODEX_SANDBOX_LIFETIME_MS ?? '', 10)
  if (!Number.isFinite(configured) || configured <= 0) return providerCeilingMs

  if (configured < CODEX_SANDBOX_MIN_LIFETIME_MS) {
    logger.warn(
      'CODEX_SANDBOX_LIFETIME_MS is below the minimum a Codex run can finish in; raising it',
      { configured, using: CODEX_SANDBOX_MIN_LIFETIME_MS }
    )
    return CODEX_SANDBOX_MIN_LIFETIME_MS
  }

  return Math.min(configured, providerCeilingMs)
}

/** Narrows an isolated sandbox to the remaining workflow execution budget. */
export function resolveCodexRunLifetimeMs(signal?: AbortSignal): number {
  const ceiling = resolveCodexSandboxLifetimeMs()
  const remaining = getRemainingExecutionMs(signal)
  return remaining === undefined ? ceiling : Math.min(ceiling, remaining)
}
