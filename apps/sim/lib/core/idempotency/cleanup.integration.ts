/**
 * The daily sweep deletes expired keys batch by batch in creation order, resuming each batch where
 * the last one ended so the permanent namespaces it keeps are not re-read every batch. Against real
 * PostgreSQL: resuming must not skip an expired key, even one sharing the boundary timestamp.
 */
import { db } from '@sim/db'
import { idempotencyKey } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { like } from 'drizzle-orm'
import { afterAll, expect, it } from 'vitest'
import {
  cleanupExpiredIdempotencyKeys,
  estimateIdempotencyKeyCount,
} from '@/lib/core/idempotency/cleanup'

const run = generateId()
const DAY_MS = 24 * 60 * 60 * 1000

afterAll(async () => {
  await db.delete(idempotencyKey).where(like(idempotencyKey.key, `%:${run}:%`))
})

it('deletes every expired key across resumed batches and keeps the permanent and fresh ones', async () => {
  const old = Date.now() - 30 * DAY_MS
  const tied = new Date(old + 1000)
  const rows = [
    ...Array.from({ length: 4 }, (_, n) => ({
      key: `workflow-execution-id:${run}:${n}`,
      createdAt: new Date(old + n),
    })),
    { key: `admin-credit-grant:${run}:0`, createdAt: new Date(old + 5) },
    ...Array.from({ length: 7 }, (_, n) => ({
      key: `webhook:${run}:${n}`,
      createdAt: n < 5 ? tied : new Date(old + 2000 + n),
    })),
    { key: `webhook:${run}:fresh`, createdAt: new Date() },
  ]
  await db.insert(idempotencyKey).values(rows.map((row) => ({ ...row, result: {} })))

  const result = await cleanupExpiredIdempotencyKeys({ batchSize: 3 })

  expect(result.errors).toEqual([])
  expect(result.deletedByNamespace.webhook).toBeGreaterThanOrEqual(7)
  const remaining = await db
    .select({ key: idempotencyKey.key })
    .from(idempotencyKey)
    .where(like(idempotencyKey.key, `%:${run}:%`))
  expect(new Set(remaining.map(({ key }) => key))).toEqual(
    new Set([
      ...Array.from({ length: 4 }, (_, n) => `workflow-execution-id:${run}:${n}`),
      `admin-credit-grant:${run}:0`,
      `webhook:${run}:fresh`,
    ])
  )
  const estimate = await estimateIdempotencyKeyCount()
  expect(estimate === null || estimate >= 0).toBe(true)
})
