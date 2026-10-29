/** Real PostgreSQL retention removes only finished events that nothing reads again. */

import { outboxEvent } from '@sim/db/schema'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { withUtcTimestamps } from '@sim/db/timestamps'
import { storageServiceMock, storageServiceMockFns } from '@sim/testing/mocks/storage-service.mock'
import { generateId } from '@sim/utils/id'
import { sql } from 'drizzle-orm'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const database = vi.hoisted(() => ({ current: undefined as PostgresJsDatabase | undefined }))

vi.mock('@/lib/uploads/core/storage-service', () => storageServiceMock)

vi.mock('@sim/db', () => ({
  get db() {
    if (!database.current) throw new Error('Outbox PostgreSQL test database is not initialized')
    return database.current
  },
}))

import {
  COMPLETED_OUTBOX_RETENTION_MS,
  OUTBOX_PRUNE_BATCH_SIZE,
  pruneCompletedOutboxEvents,
} from '@/lib/core/outbox/retention'
import { writeFramedCheckpoint } from '@/lib/knowledge/documents/processing-checkpoint-store'

const RECOVER = 'knowledge.document.processing.recover'
const STORAGE_CLEANUP = 'knowledge.document.storage.cleanup'
const ADMIN_OPERATION = 'admin.organization-member-operation'
const OCR_CHECKPOINT_EXPIRY = 'knowledge.document.ocr-checkpoint.expire'
const EMBEDDING_CHECKPOINT_EXPIRY = 'knowledge.document.embedding-checkpoint.expire'
const DEPLOYMENT_EFFECT = 'workflow.deployment.sync-active-side-effects'

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

  beforeAll(async () => {
    await connection`CREATE SCHEMA ${connection(schemaName)}`
    await connection`CREATE TABLE outbox_event (LIKE public.outbox_event INCLUDING ALL)`
    database.current = testDb
  })

  afterEach(async () => {
    await connection`TRUNCATE outbox_event`
  })

  afterAll(async () => {
    try {
      await connection`DROP SCHEMA ${connection(schemaName)} CASCADE`
    } finally {
      await connection.end()
      database.current = undefined
    }
  })

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
})
