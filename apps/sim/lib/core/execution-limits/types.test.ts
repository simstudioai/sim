/**
 * @vitest-environment node
 */
import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Free-tier timeouts are baked into EXECUTION_TIMEOUTS at module load, while
 * the billing-disabled opt-in check reads the env at call time. Seeding here
 * mirrors production, where both reads observe the same process env.
 */
const { mockEnv } = vi.hoisted(() => ({
  mockEnv: {
    EXECUTION_TIMEOUT_FREE: '120',
    EXECUTION_TIMEOUT_ASYNC_FREE: '240',
    EXECUTION_TIMEOUT_ASYNC_ENTERPRISE: '604801',
  } as Record<string, string | undefined>,
}))

vi.mock('@/lib/core/config/env', () => ({ env: mockEnv }))
/**
 * Query-suffixed import gives this file a private instance of the module under
 * test (the barrel's `./types` source, so the fresh evaluation bakes the mocked
 * env into EXECUTION_TIMEOUTS). Under `isolate: false` the worker's module
 * graph is shared across test files, so the plain specifier may already be
 * cached with the real env/env-flags bindings (mocks never reach an
 * already-evaluated module) — and evaluating it here under this file's mocks
 * would poison it for later files. The suffixed id is unique to this file, so
 * it always evaluates fresh with the mocks above.
 */
declare module '@/lib/core/execution-limits/types?execution-limits-test' {
  // biome-ignore lint/suspicious/noExportsInTest: ambient type re-declaration for the query-suffixed specifier, not a runtime export
  export * from '@/lib/core/execution-limits/types'
}

import {
  combineExecutionAbortSignals,
  createTimeoutAbortController,
  getExecutionTimeout,
  getMaxExecutionTimeout,
  getRemainingExecutionMs,
  isTimeoutAbortReason,
  resolveAsyncExecutionTimeout,
  toTriggerMaxDurationSeconds,
} from '@/lib/core/execution-limits/types?execution-limits-test'

afterAll(resetEnvFlagsMock)

describe('getExecutionTimeout', () => {
  beforeEach(() => {
    setEnvFlags({ isBillingEnabled: true })
    mockEnv.EXECUTION_TIMEOUT_FREE = '120'
    mockEnv.EXECUTION_TIMEOUT_ASYNC_FREE = '240'
  })

  it('applies per-tier timeouts when billing is enabled', () => {
    expect(getExecutionTimeout('pro_6000', 'sync')).toBe(3000 * 1000)
    expect(getExecutionTimeout('team_25000', 'sync')).toBe(3000 * 1000)
    expect(getExecutionTimeout('free', 'sync')).toBe(120 * 1000)
  })

  it('uses Enterprise metadata for async workflows and caps request overrides', () => {
    const policyTimeoutMs = getExecutionTimeout('enterprise', 'async', 86_400)

    expect(policyTimeoutMs).toBe(86_400_000)
    expect(resolveAsyncExecutionTimeout(policyTimeoutMs, 3_600)).toBe(3_600_000)
    expect(resolveAsyncExecutionTimeout(policyTimeoutMs, 172_800)).toBe(86_400_000)
  })

  it('falls back to 90 minutes when the Enterprise env default exceeds seven days', () => {
    expect(getExecutionTimeout('enterprise', 'async')).toBe(5_400_000)
  })

  it('uses a seven-day hosted ceiling and adds five minutes of Trigger cleanup grace', () => {
    expect(getMaxExecutionTimeout()).toBe(604_800_000)
    expect(toTriggerMaxDurationSeconds(60_000)).toBe(360)
    expect(toTriggerMaxDurationSeconds(604_800_000)).toBe(605_100)
  })

  it('disables timeouts when billing is disabled and no free env is set', () => {
    setEnvFlags({ isBillingEnabled: false })
    mockEnv.EXECUTION_TIMEOUT_FREE = undefined
    mockEnv.EXECUTION_TIMEOUT_ASYNC_FREE = undefined

    expect(getExecutionTimeout('free', 'sync')).toBe(0)
    expect(getExecutionTimeout('free', 'async')).toBe(0)
  })

  it('opts back into the free timeout when the env var is explicitly set', () => {
    setEnvFlags({ isBillingEnabled: false })

    expect(getExecutionTimeout('free', 'sync')).toBe(120 * 1000)
    expect(getExecutionTimeout('free', 'async')).toBe(240 * 1000)
  })

  it('never schedules an abort for a zero (disabled) timeout', () => {
    vi.useFakeTimers()
    try {
      const controller = createTimeoutAbortController(0)
      vi.advanceTimersByTime(24 * 60 * 60 * 1000)
      expect(controller.signal.aborted).toBe(false)
      expect(controller.isTimedOut()).toBe(false)
      controller.cleanup()
    } finally {
      vi.useRealTimers()
    }
  })

  it('aborts with an AbortError carrying the timeout reason when the timer fires', () => {
    vi.useFakeTimers()
    try {
      const controller = createTimeoutAbortController(1000)
      vi.advanceTimersByTime(1000)
      expect(controller.signal.aborted).toBe(true)
      expect(controller.isTimedOut()).toBe(true)
      const reason = controller.signal.reason as DOMException
      expect(reason).toBeInstanceOf(DOMException)
      expect(reason.name).toBe('AbortError')
      expect(reason.message).toBe('timeout')
      expect(isTimeoutAbortReason(reason)).toBe(true)
      controller.cleanup()
    } finally {
      vi.useRealTimers()
    }
  })

  it('manual abort uses an AbortError carrying the user reason', () => {
    const controller = createTimeoutAbortController(60_000)
    controller.abort()
    expect(controller.signal.aborted).toBe(true)
    expect(controller.isTimedOut()).toBe(false)
    const reason = controller.signal.reason as DOMException
    expect(reason).toBeInstanceOf(DOMException)
    expect(reason.name).toBe('AbortError')
    expect(reason.message).toBe('user')
    expect(isTimeoutAbortReason(reason)).toBe(false)
    controller.cleanup()
  })
})

