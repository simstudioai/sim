/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ processor: vi.fn() }))
vi.mock('@trigger.dev/sdk', () => ({ task: (config: unknown) => config }))
vi.mock('@/lib/core/outbox/processor', () => ({ runOutboxProcessor: mocks.processor }))

import { processOutboxTask } from '@/background/process-outbox'

describe('outbox processor task', () => {
  beforeEach(() => vi.clearAllMocks())
  it('bounds worker concurrency and lets the durable outbox own event retries', async () => {
    expect(processOutboxTask).toMatchObject({
      id: 'process-outbox',
      machine: 'medium-2x',
      maxDuration: 900,
      retry: { maxAttempts: 1 },
      queue: { name: 'process-outbox', concurrencyLimit: 15 },
    })
    const output = { result: { processed: 3 }, recoveredDocuments: 0, reapedBackgroundWork: 0 }
    mocks.processor.mockResolvedValueOnce(output)
    await expect(processOutboxTask.run()).resolves.toEqual(output)
  })
  it('surfaces processor failures to Trigger', async () => {
    mocks.processor.mockRejectedValueOnce(new Error('database unavailable'))
    await expect(processOutboxTask.run()).rejects.toThrow('database unavailable')
  })
})
