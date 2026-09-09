/** Real PostgreSQL claims verify scheduling fairness and concurrent delivery. */
import { db } from '@sim/db'
import { outboxEvent } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq, inArray, sql } from 'drizzle-orm'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import {
  type OutboxHandler,
  processOutboxEvents,
  withOutboxHandlerTimeout,
} from '@/lib/core/outbox/service'

interface QueryPlan {
  'Node Type': string
  'Index Name'?: string
  Plans?: QueryPlan[]
}

function planNodes(plan: QueryPlan): QueryPlan[] {
  return [plan, ...(plan.Plans ?? []).flatMap(planNodes)]
}

describe('outbox scheduling in PostgreSQL', () => {
  const eventTypes = new Set<string>()

  afterEach(async () => {
    if (eventTypes.size) {
      await db.delete(outboxEvent).where(inArray(outboxEvent.eventType, [...eventTypes]))
    }
    eventTypes.clear()
  })

  afterAll(async () => {
    await db.$client.end()
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
    status: 'pending' | 'completed' | 'processing'
  ) {
    const prefix = generateId()
    const availableAt = new Date(Date.now() - 60_000)
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
    await db.execute(sql`ANALYZE outbox_event`)

    const plans = await db.execute<{ 'QUERY PLAN': { Plan: QueryPlan }[] }>(sql`
      EXPLAIN (FORMAT JSON)
      SELECT * FROM outbox_event
      WHERE status = 'pending' AND event_type = 'test.outbox.cleanup'
        AND available_at <= now()
      ORDER BY available_at, created_at, id
      LIMIT 1 FOR UPDATE SKIP LOCKED
    `)
    const nodes = planNodes(plans[0]['QUERY PLAN'][0].Plan)
    expect(
      nodes.some((node) => node['Index Name'] === 'outbox_event_pending_type_available_idx')
    ).toBe(true)
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
