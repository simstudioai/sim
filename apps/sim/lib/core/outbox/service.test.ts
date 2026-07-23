/**
 * @vitest-environment node
 */

import { outboxEvent } from '@sim/db/schema'
import { dbChainMock, dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type OutboxRow = {
  id: string
  eventType: string
  payload: unknown
  status: 'pending' | 'processing' | 'completed' | 'dead_letter'
  attempts: number
  maxAttempts: number
  availableAt: Date
  lockedAt: Date | null
  lastError: string | null
  createdAt: Date
  processedAt: Date | null
}

vi.mock('@sim/utils/id', () => ({
  generateId: vi.fn(() => 'test-event-id'),
}))

import { enqueueOutboxEvent, processOutboxEvents } from './service'

function makePendingRow(overrides: Partial<OutboxRow> = {}): OutboxRow {
  return {
    id: 'evt-1',
    eventType: 'test.event',
    payload: { foo: 'bar' },
    status: 'pending',
    attempts: 0,
    maxAttempts: 10,
    availableAt: new Date(Date.now() - 1000),
    lockedAt: null,
    lastError: null,
    createdAt: new Date(Date.now() - 5000),
    processedAt: null,
    ...overrides,
  }
}

/** The values object of every `set(...)` call, in call order. */
const updateSets = (): Record<string, unknown>[] =>
  dbChainMockFns.set.mock.calls.map((call) => call[0] as Record<string, unknown>)

/**
 * Simulate a held processing lease: the reaper's `returning` (always the first
 * `.returning()` of a run) reaps nothing, and every later terminal /
 * checkpoint UPDATE's lease CAS reports a matched row. Without this priming,
 * `returning` defaults to `[]` everywhere, which models a lost lease.
 */
function holdLease() {
  dbChainMockFns.returning.mockResolvedValueOnce([]).mockResolvedValue([{ id: 'evt-1' }])
}

afterAll(resetDbChainMock)

describe('enqueueOutboxEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('inserts a row with the given event type and payload', async () => {
    const id = await enqueueOutboxEvent(dbChainMock.db, 'test.event', { foo: 'bar' })
    expect(id).toBe('test-event-id')
    expect(dbChainMockFns.values.mock.calls[0][0]).toMatchObject({
      id: 'test-event-id',
      eventType: 'test.event',
      payload: { foo: 'bar' },
      maxAttempts: 10,
    })
  })

  it('respects maxAttempts override', async () => {
    await enqueueOutboxEvent(dbChainMock.db, 'test.event', {}, { maxAttempts: 3 })
    expect(dbChainMockFns.values.mock.calls[0][0]).toMatchObject({ maxAttempts: 3 })
  })

  it('respects availableAt override for delayed processing', async () => {
    const future = new Date(Date.now() + 60_000)
    await enqueueOutboxEvent(dbChainMock.db, 'test.event', {}, { availableAt: future })
    expect((dbChainMockFns.values.mock.calls[0][0] as { availableAt: Date }).availableAt).toBe(
      future
    )
  })
})

describe('processOutboxEvents — empty / no handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('returns zero counts when no events are due', async () => {
    const result = await processOutboxEvents({})
    expect(result).toEqual({
      processed: 0,
      retried: 0,
      deadLettered: 0,
      leaseLost: 0,
      reaped: 0,
    })
  })

  it('dead-letters events with no registered handler', async () => {
    queueTableRows(outboxEvent, [makePendingRow({ eventType: 'unknown.event' })])
    holdLease()

    const result = await processOutboxEvents({})

    expect(result.deadLettered).toBe(1)
    const terminal = updateSets().find((set) => set.status === 'dead_letter')
    expect(terminal).toBeDefined()
    expect(terminal?.lastError).toMatch(/No handler registered/)
  })
})

