/**
 * @vitest-environment node
 */
import { redisConfigMockFns, resetEnvMock, resetRedisConfigMock, setEnv } from '@sim/testing'
import { sleep } from '@sim/utils/helpers'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionEventEntry } from '@/lib/execution/event-buffer'
import { clearLargeValueCacheForTests } from '@/lib/execution/payloads/cache'
import { LARGE_VALUE_REF_MARKER } from '@/lib/execution/payloads/large-value-ref'
import type { ExecutionEvent } from '@/lib/workflows/executor/execution-events'

const { mockRedis, persistedEntries } = vi.hoisted(() => {
  const persistedEntries: ExecutionEventEntry[] = []
  const mockRedis = {
    get: vi.fn(),
    incrby: vi.fn(),
    hset: vi.fn(),
    expire: vi.fn(),
    hgetall: vi.fn(),
    zrangebyscore: vi.fn(),
    zremrangebyrank: vi.fn(),
    pipeline: vi.fn(),
    eval: vi.fn(),
  }
  return { mockRedis, persistedEntries }
})

const { mockRegisterLargeValueOwner, mockUploadFile } = vi.hoisted(() => ({
  mockRegisterLargeValueOwner: vi.fn(),
  mockUploadFile: vi.fn(),
}))

vi.mock('@/lib/uploads', () => ({
  StorageService: {
    uploadFile: mockUploadFile,
  },
}))

vi.mock('@/lib/uploads/core/storage-service', () => ({
  uploadFile: mockUploadFile,
}))

vi.mock('@/lib/execution/payloads/large-value-metadata', () => ({
  registerLargeValueOwner: mockRegisterLargeValueOwner,
}))

const mockGetRedisClient = redisConfigMockFns.mockGetRedisClient

afterAll(() => {
  resetEnvMock()
  resetRedisConfigMock()
})

