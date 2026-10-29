/** Real PostgreSQL retention removes only finished events that nothing reads again. */

import { outboxEvent } from '@sim/db/schema'
import { readTestDatabaseUrl, readTestRedisUrl } from '@sim/db/testing/test-infrastructure'
import { withUtcTimestamps } from '@sim/db/timestamps'
import { redisConfigMock, redisConfigMockFns } from '@sim/testing/mocks/redis-config.mock'
import { storageServiceMock, storageServiceMockFns } from '@sim/testing/mocks/storage-service.mock'
import { generateId } from '@sim/utils/id'
import { sql } from 'drizzle-orm'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import Redis from 'ioredis'
import postgres from 'postgres'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const database = vi.hoisted(() => ({ current: undefined as PostgresJsDatabase | undefined }))

vi.mock('@/lib/uploads/core/storage-service', () => storageServiceMock)
vi.mock('@/lib/core/config/redis', () => redisConfigMock)

vi.mock('@sim/db', () => ({
  get db() {
    if (!database.current) throw new Error('Outbox PostgreSQL test database is not initialized')
    return database.current
  },
}))

import {
  COMPLETED_OUTBOX_RETENTION_MS,
  OUTBOX_PRUNE_BATCH_SIZE,
  OUTBOX_PRUNE_PASS_MAX_MS,
  pruneCompletedOutboxEvents,
} from '@/lib/core/outbox/retention'
import { writeFramedCheckpoint } from '@/lib/knowledge/documents/processing-checkpoint-store'

const RECOVER = 'knowledge.document.processing.recover'
const STORAGE_CLEANUP = 'knowledge.document.storage.cleanup'
const ADMIN_OPERATION = 'admin.organization-member-operation'
const OCR_CHECKPOINT_EXPIRY = 'knowledge.document.ocr-checkpoint.expire'
const EMBEDDING_CHECKPOINT_EXPIRY = 'knowledge.document.embedding-checkpoint.expire'
const DEPLOYMENT_EFFECT = 'workflow.deployment.sync-active-side-effects'
const redisUrl = readTestRedisUrl()

