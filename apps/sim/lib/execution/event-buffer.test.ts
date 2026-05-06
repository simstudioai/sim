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
    zremrangebyrank: vi.fn(),
    pipeline: vi.fn(),
    eval: vi.fn(),
  }
  const mockGetRedisClient = vi.fn(() => mockRedis)
  return { mockGetRedisClient, mockRedis, persistedEntries }
})

vi.mock('@/lib/core/config/redis', () => ({
  getRedisClient: mockGetRedisClient,
}))

import {
  createExecutionEventWriter,
  flushExecutionStreamReplayBuffer,
  initializeExecutionStreamMeta,
  readExecutionEventsState,
} from '@/lib/execution/event-buffer'

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
    mockRedis.hgetall.mockResolvedValue({})
    mockRedis.zrangebyscore.mockResolvedValue([])
    mockRedis.zremrangebyrank.mockResolvedValue(0)
    mockRedis.eval.mockImplementation(
      async (
        _script: string,
        _keyCount: number,
        _eventsKey: string,
        _seqKey: string,
        _metaKey: string,
        _ttl: number,
        _eventLimit: number,
        _updatedAt: string,
        terminalStatus: string,
        ...args: (string | number)[]
      ) => {
        for (let i = 0; i < args.length; i += 2) {
          persistedEntries.push(JSON.parse(args[i + 1] as string) as ExecutionEventEntry)
        }
        if (terminalStatus) {
          await mockRedis.hset('meta', { status: terminalStatus })
        }
        return persistedEntries[0]?.eventId ?? false
      }
    )
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

  it('flush waits for queued writes before returning', async () => {
    let releaseReservation: ((value: number) => void) | undefined
    mockRedis.incrby.mockReturnValueOnce(
      new Promise<number>((resolve) => {
        releaseReservation = resolve
      })
    )

    const writer = createExecutionEventWriter('exec-1')
    const write = writer.write(makeEvent('terminal'))
    const flush = writer.flush()

    await Promise.resolve()
    expect(persistedEntries).toEqual([])

    releaseReservation?.(100)
    await write
    await flush

    expect(persistedEntries.map((entry) => entry.eventId)).toEqual([1])
    expect((persistedEntries[0].event.data as { blockId: string }).blockId).toBe('terminal')
  })

  it('flush drains events appended while another flush is in flight', async () => {
    mockRedis.incrby.mockResolvedValue(100)
    let releaseFirstFlush: (() => void) | undefined
    const execCalls: Array<() => Promise<void>> = [
      () =>
        new Promise<void>((resolve) => {
          releaseFirstFlush = resolve
        }),
      () => Promise.resolve(),
    ]

    mockRedis.eval.mockImplementation(async (_script: string, ...args: unknown[]) => {
      const batchEntries: ExecutionEventEntry[] = []
      const zaddArgs = args.slice(8) as (string | number)[]
      for (let i = 0; i < zaddArgs.length; i += 2) {
        batchEntries.push(JSON.parse(zaddArgs[i + 1] as string) as ExecutionEventEntry)
      }
      await (execCalls.shift() ?? (() => Promise.resolve()))()
      persistedEntries.push(...batchEntries)
      return persistedEntries[0]?.eventId ?? false
    })
    mockRedis.pipeline.mockImplementation(() => {
      const batchEntries: ExecutionEventEntry[] = []
      return {
        zadd: vi.fn((_key: string, ...args: (string | number)[]) => {
          for (let i = 0; i < args.length; i += 2) {
            batchEntries.push(JSON.parse(args[i + 1] as string) as ExecutionEventEntry)
          }
        }),
        expire: vi.fn(),
        zremrangebyrank: vi.fn(),
        exec: vi.fn(async () => {
          await (execCalls.shift() ?? (() => Promise.resolve()))()
          persistedEntries.push(...batchEntries)
        }),
      }
    })

    const writer = createExecutionEventWriter('exec-1')
    await writer.write(makeEvent('first'))
    const firstFlush = writer.flush()

    await Promise.resolve()
    expect(persistedEntries).toEqual([])

    await writer.write(makeEvent('terminal'))
    const terminalFlush = writer.flush()

    releaseFirstFlush?.()
    await firstFlush
    await terminalFlush

    expect(
      persistedEntries.map((entry) => (entry.event.data as { blockId: string }).blockId)
    ).toEqual(['first', 'terminal'])
  })

  it('flush surfaces queued write failures', async () => {
    mockRedis.incrby.mockRejectedValueOnce(new Error('redis reservation failed'))

    const writer = createExecutionEventWriter('exec-1')
    await expect(writer.write(makeEvent('lost'))).rejects.toThrow('redis reservation failed')
    await expect(writer.flush()).rejects.toThrow('redis reservation failed')
  })

  it('allows terminal finalization after a recovered queued write failure', async () => {
    mockRedis.incrby
      .mockRejectedValueOnce(new Error('redis reservation failed'))
      .mockResolvedValueOnce(200)

    const writer = createExecutionEventWriter('exec-1')
    await expect(writer.write(makeEvent('lost'))).rejects.toThrow('redis reservation failed')
    await writer.write(makeEvent('terminal'))

    await expect(flushExecutionStreamReplayBuffer('exec-1', writer)).resolves.toBe(true)
    expect(persistedEntries.map((entry) => entry.eventId)).toEqual([101])
    expect(mockRedis.hset).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: 'complete' })
    )
  })

  it('does not write terminal meta when the final replay flush fails', async () => {
    mockRedis.incrby.mockResolvedValue(100)
    mockRedis.eval.mockRejectedValue(new Error('redis flush failed'))

    const writer = createExecutionEventWriter('exec-1')
    await writer.write(makeEvent('terminal'))

    await expect(flushExecutionStreamReplayBuffer('exec-1', writer)).resolves.toBe(false)
    expect(mockRedis.hset).not.toHaveBeenCalled()
  })

  it('flushes replay events after a recovered final replay flush without terminal meta', async () => {
    mockRedis.incrby.mockResolvedValue(100)
    let flushAttempt = 0
    mockRedis.eval.mockImplementation(async (_script: string, ...args: unknown[]) => {
      const zaddArgs = args.slice(8) as (string | number)[]
      if (flushAttempt > 0) {
        for (let i = 0; i < zaddArgs.length; i += 2) {
          persistedEntries.push(JSON.parse(zaddArgs[i + 1] as string) as ExecutionEventEntry)
        }
      }
      if (flushAttempt++ === 0) {
        throw new Error('first flush failed')
      }
      return persistedEntries[0]?.eventId ?? false
    })
    mockRedis.pipeline.mockImplementation(() => ({
      zadd: vi.fn((_key: string, ...args: (string | number)[]) => {
        if (flushAttempt > 0) {
          for (let i = 0; i < args.length; i += 2) {
            persistedEntries.push(JSON.parse(args[i + 1] as string) as ExecutionEventEntry)
          }
        }
      }),
      expire: vi.fn(),
      zremrangebyrank: vi.fn(),
      exec: vi.fn(async () => {
        if (flushAttempt++ === 0) {
          throw new Error('first flush failed')
        }
      }),
    }))

    const writer = createExecutionEventWriter('exec-1')
    await writer.write(makeEvent('terminal'))

    await expect(flushExecutionStreamReplayBuffer('exec-1', writer)).resolves.toBe(true)
    expect(persistedEntries.map((entry) => entry.eventId)).toEqual([1])
    expect(mockRedis.hset).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: 'complete' })
    )
  })

  it('writes terminal event and terminal meta atomically through writeTerminal', async () => {
    mockRedis.incrby.mockResolvedValue(100)

    const writer = createExecutionEventWriter('exec-1')
    await writer.writeTerminal(makeEvent('terminal'), 'complete')

    expect(persistedEntries.map((entry) => entry.eventId)).toEqual([1])
    expect(mockRedis.hset).toHaveBeenCalledWith('meta', { status: 'complete' })
  })

  it('retries active meta initialization before giving up', async () => {
    mockRedis.hset.mockRejectedValueOnce(new Error('meta write failed')).mockResolvedValueOnce(1)

    await expect(
      initializeExecutionStreamMeta('exec-1', { userId: 'user-1', workflowId: 'wf-1' })
    ).resolves.toBe(true)

    expect(mockRedis.hset).toHaveBeenCalledTimes(2)
    expect(mockRedis.hset).toHaveBeenLastCalledWith(
      'execution:stream:exec-1:meta',
      expect.objectContaining({
        status: 'active',
        userId: 'user-1',
        workflowId: 'wf-1',
      })
    )
  })

  it('reports pruned replay buffers before reading incomplete events', async () => {
    mockRedis.hgetall.mockResolvedValue({ status: 'active', earliestEventId: '10' })

    await expect(readExecutionEventsState('exec-1', 0)).resolves.toEqual({
      status: 'pruned',
      earliestEventId: 10,
    })
    expect(mockRedis.zrangebyscore).not.toHaveBeenCalled()
  })
})
