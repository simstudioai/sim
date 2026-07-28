/**
 * @vitest-environment node
 */
import { dbChainMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { evaluateRule, excludeSimExecutionsCondition } from '@/lib/workspace-events/rules'
import type { ExecutionEventContext, SimSubscriptionConfig } from '@/lib/workspace-events/types'

function makeConfig(overrides: Partial<SimSubscriptionConfig> = {}): SimSubscriptionConfig {
  return {
    eventType: 'execution_error',
    workflowIds: [],
    consecutiveFailures: 3,
    failureRatePercent: 50,
    windowHours: 24,
    durationThresholdMs: 30000,
    latencySpikePercent: 100,
    costThresholdCredits: 200,
    errorCountThreshold: 10,
    inactivityHours: 24,
    ...overrides,
  }
}

function makeContext(overrides: Partial<ExecutionEventContext> = {}): ExecutionEventContext {
  return {
    workflowId: 'wf-source',
    executionId: 'exec-1',
    status: 'error',
    trigger: 'manual',
    durationMs: 1000,
    cost: 0.25,
    errorMessage: 'boom',
    finalOutput: null,
    ...overrides,
  }
}

describe('excludeSimExecutionsCondition', () => {
  it('excludes sim-triggered executions from rule statistics', () => {
    const condition = excludeSimExecutionsCondition() as unknown as {
      type: string
      right?: unknown
    }
    expect(condition).toMatchObject({ type: 'ne', right: 'sim' })
  })
})

describe('evaluateRule', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('consecutive_failures', () => {
    it('fires when the last N executions all failed', async () => {
      dbChainMockFns.limit.mockResolvedValueOnce([
        { level: 'error' },
        { level: 'error' },
        { level: 'error' },
      ])
      await expect(evaluateRule('consecutive_failures', makeConfig(), makeContext())).resolves.toBe(
        true
      )
    })

    it('does not fire when any recent execution succeeded', async () => {
      dbChainMockFns.limit.mockResolvedValueOnce([
        { level: 'error' },
        { level: 'info' },
        { level: 'error' },
      ])
      await expect(evaluateRule('consecutive_failures', makeConfig(), makeContext())).resolves.toBe(
        false
      )
    })

    it('does not fire with fewer executions than the threshold', async () => {
      dbChainMockFns.limit.mockResolvedValueOnce([{ level: 'error' }, { level: 'error' }])
      await expect(evaluateRule('consecutive_failures', makeConfig(), makeContext())).resolves.toBe(
        false
      )
    })

    it('only runs on failed executions', async () => {
      await expect(
        evaluateRule('consecutive_failures', makeConfig(), makeContext({ status: 'success' }))
      ).resolves.toBe(false)
      expect(dbChainMockFns.select).not.toHaveBeenCalled()
    })
  })

  describe('failure_rate', () => {
    it('fires when the in-window failure rate meets the threshold (fixed legacy dead code)', async () => {
      dbChainMockFns.where.mockImplementationOnce(() => Promise.resolve([{ total: 6, errors: 4 }]))
      await expect(evaluateRule('failure_rate', makeConfig(), makeContext())).resolves.toBe(true)
    })

    it('does not fire below the minimum execution count', async () => {
      dbChainMockFns.where.mockImplementationOnce(() => Promise.resolve([{ total: 4, errors: 4 }]))
      await expect(evaluateRule('failure_rate', makeConfig(), makeContext())).resolves.toBe(false)
    })

    it('does not fire when the rate is below the threshold', async () => {
      dbChainMockFns.where.mockImplementationOnce(() => Promise.resolve([{ total: 5, errors: 1 }]))
      await expect(evaluateRule('failure_rate', makeConfig(), makeContext())).resolves.toBe(false)
    })
  })

  describe('latency_threshold', () => {
    it('fires when duration exceeds the threshold', async () => {
      await expect(
        evaluateRule(
          'latency_threshold',
          makeConfig({ durationThresholdMs: 1000 }),
          makeContext({ durationMs: 1001 })
        )
      ).resolves.toBe(true)
    })

    it('does not fire at exactly the threshold', async () => {
      await expect(
        evaluateRule(
          'latency_threshold',
          makeConfig({ durationThresholdMs: 1000 }),
          makeContext({ durationMs: 1000 })
        )
      ).resolves.toBe(false)
    })
  })

  describe('latency_spike', () => {
    it('fires when the execution is slower than the spike threshold over the average', async () => {
      dbChainMockFns.where.mockImplementationOnce(() =>
        Promise.resolve([{ avgDuration: '1000', count: 5 }])
      )
      await expect(
        evaluateRule('latency_spike', makeConfig(), makeContext({ durationMs: 2001 }))
      ).resolves.toBe(true)
    })

    it('does not fire at exactly the spike threshold', async () => {
      dbChainMockFns.where.mockImplementationOnce(() =>
        Promise.resolve([{ avgDuration: '1000', count: 5 }])
      )
      await expect(
        evaluateRule('latency_spike', makeConfig(), makeContext({ durationMs: 2000 }))
      ).resolves.toBe(false)
    })

    it('does not fire below the minimum execution count', async () => {
      dbChainMockFns.where.mockImplementationOnce(() =>
        Promise.resolve([{ avgDuration: '1000', count: 4 }])
      )
      await expect(
        evaluateRule('latency_spike', makeConfig(), makeContext({ durationMs: 5000 }))
      ).resolves.toBe(false)
    })
  })

  describe('cost_threshold', () => {
    it('fires when the run cost exceeds the credit-denominated threshold', async () => {
      // 200 credits = $1; a $1.50 run exceeds it.
      await expect(
        evaluateRule(
          'cost_threshold',
          makeConfig({ costThresholdCredits: 200 }),
          makeContext({ cost: 1.5 })
        )
      ).resolves.toBe(true)
    })

    it('does not fire at exactly the threshold', async () => {
      await expect(
        evaluateRule(
          'cost_threshold',
          makeConfig({ costThresholdCredits: 200 }),
          makeContext({ cost: 1 })
        )
      ).resolves.toBe(false)
    })
  })

  describe('error_count', () => {
    it('fires when the in-window error count reaches the threshold', async () => {
      dbChainMockFns.where.mockImplementationOnce(() => Promise.resolve([{ count: 10 }]))
      await expect(evaluateRule('error_count', makeConfig(), makeContext())).resolves.toBe(true)
    })

    it('does not fire below the threshold', async () => {
      dbChainMockFns.where.mockImplementationOnce(() => Promise.resolve([{ count: 9 }]))
      await expect(evaluateRule('error_count', makeConfig(), makeContext())).resolves.toBe(false)
    })

    it('only runs on failed executions', async () => {
      await expect(
        evaluateRule('error_count', makeConfig(), makeContext({ status: 'success' }))
      ).resolves.toBe(false)
      expect(dbChainMockFns.select).not.toHaveBeenCalled()
    })
  })

  it('no_activity never fires at execution time (owned by the poller)', async () => {
    await expect(evaluateRule('no_activity', makeConfig(), makeContext())).resolves.toBe(false)
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })
})