describe('processOutboxEvents — handler success and retry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('transitions to completed on handler success and passes context to handler', async () => {
    const handlerCalls: Array<{ payload: unknown; eventId: string; attempts: number }> = []
    const handler = vi.fn(async (payload: unknown, ctx: { eventId: string; attempts: number }) => {
      handlerCalls.push({ payload, eventId: ctx.eventId, attempts: ctx.attempts })
    })

    queueTableRows(outboxEvent, [makePendingRow()])
    holdLease()

    const result = await processOutboxEvents({ 'test.event': handler })

    expect(result.processed).toBe(1)
    expect(handlerCalls).toEqual([{ payload: { foo: 'bar' }, eventId: 'evt-1', attempts: 0 }])
    const completeUpdate = updateSets().find((set) => set.status === 'completed')
    expect(completeUpdate).toBeDefined()
    expect(completeUpdate?.lastError).toBeNull()
  })

  it('checkpoints payload fields only while the processing lease is held', async () => {
    const handler = vi.fn(
      async (
        _payload: unknown,
        ctx: { checkpointPayload: (patch: Record<string, unknown>) => Promise<void> }
      ) => {
        await ctx.checkpointPayload({ stripeProgress: { customerId: 'cus_1' } })
      }
    )
    queueTableRows(outboxEvent, [makePendingRow()])
    holdLease()

    const result = await processOutboxEvents({ 'test.event': handler })

    expect(result.processed).toBe(1)
    expect(updateSets().some((set) => 'payload' in set)).toBe(true)
  })

  it('stops a handler whose payload checkpoint loses the processing lease', async () => {
    const handler = vi.fn(
      async (
        _payload: unknown,
        ctx: { checkpointPayload: (patch: Record<string, unknown>) => Promise<void> }
      ) => {
        await ctx.checkpointPayload({ stripeProgress: { customerId: 'cus_1' } })
      }
    )
    queueTableRows(outboxEvent, [makePendingRow()])

    const result = await processOutboxEvents({ 'test.event': handler })

    expect(result.leaseLost).toBe(1)
    expect(result.processed).toBe(0)
  })

  it('schedules retry with exponential backoff on handler failure below maxAttempts', async () => {
    const handler = vi.fn(async () => {
      throw new Error('transient failure')
    })

    queueTableRows(outboxEvent, [makePendingRow({ attempts: 2 })])
    holdLease()

    const before = Date.now()
    const result = await processOutboxEvents({ 'test.event': handler })

    expect(result.retried).toBe(1)
    const retryUpdate = updateSets().find((set) => set.status === 'pending' && 'attempts' in set)
    expect(retryUpdate).toBeDefined()
    expect(retryUpdate?.attempts).toBe(3)
    expect(retryUpdate?.lastError).toBe('transient failure')
    // Backoff after nextAttempts=3: 1000 * 2^3 = 8000ms
    const scheduledAt = retryUpdate?.availableAt as Date
    expect(scheduledAt.getTime()).toBeGreaterThan(before + 7500)
    expect(scheduledAt.getTime()).toBeLessThan(before + 10_000)
  })

  it('dead-letters on failure when attempts reaches maxAttempts', async () => {
    const handler = vi.fn(async () => {
      throw new Error('permanent failure')
    })

    queueTableRows(outboxEvent, [makePendingRow({ attempts: 9, maxAttempts: 10 })])
    holdLease()

    const result = await processOutboxEvents({ 'test.event': handler })

    expect(result.deadLettered).toBe(1)
    const deadUpdate = updateSets().find((set) => set.status === 'dead_letter')
    expect(deadUpdate).toBeDefined()
    expect(deadUpdate?.attempts).toBe(10)
    expect(deadUpdate?.lastError).toBe('permanent failure')
  })

  it('caps exponential backoff at 1 hour', async () => {
    const handler = vi.fn(async () => {
      throw new Error('transient')
    })

    queueTableRows(outboxEvent, [makePendingRow({ attempts: 20, maxAttempts: 100 })])
    holdLease()

    const before = Date.now()
    await processOutboxEvents({ 'test.event': handler })

    const retryUpdate = updateSets().find((set) => set.status === 'pending' && 'attempts' in set)
    expect(retryUpdate).toBeDefined()
    const scheduledAt = retryUpdate?.availableAt as Date
    // 1hr = 3,600,000ms
    expect(scheduledAt.getTime()).toBeLessThan(before + 3_600_000 + 1000)
    expect(scheduledAt.getTime()).toBeGreaterThan(before + 3_599_000)
  })
})