import {
  createExecutionEventWriter,
  flushExecutionStreamReplayBuffer,
  initializeExecutionStreamMeta,
  markExecutionStreamTerminal,
  readExecutionEventsState,
  readExecutionMetaState,
  resetExecutionStreamBuffer,
  setExecutionActiveBlockStarts,
  setExecutionMeta,
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

function parseFlushEvalArgs(args: unknown[]): {
  terminalStatus: string
  zaddArgs: (string | number)[]
} {
  const keyCount = Number(args[0])
  return {
    terminalStatus: String(args[keyCount + 4] ?? ''),
    zaddArgs: args.slice(keyCount + 9) as (string | number)[],
  }
}

function isFlushScript(script: string): boolean {
  return script.includes("redis.call('ZADD'") && script.includes('new_count')
}

function isResetScript(script: string): boolean {
  return script.includes('retained_bytes') && script.includes('replayStartEventId')
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

describe('execution event buffer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearLargeValueCacheForTests()
    setEnv({ REDIS_URL: 'redis://localhost:6379' })
    persistedEntries.length = 0
    mockGetRedisClient.mockReturnValue(mockRedis)
    mockRedis.get.mockResolvedValue(null)
    mockRedis.hgetall.mockResolvedValue({})
    mockRedis.zrangebyscore.mockResolvedValue([])
    mockRedis.zremrangebyrank.mockResolvedValue(0)
    mockUploadFile.mockImplementation(async ({ customKey }) => ({ key: customKey }))
    mockRegisterLargeValueOwner.mockResolvedValue(true)
    mockRedis.eval.mockImplementation(async (script: string, ...args: unknown[]) => {
      if (isFlushScript(script)) {
        const { terminalStatus, zaddArgs } = parseFlushEvalArgs(args)
        for (let i = 0; i < zaddArgs.length; i += 2) {
          persistedEntries.push(JSON.parse(zaddArgs[i + 1] as string) as ExecutionEventEntry)
        }
        if (terminalStatus) {
          await mockRedis.hset('meta', { status: terminalStatus })
        }
        return [1, persistedEntries[0]?.eventId ?? false, 0]
      }
      if (isResetScript(script)) {
        return 0
      }
      if (script.includes('DECRBY')) {
        return 1
      }
      return [1, 'ok', 0, 0]
    })
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

  it('restores the bounded active block snapshot from stream metadata', async () => {
    mockRedis.hgetall.mockResolvedValueOnce({
      status: 'active',
      workflowId: 'wf-1',
      activeBlockStarts: JSON.stringify([
        {
          eventId: 7,
          data: {
            blockId: 'function-1',
            blockName: 'Qualify',
            blockType: 'function',
            executionOrder: 2,
          },
        },
      ]),
    })

    await expect(readExecutionMetaState('exec-1')).resolves.toMatchObject({
      status: 'found',
      meta: {
        activeBlockStarts: [{ eventId: 7, data: { blockId: 'function-1' } }],
      },
    })
  })

  it('uses the configured in-memory provider when database cache mode is selected', async () => {
    setEnv({ REDIS_URL: undefined })
    mockGetRedisClient.mockReturnValue(null)
    const executionId = 'exec-database-provider'

    await expect(
      initializeExecutionStreamMeta(executionId, {
        workflowId: 'wf-1',
        userId: 'user-1',
      })
    ).resolves.toBe(true)
    const writer = createExecutionEventWriter(executionId)
    const entry = await writer.write({
      ...makeEvent('function-local'),
      executionId,
    })

    await expect(readExecutionEventsState(executionId, 0)).resolves.toMatchObject({
      status: 'ok',
      events: [{ eventId: entry.eventId, event: { type: 'block:started' } }],
    })
    await expect(readExecutionMetaState(executionId)).resolves.toMatchObject({
      status: 'found',
      meta: { status: 'active', protocolVersion: 1 },
    })
  })

  it('retains active runs through the execution ceiling but expires terminal streams after an hour', async () => {
    await setExecutionMeta('exec-1', { status: 'active' })
    await setExecutionMeta('exec-1', { status: 'complete' })

    expect(mockRedis.expire.mock.calls[0]?.[1]).toBeGreaterThan(60 * 60)
    expect(mockRedis.expire.mock.calls[1]?.[1]).toBe(60 * 60)
  })

  it('atomically marks a degraded terminal stream and wakes its observers', async () => {
    await expect(markExecutionStreamTerminal('exec-1', 'error')).resolves.toBe(true)

    const [script, keyCount, metaKey, signalChannel, status, , ttlSeconds] =
      mockRedis.eval.mock.calls.at(-1) ?? []
    expect(script).toContain("redis.call('HSET'")
    expect(script).toContain("redis.call('PUBLISH'")
    expect(keyCount).toBe(2)
    expect(metaKey).toBe('execution:stream:exec-1:meta')
    expect(signalChannel).toBe('execution:signal:exec-1')
    expect(status).toBe('error')
    expect(ttlSeconds).toBe(60 * 60)
  })

  it('atomically persists active block starts and wakes reconnecting observers', async () => {
    const activeBlockStarts = [
      {
        eventId: 7,
        data: {
          blockId: 'function-1',
          blockName: 'Qualify',
          blockType: 'function',
          executionOrder: 2,
        },
      },
    ]

    await expect(setExecutionActiveBlockStarts('exec-1', activeBlockStarts)).resolves.toBe(true)

    const [script, keyCount, metaKey, signalChannel, snapshot, , ttlSeconds] =
      mockRedis.eval.mock.calls.at(-1) ?? []
    expect(script).toContain("redis.call('HSET'")
    expect(script).toContain("redis.call('HGET'")
    expect(script).toContain("status == 'complete'")
    expect(script).toContain("status == 'error'")
    expect(script).toContain("status == 'cancelled'")
    expect(script).toContain("redis.call('PUBLISH'")
    expect(keyCount).toBe(2)
    expect(metaKey).toBe('execution:stream:exec-1:meta')
    expect(signalChannel).toBe('execution:signal:exec-1')
    expect(snapshot).toBe(JSON.stringify(activeBlockStarts))
    expect(ttlSeconds).toBeGreaterThan(60 * 60)
  })

  it('does not replace a terminal process-local snapshot with a late block event', async () => {
    setEnv({ REDIS_URL: undefined })
    mockGetRedisClient.mockReturnValue(null)
    const executionId = 'exec-terminal-snapshot'

    await expect(markExecutionStreamTerminal(executionId, 'cancelled')).resolves.toBe(true)
    await expect(
      setExecutionActiveBlockStarts(executionId, [
        {
          eventId: 9,
          data: {
            blockId: 'function-late',
            blockName: 'Late',
            blockType: 'function',
            executionOrder: 3,
          },
        },
      ])
    ).resolves.toBe(true)

    await expect(readExecutionMetaState(executionId)).resolves.toMatchObject({
      status: 'found',
      meta: { status: 'cancelled', activeBlockStarts: [] },
    })
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

    mockRedis.eval.mockImplementation(async (script: string, ...args: unknown[]) => {
      const batchEntries: ExecutionEventEntry[] = []
      const { zaddArgs } = parseFlushEvalArgs(args)
      for (let i = 0; i < zaddArgs.length; i += 2) {
        batchEntries.push(JSON.parse(zaddArgs[i + 1] as string) as ExecutionEventEntry)
      }
      await (execCalls.shift() ?? (() => Promise.resolve()))()
      persistedEntries.push(...batchEntries)
      return [1, persistedEntries[0]?.eventId ?? false, 0]
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
    mockRedis.eval.mockImplementation(async (script: string, ...args: unknown[]) => {
      const { zaddArgs } = parseFlushEvalArgs(args)
      if (flushAttempt > 0) {
        for (let i = 0; i < zaddArgs.length; i += 2) {
          persistedEntries.push(JSON.parse(zaddArgs[i + 1] as string) as ExecutionEventEntry)
        }
      }
      if (flushAttempt++ === 0) {
        throw new Error('first flush failed')
      }
      return [1, persistedEntries[0]?.eventId ?? false, 0]
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

  it('budgets only net event bytes after pruning during flush', async () => {
    mockRedis.incrby.mockResolvedValue(100)
    let netBudgetBytes = 0
    mockRedis.eval.mockImplementation(async (script: string, ...args: unknown[]) => {
      const keyCount = Number(args[0])
      netBudgetBytes = Number(args[keyCount + 5])
      const { zaddArgs } = parseFlushEvalArgs(args)
      for (let i = 0; i < zaddArgs.length; i += 2) {
        persistedEntries.push(JSON.parse(zaddArgs[i + 1] as string) as ExecutionEventEntry)
      }
      return [1, persistedEntries[0]?.eventId ?? false, 123]
    })

    const writer = createExecutionEventWriter('exec-1')
    await writer.writeTerminal(makeEvent('terminal'), 'complete')

    expect(netBudgetBytes).toBeGreaterThan(0)
  })

  it('releases retained event budget when resetting the stream buffer', async () => {
    mockRedis.get.mockResolvedValueOnce(41)
    mockRedis.hgetall.mockResolvedValueOnce({ userId: 'user-1' })
    let releasedBytes = 0
    mockRedis.eval.mockImplementationOnce(async (script: string, ...args: unknown[]) => {
      expect(script).toContain('retained_bytes')
      expect(args.slice(0, 5)).toEqual([
        4,
        'execution:stream:exec-1:events',
        'execution:stream:exec-1:meta',
        'execution:redis-budget:execution:exec-1',
        'execution:redis-budget:user:user-1',
      ])
      releasedBytes = 256
      return releasedBytes
    })

    await expect(resetExecutionStreamBuffer('exec-1')).resolves.toBe(true)

    expect(releasedBytes).toBe(256)
  })

  it('surfaces execution memory limit errors when the Redis budget is exceeded', async () => {
    mockRedis.incrby.mockResolvedValue(100)
    mockRedis.eval.mockImplementation(async (script: string) => {
      if (isFlushScript(script)) {
        return [0, 'execution_redis_bytes', 64 * 1024 * 1024]
      }
      return [1, 'ok', 0, 0]
    })

    const writer = createExecutionEventWriter('exec-1')

    await expect(writer.writeTerminal(makeEvent('terminal'), 'complete')).rejects.toThrow(
      'Execution memory limit exceeded'
    )
    expect(persistedEntries).toEqual([])
  })

  /**
   * Requeueing a batch the budget rejected is what grew `pending` for a whole
   * run, each retry re-serializing an ever-larger array. Rejected bytes must be
   * dropped, not retained.
   */
  it('drops rejected batches instead of growing a backlog when the Redis budget is exhausted', async () => {
    mockRedis.incrby.mockResolvedValue(100000)
    let budgetExhausted = true
    mockRedis.eval.mockImplementation(async (script: string, ...args: unknown[]) => {
      if (isFlushScript(script)) {
        if (budgetExhausted) return [0, 'execution_redis_bytes', 64 * 1024 * 1024]
        const { zaddArgs } = parseFlushEvalArgs(args)
        for (let i = 0; i < zaddArgs.length; i += 2) {
          persistedEntries.push(JSON.parse(zaddArgs[i + 1] as string) as ExecutionEventEntry)
        }
        return [1, 1, 0]
      }
      return [1, 'ok', 0, 0]
    })

    const writer = createExecutionEventWriter('exec-1')

    for (let i = 0; i < 2500; i++) {
      await writer.write(makeEvent(`block-${i}`)).catch(() => {})
    }

    // Once the budget frees the writer recovers, but only whatever accumulated
    // since the last rejection — never a run-length backlog.
    budgetExhausted = false
    await writer.flush()

    expect(persistedEntries.length).toBeLessThanOrEqual(200)
  })

  /**
   * Individual events are capped well below the single-write limit, but a burst
   * of large ones coalesces into a batch above it. Splitting is the only way the
   * buffer makes progress: no retry can shrink a batch it keeps whole.
   */
  it('splits a batch that exceeds the single-write cap instead of stalling on it', async () => {
    mockRedis.incrby.mockResolvedValue(100)
    // Built from many modest fields rather than one huge one: compaction offloads
    // individual values over its threshold, so a single large string would leave a
    // tiny ref behind and never reach the batch cap. Each event stays under the
    // 8MiB per-event cap; two of them do not.
    const chunk = 'x'.repeat(100_000)
    const wideEvent = () => {
      const event = makeEvent('wide')
      const data = event.data as Record<string, unknown>
      for (let i = 0; i < 45; i++) data[`field${i}`] = chunk
      return event
    }

    const writer = createExecutionEventWriter('exec-1')
    await writer.write(wideEvent())
    await writer.write(wideEvent())
    await writer.flush()

    expect(persistedEntries).toHaveLength(2)
    expect(
      mockRedis.eval.mock.calls.filter(([script]) => isFlushScript(script as string))
    ).toHaveLength(2)
  })

  it('drops the terminal entry rather than leaving it queued when the budget is exhausted', async () => {
    mockRedis.incrby.mockResolvedValue(100)
    let budgetExhausted = true
    mockRedis.eval.mockImplementation(async (script: string, ...args: unknown[]) => {
      if (isFlushScript(script)) {
        if (budgetExhausted) return [0, 'execution_redis_bytes', 64 * 1024 * 1024]
        const { zaddArgs } = parseFlushEvalArgs(args)
        for (let i = 0; i < zaddArgs.length; i += 2) {
          persistedEntries.push(JSON.parse(zaddArgs[i + 1] as string) as ExecutionEventEntry)
        }
        return [1, 1, 0]
      }
      return [1, 'ok', 0, 0]
    })

    const writer = createExecutionEventWriter('exec-1')

    await expect(writer.writeTerminal(makeEvent('terminal'), 'complete')).rejects.toThrow(
      'Execution memory limit exceeded'
    )

    // The failed terminal write stays surfaced through flush(), but its entry must
    // not linger in the backlog and reappear once the budget frees up.
    budgetExhausted = false
    await writer.flush().catch(() => {})

    expect(persistedEntries).toEqual([])
  })

  /**
   * A timer-driven flush carries no terminal status of its own. If it is the
   * loop that drains the final chunk, the terminal event lands without a status
   * and readers wait on an `active` stream forever — while `writeTerminal` reports
   * success, so nothing degrades.
   */
  it('applies terminal status even when a concurrent scheduled flush drains the final chunk', async () => {
    mockRedis.incrby.mockResolvedValue(100)
    const observedTerminalStatuses: string[] = []
    let releaseFirstFlush: (() => void) | undefined
    const firstFlushStarted = new Promise<void>((resolveStarted) => {
      let started = false
      mockRedis.eval.mockImplementation(async (script: string, ...args: unknown[]) => {
        if (!isFlushScript(script)) return [1, 'ok', 0, 0]
        const { terminalStatus, zaddArgs } = parseFlushEvalArgs(args)
        observedTerminalStatuses.push(terminalStatus)
        if (!started) {
          started = true
          resolveStarted()
          await new Promise<void>((resolve) => {
            releaseFirstFlush = resolve
          })
        }
        for (let i = 0; i < zaddArgs.length; i += 2) {
          persistedEntries.push(JSON.parse(zaddArgs[i + 1] as string) as ExecutionEventEntry)
        }
        return [1, 1, 0]
      })
    })

    const writer = createExecutionEventWriter('exec-1')
    await writer.write(makeEvent('first'))
    await firstFlushStarted

    const terminalWrite = writer.writeTerminal(makeEvent('terminal'), 'complete')
    // Let writeTerminal's queued body actually enqueue its entry before the
    // in-flight flush resolves — otherwise the scheduled loop finds nothing left
    // to drain and the race under test never forms.
    await sleep(5)
    releaseFirstFlush?.()
    await terminalWrite

    expect(observedTerminalStatuses).toContain('complete')
  })

  /**
   * The backlog ahead of a terminal event can exceed the budget while the
   * terminal event itself still fits. Discarding it alongside the backlog would
   * leave readers without the final status for a run that could have published
   * one.
   */
  it('still publishes the terminal event when the backlog ahead of it is dropped', async () => {
    mockRedis.incrby.mockResolvedValue(100)
    const observedTerminalStatuses: string[] = []
    mockRedis.eval.mockImplementation(async (script: string, ...args: unknown[]) => {
      if (!isFlushScript(script)) return [1, 'ok', 0, 0]
      const { terminalStatus, zaddArgs } = parseFlushEvalArgs(args)
      // Reject anything but a lone entry, standing in for a budget with only
      // enough headroom left for one small write.
      if (zaddArgs.length > 2) return [0, 'execution_redis_bytes', 64 * 1024 * 1024]
      observedTerminalStatuses.push(terminalStatus)
      for (let i = 0; i < zaddArgs.length; i += 2) {
        persistedEntries.push(JSON.parse(zaddArgs[i + 1] as string) as ExecutionEventEntry)
      }
      return [1, 1, 0]
    })

    const writer = createExecutionEventWriter('exec-1')
    for (let i = 0; i < 5; i++) {
      await writer.write(makeEvent(`block-${i}`)).catch(() => {})
    }

    await expect(writer.writeTerminal(makeEvent('terminal'), 'complete')).resolves.toMatchObject({
      executionId: 'exec-1',
    })
    expect(observedTerminalStatuses).toContain('complete')
    expect(
      persistedEntries.map((entry) => (entry.event.data as { blockId: string }).blockId)
    ).toContain('terminal')
  })

  /**
   * A terminal publish that threw must not be resurrected. Leaving the status
   * armed would let the next flush stamp the stream terminal for an event that
   * was discarded — telling readers the run ended cleanly while the caller was
   * told it failed.
   */
  it('does not stamp terminal status on a later flush after the terminal publish failed', async () => {
    mockRedis.incrby.mockResolvedValue(100)
    const observedTerminalStatuses: string[] = []
    let failNextFlush = false
    mockRedis.eval.mockImplementation(async (script: string, ...args: unknown[]) => {
      if (!isFlushScript(script)) return [1, 'ok', 0, 0]
      if (failNextFlush) throw new Error('redis unavailable')
      const { terminalStatus, zaddArgs } = parseFlushEvalArgs(args)
      observedTerminalStatuses.push(terminalStatus)
      for (let i = 0; i < zaddArgs.length; i += 2) {
        persistedEntries.push(JSON.parse(zaddArgs[i + 1] as string) as ExecutionEventEntry)
      }
      return [1, 1, 0]
    })

    const writer = createExecutionEventWriter('exec-1')
    await writer.write(makeEvent('a'))

    failNextFlush = true
    await expect(writer.writeTerminal(makeEvent('terminal'), 'complete')).rejects.toThrow()

    // flush() still surfaces the earlier terminal failure; what matters is that
    // the events it drains are not stamped terminal.
    failNextFlush = false
    await writer.flush().catch(() => {})

    expect(observedTerminalStatuses).toEqual([''])
    expect(
      persistedEntries.map((entry) => (entry.event.data as { blockId: string }).blockId)
    ).toEqual(['a'])
  })

  /**
   * A budget rejection must not colour a later, unrelated failure: reporting a
   * Redis outage as "reduce payload size" sends the user after the wrong thing.
   */
  it('reports the generic failure, not a stale budget rejection, on the terminal path', async () => {
    mockRedis.incrby.mockResolvedValue(100)
    let mode: 'budget' | 'outage' = 'budget'
    mockRedis.eval.mockImplementation(async (script: string) => {
      if (!isFlushScript(script)) return [1, 'ok', 0, 0]
      if (mode === 'budget') return [0, 'execution_redis_bytes', 64 * 1024 * 1024]
      throw new Error('redis unavailable')
    })

    const writer = createExecutionEventWriter('exec-1')
    for (let i = 0; i < 200; i++) {
      await writer.write(makeEvent(`block-${i}`)).catch(() => {})
    }

    mode = 'outage'
    await expect(writer.writeTerminal(makeEvent('terminal'), 'complete')).rejects.toThrow(
      'Failed to flush terminal execution event'
    )
  })

  it('settles a scheduled flush that hits the budget instead of rejecting later callers', async () => {
    mockRedis.incrby.mockResolvedValue(100)
    mockRedis.eval.mockImplementation(async (script: string) => {
      if (isFlushScript(script)) {
        return [0, 'execution_redis_bytes', 64 * 1024 * 1024]
      }
      return [1, 'ok', 0, 0]
    })

    const writer = createExecutionEventWriter('exec-1')
    await writer.write(makeEvent('a'))

    await sleep(60)

    await expect(writer.flush()).resolves.toBeUndefined()
  })

  /**
   * A short run must keep full-fidelity output: the SSE stream carries the
   * compacted event, and the terminal renders a ref only as a preview, so
   * offloading ordinary block outputs would make them unreadable live.
   */
  it('keeps values inline while the execution is below the offload pressure mark', async () => {
    mockRedis.incrby.mockResolvedValue(100)
    const payload = 'x'.repeat(512 * 1024)

    const writer = createExecutionEventWriter('exec-1', {
      workspaceId: 'ws-1',
      workflowId: 'wf-1',
    })
    await writer.write(makeEvent(payload))
    await writer.flush()

    const persisted = JSON.stringify(persistedEntries[0])
    expect(persisted).toContain(payload)
    expect(persisted).not.toContain(LARGE_VALUE_REF_MARKER)
  })

  /**
   * Once a run has buffered its way into the danger zone the tight ceiling
   * engages, so it stops accumulating against its budget instead of pinning
   * itself at the ceiling for the rest of its life.
   */
  it('offloads values once the execution crosses the offload pressure mark', async () => {
    mockRedis.incrby.mockResolvedValue(100000)
    const payload = 'x'.repeat(2 * 1024 * 1024)

    const writer = createExecutionEventWriter('exec-1', {
      workspaceId: 'ws-1',
      workflowId: 'wf-1',
    })
    // Push past half the per-execution budget so the next write is under pressure.
    for (let i = 0; i < 17; i++) {
      await writer.write(makeEvent(payload))
      await writer.flush()
    }
    persistedEntries.length = 0
    await writer.write(makeEvent(payload))
    await writer.flush()

    const persisted = JSON.stringify(persistedEntries[0])
    expect(persisted).toContain(LARGE_VALUE_REF_MARKER)
    expect(persisted).not.toContain(payload)
  })

  /**
   * Terminal status is the reader's end-of-run signal: once it lands, a
   * reconnecting client drains what is in Redis and closes. Stamping it while
   * lower event ids are still queued strands those events behind a stream the
   * reader has already finished with.
   *
   * Needs a backlog past the single-write cap so chunking leaves a remainder
   * behind the terminal entry — the only shape where that ordering can invert.
   */
  it('does not stamp terminal status while earlier events are still queued', async () => {
    mockRedis.incrby.mockResolvedValue(100000)
    const idsAtStamp: number[] = []
    mockRedis.eval.mockImplementation(async (script: string, ...args: unknown[]) => {
      if (!isFlushScript(script)) return [1, 'ok', 0, 0]
      const { terminalStatus, zaddArgs } = parseFlushEvalArgs(args)
      // Reject any multi-entry batch, forcing the terminal-alone retry path.
      if (zaddArgs.length > 2) return [0, 'execution_redis_bytes', 64 * 1024 * 1024]
      for (let i = 0; i < zaddArgs.length; i += 2) {
        persistedEntries.push(JSON.parse(zaddArgs[i + 1] as string) as ExecutionEventEntry)
      }
      if (terminalStatus && idsAtStamp.length === 0) {
        idsAtStamp.push(...persistedEntries.map((e) => e.eventId))
      }
      return [1, 1, 0]
    })

    // ~3MB per event, so three of them exceed the 8MiB single-write cap and the
    // chunk boundary leaves a remainder queued behind the terminal entry.
    const payload = 'x'.repeat(1_500_000)
    const writer = createExecutionEventWriter('exec-1', {
      workspaceId: 'ws-1',
      workflowId: 'wf-1',
    })
    for (let i = 0; i < 3; i++) {
      await writer.write(makeEvent(payload)).catch(() => {})
    }
    await writer.writeTerminal(makeEvent('terminal'), 'complete').catch(() => {})
    await writer.close().catch(() => {})

    const terminalId = Math.max(...persistedEntries.map((e) => e.eventId))
    const strandedAtStamp = persistedEntries
      .map((e) => e.eventId)
      .filter((id) => id < terminalId && !idsAtStamp.includes(id))
    expect(strandedAtStamp).toEqual([])
  })

  /**
   * Pressure has to be measured as events are produced, not once a flush
   * succeeds. A burst is compacted long before the scheduled flush runs, so
   * flush-time accounting would let the very batch that exhausts the budget
   * through at the loose ceiling and drop it instead of offloading it.
   */
  it('engages pressure within a burst that has not flushed yet', async () => {
    mockRedis.incrby.mockResolvedValue(100000)
    const payload = 'x'.repeat(2 * 1024 * 1024)

    const writer = createExecutionEventWriter('exec-1', {
      workspaceId: 'ws-1',
      workflowId: 'wf-1',
    })
    // No flush between writes: everything stays pending while the burst builds.
    for (let i = 0; i < 20; i++) {
      await writer.write(makeEvent(payload)).catch(() => {})
    }
    await writer.flush().catch(() => {})

    // The later events in the burst must have been offloaded, not left inline.
    const persisted = JSON.stringify(persistedEntries)
    expect(persisted).toContain(LARGE_VALUE_REF_MARKER)
  })

  /**
   * A transient failure while draining the backlog must not cost events, and
   * must not let the run be marked terminal. Overwriting the queue would drop
   * entries the budget never rejected, and the drain's final chunk would
   * otherwise stamp the status before the terminal event is written.
   */
  it('retains the backlog and withholds terminal status when the drain fails transiently', async () => {
    mockRedis.incrby.mockResolvedValue(100000)
    const stamped: string[] = []
    let failDrain = true
    mockRedis.eval.mockImplementation(async (script: string, ...args: unknown[]) => {
      if (!isFlushScript(script)) return [1, 'ok', 0, 0]
      const { terminalStatus, zaddArgs } = parseFlushEvalArgs(args)
      // Reject any multi-entry batch so the terminal-alone retry path is taken.
      if (zaddArgs.length > 2) return [0, 'execution_redis_bytes', 64 * 1024 * 1024]
      // The backlog drain hits a transient outage rather than a budget rejection.
      if (failDrain) {
        failDrain = false
        throw new Error('redis unavailable')
      }
      for (let i = 0; i < zaddArgs.length; i += 2) {
        persistedEntries.push(JSON.parse(zaddArgs[i + 1] as string) as ExecutionEventEntry)
      }
      if (terminalStatus) stamped.push(terminalStatus)
      return [1, 1, 0]
    })

    const payload = 'x'.repeat(1_500_000)
    const writer = createExecutionEventWriter('exec-1', {
      workspaceId: 'ws-1',
      workflowId: 'wf-1',
    })
    for (let i = 0; i < 3; i++) {
      await writer.write(makeEvent(payload)).catch(() => {})
    }
    await expect(writer.writeTerminal(makeEvent('terminal'), 'complete')).rejects.toThrow()

    // The transiently-failed backlog is still queued, so it is not lost.
    expect(stamped).toEqual([])
    await writer.close().catch(() => {})
    expect(persistedEntries.length).toBeGreaterThan(0)
  })

  /**
   * Offloading under pressure is an optimization. If the value cannot be
   * persisted durably, the event must still reach the replay buffer inline —
   * dropping it would leave a reconnecting client permanently missing it.
   */
  it('buffers the event inline when a pressure offload cannot be persisted', async () => {
    mockRedis.incrby.mockResolvedValue(100000)
    const payload = 'x'.repeat(2 * 1024 * 1024)

    // No workspace/workflow ids, so durable persistence of an offloaded value
    // fails the way a storage outage would.
    const writer = createExecutionEventWriter('exec-1')
    for (let i = 0; i < 20; i++) {
      await writer.write(makeEvent(payload)).catch(() => {})
    }
    await writer.flush().catch(() => {})

    expect(persistedEntries).toHaveLength(20)
  })

  it('preserves requested UserFile base64 when buffering terminal events', async () => {
    mockRedis.incrby.mockResolvedValue(100)
    const base64 = Buffer.from('hello').toString('base64')
    const writer = createExecutionEventWriter('exec-1', { preserveUserFileBase64: true })

    await writer.writeTerminal(
      {
        type: 'execution:completed',
        timestamp: new Date().toISOString(),
        executionId: 'exec-1',
        workflowId: 'wf-1',
        data: {
          success: true,
          duration: 1,
          output: {
            file: {
              id: 'file-1',
              name: 'small.txt',
              size: 5,
              type: 'text/plain',
              context: 'execution',
              base64,
            },
          },
        },
      },
      'complete'
    )

    const eventData = persistedEntries[0].event.data as {
      output: { file: { base64?: string } }
    }
    expect(eventData.output.file.base64).toBe(base64)
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

  it('never extends an existing user budget window while flushing events', async () => {
    let flushScript = ''
    mockRedis.eval.mockImplementation(async (script: string) => {
      if (isFlushScript(script)) flushScript = script
      return [1, false, 0]
    })

    const writer = createExecutionEventWriter('exec-1', { userId: 'user-1' })
    await writer.writeTerminal(makeEvent('terminal'), 'complete')

    expect(flushScript).not.toBe('')
    const userKeyExpires = countOccurrences(flushScript, "redis.call('EXPIRE', KEYS[6]")
    const userKeyTtlGuards = countOccurrences(flushScript, "redis.call('TTL', KEYS[6]) < 0")
    expect(userKeyExpires).toBeGreaterThan(0)
    expect(userKeyTtlGuards).toBe(userKeyExpires)
  })

  it('keeps sliding the execution budget window, which expires with its own data', async () => {
    let flushScript = ''
    mockRedis.eval.mockImplementation(async (script: string) => {
      if (isFlushScript(script)) flushScript = script
      return [1, false, 0]
    })

    const writer = createExecutionEventWriter('exec-1', { userId: 'user-1' })
    await writer.writeTerminal(makeEvent('terminal'), 'complete')

    expect(countOccurrences(flushScript, "redis.call('TTL', KEYS[5]) < 0")).toBe(0)
    expect(countOccurrences(flushScript, "redis.call('EXPIRE', KEYS[5]")).toBeGreaterThan(0)
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
