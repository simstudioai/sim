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

import {
  continueOutboxHandler,
  deferOutboxHandler,
  enqueueOrReschedulePendingOutboxEvent,
  enqueueOutboxEvent,
  enqueueOutboxEvents,
  outboxEventHasSourceOperationId,
  outboxPayloadHasSourceOperationId,
  processOutboxEvents,
  withOutboxHandlerTimeout,
} from '@/lib/core/outbox/service'

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

  it('inserts a bounded event batch in one statement', async () => {
    const ids = await enqueueOutboxEvents(dbChainMock.db, 'test.event', [
      { sequence: 0 },
      { sequence: 1 },
    ])

    expect(ids).toHaveLength(2)
    expect(dbChainMockFns.values).toHaveBeenCalledTimes(1)
    expect(dbChainMockFns.values.mock.calls[0][0]).toEqual([
      expect.objectContaining({ eventType: 'test.event', payload: { sequence: 0 } }),
      expect.objectContaining({ eventType: 'test.event', payload: { sequence: 1 } }),
    ])
  })

  it('rejects an oversized event batch before inserting', async () => {
    await expect(
      enqueueOutboxEvents(
        dbChainMock.db,
        'test.event',
        Array.from({ length: 1_001 }, (_, sequence) => ({ sequence }))
      )
    ).rejects.toThrow('Cannot enqueue more than 1000')
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })
})

describe('outbox parent-operation correlation', () => {
  it('casts JSON payloads before applying JSONB containment operators', () => {
    const query = JSON.stringify(outboxEventHasSourceOperationId('operation-1'))

    expect(query).toContain("::jsonb -> 'sourceOperationIds'")
    expect(query).toContain('@> jsonb_build_array')
  })

  it('retains both scalar and coalesced parent operation identities', () => {
    expect(
      outboxPayloadHasSourceOperationId({ sourceOperationId: 'operation-1' }, 'operation-1')
    ).toBe(true)
    expect(
      outboxPayloadHasSourceOperationId(
        { sourceOperationIds: ['operation-1', 'operation-2'] },
        'operation-1'
      )
    ).toBe(true)
    expect(
      outboxPayloadHasSourceOperationId(
        { sourceOperationIds: ['operation-1', 'operation-2'] },
        'operation-2'
      )
    ).toBe(true)
    expect(
      outboxPayloadHasSourceOperationId({ sourceOperationIds: ['operation-2'] }, 'operation-1')
    ).toBe(false)
  })
})

describe('enqueueOrReschedulePendingOutboxEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('inserts normally when the subject has no pending event', async () => {
    const availableAt = new Date('2026-07-30T12:01:00.000Z')

    const id = await enqueueOrReschedulePendingOutboxEvent(
      dbChainMock.db,
      'invitation.send-migrated-link',
      { invitationId: 'invite-1' },
      {
        availableAt,
        coalesceOn: { payloadKey: 'invitationId', payloadValue: 'invite-1' },
      }
    )

    expect(id).toBe('test-event-id')
    expect(dbChainMockFns.values).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'test-event-id',
        eventType: 'invitation.send-migrated-link',
        payload: { invitationId: 'invite-1' },
        availableAt,
      })
    )
  })

  it('extends one pending event instead of inserting a duplicate for the same subject', async () => {
    const existingAvailableAt = new Date('2026-07-30T12:00:00.000Z')
    const nextAvailableAt = new Date('2026-07-30T12:01:00.000Z')
    queueTableRows(outboxEvent, [
      makePendingRow({
        id: 'evt-existing',
        payload: { invitationId: 'invite-1' },
        availableAt: existingAvailableAt,
      }),
    ])
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'evt-existing' }])

    const id = await enqueueOrReschedulePendingOutboxEvent(
      dbChainMock.db,
      'invitation.send-migrated-link',
      { invitationId: 'invite-1' },
      {
        availableAt: nextAvailableAt,
        coalesceOn: { payloadKey: 'invitationId', payloadValue: 'invite-1' },
      }
    )

    expect(id).toBe('evt-existing')
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    expect(dbChainMockFns.set).toHaveBeenCalledWith({ availableAt: nextAvailableAt })
    expect(dbChainMockFns.for).toHaveBeenCalledWith('update')
  })

  it('keeps a later existing delivery deadline when another mutation settles sooner', async () => {
    const existingAvailableAt = new Date('2026-07-30T12:02:00.000Z')
    const requestedAvailableAt = new Date('2026-07-30T12:01:00.000Z')
    queueTableRows(outboxEvent, [
      makePendingRow({
        id: 'evt-existing',
        payload: { invitationId: 'invite-1' },
        availableAt: existingAvailableAt,
      }),
    ])
    dbChainMockFns.returning.mockResolvedValueOnce([{ id: 'evt-existing' }])

    await enqueueOrReschedulePendingOutboxEvent(
      dbChainMock.db,
      'invitation.send-migrated-link',
      { invitationId: 'invite-1' },
      {
        availableAt: requestedAvailableAt,
        coalesceOn: { payloadKey: 'invitationId', payloadValue: 'invite-1' },
      }
    )

    expect(dbChainMockFns.set).toHaveBeenCalledWith({ availableAt: existingAvailableAt })
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

  it('retries events with no registered handler during rolling deployments', async () => {
    queueTableRows(outboxEvent, [makePendingRow({ eventType: 'unknown.event' })])
    holdLease()

    const result = await processOutboxEvents({})

    expect(result.retried).toBe(1)
    const retry = updateSets().find((set) => set.status === 'pending' && 'attempts' in set)
    expect(retry).toBeDefined()
    expect(retry?.attempts).toBe(1)
  })

  it('dead-letters a missing handler after the configured retry budget', async () => {
    queueTableRows(outboxEvent, [
      makePendingRow({ eventType: 'unknown.event', attempts: 2, maxAttempts: 3 }),
    ])
    holdLease()

    const result = await processOutboxEvents({})

    expect(result.deadLettered).toBe(1)
    const terminal = updateSets().find((set) => set.status === 'dead_letter')
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

  it('keeps an acknowledged external wait pending without recording a failure', async () => {
    const handler = vi.fn(async () => deferOutboxHandler('waiting for webhook'))
    queueTableRows(outboxEvent, [makePendingRow({ attempts: 2 })])
    holdLease()

    const result = await processOutboxEvents({ 'test.event': handler })

    expect(result.retried).toBe(1)
    const deferredUpdate = updateSets().find((set) => set.status === 'pending' && 'attempts' in set)
    expect(deferredUpdate).toMatchObject({ attempts: 3, lastError: null, lockedAt: null })
  })

  it('dead-letters a deferred wait only after its acknowledgement budget is exhausted', async () => {
    const handler = vi.fn(async () => deferOutboxHandler('webhook acknowledgement missing'))
    queueTableRows(outboxEvent, [makePendingRow({ attempts: 9, maxAttempts: 10 })])
    holdLease()

    const result = await processOutboxEvents({ 'test.event': handler })

    expect(result.deadLettered).toBe(1)
    const deadUpdate = updateSets().find((set) => set.status === 'dead_letter')
    expect(deadUpdate).toMatchObject({
      attempts: 10,
      lastError: 'webhook acknowledgement missing',
    })
  })

  it('reschedules an internal dependency wait without consuming its attempt budget', async () => {
    const handler = vi.fn(async () => deferOutboxHandler('waiting for dependency', 5_000, false))
    queueTableRows(outboxEvent, [makePendingRow({ attempts: 4, maxAttempts: 5 })])
    holdLease()

    const result = await processOutboxEvents({ 'test.event': handler })

    expect(result.retried).toBe(1)
    const deferredUpdate = updateSets().find((set) => set.status === 'pending' && 'attempts' in set)
    expect(deferredUpdate).toMatchObject({ attempts: 4, lastError: null, lockedAt: null })
  })

  it('re-runs a continued handler without consuming its attempt budget', async () => {
    const handler = vi.fn(async () => continueOutboxHandler('continuing bounded cleanup'))
    queueTableRows(outboxEvent, [makePendingRow({ attempts: 4, maxAttempts: 5 })])
    holdLease()

    const result = await processOutboxEvents({ 'test.event': handler })

    expect(result.retried).toBe(1)
    const continuedUpdate = updateSets().find(
      (set) => set.status === 'pending' && 'attempts' in set
    )
    expect(continuedUpdate).toMatchObject({ attempts: 4, lastError: null, lockedAt: null })
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

  it('allows an opted-in handler to finish after the default 90-second window', async () => {
    let observedDeadline = 0
    const startedAt = Date.now()
    const handler = withOutboxHandlerTimeout(async (_payload, context) => {
      observedDeadline = context.deadlineAt ?? 0
      await new Promise<void>((resolve) => setTimeout(resolve, 120_000))
    }, 550_000)
    queueTableRows(outboxEvent, [makePendingRow()])
    holdLease()
    const promise = processOutboxEvents({ 'test.event': handler }, { maxRuntimeMs: 790_000 })
    await vi.advanceTimersByTimeAsync(120_001)
    expect(await promise).toMatchObject({ processed: 1, leaseLost: 0 })
    expect(observedDeadline).toBe(startedAt + 550_000)
  })

  it('leaves a long handler pending when the remaining invocation cannot fit its complete window', async () => {
    const handler = withOutboxHandlerTimeout(
      vi.fn(async () => {}),
      550_000
    )
    queueTableRows(outboxEvent, [makePendingRow()])
    holdLease()
    expect(
      await processOutboxEvents({ 'test.event': handler }, { maxRuntimeMs: 110_000 })
    ).toMatchObject({ processed: 0, retried: 0 })
    expect(handler).not.toHaveBeenCalled()
    expect(updateSets()).toContainEqual({ status: 'pending', lockedAt: null })
    expect(updateSets().some((set) => 'attempts' in set)).toBe(false)
  })

  it('refuses a handler window that can overlap the ten-minute stale-lease reaper', () => {
    expect(() => withOutboxHandlerTimeout(async () => {}, 600_000)).toThrow(/550000/)
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
