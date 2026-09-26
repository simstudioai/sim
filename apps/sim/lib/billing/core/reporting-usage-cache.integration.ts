/**
 * The shared reporting-usage read against a real ledger in a disposable PostgreSQL schema and a
 * real Redis. Skipped without `TEST_REDIS_URL`. Each test uses a fresh payer, so the in-process
 * cache is always cold and every read models a new process.
 */
import type { db } from '@sim/db'
import * as schema from '@sim/db/schema'
import { readTestDatabaseUrl, readTestRedisUrl } from '@sim/db/testing/test-infrastructure'
import { redisConfigMock, redisConfigMockFns } from '@sim/testing/mocks/redis-config.mock'
import { generateId } from '@sim/utils/id'
import { drizzle } from 'drizzle-orm/postgres-js'
import Redis from 'ioredis'
import postgres from 'postgres'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { transaction } = vi.hoisted(() => ({ transaction: vi.fn() }))
const databaseUrl = readTestDatabaseUrl()
const redisUrl = readTestRedisUrl()

vi.mock('@sim/db', () => ({ db: { transaction }, dbReplica: {} }))
vi.mock('@/lib/core/config/redis', () => redisConfigMock)

import { readSoftGateUsageCost } from '@/lib/billing/core/reporting-usage-cache'
import type { BillingEntity, UsageQueryPeriod } from '@/lib/billing/core/usage-log'

const schemaName = `reporting_usage_${generateId().replaceAll('-', '')}`
const connection = postgres(databaseUrl, {
  max: 2,
  prepare: false,
  connection: { search_path: schemaName },
  onnotice: () => undefined,
})
const database = drizzle(connection, { schema }) as typeof db

const REPORTING: UsageQueryPeriod = {
  start: new Date('2026-01-01T00:00:00.000Z'),
  end: new Date('2027-01-01T00:00:00.000Z'),
  source: 'reporting',
}

function sharedKey(payer: BillingEntity): string {
  return `usage:reporting:v1:${payer.type}:${payer.id}:reporting:${REPORTING.start.toISOString()}:${REPORTING.end.toISOString()}`
}

describe.runIf(Boolean(redisUrl))('shared reporting usage read', () => {
  let redis: Redis
  let payer: BillingEntity

  beforeAll(async () => {
    redis = new Redis(redisUrl!, { lazyConnect: true, maxRetriesPerRequest: 0 })
    await redis.connect()
    await connection.unsafe(`CREATE SCHEMA "${schemaName}"`)
    await connection.unsafe(`CREATE TABLE usage_log (
      id text PRIMARY KEY, cost numeric NOT NULL, billing_entity_type text,
      billing_entity_id text, billing_period_start timestamp, billing_period_end timestamp,
      created_at timestamp NOT NULL
    )`)
    transaction.mockImplementation((callback) => database.transaction(callback))
  })

  beforeEach(async () => {
    transaction.mockClear()
    redisConfigMockFns.mockGetRedisClient.mockReturnValue(redis)
    payer = { type: 'organization', id: generateId() }
    await connection`INSERT INTO usage_log (id, cost, billing_entity_type, billing_entity_id, created_at)
      VALUES (${generateId()}, 4.25, 'organization', ${payer.id}, '2026-03-01'),
        (${generateId()}, 1.5, 'organization', ${payer.id}, '2026-06-01'),
        (${generateId()}, 99, 'organization', ${payer.id}, '2025-12-31')`
  })

  afterEach(async () => {
    await redis.del(sharedKey(payer))
  })

  afterAll(async () => {
    await redis?.quit()
    await connection.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
    await connection.end()
  })

  it('serves a sum another process stored without summing the ledger', async () => {
    await redis.set(sharedKey(payer), '12.5', 'PX', 30_000)

    await expect(readSoftGateUsageCost(payer, REPORTING)).resolves.toBe(12.5)
    expect(transaction).not.toHaveBeenCalled()
  })

  it('sums the ledger exactly on a miss and stores the sum for other processes', async () => {
    await expect(readSoftGateUsageCost(payer, REPORTING)).resolves.toBe(5.75)
    expect(transaction).toHaveBeenCalledTimes(1)

    await vi.waitFor(async () => expect(await redis.get(sharedKey(payer))).toBe('5.75'))
    const ttl = await redis.pttl(sharedKey(payer))
    expect(ttl).toBeGreaterThan(25_000)
    expect(ttl).toBeLessThanOrEqual(35_000)
  })

  it('treats an unreadable stored sum as a miss and overwrites it', async () => {
    await redis.set(sharedKey(payer), 'not-a-number', 'PX', 30_000)

    await expect(readSoftGateUsageCost(payer, REPORTING)).resolves.toBe(5.75)
    await vi.waitFor(async () => expect(await redis.get(sharedKey(payer))).toBe('5.75'))
  })

  it('sums the ledger promptly when Redis is unreachable', async () => {
    const unreachable = new Redis('redis://127.0.0.1:1', {
      enableOfflineQueue: true,
      maxRetriesPerRequest: null,
      retryStrategy: () => 1_000,
    })
    unreachable.on('error', () => undefined)
    redisConfigMockFns.mockGetRedisClient.mockReturnValue(unreachable)
    try {
      const startedAt = Date.now()
      await expect(readSoftGateUsageCost(payer, REPORTING)).resolves.toBe(5.75)
      expect(Date.now() - startedAt).toBeLessThan(2_000)
    } finally {
      unreachable.disconnect()
    }
  })
})
