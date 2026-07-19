/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Free-tier timeouts are baked into EXECUTION_TIMEOUTS at module load, while
 * the billing-disabled opt-in check reads the env at call time. Seeding here
 * mirrors production, where both reads observe the same process env.
 */
const { mockEnv, mockFlags } = vi.hoisted(() => ({
  mockEnv: {
    EXECUTION_TIMEOUT_FREE: '120',
    EXECUTION_TIMEOUT_ASYNC_FREE: '240',
  } as Record<string, string | undefined>,
  mockFlags: { isBillingEnabled: true },
}))

vi.mock('@/lib/core/config/env', () => ({ env: mockEnv }))
vi.mock('@/lib/core/config/env-flags', () => ({
  get isBillingEnabled() {
    return mockFlags.isBillingEnabled
  },
}))

import { createTimeoutAbortController, getExecutionTimeout } from '@/lib/core/execution-limits'

describe('getExecutionTimeout', () => {
  beforeEach(() => {
    mockFlags.isBillingEnabled = true
    mockEnv.EXECUTION_TIMEOUT_FREE = '120'
    mockEnv.EXECUTION_TIMEOUT_ASYNC_FREE = '240'
  })

  it('applies per-tier timeouts when billing is enabled', () => {
    expect(getExecutionTimeout('pro_6000', 'sync')).toBe(3000 * 1000)
    expect(getExecutionTimeout('team_25000', 'sync')).toBe(3000 * 1000)
    expect(getExecutionTimeout('free', 'sync')).toBe(120 * 1000)
  })

  it('disables timeouts when billing is disabled and no free env is set', () => {
    mockFlags.isBillingEnabled = false
    mockEnv.EXECUTION_TIMEOUT_FREE = undefined
    mockEnv.EXECUTION_TIMEOUT_ASYNC_FREE = undefined

    expect(getExecutionTimeout('free', 'sync')).toBe(0)
    expect(getExecutionTimeout('free', 'async')).toBe(0)
  })

  it('opts back into the free timeout when the env var is explicitly set', () => {
    mockFlags.isBillingEnabled = false

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
})
