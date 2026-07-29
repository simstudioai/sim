/**
 * How long a Pi sandbox may live. Separate from the provider adapters and the
 * `remote-sandbox` barrel so the Pi backends can cap their per-command timeouts
 * against the same number without importing the provider SDKs.
 */

import { createLogger } from '@sim/logger'
import { env } from '@/lib/core/config/env'
import { getRemainingExecutionMs } from '@/lib/core/execution-limits'

const logger = createLogger('PiSandboxLifetime')

/**
 * Read from `env` rather than the `env-flags` gate, and normalized the same way
 * `remote-sandbox/index.ts` normalizes it, so this module keeps the independence
 * its header describes: no provider adapters, no barrel, no config gate.
 */
function isLifetimeProvider(): boolean {
  return (env.SANDBOX_PROVIDER || 'e2b').toLowerCase() === 'e2b'
}

/**
 * E2B documents a one-hour maximum sandbox lifetime for Hobby accounts (24 hours
 * for Pro) and rejects a create above it. The cap sits strictly below that hour:
 * one hour is the documented boundary, and betting on an exact-boundary create
 * buys nothing.
 */
export const PI_SANDBOX_MAX_LIFETIME_MS = 59 * 60 * 1000

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
 * The lifetime requested for a Pi sandbox, or `undefined` when the selected
 * provider has no such concept.
 *
 * Only E2B takes an absolute lifetime. Daytona stops on inactivity instead
 * (`autoStopInterval`, refreshed by activity), so there is no ceiling for a Pi
 * command to reserve against — and deriving one anyway would shorten Daytona's
 * agent turn to fit a limit that does not apply to it.
 *
 * For E2B it defaults to {@link PI_SANDBOX_MAX_LIFETIME_MS}: a run that finishes
 * kills its sandbox explicitly, so on the normal path the lifetime is a ceiling
 * rather than a budget. It is not entirely free — if the web process dies
 * mid-run the orphaned sandbox now bills until this ceiling instead of the SDK's
 * five minutes — but five minutes is short enough to kill live runs, which is
 * the bug this replaces.
 *
 * `PI_SANDBOX_LIFETIME_MS` may only lower it, and only as far as
 * {@link PI_SANDBOX_MIN_LIFETIME_MS}, so a misconfigured value can neither make
 * every create fail on a Hobby key nor leave a run without time to push.
 */
export function resolvePiSandboxLifetimeMs(): number | undefined {
  if (!isLifetimeProvider()) return undefined

  const configured = Number.parseInt(env.PI_SANDBOX_LIFETIME_MS ?? '', 10)
  if (!Number.isFinite(configured) || configured <= 0) return PI_SANDBOX_MAX_LIFETIME_MS

  if (configured < PI_SANDBOX_MIN_LIFETIME_MS) {
    logger.warn('PI_SANDBOX_LIFETIME_MS is below the minimum a Pi run can finish in; raising it', {
      configured,
      using: PI_SANDBOX_MIN_LIFETIME_MS,
    })
    return PI_SANDBOX_MIN_LIFETIME_MS
  }

  return Math.min(configured, PI_SANDBOX_MAX_LIFETIME_MS)
}

/**
 * A sandbox that outlives its own execution is billed for work nobody is waiting
 * on: the run aborts at its deadline, but the sandbox keeps costing until the
 * provider ceiling. That gap is the whole reason this exists — it is widest on
 * the plans with the shortest deadlines, where {@link resolvePiSandboxLifetimeMs}
 * alone hands a five-minute sync run the same ceiling as a ninety-minute async
 * one, and `PI_SANDBOX_LIFETIME_MS` cannot close it because that override has its
 * own floor.
 *
 * `undefined` still means the provider has no lifetime concept (Daytona), and an
 * untimed execution still falls back to the ceiling — {@link getRemainingExecutionMs}
 * returning `undefined` is "unknown", never "unlimited".
 *
 * Callers pass the result to both `withPiSandbox` and
 * `resolvePiTimeoutMs` rather than calling this twice, so the lifetime the
 * sandbox is created with and the lifetime the agent turn reserves against are
 * the same number and cannot drift by the milliseconds between two calls.
 */
export function resolvePiRunLifetimeMs(signal?: AbortSignal): number | undefined {
  const ceiling = resolvePiSandboxLifetimeMs()
  if (ceiling === undefined) return undefined

  const remaining = getRemainingExecutionMs(signal)
  if (remaining === undefined) return ceiling

  return Math.min(ceiling, remaining)
}