describe('processOutboxEvents — lease CAS / reaper race', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('reports leaseLost when completion UPDATE affects zero rows', async () => {
    const handler = vi.fn(async () => {
      // "succeeds" but terminal write will fail the lease CAS
    })

    queueTableRows(outboxEvent, [makePendingRow()])

    const result = await processOutboxEvents({ 'test.event': handler })

    expect(result.leaseLost).toBe(1)
    expect(result.processed).toBe(0)
  })

  it('reports leaseLost on retry-schedule UPDATE when row was reclaimed', async () => {
    const handler = vi.fn(async () => {
      throw new Error('transient')
    })

    queueTableRows(outboxEvent, [makePendingRow({ attempts: 2 })])

    const result = await processOutboxEvents({ 'test.event': handler })

    expect(result.leaseLost).toBe(1)
    expect(result.retried).toBe(0)
  })
})

describe('processOutboxEvents — handler timeout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('times out a stuck handler without releasing it for overlapping retry', async () => {
    const neverResolves = vi.fn(() => new Promise<void>(() => {}))

    queueTableRows(outboxEvent, [makePendingRow({ attempts: 0 })])
    holdLease()

    const promise = processOutboxEvents({ 'test.event': neverResolves })
    // Must exceed DEFAULT_HANDLER_TIMEOUT_MS (90s).
    await vi.advanceTimersByTimeAsync(90 * 1000 + 1)
    const result = await promise

    expect(result.leaseLost).toBe(1)
    const timeoutUpdate = updateSets().find(
      (set) => !('status' in set) && 'attempts' in set && 'lockedAt' in set
    )
    expect(timeoutUpdate?.attempts).toBe(1)
    expect(timeoutUpdate?.lastError).toMatch(/timed out/)
  })

  it('aborts the handler signal when its execution window expires', async () => {
    let handlerSignal: AbortSignal | undefined
    const handler = vi.fn(
      async (
        _payload: unknown,
        context: { maxAttempts: number; signal: AbortSignal }
      ): Promise<void> => {
        handlerSignal = context.signal
        expect(context.maxAttempts).toBe(10)
        await new Promise<void>((resolve) => {
          context.signal.addEventListener('abort', () => resolve(), { once: true })
        })
      }
    )
    queueTableRows(outboxEvent, [makePendingRow({ attempts: 0 })])
    holdLease()

    const promise = processOutboxEvents({ 'test.event': handler })
    await vi.advanceTimersByTimeAsync(90 * 1000 + 1)
    const result = await promise

    expect(handlerSignal?.aborted).toBe(true)
    expect(result.leaseLost).toBe(1)
  })
})

describe('processOutboxEvents — reaper recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('reaps stuck processing rows back to pending and reports count', async () => {
    dbChainMockFns.returning.mockResolvedValueOnce([
      { id: 'stuck-1' },
      { id: 'stuck-2' },
      { id: 'stuck-3' },
    ])

    const result = await processOutboxEvents({})

    expect(result.reaped).toBe(3)
    expect(result.processed).toBe(0)

    // The reaper's UPDATE sets status='pending' with NO attempts / availableAt
    // fields — that's how runHandler's retry update is distinguished from it.
    const reaperUpdate = updateSets().find(
      (set) => set.status === 'pending' && !('attempts' in set) && !('availableAt' in set)
    )
    expect(reaperUpdate).toBeDefined()
    expect(reaperUpdate?.lockedAt).toBeNull()
  })

  it('returns zero reaped when no rows are stuck', async () => {
    const result = await processOutboxEvents({})
    expect(result.reaped).toBe(0)
  })
})