describe('getRemainingExecutionMs', () => {
  it('reports the time left on the signal that enforces the timeout', () => {
    const controller = createTimeoutAbortController(60_000)

    const remaining = getRemainingExecutionMs(controller.signal)

    expect(remaining).toBeGreaterThan(55_000)
    expect(remaining).toBeLessThanOrEqual(60_000)
    controller.cleanup()
  })

  it('never reports a negative remainder once the deadline has passed', () => {
    vi.useFakeTimers()
    try {
      const controller = createTimeoutAbortController(1_000)
      vi.advanceTimersByTime(5_000)

      expect(getRemainingExecutionMs(controller.signal)).toBe(0)
      controller.cleanup()
    } finally {
      vi.useRealTimers()
    }
  })

  it('preserves the earliest deadline when combining cancellation signals', () => {
    const longer = createTimeoutAbortController(60_000)
    const shorter = createTimeoutAbortController(30_000)
    const combined = combineExecutionAbortSignals([longer.signal, shorter.signal])

    const remaining = getRemainingExecutionMs(combined)
    expect(remaining).toBeGreaterThan(25_000)
    expect(remaining).toBeLessThanOrEqual(30_000)

    longer.cleanup()
    shorter.cleanup()
  })

  it('forwards parent cancellation through a timed controller', () => {
    const parent = new AbortController()
    const controller = createTimeoutAbortController(60_000, parent.signal)

    parent.abort(new DOMException('user', 'AbortError'))

    expect(controller.signal.aborted).toBe(true)
    expect(controller.isTimedOut()).toBe(false)
    controller.cleanup()
  })

  /**
   * `undefined` is "unknown", not "unlimited" — an untimed run, a signal from
   * somewhere else, or an unregistered derived signal all land here, and a caller that needs a
   * bound has to keep its own fallback rather than assume the run is untimed.
   */
  it('returns undefined for an untimed, foreign, or absent signal', () => {
    const untimed = createTimeoutAbortController()

    expect(getRemainingExecutionMs(untimed.signal)).toBeUndefined()
    expect(getRemainingExecutionMs(new AbortController().signal)).toBeUndefined()
    expect(getRemainingExecutionMs(undefined)).toBeUndefined()
    untimed.cleanup()
  })
})
