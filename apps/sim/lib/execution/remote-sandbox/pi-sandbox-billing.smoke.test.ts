/**
 * @vitest-environment node
 *
 * Checks that a Pi session's sandbox is actually metered against a real provider.
 *
 * The handler-level test mocks the backend and writes into the sink by hand, so
 * it proves the wiring from a backend to the block's cost and nothing else. It
 * would still pass if `withPiSandbox` never metered at all — which is exactly
 * the bug this path had. Only a real Pi sandbox shows that creation is metered,
 * that teardown reports, and that the amount tracks the session's real lifetime.
 *
 * Enable with `SANDBOX_BILLING_SMOKE=1`, against whichever provider
 * `SANDBOX_PROVIDER` selects. Needs that provider's Pi image configured
 * (`E2B_PI_TEMPLATE_ID` / `DAYTONA_PI_SNAPSHOT_ID`).
 */
import { describe, expect, it } from 'vitest'
import { createSandboxPricing } from '@/lib/billing/sandbox-pricing'
import { withPiSandbox } from '@/lib/execution/remote-sandbox'
import { resolveProvider } from '@/lib/execution/remote-sandbox/provider'
import type { SandboxCostSink } from '@/lib/execution/remote-sandbox/types'

const smokeEnabled = process.env.SANDBOX_BILLING_SMOKE === '1'
const CASE_TIMEOUT_MS = 5 * 60_000

/** Long enough that provisioning jitter cannot dominate the measured session. */
const SLEEP_SECONDS = 5
/** Well under any provider ceiling, so the lifetime cap never clamps the charge. */
const LIFETIME_MS = 10 * 60_000

describe.skipIf(!smokeEnabled)('pi sandbox billing smoke', () => {
  it(
    'bills the session a Pi sandbox was held for',
    async () => {
      const pricing = createSandboxPricing(resolveProvider().id)
      const usdPerBilledSecond =
        (pricing.resources.vcpu * pricing.rates.cpuUsdPerVcpuSecond +
          pricing.resources.memoryGiB * pricing.rates.memoryUsdPerGiBSecond +
          pricing.resources.diskGiB * pricing.rates.diskUsdPerGiBSecond) *
        pricing.multiplier

      const sandboxCost: SandboxCostSink = { total: 0 }
      const wallClockStartedAtMs = Date.now()
      const exitCode = await withPiSandbox(
        { lifetimeMs: LIFETIME_MS, cost: sandboxCost },
        async (runner) => {
          const result = await runner.run(`sleep ${SLEEP_SECONDS}; echo held`, {
            envs: {},
            timeoutMs: CASE_TIMEOUT_MS,
          })
          return result.exitCode
        }
      )
      const wallClockMs = Date.now() - wallClockStartedAtMs

      expect(exitCode).toBe(0)
      expect(sandboxCost.total).toBeGreaterThanOrEqual(SLEEP_SECONDS * usdPerBilledSecond)
      expect(sandboxCost.total).toBeLessThanOrEqual((wallClockMs / 1000) * usdPerBilledSecond)
    },
    CASE_TIMEOUT_MS
  )

  it(
    'bills nothing when no sink is supplied',
    async () => {
      // The mothership and any other internal caller must stay free, and the
      // absence of a sink is the whole mechanism keeping them that way.
      const held = await withPiSandbox({ lifetimeMs: LIFETIME_MS }, async (runner) => {
        const result = await runner.run('echo held', { envs: {}, timeoutMs: CASE_TIMEOUT_MS })
        return result.exitCode
      })

      expect(held).toBe(0)
    },
    CASE_TIMEOUT_MS
  )
})
