/**
 * The shared reporting-usage read against a real ledger in a disposable PostgreSQL schema and a
 * real Redis. Skipped without `TEST_REDIS_URL`. Each test uses a fresh payer, so the in-process
 * cache is always cold and every read models a new process.
 */

import { type AddressInfo, createServer, type Socket } from 'node:net'
import type { db } from '@sim/db'
import * as schema from '@sim/db/schema'
import { readTestDatabaseUrl, readTestRedisUrl } from '@sim/db/testing/test-infrastructure'
import { redisConfigMock, redisConfigMockFns } from '@sim/testing/mocks/redis-config.mock'
import { generateId } from '@sim/utils/id'
import { randomInt, randomItem } from '@sim/utils/random'
import { drizzle } from 'drizzle-orm/postgres-js'
import Redis from 'ioredis'
import postgres from 'postgres'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { transaction, summedPeriods } = vi.hoisted(() => ({
  transaction: vi.fn(),
  summedPeriods: [] as UsageQueryPeriod[],
}))
const databaseUrl = readTestDatabaseUrl()
const redisUrl = readTestRedisUrl()

vi.mock('@sim/db', () => {
  const db = { transaction }
  return {
    db,
    dbFor: () => ({ transaction }),
    dbReplica: {},
    isPrimaryPoolClient: (executor: object) => executor === db,
  }
})
vi.mock('@/lib/core/config/redis', () => redisConfigMock)
vi.mock('@/lib/billing/core/usage-log', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/billing/core/usage-log')>()
  return {
    ...actual,
    getBillingPeriodUsageCost: (...args: Parameters<typeof actual.getBillingPeriodUsageCost>) => {
      summedPeriods.push(args[1])
      return actual.getBillingPeriodUsageCost(...args)
    },
  }
})

import {
  REPORTING_USAGE_CACHE_TTL_MS,
  readSoftGateUsageCost,
} from '@/lib/billing/core/reporting-usage-cache'
import { invalidateReportingUsagePrefixes } from '@/lib/billing/core/reporting-usage-epoch'
import {
  type BillingEntity,
  type RecordCumulativeUsageParams,
  recordCumulativeUsage,
  type UsageQueryPeriod,
} from '@/lib/billing/core/usage-log'

