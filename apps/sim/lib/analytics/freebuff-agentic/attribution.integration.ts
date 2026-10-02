import { db } from '@sim/db'
import { freebuffAttribution, outboxEvent, user } from '@sim/db/schema'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { eq, inArray, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { freebuffAgenticOutboxHandlers } from '@/lib/analytics/freebuff-agentic/outbox'
import {
  bindFreebuffAttribution,
  enqueueFreebuffUse,
} from '@/lib/analytics/freebuff-agentic/service'
import {
  readFreebuffAttribution,
  sealFreebuffAttribution,
} from '@/lib/analytics/freebuff-agentic/token'
import { processOutboxEventById } from '@/lib/core/outbox/service'

/** Protects token secrecy, expiry, transactional rollback, replay identity and retry policy. */
const userId = generateId()
const token = 'fixture-opaque-token-not-issued-by-freebuff'
const executionId = generateId()
const ids = [`freebuff:account_created:${userId}`, `freebuff:tool_used:${executionId}`]

beforeAll(async () => {
  await db.insert(user).values({
    id: userId,
    name: 'Fixture',
    email: `${userId}@example.test`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
})
afterAll(async () => {
  await db
    .delete(outboxEvent)
    .where(
      sql`${outboxEvent.id} like ${`freebuff:expire:${userId}:%`} or ${inArray(outboxEvent.id, ids)}`
    )
  await db.delete(user).where(eq(user.id, userId))
})

beforeEach(async () => {
  await db
    .delete(outboxEvent)
    .where(
      sql`${outboxEvent.id} like ${`freebuff:expire:${userId}:%`} or ${inArray(outboxEvent.id, ids)}`
    )
  await db.delete(freebuffAttribution).where(eq(freebuffAttribution.userId, userId))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
async function seedUse() {
  const sealed = await sealFreebuffAttribution(token)
  await db.update(user).set({ createdAt: new Date() }).where(eq(user.id, userId))
  await bindFreebuffAttribution(userId, sealed)
  await db.transaction((tx) => enqueueFreebuffUse(tx, userId, executionId, new Date()))
}

describe('agentic attribution across committed outcomes', () => {
  it('does not resurrect signup attribution from an older rejected capture', async () => {
    const older = await sealFreebuffAttribution('fixture-older')
    await sleep(2)
    await db.update(user).set({ createdAt: new Date() }).where(eq(user.id, userId))
    await sleep(2)
    const newer = await sealFreebuffAttribution('fixture-newer')
    await bindFreebuffAttribution(userId, newer)
    await bindFreebuffAttribution(userId, older)
    const [association] = await db
      .select()
      .from(freebuffAttribution)
      .where(eq(freebuffAttribution.userId, userId))
    expect(association.encryptedToken).toBe(newer)
    expect(await db.select().from(outboxEvent).where(eq(outboxEvent.id, ids[0]))).toHaveLength(0)
  })

  it('rejects tampered and expired capture without exposing the bearer token', async () => {
    const sealed = await sealFreebuffAttribution(token)
    expect(sealed).not.toContain(token)
    expect((await readFreebuffAttribution(sealed))?.token).toBe(token)
    expect(await readFreebuffAttribution(`${sealed}00`)).toBeNull()
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 31 * 24 * 60 * 60 * 1000)
    expect(await readFreebuffAttribution(sealed)).toBeNull()
    vi.useRealTimers()
  })

  it('retains signup identity on repeated login and rolls back uncommitted use', async () => {
    const sealed = await sealFreebuffAttribution(token)
    const createdAt = new Date()
    await db.update(user).set({ createdAt }).where(eq(user.id, userId))
    await bindFreebuffAttribution(userId, sealed)
    await bindFreebuffAttribution(userId, sealed)
    const [association] = await db
      .select()
      .from(freebuffAttribution)
      .where(eq(freebuffAttribution.userId, userId))
    expect(association.encryptedToken).not.toContain(token)
    const [signup] = await db.select().from(outboxEvent).where(eq(outboxEvent.id, ids[0]))
    expect(signup.payload).toMatchObject({
      eventType: 'account_created',
      occurredAt: createdAt.toISOString(),
    })
    await expect(
      db.transaction(async (tx) => {
        await enqueueFreebuffUse(tx, userId, executionId, new Date())
        throw new Error('rollback fixture')
      })
    ).rejects.toThrow('rollback fixture')
    expect(await db.select().from(outboxEvent).where(eq(outboxEvent.id, ids[1]))).toHaveLength(0)
    const occurredAt = new Date()
    await db.transaction(async (tx) => {
      await enqueueFreebuffUse(tx, userId, executionId, occurredAt)
      await enqueueFreebuffUse(tx, userId, executionId, new Date(occurredAt.getTime() + 1))
    })
    const uses = await db.select().from(outboxEvent).where(eq(outboxEvent.id, ids[1]))
    expect(uses).toHaveLength(1)
    expect(uses[0].payload).toMatchObject({
      eventType: 'tool_used',
      occurredAt: occurredAt.toISOString(),
    })
  })

  it('retries with original identity and treats deduplicated delivery as success', async () => {
    await seedUse()
    const requests: Record<string, unknown>[] = []
    let count = 0
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      requests.push(JSON.parse(String(init.body)))
      expect(init.headers).not.toHaveProperty('Authorization')
      return new Response(
        JSON.stringify(++count === 1 ? { error: 'busy' } : { accepted: true, deduped: true }),
        { status: count === 1 ? 503 : 200, headers: { 'Content-Type': 'application/json' } }
      )
    })
    expect(await processOutboxEventById(ids[1], freebuffAgenticOutboxHandlers)).toBe('pending')
    await db
      .update(outboxEvent)
      .set({ availableAt: new Date(0) })
      .where(eq(outboxEvent.id, ids[1]))
    expect(await processOutboxEventById(ids[1], freebuffAgenticOutboxHandlers)).toBe('completed')
    expect(requests).toHaveLength(2)
    expect(requests[1]).toEqual(requests[0])
    expect(requests[0]).toMatchObject({
      conversionToken: token,
      eventType: 'tool_used',
      eventId: `tool_used:${executionId}`,
    })
    vi.unstubAllGlobals()
  })

  it.each(['network', 'server'])(
    'erases credentials after three exhausted %s attempts',
    async (failure) => {
      await seedUse()
      let attempts = 0
      vi.stubGlobal('fetch', async () => {
        attempts++
        if (failure === 'network') throw new Error('fixture network failure')
        return new Response('{}', { status: 503 })
      })
      for (let attempt = 0; attempt < 3; attempt++) {
        await db
          .update(outboxEvent)
          .set({ availableAt: new Date(0) })
          .where(eq(outboxEvent.id, ids[1]))
        expect(await processOutboxEventById(ids[1], freebuffAgenticOutboxHandlers)).toBe(
          attempt === 2 ? 'dead_letter' : 'pending'
        )
      }
      const [event] = await db.select().from(outboxEvent).where(eq(outboxEvent.id, ids[1]))
      expect(attempts).toBe(3)
      expect(event.payload).toMatchObject({
        deliveryStatus: 'retry_exhausted',
        encryptedToken: null,
      })
    }
  )

  it('records a terminal rejection without retrying invalid credentials', async () => {
    await seedUse()
    vi.stubGlobal(
      'fetch',
      async () => new Response('{"error":"invalid_conversion_token"}', { status: 401 })
    )
    expect(await processOutboxEventById(ids[0], freebuffAgenticOutboxHandlers)).toBe('completed')
    const [event] = await db.select().from(outboxEvent).where(eq(outboxEvent.id, ids[0]))
    expect(event.payload).toMatchObject({ deliveryStatus: 'rejected', httpStatus: 401 })
    expect(event.payload).toHaveProperty('encryptedToken', null)
    vi.unstubAllGlobals()
  })
})