describe('completed outbox retention in PostgreSQL', () => {
  const schemaName = `outbox_retention_${generateId().replaceAll('-', '')}`
  const connection = postgres(
    readTestDatabaseUrl(),
    withUtcTimestamps({
      max: 2,
      prepare: false,
      fetch_types: false,
      connection: { search_path: schemaName },
      onnotice: () => {},
    })
  )
  const testDb = drizzle(connection)
  const expired = () => new Date(Date.now() - COMPLETED_OUTBOX_RETENTION_MS - 60_000)
  const cursorKeys = [RECOVER, EMBEDDING_CHECKPOINT_EXPIRY].map(
    (eventType) => `outbox-prune-cursor:v1:${eventType}`
  )
  let redis: Redis | undefined

  beforeAll(async () => {
    await connection`CREATE SCHEMA ${connection(schemaName)}`
    await connection`CREATE TABLE outbox_event (LIKE public.outbox_event INCLUDING ALL)`
    database.current = testDb
    if (redisUrl) {
      redis = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 0 })
      await redis.connect()
      await redis.del(...cursorKeys)
    }
  })

  afterEach(async () => {
    redisConfigMockFns.mockGetRedisClient.mockReturnValue(null)
    await redis?.del(...cursorKeys)
    await connection`TRUNCATE outbox_event`
  })

  afterAll(async () => {
    try {
      await connection`DROP SCHEMA ${connection(schemaName)} CASCADE`
    } finally {
      await connection.end()
      await redis?.quit()
      database.current = undefined
    }
  })

  /** Runs the rest of the test with each type's pass resuming through real Redis. */
  function resumeThroughRedis(): Redis {
    if (!redis) throw new Error('TEST_REDIS_URL is required for the resume cases')
    redisConfigMockFns.mockGetRedisClient.mockReturnValue(redis)
    return redis
  }

  async function seed(eventType: string, status: string, createdAt: Date) {
    const id = generateId()
    await testDb.insert(outboxEvent).values({
      id,
      eventType,
      payload: {},
      status,
      createdAt,
      availableAt: createdAt,
    })
    return id
  }

  async function remainingIds() {
    const rows = await testDb.select({ id: outboxEvent.id }).from(outboxEvent)
    return new Set(rows.map((row) => row.id))
  }

  it('deletes only expired completed events of prunable types', async () => {
    const pruned = [
      await seed(RECOVER, 'completed', expired()),
      await seed(STORAGE_CLEANUP, 'completed', expired()),
      await seed(OCR_CHECKPOINT_EXPIRY, 'completed', expired()),
    ]
    const kept = [
      await seed(RECOVER, 'completed', new Date(Date.now() - 60_000)),
      await seed(STORAGE_CLEANUP, 'pending', expired()),
      await seed(RECOVER, 'processing', expired()),
      await seed(STORAGE_CLEANUP, 'dead_letter', expired()),
      await seed(ADMIN_OPERATION, 'completed', expired()),
      await seed(DEPLOYMENT_EFFECT, 'completed', expired()),
      await seed(OCR_CHECKPOINT_EXPIRY, 'pending', expired()),
    ]

    expect(await pruneCompletedOutboxEvents()).toBe(pruned.length)
    expect(await remainingIds()).toEqual(new Set(kept))
  })

  it('deletes at most one oldest batch per type per run, and the next run continues', async () => {
    const createdAt = expired().toISOString()
    for (const [prefix, eventType] of [
      ['recover', RECOVER],
      ['storage', STORAGE_CLEANUP],
    ]) {
      await testDb.execute(sql`
        INSERT INTO outbox_event (id, event_type, payload, status, available_at, created_at)
        SELECT ${prefix} || ':' || n, ${eventType}, '{}'::json, 'completed',
          ${createdAt}::timestamp, ${createdAt}::timestamp - n * interval '1 millisecond'
        FROM generate_series(0, ${OUTBOX_PRUNE_BATCH_SIZE}::integer) AS n
      `)
    }
    const pending = await seed(RECOVER, 'pending', expired())

    expect(await pruneCompletedOutboxEvents()).toBe(2 * OUTBOX_PRUNE_BATCH_SIZE)
    expect(await remainingIds()).toEqual(new Set(['recover:0', 'storage:0', pending]))
    expect(await pruneCompletedOutboxEvents()).toBe(2)
    expect(await remainingIds()).toEqual(new Set([pending]))
  })
  it('keeps every checkpoint written after its pruned expiry gate covered by a fresh cleanup', async () => {
    storageServiceMockFns.mockUploadFile.mockReset().mockResolvedValue(undefined)
    const key = 'kb/embedding-checkpoint/pruned-gate.bin'
    const write = () =>
      writeFramedCheckpoint(key, {}, Buffer.from('vectors'), {
        cleanupEventType: EMBEDDING_CHECKPOINT_EXPIRY,
        cleanupIdPrefix: 'retention-test',
        fileName: 'checkpoint.bin',
      })
    await write()
    const [gate] = await testDb.select().from(outboxEvent)
    await testDb
      .update(outboxEvent)
      .set({ status: 'completed', createdAt: expired() })
      .where(sql`${outboxEvent.id} = ${gate.id}`)

    /** The object's cleanup already ran, so a writer must not upload under the completed gate. */
    await write()
    expect(storageServiceMockFns.mockUploadFile).toHaveBeenCalledTimes(1)

    expect(await pruneCompletedOutboxEvents()).toBe(1)
    await write()

    expect(storageServiceMockFns.mockUploadFile).toHaveBeenCalledTimes(2)
    const rows = await testDb.select().from(outboxEvent)
    expect(rows.map((row) => [row.id, row.status])).toEqual([[gate.id, 'pending']])
  })

  describe.runIf(Boolean(redisUrl))("resuming each type's pass across runs", () => {
    /** One full batch plus one newer row, all completed, a millisecond apart, oldest first. */
    async function seedFullBatchPlusOne(eventType: string) {
      const newest = expired().toISOString()
      await testDb.execute(sql`
        INSERT INTO outbox_event (id, event_type, payload, status, available_at, created_at)
        SELECT 'row:' || n, ${eventType}, '{}'::json, 'completed',
          ${newest}::timestamp, ${newest}::timestamp - n * interval '1 millisecond'
        FROM generate_series(0, ${OUTBOX_PRUNE_BATCH_SIZE}::integer) AS n
      `)
    }

    /** Pending before any seeded row, then completed once the first batch has gone past it. */
    async function seedLateCompletion(eventType: string) {
      const id = await seed(
        eventType,
        'pending',
        new Date(expired().getTime() - OUTBOX_PRUNE_BATCH_SIZE - 60_000)
      )
      return {
        id,
        complete: () =>
          testDb
            .update(outboxEvent)
            .set({ status: 'completed' })
            .where(sql`${outboxEvent.id} = ${id}`),
      }
    }

    it('resumes after the last row the previous batch deleted, and the next pass covers a row it went by', async () => {
      resumeThroughRedis()
      await seedFullBatchPlusOne(EMBEDDING_CHECKPOINT_EXPIRY)
      const late = await seedLateCompletion(EMBEDDING_CHECKPOINT_EXPIRY)

      expect(await pruneCompletedOutboxEvents()).toBe(OUTBOX_PRUNE_BATCH_SIZE)
      expect(await remainingIds()).toEqual(new Set(['row:0', late.id]))
      await late.complete()

      /** Starting again from the oldest row would take the late completion in this batch too. */
      expect(await pruneCompletedOutboxEvents()).toBe(1)
      expect(await remainingIds()).toEqual(new Set([late.id]))

      expect(await pruneCompletedOutboxEvents()).toBe(1)
      expect(await remainingIds()).toEqual(new Set())
    })

    it('deletes exactly the eligible rows across batches that split one creation time', async () => {
      resumeThroughRedis()
      const createdAt = `${expired().toISOString().slice(0, -1)}123Z`
      await testDb.execute(sql`
        INSERT INTO outbox_event (id, event_type, payload, status, available_at, created_at)
        SELECT 'tie:' || lpad(n::text, 5, '0'), ${RECOVER}, '{}'::json,
          CASE WHEN n % 100 = 7 THEN 'pending' ELSE 'completed' END,
          ${createdAt}::timestamp, ${createdAt}::timestamp
        FROM generate_series(1, ${OUTBOX_PRUNE_BATCH_SIZE + 500}::integer) AS n
      `)
      const kept = [
        await seed(ADMIN_OPERATION, 'completed', expired()),
        await seed(RECOVER, 'completed', new Date(Date.now() - 60_000)),
      ]
      const pendingTies = await testDb
        .select({ id: outboxEvent.id })
        .from(outboxEvent)
        .where(sql`${outboxEvent.status} = 'pending'`)
      const completedTies = OUTBOX_PRUNE_BATCH_SIZE + 500 - pendingTies.length

      expect(await pruneCompletedOutboxEvents()).toBe(OUTBOX_PRUNE_BATCH_SIZE)
      expect(await pruneCompletedOutboxEvents()).toBe(completedTies - OUTBOX_PRUNE_BATCH_SIZE)
      expect(await pruneCompletedOutboxEvents()).toBe(0)
      expect(await remainingIds()).toEqual(new Set([...kept, ...pendingTies.map((row) => row.id)]))
    })

    it.each([
      ['the pass is over its time limit', async () => {}, OUTBOX_PRUNE_PASS_MAX_MS],
      [
        'the cursor is unreadable',
        async (client: Redis) => {
          await client.set(`outbox-prune-cursor:v1:${RECOVER}`, '{"createdAt":')
        },
        0,
      ],
      [
        'the cursor names no real creation time',
        async (client: Redis) => {
          await client.set(
            `outbox-prune-cursor:v1:${RECOVER}`,
            JSON.stringify({
              createdAt: '2026-02-30 00:00:00',
              id: 'row:1',
              passStartedAt: Date.now(),
            })
          )
        },
        0,
      ],
    ])('starts again from the oldest row when %s', async (_, corrupt, laterMs) => {
      const client = resumeThroughRedis()
      await seedFullBatchPlusOne(RECOVER)
      const late = await seedLateCompletion(RECOVER)

      expect(await pruneCompletedOutboxEvents()).toBe(OUTBOX_PRUNE_BATCH_SIZE)
      await late.complete()
      await corrupt(client)

      expect(await pruneCompletedOutboxEvents(new Date(Date.now() + laterMs))).toBe(2)
      expect(await remainingIds()).toEqual(new Set())
    })
  })
})
