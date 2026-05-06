/**
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

// Hoisted mock state — all tests manipulate these directly.
const { state, mockDb } = vi.hoisted(() => {
  const state = {
    // Rows returned from the FOR UPDATE SKIP LOCKED select in claimBatch.
    claimedRows: [] as OutboxRow[],
    // Whether the terminal update (lease CAS) should report a match.
    leaseHeld: true,
    // IDs the reaper's UPDATE should return (simulates stuck `processing` rows).
    reapedRowIds: [] as string[],
    // Everything written (for assertions).
    inserts: [] as Array<{ values: unknown }>,
    updates: [] as Array<{ set: Record<string, unknown>; where?: unknown }>,
  }

  const makeUpdateChain = () => {
    const row: { set: Record<string, unknown>; where?: unknown } = { set: {} }
    const chain: Record<string, unknown> = {}
    chain.set = vi.fn((s: Record<string, unknown>) => {
      row.set = s
      return chain
    })
    chain.where = vi.fn((w: unknown) => {
      row.where = w
      state.updates.push(row)
      return chain
    })
    chain.returning = vi.fn(async () => {
      // Terminal UPDATE (lease CAS): has `attempts` + `availableAt`
      // on retry, or explicit completed/dead_letter. Reaper path sets
      // status='pending' without attempts/availableAt.
      const isReaperUpdate =
        row.set.status === 'pending' && !('attempts' in row.set) && !('availableAt' in row.set)

      if (isReaperUpdate) {
        return state.reapedRowIds.map((id) => ({ id }))
      }

      if (
        row.set.status === 'completed' ||
        row.set.status === 'dead_letter' ||
        (row.set.status === 'pending' && 'attempts' in row.set && 'availableAt' in row.set)
      ) {
        return state.leaseHeld ? [{ id: 'evt-1' }] : []
      }

      return []
    })
    return chain
  }

  const makeSelectChain = () => {
    const chain: Record<string, unknown> = {}
    const self = () => chain
    chain.from = vi.fn(self)
    chain.where = vi.fn(self)
    chain.orderBy = vi.fn(self)
    chain.limit = vi.fn(self)
    chain.for = vi.fn(async () => state.claimedRows)
    return chain
  }

  const mockDb = {
    insert: vi.fn(() => {
      const chain: Record<string, unknown> = {}
      chain.values = vi.fn(async (v: unknown) => {
        state.inserts.push({ values: v })
      })
      return chain
    }),
    update: vi.fn(() => makeUpdateChain()),
    select: vi.fn(() => makeSelectChain()),
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(mockDb)),
  }

  return { state, mockDb }
})

vi.mock('@sim/db', () => ({ db: mockDb }))

vi.mock('@sim/db/schema', () => ({
  outboxEvent: {
    id: 'outbox_event.id',
    eventType: 'outbox_event.event_type',
    payload: 'outbox_event.payload',
    status: 'outbox_event.status',
    attempts: 'outbox_event.attempts',
    maxAttempts: 'outbox_event.max_attempts',
    availableAt: 'outbox_event.available_at',
    lockedAt: 'outbox_event.locked_at',
    lastError: 'outbox_event.last_error',
    createdAt: 'outbox_event.created_at',
    processedAt: 'outbox_event.processed_at',
    $inferSelect: {} as OutboxRow,
  },
}))

vi.mock('@sim/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args) => ({ _op: 'and', args })),
  asc: vi.fn((col) => ({ _op: 'asc', col })),
  eq: vi.fn((col, val) => ({ _op: 'eq', col, val })),
  inArray: vi.fn((col, vals) => ({ _op: 'inArray', col, vals })),
  lte: vi.fn((col, val) => ({ _op: 'lte', col, val })),
}))

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

function resetState() {
  state.claimedRows = []
  state.leaseHeld = true
  state.reapedRowIds = []
  state.inserts.length = 0
  state.updates.length = 0
}

describe('enqueueOutboxEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetState()
  })

  it('inserts a row with the given event type and payload', async () => {
    const id = await enqueueOutboxEvent(mockDb, 'test.event', { foo: 'bar' })
    expect(id).toBe('test-event-id')
    expect(state.inserts[0].values).toMatchObject({
      id: 'test-event-id',
      eventType: 'test.event',
      payload: { foo: 'bar' },
      maxAttempts: 10,
    })
  })

  it('respects maxAttempts override', async () => {
    await enqueueOutboxEvent(mockDb, 'test.event', {}, { maxAttempts: 3 })
    expect(state.inserts[0].values).toMatchObject({ maxAttempts: 3 })
  })

  it('respects availableAt override for delayed processing', async () => {
    const future = new Date(Date.now() + 60_000)
    await enqueueOutboxEvent(mockDb, 'test.event', {}, { availableAt: future })
    expect((state.inserts[0].values as { availableAt: Date }).availableAt).toBe(future)
  })
})

describe('processOutboxEvents — empty / no handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetState()
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
    state.claimedRows = [makePendingRow({ eventType: 'unknown.event' })]

    const result = await processOutboxEvents({})

    expect(result.deadLettered).toBe(1)
    const terminal = state.updates.find((u) => u.set.status === 'dead_letter')
    expect(terminal).toBeDefined()
    expect(terminal?.set.lastError).toMatch(/No handler registered/)
  })
})

describe('processOutboxEvents — handler success and retry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetState()
  })

  it('transitions to completed on handler success and passes context to handler', async () => {
    const handlerCalls: Array<{ payload: unknown; eventId: string; attempts: number }> = []
    const handler = vi.fn(async (payload: unknown, ctx: { eventId: string; attempts: number }) => {
      handlerCalls.push({ payload, eventId: ctx.eventId, attempts: ctx.attempts })
    })

    state.claimedRows = [makePendingRow()]

    const result = await processOutboxEvents({ 'test.event': handler })

    expect(result.processed).toBe(1)
    expect(handlerCalls).toEqual([{ payload: { foo: 'bar' }, eventId: 'evt-1', attempts: 0 }])
    const completeUpdate = state.updates.find((u) => u.set.status === 'completed')
    expect(completeUpdate).toBeDefined()
  })

  it('schedules retry with exponential backoff on handler failure below maxAttempts', async () => {
    const handler = vi.fn(async () => {
      throw new Error('transient failure')
    })

    state.claimedRows = [makePendingRow({ attempts: 2 })]

    const before = Date.now()
    const result = await processOutboxEvents({ 'test.event': handler })

    expect(result.retried).toBe(1)
    const retryUpdate = state.updates.find((u) => u.set.status === 'pending' && 'attempts' in u.set)
    expect(retryUpdate).toBeDefined()
    expect(retryUpdate?.set.attempts).toBe(3)
    expect(retryUpdate?.set.lastError).toBe('transient failure')
    // Backoff after nextAttempts=3: 1000 * 2^3 = 8000ms
    const scheduledAt = retryUpdate?.set.availableAt as Date
    expect(scheduledAt.getTime()).toBeGreaterThan(before + 7500)
    expect(scheduledAt.getTime()).toBeLessThan(before + 10_000)
  })

  it('dead-letters on failure when attempts reaches maxAttempts', async () => {
    const handler = vi.fn(async () => {
      throw new Error('permanent failure')
    })

    state.claimedRows = [makePendingRow({ attempts: 9, maxAttempts: 10 })]

    const result = await processOutboxEvents({ 'test.event': handler })

    expect(result.deadLettered).toBe(1)
    const deadUpdate = state.updates.find((u) => u.set.status === 'dead_letter')
    expect(deadUpdate).toBeDefined()
    expect(deadUpdate?.set.attempts).toBe(10)
    expect(deadUpdate?.set.lastError).toBe('permanent failure')
  })

  it('caps exponential backoff at 1 hour', async () => {
    const handler = vi.fn(async () => {
      throw new Error('transient')
    })

    state.claimedRows = [makePendingRow({ attempts: 20, maxAttempts: 100 })]

    const before = Date.now()
    await processOutboxEvents({ 'test.event': handler })

    const retryUpdate = state.updates.find((u) => u.set.status === 'pending' && 'attempts' in u.set)
    expect(retryUpdate).toBeDefined()
    const scheduledAt = retryUpdate?.set.availableAt as Date
    // 1hr = 3,600,000ms
    expect(scheduledAt.getTime()).toBeLessThan(before + 3_600_000 + 1000)
    expect(scheduledAt.getTime()).toBeGreaterThan(before + 3_599_000)
  })
})

describe('processOutboxEvents — lease CAS / reaper race', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetState()
  })

  it('reports leaseLost when completion UPDATE affects zero rows', async () => {
    const handler = vi.fn(async () => {
      // "succeeds" but terminal write will fail the lease CAS
    })

    state.claimedRows = [makePendingRow()]
    state.leaseHeld = false

    const result = await processOutboxEvents({ 'test.event': handler })

    expect(result.leaseLost).toBe(1)
    expect(result.processed).toBe(0)
  })

  it('reports leaseLost on retry-schedule UPDATE when row was reclaimed', async () => {
    const handler = vi.fn(async () => {
      throw new Error('transient')
    })

    state.claimedRows = [makePendingRow({ attempts: 2 })]
    state.leaseHeld = false

    const result = await processOutboxEvents({ 'test.event': handler })

    expect(result.leaseLost).toBe(1)
    expect(result.retried).toBe(0)
  })
})

describe('processOutboxEvents — handler timeout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetState()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('times out a stuck handler and schedules retry', async () => {
    const neverResolves = vi.fn(() => new Promise<void>(() => {}))

    state.claimedRows = [makePendingRow({ attempts: 0 })]

    const promise = processOutboxEvents({ 'test.event': neverResolves })
    // Must exceed DEFAULT_HANDLER_TIMEOUT_MS (90s).
    await vi.advanceTimersByTimeAsync(90 * 1000 + 1)
    const result = await promise

    expect(result.retried).toBe(1)
    const retryUpdate = state.updates.find((u) => u.set.status === 'pending' && 'attempts' in u.set)
    expect(retryUpdate?.set.lastError).toMatch(/timed out/)
  })
})

describe('processOutboxEvents — reaper recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetState()
  })

  it('reaps stuck processing rows back to pending and reports count', async () => {
    state.reapedRowIds = ['stuck-1', 'stuck-2', 'stuck-3']

    const result = await processOutboxEvents({})

    expect(result.reaped).toBe(3)
    expect(result.processed).toBe(0)

    // The reaper's UPDATE sets status='pending' with NO attempts / availableAt
    // fields — that's how runHandler's retry update is distinguished from it.
    const reaperUpdate = state.updates.find(
      (u) => u.set.status === 'pending' && !('attempts' in u.set) && !('availableAt' in u.set)
    )
    expect(reaperUpdate).toBeDefined()
    expect(reaperUpdate?.set.lockedAt).toBeNull()
  })

  it('returns zero reaped when no rows are stuck', async () => {
    const result = await processOutboxEvents({})
    expect(result.reaped).toBe(0)
  })
})
