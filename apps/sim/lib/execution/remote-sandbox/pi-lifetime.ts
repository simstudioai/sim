/**
 * How long a Pi sandbox may live. Separate from the provider adapters and the
 * `remote-sandbox` barrel so the Pi backends can cap their per-command timeouts
 * against the same number without importing the provider SDKs.
 */

import { createLogger } from '@sim/logger'
import { env } from '@/lib/core/config/env'
import { inspectCapability, SANDBOX_CAPABILITY } from '@/lib/core/config/env-capabilities'
import { getMaxExecutionTimeout, getRemainingExecutionMs } from '@/lib/core/execution-limits'

const logger = createLogger('PiSandboxLifetime')

/** E2B's documented continuous-runtime ceiling for a single sandbox. */
const E2B_PI_SANDBOX_PROVIDER_LIMIT_MS = 24 * 60 * 60 * 1000

/**
 * The platform-wide ceiling for one workflow execution. Provider-specific
 * limits are applied by {@link providerLifetimeCeilingMs}.
 */
export const PI_SANDBOX_MAX_LIFETIME_MS = getMaxExecutionTimeout()

function providerLifetimeCeilingMs(): number {
  const providerId = inspectCapability(SANDBOX_CAPABILITY, env).providerId
  return providerId === 'daytona'
    ? PI_SANDBOX_MAX_LIFETIME_MS
    : Math.min(PI_SANDBOX_MAX_LIFETIME_MS, E2B_PI_SANDBOX_PROVIDER_LIMIT_MS)
}

/**
 * The shortest lifetime a Pi run can actually complete in, and the floor an
 * override is raised to.
 *
 * A Pi backend brackets the agent turn with a clone and two finalize commands,
 * and caps the turn itself against whatever is left. Below this, that arithmetic
 * has no positive remainder: the reserves alone exhaust the lifetime, so E2B
 * could reap the sandbox before the turn or the push finished. Raising the value
 * is better than rejecting it — a module-scope throw on a config typo would take
 * down every execution path that imports this, not just Pi.
 *
 * `cloud-shared.test.ts` asserts this stays at or above the backends' own
 * reserves, so the two cannot drift apart silently.
 */
export const PI_SANDBOX_MIN_LIFETIME_MS = 31 * 60 * 1000

/**
 * The lifetime requested for a Pi sandbox. Both adapters now enforce an absolute
 * wall-clock lifetime: E2B through `timeoutMs`, Daytona through `ttlMinutes`.
 *
 * It defaults to the selected provider's ceiling: the platform execution
 * ceiling for Daytona, or E2B's lower 24-hour continuous-runtime limit. A run
 * that finishes kills its sandbox explicitly, so on the normal path the
 * lifetime is a ceiling rather than a budget. {@link resolvePiRunLifetimeMs}
 * keeps orphan exposure proportional by lowering it to the run's own deadline.
 *
 * `PI_SANDBOX_LIFETIME_MS` may only lower it, and only as far as
 * {@link PI_SANDBOX_MIN_LIFETIME_MS}, so a misconfigured value can neither
 * outrun the selected provider's policy ceiling nor leave a run without time to
 * push.
 */
export function resolvePiSandboxLifetimeMs(): number {
  const providerCeilingMs = providerLifetimeCeilingMs()
  const configured = Number.parseInt(env.PI_SANDBOX_LIFETIME_MS ?? '', 10)
  if (!Number.isFinite(configured) || configured <= 0) return providerCeilingMs

  if (configured < PI_SANDBOX_MIN_LIFETIME_MS) {
    logger.warn('PI_SANDBOX_LIFETIME_MS is below the minimum a Pi run can finish in; raising it', {
      configured,
      using: PI_SANDBOX_MIN_LIFETIME_MS,
    })
    return PI_SANDBOX_MIN_LIFETIME_MS
  }

  return Math.min(configured, providerCeilingMs)
}

/**
 * A sandbox that outlives its own execution is billed for work nobody is waiting
 * on: the run aborts at its deadline, but the sandbox keeps costing until the
 * provider ceiling. That gap is the whole reason this exists — it is widest on
 * the plans with the shortest deadlines, where {@link resolvePiSandboxLifetimeMs}
 * alone hands a five-minute sync run the same ceiling as a much longer async one,
 * and `PI_SANDBOX_LIFETIME_MS` cannot close it because that override has its own
 * floor.
 *
 * An untimed execution still falls back to the selected provider's ceiling —
 * {@link getRemainingExecutionMs} returning `undefined` is "unknown", never
 * "unlimited".
 *
 * Callers pass the result to both `withPiSandbox` and
 * `resolvePiTimeoutMs` rather than calling this twice, so the lifetime the
 * sandbox is created with and the lifetime the agent turn reserves against are
 * the same number and cannot drift by the milliseconds between two calls.
 */
export function resolvePiRunLifetimeMs(signal?: AbortSignal): number {
  const ceiling = resolvePiSandboxLifetimeMs()
  const remaining = getRemainingExecutionMs(signal)
  if (remaining === undefined) return ceiling

  return Math.min(ceiling, remaining)
}
