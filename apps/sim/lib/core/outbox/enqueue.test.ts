import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  trigger: vi.fn(),
  processor: vi.fn(),
  enabled: true,
}))
vi.mock('@trigger.dev/sdk', () => ({ tasks: { trigger: mocks.trigger } }))
vi.mock('@/lib/core/config/env-flags', () => ({
  get isTriggerDevEnabled() {
    return mocks.enabled
  },
}))
vi.mock('@/lib/core/async-jobs/region', () => ({ resolveTriggerRegion: async () => 'us-east-1' }))
vi.mock('@/lib/core/outbox/processor', () => ({ runOutboxProcessor: mocks.processor }))

import { enqueueOutboxProcessor } from '@/lib/core/outbox/enqueue'

describe('outbox processor enqueue', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-16T12:34:45Z'))
    mocks.enabled = true
    mocks.trigger.mockResolvedValue({ id: 'run-1' })
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
    mocks.enabled = false
    const output = {
      result: { processed: 4, retried: 0, deadLettered: 0, leaseLost: 0, reaped: 0 },
      recoveredDocuments: 2,
      reapedBackgroundWork: 1,
    }
    mocks.processor.mockResolvedValueOnce(output)
    await expect(enqueueOutboxProcessor()).resolves.toEqual({ backend: 'inline', output })
    expect(mocks.trigger).not.toHaveBeenCalled()
  })
})
