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
  createTimeoutAbortController,
  getExecutionTimeout,
  isTimeoutAbortReason,
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
