/**
 * @vitest-environment node
 *
 * Checks the metered amount against a real provider run.
 *
 * `sandbox-pricing.test.ts` pins the arithmetic and the conformance suite proves
 * a cost is produced, attached, and routed — but that suite stubs the provider
 * and mocks `Date.now()`, so its clock advances one millisecond per call. Under
 * those conditions `total > 0` is the strongest claim available, and it would
 * hold just as well if the metered window measured the wrong instants. Only a
 * real run can show that the window tracks the sandbox's actual lifetime.
 *
 * Enable with `SANDBOX_BILLING_SMOKE=1`. Runs against whichever provider
 * `SANDBOX_PROVIDER` selects, so point it at each in turn to cover both.
 */
import { describe, expect, it } from 'vitest'
import { createSandboxPricing } from '@/lib/billing/sandbox-pricing'
import { CodeLanguage } from '@/lib/execution/languages'
import { executeInSandbox } from '@/lib/execution/remote-sandbox'
import { resolveProvider } from '@/lib/execution/remote-sandbox/provider'

const smokeEnabled = process.env.SANDBOX_BILLING_SMOKE === '1'
const CASE_TIMEOUT_MS = 5 * 60_000
const RUN_TIMEOUT_MS = 4 * 60_000

/** Long enough that provisioning jitter cannot dominate the measured runtime. */
const SLEEP_SECONDS = 5

describe.skipIf(!smokeEnabled)('sandbox billing smoke', () => {
  it(
    'bills the sandbox lifetime at the provider rate',
    async () => {
      const pricing = createSandboxPricing(resolveProvider().id)
      const usdPerSecond =
        pricing.resources.vcpu * pricing.rates.cpuUsdPerVcpuSecond +
        pricing.resources.memoryGiB * pricing.rates.memoryUsdPerGiBSecond +
        pricing.resources.diskGiB * pricing.rates.diskUsdPerGiBSecond
      const usdPerBilledSecond = usdPerSecond * pricing.multiplier

      const wallClockStartedAtMs = Date.now()
      const result = await executeInSandbox({
        code: `import time\ntime.sleep(${SLEEP_SECONDS})\nprint("slept")`,
        language: CodeLanguage.Python,
        timeoutMs: RUN_TIMEOUT_MS,
        meterUsage: true,
      })
      const wallClockMs = Date.now() - wallClockStartedAtMs

      expect(result.cost).toEqual({ input: 0, output: 0, total: expect.any(Number) })
      const billed = result.cost?.total ?? 0

      /**
       * The window opens immediately before the provider create call and closes
       * before teardown, so it has to cover the sleep and cannot exceed the whole
       * call measured from out here. A rate error, a wrong resource constant, or a
       * window anchored to the wrong instant all land outside these bounds — which
       * an `expect.any(Number)` assertion cannot see.
       */
      expect(billed).toBeGreaterThanOrEqual(SLEEP_SECONDS * usdPerBilledSecond)
      expect(billed).toBeLessThanOrEqual((wallClockMs / 1000) * usdPerBilledSecond)
    },
    CASE_TIMEOUT_MS
  )

  it(
    'bills nothing when the caller did not ask for metering',
    async () => {
      const result = await executeInSandbox({
        code: 'print("unmetered")',
        language: CodeLanguage.Python,
        timeoutMs: RUN_TIMEOUT_MS,
      })

      expect(result.cost).toBeUndefined()
    },
    CASE_TIMEOUT_MS
  )
})
