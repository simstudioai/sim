import { asyncJobsRegionMock } from '@sim/testing/mocks/async-jobs-region.mock'
import { setEnvFlags } from '@sim/testing/mocks/env-flags.mock'
import { outboxServiceMock, outboxServiceMockFns } from '@sim/testing/mocks/outbox-service.mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  processor: vi.fn(),
}))
vi.mock('@/lib/core/async-jobs/region', () => asyncJobsRegionMock)
vi.mock('@/lib/core/outbox/processor', () => ({ runOutboxProcessor: hoisted.processor }))
vi.mock('@/lib/core/outbox/service', () => outboxServiceMock)

import { tasks } from '@trigger.dev/sdk'
import { enqueueOutboxProcessor } from '@/lib/core/outbox/enqueue'

const mocks = {
  ...hoisted,
  trigger: vi.mocked(tasks.trigger),
  hasDueWork: outboxServiceMockFns.mockHasDueOutboxWork,
}

/** 12:34 is not a maintenance minute (754 % 5 = 4); 12:35 is. */
const IDLE_MINUTE = new Date('2026-09-16T12:34:45Z')
const MAINTENANCE_MINUTE = new Date('2026-09-16T12:35:10Z')

const BACKENDS = [
  { name: 'Trigger.dev', isTriggerDevEnabled: true },
  { name: 'self-hosted inline', isTriggerDevEnabled: false },
] as const

function processorStarted() {
  return mocks.trigger.mock.calls.length + mocks.processor.mock.calls.length
}

describe('outbox processor enqueue', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(IDLE_MINUTE)
    setEnvFlags({ isTriggerDevEnabled: true })
    mocks.trigger.mockResolvedValue({ id: 'run-1' })
    mocks.hasDueWork.mockReset()
    mocks.hasDueWork.mockResolvedValue(true)
  })
  afterEach(() => vi.useRealTimers())

  it('deduplicates duplicate ticks while allowing the next minute to drain more work', async () => {
    await enqueueOutboxProcessor()
    await enqueueOutboxProcessor()
    vi.advanceTimersByTime(60_000)
    await enqueueOutboxProcessor()
    const keys = mocks.trigger.mock.calls.map((call) => call[2].idempotencyKey)
    expect(keys[0]).toBe(keys[1])
    expect(keys[2]).not.toBe(keys[0])
  })

  it('fails closed on an enqueue error without starting concurrent inline work', async () => {
    mocks.trigger.mockRejectedValueOnce(new Error('Trigger unavailable'))
    await expect(enqueueOutboxProcessor()).rejects.toThrow('Trigger unavailable')
    expect(mocks.processor).not.toHaveBeenCalled()
  })

  it('preserves synchronous processing for self-hosted deployments without Trigger', async () => {
    setEnvFlags({ isTriggerDevEnabled: false })
    const output = {
      result: { processed: 4, retried: 0, deadLettered: 0, leaseLost: 0, reaped: 0 },
      recoveredDocuments: 2,
      reapedBackgroundWork: 1,
    }
    mocks.processor.mockResolvedValueOnce(output)
    await expect(enqueueOutboxProcessor()).resolves.toEqual({ backend: 'inline', output })
    expect(mocks.trigger).not.toHaveBeenCalled()
  })

  it.each(BACKENDS)(
    'starts no $name processor on an idle queue outside the maintenance window',
    async ({ isTriggerDevEnabled }) => {
      setEnvFlags({ isTriggerDevEnabled })
      mocks.hasDueWork.mockResolvedValue(false)
      await expect(enqueueOutboxProcessor()).resolves.toEqual({ backend: null, triggered: false })
      expect(processorStarted()).toBe(0)
    }
  )

  it.each(BACKENDS)(
    'starts the $name processor on an idle queue in the maintenance window',
    async ({ isTriggerDevEnabled }) => {
      setEnvFlags({ isTriggerDevEnabled })
      vi.setSystemTime(MAINTENANCE_MINUTE)
      mocks.hasDueWork.mockResolvedValue(false)
      await enqueueOutboxProcessor()
      expect(processorStarted()).toBe(1)
    }
  )

  it.each(BACKENDS)(
    'starts the $name processor when the work check fails',
    async ({ isTriggerDevEnabled }) => {
      setEnvFlags({ isTriggerDevEnabled })
      mocks.hasDueWork.mockRejectedValue(new Error('connection refused'))
      await enqueueOutboxProcessor()
      expect(processorStarted()).toBe(1)
    }
  )
})
