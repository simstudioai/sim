/** Real PostgreSQL claims verify scheduling fairness and concurrent delivery. */
import { db } from '@sim/db'
import { outboxEvent } from '@sim/db/schema'
import { withUtcTimestamps } from '@sim/db/timestamps'
import { generateId } from '@sim/utils/id'
import { eq, inArray, sql } from 'drizzle-orm'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const database = vi.hoisted(() => ({ current: undefined as PostgresJsDatabase | undefined }))

vi.mock('@sim/db', () => ({
  get db() {
    if (!database.current) throw new Error('Outbox PostgreSQL test database is not initialized')
    return database.current
  },
}))

import { readyEventTypesQuery } from '@/lib/core/outbox/queries'
import {
  type OutboxHandler,
  processOutboxEvents,
  withOutboxHandlerTimeout,
} from '@/lib/core/outbox/service'

interface QueryPlan {
  'Node Type': string
  'Index Name'?: string
  'Shared Hit Blocks': number
  'Shared Read Blocks': number
  Plans?: QueryPlan[]
}

function planNodes(plan: QueryPlan): QueryPlan[] {
  return [plan, ...(plan.Plans ?? []).flatMap(planNodes)]
}

describe('outbox scheduling in PostgreSQL', () => {
  const eventTypes = new Set<string>()
  const schemaName = `outbox_test_${generateId().replaceAll('-', '')}`
  const databaseUrl = process.env.TEST_DATABASE_URL
  if (!databaseUrl) throw new Error('Outbox tests require a disposable local database')
  const connection = postgres(
    databaseUrl,
    withUtcTimestamps({
      max: 4,
      prepare: false,
      fetch_types: false,
      connection: { search_path: schemaName },
      onnotice: () => {},
    })
  )

  beforeAll(async () => {
    await connection`CREATE SCHEMA ${connection(schemaName)}`
    /** Copy the provisioned table and indexes without consuming another suite's pending events. */
    await connection`CREATE TABLE outbox_event (LIKE public.outbox_event INCLUDING ALL)`
    database.current = drizzle(connection)
  })

  afterEach(async () => {
    if (eventTypes.size) {
      await db.delete(outboxEvent).where(inArray(outboxEvent.eventType, [...eventTypes]))
    }
    eventTypes.clear()
  })

  afterAll(async () => {
    try {
      await connection`DROP SCHEMA ${connection(schemaName)} CASCADE`
    } finally {
      await connection.end()
      database.current = undefined
    }
  })

  async function enqueue(eventType: string, count: number, ageMs = 10_000) {
    if (count > 1_000) throw new Error('Use bounded SQL batches for large fixtures')
    const now = Date.now()
    const rows = Array.from({ length: count }, (_, index) => ({
      id: generateId(),
      eventType,
      payload: {},
      createdAt: new Date(now - ageMs + index),
      availableAt: new Date(now - 1),
    }))
    eventTypes.add(eventType)
    await db.insert(outboxEvent).values(rows)
    return rows
  }

  async function seedBacklog(
    eventType: string,
    count: number,
    status: 'pending' | 'completed' | 'processing',
    availableAt = new Date(Date.now() - 60_000)
  ) {
    const prefix = generateId()
    const createdAt = new Date(Date.now() - 24 * 60 * 60_000)
    const lockedAt = status === 'processing' ? new Date(Date.now() - 11 * 60_000) : null
    eventTypes.add(eventType)
    for (let offset = 0; offset < count; offset += 1_000) {
      await db.execute(sql`
        INSERT INTO outbox_event
          (id, event_type, payload, status, available_at, created_at, locked_at)
        SELECT ${prefix} || ':' || n, ${eventType}, '{}'::json, ${status},
          ${availableAt.toISOString()}::timestamp,
          ${createdAt.toISOString()}::timestamp + n * interval '1 millisecond',
          ${lockedAt?.toISOString() ?? null}::timestamp
        FROM generate_series(${offset}::integer, ${Math.min(offset + 999, count - 1)}::integer) AS n
      `)
    }
  }

  async function expectBoundedDiscovery(now: Date) {
    const plans = await db.execute<{ 'QUERY PLAN': { Plan: QueryPlan }[] }>(sql`
      EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${readyEventTypesQuery(now)}
    `)
    const plan = plans[0]['QUERY PLAN'][0].Plan
    const nodes = planNodes(plan)
    expect(nodes.some((node) => node['Node Type'] === 'Recursive Union')).toBe(true)
    expect(nodes.some((node) => node['Node Type'] === 'Seq Scan')).toBe(false)
    /** Buffer work, unlike wall-clock time, catches a backlog scan even on a warm local database. */
    expect(plan['Shared Hit Blocks'] + plan['Shared Read Blocks']).toBeLessThan(1_000)
  }

  it('discovers an empty queue without returning a null type', async () => {
    expect(await db.execute(readyEventTypesQuery(new Date()))).toEqual([])
  })

  it('uses earliest availability, inclusive deadlines, and deterministic type ties', async () => {
    const now = new Date('2026-01-01T12:00:00.000Z')
    const fixtures = [
      { eventType: 'test.outbox.z-first', availableAt: new Date(now.getTime() - 1) },
      { eventType: 'test.outbox.z-first', availableAt: new Date(now.getTime() + 60_000) },
      { eventType: 'test.outbox.b-tie', availableAt: now },
      { eventType: 'test.outbox.a-tie', availableAt: now },
      { eventType: 'test.outbox.future', availableAt: new Date(now.getTime() + 1) },
      { eventType: 'test.outbox.completed', availableAt: now, status: 'completed' },
      { eventType: 'test.outbox.processing', availableAt: now, status: 'processing' },
      { eventType: 'test.outbox.dead', availableAt: now, status: 'dead_letter' },
    ]
    for (const fixture of fixtures) eventTypes.add(fixture.eventType)
    await db
      .insert(outboxEvent)
      .values(fixtures.map((row) => ({ id: generateId(), payload: {}, ...row })))

    expect(await db.execute(readyEventTypesQuery(now))).toEqual([
      { eventType: 'test.outbox.z-first' },
      { eventType: 'test.outbox.a-tie' },
      { eventType: 'test.outbox.b-tie' },
    ])
  })

  it('caps ready types after ordering all heads, including types unknown to this worker', async () => {
    const now = new Date()
    const rows = Array.from({ length: 140 }, (_, index) => ({
      id: generateId(),
      eventType: `test.outbox.type-${String(index).padStart(3, '0')}`,
      payload: {},
      availableAt: new Date(now.getTime() - index - 1),
    }))
    for (const row of rows) eventTypes.add(row.eventType)
    await db.insert(outboxEvent).values(rows)

    expect(await db.execute(readyEventTypesQuery(now))).toEqual(
      [...rows]
        .reverse()
        .slice(0, 128)
        .map(({ eventType }) => ({ eventType }))
    )
  })

  it('skips large future backlogs and more than 128 future types without hiding ready work', async () => {
    const future = new Date(Date.now() + 48 * 60 * 60_000)
    await seedBacklog('test.outbox.a-expiry', 100_000, 'pending', future)
    const futureTypes = Array.from({ length: 130 }, (_, index) => ({
      id: generateId(),
      eventType: `test.outbox.future-${index}`,
      payload: {},
      availableAt: future,
    }))
    for (const row of futureTypes) eventTypes.add(row.eventType)
    await db.insert(outboxEvent).values(futureTypes)
    await enqueue('test.outbox.z-ready', 1)
    await connection`VACUUM (ANALYZE) outbox_event`

    const now = new Date()
    expect(await db.execute(readyEventTypesQuery(now))).toEqual([
      { eventType: 'test.outbox.z-ready' },
    ])
    await expectBoundedDiscovery(now)
    expect(await processOutboxEvents({ 'test.outbox.z-ready': async () => {} })).toMatchObject({
      processed: 1,
    })
    expect(await db.execute(readyEventTypesQuery(new Date()))).toEqual([])
  }, 60_000)

  it('retains bounded retries for a type missing during a rolling deployment', async () => {
    const [event] = await enqueue('test.outbox.unknown', 1)

    expect(await processOutboxEvents({})).toMatchObject({ retried: 1 })
    const [pending] = await db.select().from(outboxEvent).where(eq(outboxEvent.id, event.id))
    expect(pending).toMatchObject({ status: 'pending', attempts: 1 })
    expect(pending.availableAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('lets claims skip a locked head without hiding other rows of that type', async () => {
    const [locked, available] = await enqueue('test.outbox.locked', 2)
    const delivered: string[] = []
    await connection.begin(async (transaction) => {
      await transaction`SELECT id FROM outbox_event WHERE id = ${locked.id} FOR UPDATE`
      const result = await processOutboxEvents({
        'test.outbox.locked': async (_payload, context) => {
          delivered.push(context.eventId)
        },
      })
      expect(result.processed).toBe(1)
    })
    expect(delivered).toEqual([available.id])
  })

  it('serves newer event types before exhausting an older cleanup backlog', async () => {
    await enqueue('test.outbox.cleanup', 1_000)
    const [dispatch] = await enqueue('test.outbox.dispatch', 1, 2_000)
    const [billing] = await enqueue('test.outbox.billing', 1, 1_000)
    const delivered: string[] = []
    const handler: OutboxHandler = async (_payload, context) => {
      delivered.push(context.eventId)
    }

    const result = await processOutboxEvents(
      {
        'test.outbox.cleanup': handler,
        'test.outbox.dispatch': handler,
        'test.outbox.billing': handler,
      },
      { batchSize: 20 }
    )

    expect(result.processed).toBe(20)
    expect(delivered.slice(0, 3)).toContain(dispatch.id)
    expect(delivered.slice(0, 3)).toContain(billing.id)
  })

  it('keeps draining a single event type up to the batch limit in creation order', async () => {
    const rows = await enqueue('test.outbox.cleanup', 30)
    const delivered: string[] = []
    const handler: OutboxHandler = async (_payload, context) => {
      delivered.push(context.eventId)
    }

    const result = await processOutboxEvents({ 'test.outbox.cleanup': handler }, { batchSize: 25 })

    expect(result.processed).toBe(25)
    expect(delivered).toEqual(rows.slice(0, 25).map((row) => row.id))
  })

  it('keeps future events pending while serving other ready event types', async () => {
    const [future] = await enqueue('test.outbox.future', 1)
    await db
      .update(outboxEvent)
      .set({ availableAt: new Date(Date.now() + 60_000) })
      .where(eq(outboxEvent.id, future.id))
    await enqueue('test.outbox.cleanup', 5)
    const delivered: string[] = []
    const handler: OutboxHandler = async (_payload, context) => {
      delivered.push(context.eventId)
    }

    const result = await processOutboxEvents({
      'test.outbox.future': handler,
      'test.outbox.cleanup': handler,
    })

    expect(result.processed).toBe(5)
    expect(delivered).not.toContain(future.id)
  })

  it('does not deliver the same event twice when cron invocations overlap', async () => {
    await enqueue('test.outbox.cleanup', 50)
    await enqueue('test.outbox.dispatch', 2, 1_000)
    const delivered: string[] = []
    const handler: OutboxHandler = async (_payload, context) => {
      delivered.push(context.eventId)
    }
    const handlers = { 'test.outbox.cleanup': handler, 'test.outbox.dispatch': handler }

    const results = await Promise.all([
      processOutboxEvents(handlers, { batchSize: 40 }),
      processOutboxEvents(handlers, { batchSize: 40 }),
    ])

    expect(results.reduce((sum, result) => sum + result.processed, 0)).toBe(52)
    expect(delivered).toHaveLength(52)
    expect(new Set(delivered).size).toBe(52)
  })

  it('serves rare types using indexed heads beside 100,000 pending and 100,000 completed events', async () => {
    await seedBacklog('test.outbox.cleanup', 100_000, 'completed')
    await seedBacklog('test.outbox.cleanup', 100_000, 'pending')
    const [dispatch] = await enqueue('test.outbox.dispatch', 1)
    const [billing] = await enqueue('test.outbox.billing', 1)
    await connection`VACUUM (ANALYZE) outbox_event`
    await expectBoundedDiscovery(new Date())

    const plans = await db.execute<{ 'QUERY PLAN': { Plan: QueryPlan }[] }>(sql`
      EXPLAIN (FORMAT JSON)
      SELECT * FROM outbox_event
      WHERE status = 'pending' AND event_type = 'test.outbox.cleanup'
        AND available_at <= now()
      ORDER BY available_at, created_at, id
      LIMIT 1 FOR UPDATE SKIP LOCKED
      `)
    const nodes = planNodes(plans[0]['QUERY PLAN'][0].Plan)
    const indexScan = nodes.find((node) => node['Node Type'] === 'Index Scan')
    expect(indexScan).toBeDefined()
    const [index] = await connection<{ indexdef: string }[]>`
        SELECT indexdef FROM pg_indexes
        WHERE schemaname = ${schemaName} AND indexname = ${indexScan?.['Index Name'] ?? ''}
        LIMIT 1
      `
    expect(index.indexdef).toContain('(event_type, available_at, created_at, id)')
    expect(index.indexdef).toContain("WHERE (status = 'pending'::text)")
    expect(nodes.some((node) => node['Node Type'] === 'Sort')).toBe(false)

    const delivered: string[] = []
    const handler: OutboxHandler = async (_payload, context) => {
      delivered.push(context.eventId)
    }
    const result = await processOutboxEvents(
      {
        'test.outbox.cleanup': handler,
        'test.outbox.dispatch': handler,
        'test.outbox.billing': handler,
      },
      { batchSize: 20 }
    )

    expect(result.processed).toBe(20)
    expect(delivered.slice(0, 3)).toContain(dispatch.id)
    expect(delivered.slice(0, 3)).toContain(billing.id)
  }, 60_000)

  it('runs eligible short handlers without claiming a type that exceeds the deadline', async () => {
    const [long] = await enqueue('test.outbox.long', 1)
    const [short] = await enqueue('test.outbox.short', 1)
    const delivered: string[] = []
    const handler: OutboxHandler = async (_payload, context) => {
      delivered.push(context.eventId)
    }
    const result = await processOutboxEvents(
      {
        'test.outbox.long': withOutboxHandlerTimeout(async () => {
          throw new Error('Long handler must remain pending')
        }, 550_000),
        'test.outbox.short': handler,
      },
      { maxRuntimeMs: 110_000 }
    )

    expect(result.processed).toBe(1)
    expect(delivered).toEqual([short.id])
    const [pending] = await db.select().from(outboxEvent).where(eq(outboxEvent.id, long.id))
    expect(pending).toMatchObject({ status: 'pending', attempts: 0, lockedAt: null })
  })

  it('bounds stale-lease recovery and leaves excess rows for the next invocation', async () => {
    await seedBacklog('test.outbox.stale', 1_005, 'processing')

    const first = await processOutboxEvents({}, { batchSize: 0 })
    expect(first.reaped).toBe(1_000)
    const counts = await db
      .select({ status: outboxEvent.status, count: sql<number>`count(*)::int` })
      .from(outboxEvent)
      .where(eq(outboxEvent.eventType, 'test.outbox.stale'))
      .groupBy(outboxEvent.status)
    expect(counts).toEqual(
      expect.arrayContaining([
        { status: 'pending', count: 1_000 },
        { status: 'processing', count: 5 },
      ])
    )

    const second = await processOutboxEvents({}, { batchSize: 0 })
    expect(second.reaped).toBe(5)
  })
})
