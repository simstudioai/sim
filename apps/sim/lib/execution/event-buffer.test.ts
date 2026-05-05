/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionEventEntry } from '@/lib/execution/event-buffer'
import type { ExecutionEvent } from '@/lib/workflows/executor/execution-events'

const { mockGetRedisClient, mockRedis, persistedEntries } = vi.hoisted(() => {
  const persistedEntries: ExecutionEventEntry[] = []
  const mockRedis = {
    incrby: vi.fn(),
    hset: vi.fn(),
    expire: vi.fn(),
    hgetall: vi.fn(),
    zrangebyscore: vi.fn(),
    pipeline: vi.fn(),
  }
  const mockGetRedisClient = vi.fn(() => mockRedis)
  return { mockGetRedisClient, mockRedis, persistedEntries }
})

vi.mock('@/lib/core/config/redis', () => ({
  getRedisClient: mockGetRedisClient,
}))

import { createExecutionEventWriter } from '@/lib/execution/event-buffer'

function makeEvent(blockId: string): ExecutionEvent {
  return {
    type: 'block:started',
    timestamp: new Date().toISOString(),
    executionId: 'exec-1',
    workflowId: 'wf-1',
    data: {
      blockId,
      blockName: blockId,
      blockType: 'function',
      executionOrder: 1,
    },
  }
}

describe('execution event buffer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    persistedEntries.length = 0
    mockGetRedisClient.mockReturnValue(mockRedis)
    mockRedis.pipeline.mockImplementation(() => ({
      zadd: vi.fn((_key: string, ...args: (string | number)[]) => {
        for (let i = 0; i < args.length; i += 2) {
          persistedEntries.push(JSON.parse(args[i + 1] as string) as ExecutionEventEntry)
        }
      }),
      expire: vi.fn(),
      zremrangebyrank: vi.fn(),
      exec: vi.fn().mockResolvedValue(undefined),
    }))
  })

  it('serializes event id reservation so reconnect replay preserves write order', async () => {
    let releaseReservation: ((value: number) => void) | undefined
    mockRedis.incrby.mockReturnValueOnce(
      new Promise<number>((resolve) => {
        releaseReservation = resolve
      })
    )

    const writer = createExecutionEventWriter('exec-1')
    const firstWrite = writer.write(makeEvent('first'))
    const secondWrite = writer.write(makeEvent('second'))

    await Promise.resolve()
    expect(mockRedis.incrby).toHaveBeenCalledTimes(1)

    releaseReservation?.(100)
    await expect(Promise.all([firstWrite, secondWrite])).resolves.toMatchObject([
      { eventId: 1 },
      { eventId: 2 },
    ])

    await writer.close()

    expect(persistedEntries.map((entry) => entry.eventId)).toEqual([1, 2])
    expect(
      persistedEntries.map((entry) => (entry.event.data as { blockId: string }).blockId)
    ).toEqual(['first', 'second'])
  })
})