const schemaName = `reporting_usage_${generateId().replaceAll('-', '')}`
const connection = postgres(databaseUrl, {
  max: 4,
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

const DAY_MS = 86_400_000
const MINUTE_MS = 60_000

/** A year-long window that started 100 days ago, so the clock is always inside it. */
function openReportingWindow(): UsageQueryPeriod {
  const start = Math.floor((Date.now() - 100 * DAY_MS) / DAY_MS) * DAY_MS
  return { start: new Date(start), end: new Date(start + 365 * DAY_MS), source: 'reporting' }
}

function windowKey(payer: BillingEntity, period: UsageQueryPeriod): string {
  return `${payer.type}:${payer.id}:reporting:${period.start.toISOString()}:${period.end.toISOString()}`
}

function sharedKey(payer: BillingEntity, period: UsageQueryPeriod = REPORTING): string {
  return `usage:reporting:v1:${windowKey(payer, period)}`
}

function prefixKey(payer: BillingEntity, period: UsageQueryPeriod): string {
  return `usage:reporting:v1:prefix:${windowKey(payer, period)}`
}

function prefixLeaseKey(payer: BillingEntity, period: UsageQueryPeriod): string {
  return `usage:reporting:v1:prefix-lease:${windowKey(payer, period)}`
}

function payerEpochKey(payer: BillingEntity): string {
  return `usage:reporting:v1:prefix-epoch:${payer.type}:${payer.id}`
}

type ReportingUsageCacheModule = typeof import('@/lib/billing/core/reporting-usage-cache')

/** Fresh module instances, so each in-process cache is cold, as in a new process. */
async function newProcesses(count: number): Promise<ReportingUsageCacheModule[]> {
  const processes: ReportingUsageCacheModule[] = []
  for (let index = 0; index < count; index++) {
    vi.resetModules()
    processes.push(await import('@/lib/billing/core/reporting-usage-cache'))
  }
  return processes
}

async function readInNewProcess(payer: BillingEntity, period: UsageQueryPeriod): Promise<number> {
  const [cache] = await newProcesses(1)
  return cache.readSoftGateUsageCost(payer, period)
}

/** Sums that start at the window's start: a whole-window sum or a prefix, never a tail. */
function windowStartSums(period: UsageQueryPeriod): UsageQueryPeriod[] {
  return summedPeriods.filter((summed) => summed.start.getTime() === period.start.getTime())
}

async function insertUsage(payer: BillingEntity, cost: number, createdAt: Date): Promise<string> {
  const id = generateId()
  await connection`INSERT INTO usage_log (id, cost, billing_entity_type, billing_entity_id, created_at)
    VALUES (${id}, ${cost}, ${payer.type}, ${payer.id}, ${createdAt.toISOString()})`
  return id
}

function cumulativeCharge(
  payer: BillingEntity,
  eventKey: string,
  cost: number
): RecordCumulativeUsageParams {
  return {
    userId: 'actor',
    workspaceId: 'workspace',
    billingEntity: payer,
    billingPeriod: { start: REPORTING.start, end: REPORTING.end },
    source: 'workspace-chat',
    model: 'test-model',
    eventKey,
    cost,
  }
}

/** A cumulative charge whose row was first written at `createdAt`. */
async function startCumulativeCharge(
  payer: BillingEntity,
  cost: number,
  createdAt: Date
): Promise<string> {
  const eventKey = `update-cost:${generateId()}`
  await recordCumulativeUsage(cumulativeCharge(payer, eventKey, cost))
  await connection`UPDATE usage_log SET created_at = ${createdAt.toISOString()}
    WHERE event_key = ${eventKey}`
  return eventKey
}

async function exactSum(payer: BillingEntity, period: UsageQueryPeriod): Promise<number> {
  const [row] = await connection<{ cost: string }[]>`SELECT COALESCE(SUM(cost), 0) AS cost
    FROM usage_log WHERE billing_entity_type = ${payer.type} AND billing_entity_id = ${payer.id}
    AND created_at >= ${period.start.toISOString()} AND created_at < ${period.end.toISOString()}`
  return Number(row?.cost ?? 0)
}

describe.runIf(Boolean(redisUrl))('shared reporting usage read', () => {
  let redis: Redis
  let payer: BillingEntity

  async function prefixStored(payer: BillingEntity, period: UsageQueryPeriod): Promise<void> {
    await vi.waitFor(async () => expect(await redis.exists(prefixKey(payer, period))).toBe(1))
  }

  beforeAll(async () => {
    redis = new Redis(redisUrl!, { lazyConnect: true, maxRetriesPerRequest: 0 })
    await redis.connect()
    await connection.unsafe(`CREATE SCHEMA "${schemaName}"`)
    await connection.unsafe(`CREATE TABLE usage_log (
      id text PRIMARY KEY, user_id text, category text, source text, description text,
      metadata jsonb, cost numeric NOT NULL, event_key text, billing_entity_type text,
      billing_entity_id text, billing_period_start timestamp, billing_period_end timestamp,
      workspace_id text, workflow_id text, execution_id text,
      created_at timestamp NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX usage_log_event_key_unique ON usage_log(event_key)
    WHERE event_key IS NOT NULL`)
    transaction.mockImplementation((callback) => database.transaction(callback))
  })

  beforeEach(async () => {
    transaction.mockClear()
    summedPeriods.length = 0
    redisConfigMockFns.mockGetRedisClient.mockReturnValue(redis)
    redisConfigMockFns.mockReleaseLock.mockImplementation(async (key: string, value: string) => {
      if ((await redis.get(key)) !== value) return false
      return (await redis.del(key)) === 1
    })
    payer = { type: 'organization', id: generateId() }
    await connection`INSERT INTO usage_log (id, cost, billing_entity_type, billing_entity_id, created_at)
      VALUES (${generateId()}, 4.25, 'organization', ${payer.id}, '2026-03-01'),
        (${generateId()}, 1.5, 'organization', ${payer.id}, '2026-06-01'),
        (${generateId()}, 99, 'organization', ${payer.id}, '2025-12-31')`
  })

  afterEach(async () => {
    vi.useRealTimers()
    await redis.del(
      ...[REPORTING, openReportingWindow()].flatMap((period) => [
        sharedKey(payer, period),
        prefixKey(payer, period),
        prefixLeaseKey(payer, period),
      ]),
      payerEpochKey(payer),
      'usage:reporting:v1:prefix-epoch'
    )
  })

  afterAll(async () => {
    await redis?.quit()
    await connection.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
    await connection.end()
  })

  it('serves a sum another process stored instead of the ledger', async () => {
    await redis.set(sharedKey(payer), '12.5', 'PX', 30_000)

    await expect(readSoftGateUsageCost(payer, REPORTING)).resolves.toBe(12.5)
  })

  it('sums the ledger exactly on a miss and stores the sum for other processes', async () => {
    await expect(readSoftGateUsageCost(payer, REPORTING)).resolves.toBe(5.75)

    await vi.waitFor(async () => expect(await redis.get(sharedKey(payer))).toBe('5.75'))
    const ttl = await redis.pttl(sharedKey(payer))
    expect(ttl).toBeGreaterThan(25_000)
    expect(ttl).toBeLessThanOrEqual(35_000)
  })

  it('treats an unreadable stored sum as a miss', async () => {
    await redis.set(sharedKey(payer), 'not-a-number', 'PX', 30_000)

    await expect(readSoftGateUsageCost(payer, REPORTING)).resolves.toBe(5.75)
  })

  it('shares a sum that ran longer than the TTL for a short floor instead of dropping it', async () => {
    const now = Date.now()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(now - REPORTING_USAGE_CACHE_TTL_MS - 1_000)
    transaction.mockImplementationOnce(async (callback) => {
      const result = await database.transaction(callback)
      vi.setSystemTime(now)
      return result
    })

    await expect(readSoftGateUsageCost(payer, REPORTING)).resolves.toBe(5.75)
    expect(await redis.get(sharedKey(payer))).toBe('5.75')
    const ttl = await redis.pttl(sharedKey(payer))
    expect(ttl).toBeGreaterThan(4_000)
    expect(ttl).toBeLessThanOrEqual(5_000)
  })

  it('anchors a stored sum expiry to when the sum began, not when it was written', async () => {
    const now = Date.now()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(now - 20_000)
    transaction.mockImplementationOnce(async (callback) => {
      const result = await database.transaction(callback)
      vi.setSystemTime(now)
      return result
    })

    await expect(readSoftGateUsageCost(payer, REPORTING)).resolves.toBe(5.75)
    const ttl = await redis.pttl(sharedKey(payer))
    expect(ttl).toBeGreaterThan(REPORTING_USAGE_CACHE_TTL_MS - 20_000 - 1_000)
    expect(ttl).toBeLessThanOrEqual(REPORTING_USAGE_CACHE_TTL_MS - 20_000 + 5_000)
  })

  it('never lets a slower, older sum replace one stored while it ran', async () => {
    transaction.mockImplementationOnce(async (callback) => {
      const result = await database.transaction(callback)
      await redis.set(sharedKey(payer), '9.99', 'PX', 30_000)
      return result
    })

    await expect(readSoftGateUsageCost(payer, REPORTING)).resolves.toBe(5.75)
    expect(await redis.get(sharedKey(payer))).toBe('9.99')
  })

  it('sums the whole window in one query when Redis is absent', async () => {
    redisConfigMockFns.mockGetRedisClient.mockReturnValue(null)
    const period = openReportingWindow()
    await insertUsage(payer, 2, new Date(period.start.getTime() + DAY_MS))
    await insertUsage(payer, 3, new Date(Date.now() - MINUTE_MS))

    await expect(readInNewProcess(payer, period)).resolves.toBe(5)
    expect(summedPeriods).toEqual([period])
  })

  it('leases a due refresh to one of the processes missing together', async () => {
    const period = openReportingWindow()
    await insertUsage(payer, 2, new Date(period.start.getTime() + DAY_MS))
    await insertUsage(payer, 3, new Date(Date.now() - MINUTE_MS))
    await expect(readInNewProcess(payer, period)).resolves.toBe(5)
    await insertUsage(payer, 4, new Date(period.start.getTime() + 2 * DAY_MS))

    const now = Date.now()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(now + 4 * MINUTE_MS)
    await redis.del(sharedKey(payer, period), prefixLeaseKey(payer, period))
    const processes = await newProcesses(5)
    const costs = await Promise.all(
      processes.map((cache) => cache.readSoftGateUsageCost(payer, period))
    )

    expect(windowStartSums(period)).toHaveLength(2)
    expect(costs).toContain(9)
    for (const cost of costs) expect([5, 9]).toContain(cost)
  })

  it('sums the whole window at once when no prefix is stored and another process is summing one', async () => {
    const period = openReportingWindow()
    await insertUsage(payer, 2, new Date(period.start.getTime() + DAY_MS))
    await insertUsage(payer, 3, new Date(Date.now() - MINUTE_MS))
    await redis.set(prefixLeaseKey(payer, period), '1', 'PX', MINUTE_MS)
    const [cache] = await newProcesses(1)

    const startedAt = performance.now()
    await expect(cache.readSoftGateUsageCost(payer, period)).resolves.toBe(5)
    expect(performance.now() - startedAt).toBeLessThan(1_000)
    expect(summedPeriods).toEqual([period])
  })

  it('never reads above the ledger as it grows, and matches it once the prefix is refreshed', async () => {
    const period = openReportingWindow()
    const oldRows = [
      await insertUsage(payer, 1.25, new Date(period.start.getTime() + DAY_MS)),
      await insertUsage(payer, 0.5, new Date(Date.now() - 10 * DAY_MS)),
    ]
    await expect(readInNewProcess(payer, period)).resolves.toBe(1.75)

    for (let round = 0; round < 8; round++) {
      const recent = new Date(Date.now() - randomInt(0, 4 * MINUTE_MS))
      await insertUsage(payer, randomInt(1, 500) / 100, recent)
      if (round % 2 === 0) {
        const late = new Date(period.start.getTime() + randomInt(1, 90) * DAY_MS)
        await insertUsage(payer, randomInt(1, 500) / 100, late)
      } else {
        await connection`UPDATE usage_log SET cost = cost + ${randomInt(1, 500) / 100}
          WHERE id = ${randomItem(oldRows)}`
      }
      await redis.del(sharedKey(payer, period))

      const served = await readInNewProcess(payer, period)
      expect(served).toBeLessThanOrEqual((await exactSum(payer, period)) + 1e-9)
    }
    expect(windowStartSums(period)).toHaveLength(1)

    const now = Date.now()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(now + 4 * MINUTE_MS)
    await redis.del(sharedKey(payer, period), prefixLeaseKey(payer, period))

    const refreshed = await readInNewProcess(payer, period)
    expect(refreshed).toBeCloseTo(await exactSum(payer, period), 9)
    expect(windowStartSums(period)).toHaveLength(2)
  })

  it('never reads above the ledger after ledger rows are deleted and prefixes are invalidated', async () => {
    const period = openReportingWindow()
    await insertUsage(payer, 2, new Date(period.start.getTime() + DAY_MS))
    const departedRow = await insertUsage(payer, 6, new Date(period.start.getTime() + 2 * DAY_MS))
    await insertUsage(payer, 3, new Date(Date.now() - MINUTE_MS))
    await expect(readInNewProcess(payer, period)).resolves.toBe(11)
    await prefixStored(payer, period)

    await connection`DELETE FROM usage_log WHERE id = ${departedRow}`
    await invalidateReportingUsagePrefixes()
    await redis.del(sharedKey(payer, period))

    await expect(readInNewProcess(payer, period)).resolves.toBe(await exactSum(payer, period))
  })

  it('sees a top-up to a row inside the stored prefix on the next read', async () => {
    const period = openReportingWindow()
    await insertUsage(payer, 3, new Date(Date.now() - MINUTE_MS))
    const eventKey = await startCumulativeCharge(
      payer,
      2,
      new Date(period.start.getTime() + DAY_MS)
    )
    await expect(readInNewProcess(payer, period)).resolves.toBe(5)
    await prefixStored(payer, period)

    await recordCumulativeUsage(cumulativeCharge(payer, eventKey, 6))
    await vi.waitFor(async () => expect(await redis.exists(payerEpochKey(payer))).toBe(1))
    await redis.del(sharedKey(payer, period))

    await expect(readInNewProcess(payer, period)).resolves.toBe(9)
    expect(await exactSum(payer, period)).toBe(9)
  })

  it('refreshes a prefix discarded by a top-up once, instead of summing the window on every read', async () => {
    const period = openReportingWindow()
    await insertUsage(payer, 3, new Date(Date.now() - MINUTE_MS))
    const eventKey = await startCumulativeCharge(
      payer,
      2,
      new Date(period.start.getTime() + DAY_MS)
    )
    await expect(readInNewProcess(payer, period)).resolves.toBe(5)
    await prefixStored(payer, period)
    await vi.waitFor(async () => expect(await redis.exists(prefixLeaseKey(payer, period))).toBe(0))

    await recordCumulativeUsage(cumulativeCharge(payer, eventKey, 6))
    await vi.waitFor(async () => expect(await redis.exists(payerEpochKey(payer))).toBe(1))
    await redis.del(sharedKey(payer, period))
    await expect(readInNewProcess(payer, period)).resolves.toBe(9)
    await redis.del(sharedKey(payer, period))
    await expect(readInNewProcess(payer, period)).resolves.toBe(9)

    expect(await exactSum(payer, period)).toBe(9)
    expect(windowStartSums(period)).toHaveLength(2)
  })

  it('leaves the prefix in place for a top-up to a row still in the tail, and reads it exactly', async () => {
    const period = openReportingWindow()
    await insertUsage(payer, 2, new Date(period.start.getTime() + DAY_MS))
    const eventKey = await startCumulativeCharge(payer, 3, new Date(Date.now() - MINUTE_MS))
    await expect(readInNewProcess(payer, period)).resolves.toBe(5)
    await prefixStored(payer, period)

    await recordCumulativeUsage(cumulativeCharge(payer, eventKey, 7))
    await redis.del(sharedKey(payer, period))

    await expect(readInNewProcess(payer, period)).resolves.toBe(9)
    expect(await redis.exists(payerEpochKey(payer))).toBe(0)
    expect(windowStartSums(period)).toHaveLength(1)
  })

  it('never over-counts a top-up that commits while a prefix refresh sums', async () => {
    const period = openReportingWindow()
    await insertUsage(payer, 3, new Date(Date.now() - MINUTE_MS))
    const eventKey = await startCumulativeCharge(
      payer,
      2,
      new Date(period.start.getTime() + DAY_MS)
    )
    const [refreshing] = await newProcesses(1)
    transaction.mockImplementationOnce(async (callback) => {
      const result = await database.transaction(callback)
      await recordCumulativeUsage(cumulativeCharge(payer, eventKey, 6))
      return result
    })

    const served = await refreshing.readSoftGateUsageCost(payer, period)
    expect(served).toBeLessThanOrEqual(await exactSum(payer, period))
    await prefixStored(payer, period)
    await vi.waitFor(async () => expect(await redis.exists(payerEpochKey(payer))).toBe(1))
    await redis.del(sharedKey(payer, period))

    await expect(readInNewProcess(payer, period)).resolves.toBe(await exactSum(payer, period))
  })

  it('serves a stale prefix while another process holds the refresh lease', async () => {
    const period = openReportingWindow()
    await insertUsage(payer, 2, new Date(period.start.getTime() + DAY_MS))
    await insertUsage(payer, 3, new Date(Date.now() - MINUTE_MS))
    const staleCutoff = Date.now() - 10 * MINUTE_MS
    await redis.set(prefixKey(payer, period), `::${staleCutoff}:7`, 'PX', MINUTE_MS)
    await redis.set(prefixLeaseKey(payer, period), '1', 'PX', MINUTE_MS)

    await expect(readInNewProcess(payer, period)).resolves.toBe(10)
    expect(windowStartSums(period)).toHaveLength(0)
  })

  it('sums the ledger when the Redis client cannot be built', async () => {
    redisConfigMockFns.mockGetRedisClient.mockImplementation(() => {
      throw new Error('Invalid Redis configuration')
    })

    await expect(readSoftGateUsageCost(payer, REPORTING)).resolves.toBe(5.75)
  })

  it('sums the ledger without issuing or queuing a command while Redis is not ready', async () => {
    const notReady = new Redis(redisUrl!, { lazyConnect: true, maxRetriesPerRequest: 0 })
    redisConfigMockFns.mockGetRedisClient.mockReturnValue(notReady)
    try {
      await expect(readSoftGateUsageCost(payer, REPORTING)).resolves.toBe(5.75)
      expect(notReady.status).toBe('wait')

      await notReady.connect()
      await notReady.ping()
      expect(await redis.get(sharedKey(payer))).toBeNull()
    } finally {
      notReady.disconnect()
    }
  })

  it('sums the ledger promptly when a connected Redis stops answering', async () => {
    const sockets = new Set<Socket>()
    /** Completes the client's handshake, then never answers a read. */
    const silent = createServer((socket) => {
      sockets.add(socket)
      socket.on('data', (data) => {
        const text = data.toString()
        if (/\bGET\b/i.test(text)) return
        socket.write('+OK\r\n'.repeat(text.match(/^\*\d+\r\n/gm)?.length ?? 0))
      })
    })
    await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve))
    const { port } = silent.address() as AddressInfo
    const hung = new Redis({ host: '127.0.0.1', port, lazyConnect: true, enableReadyCheck: false })
    redisConfigMockFns.mockGetRedisClient.mockReturnValue(hung)
    try {
      await hung.connect()
      const startedAt = Date.now()
      await expect(readSoftGateUsageCost(payer, REPORTING)).resolves.toBe(5.75)
      expect(Date.now() - startedAt).toBeLessThan(2_000)
    } finally {
      hung.disconnect()
      for (const socket of sockets) socket.destroy()
      silent.close()
    }
  })
})
