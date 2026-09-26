/**
 * Uses a disposable schema in local PostgreSQL 15+. The paused callback models
 * a client that stops progressing after writing usage but before COMMIT; the
 * database must release its locks without waiting for that client to resume.
 */

import { createRequire } from 'node:module'
import type { db } from '@sim/db'
import * as schema from '@sim/db/schema'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { transaction } = vi.hoisted(() => ({ transaction: vi.fn() }))
const databaseUrl = readTestDatabaseUrl()

vi.mock('@sim/db', () => ({ db: { transaction }, dbReplica: {} }))
vi.mock('@/lib/billing/core/plan', () => ({ getHighestPrioritySubscription: vi.fn() }))
vi.mock('@/lib/billing/subscriptions/utils', () => ({ isOrgScopedSubscription: vi.fn() }))

import {
  CumulativeUsageContextMismatchError,
  getBillingPeriodUsageCost,
  getBillingPeriodUsageCostByUser,
  type RecordCumulativeUsageParams,
  recordCumulativeUsage,
} from '@/lib/billing/core/usage-log'

const require = createRequire(import.meta.url)
const commonJsPostgres = require('postgres') as typeof postgres

const schemaName = `billing_usage_${generateId().replaceAll('-', '')}`
const connection = postgres(databaseUrl, {
  max: 8,
  prepare: false,
  fetch_types: false,
  connection: { search_path: schemaName },
  onnotice: () => undefined,
})
const database = drizzle(connection, { schema }) as typeof db

type Transaction = Parameters<Parameters<(typeof database)['transaction']>[0]>[0]

function deferred() {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

interface PausedTransaction {
  reached: ReturnType<typeof deferred>
  release: ReturnType<typeof deferred>
  lockOnly: boolean
}

let nextPause: PausedTransaction | undefined
let holderTimeoutSetting = 'transaction_timeout'

function pauseNextTransaction(lockOnly = false): PausedTransaction {
  const pause = { reached: deferred(), release: deferred(), lockOnly }
  nextPause = pause
  return pause
}

function usage(cost: number, eventKey = 'update-cost:shared-request'): RecordCumulativeUsageParams {
  return {
    userId: 'actor',
    workspaceId: 'workspace',
    billingEntity: { type: 'organization', id: 'payer' },
    billingPeriod: {
      start: new Date('2026-09-01T00:00:00.000Z'),
      end: new Date('2026-10-01T00:00:00.000Z'),
    },
    source: 'workspace-chat',
    model: 'test-model',
    eventKey,
    cost,
    metadata: { inputTokens: 10, outputTokens: 5 },
  }
}

async function ledgerRows() {
  return connection<{ event_key: string; cost: string }[]>`
    select event_key, cost from usage_log order by event_key
  `
}

afterAll(async () => {
  nextPause?.release.resolve()
  await connection.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
  await connection.end()
})

describe('Cumulative billing with PostgreSQL', () => {
  beforeAll(async () => {
    const [version] = await connection`
        select current_setting('server_version_num')::integer as version,
          current_setting('transaction_timeout', true) is not null as has_transaction_timeout
      `
    expect(version.version).toBeGreaterThanOrEqual(150000)
    holderTimeoutSetting = version.has_transaction_timeout
      ? 'transaction_timeout'
      : 'idle_in_transaction_session_timeout'
    await connection.unsafe(`CREATE SCHEMA "${schemaName}"`)
    await connection.unsafe(`
      CREATE TABLE usage_log (
        id text PRIMARY KEY, user_id text NOT NULL, category text NOT NULL,
        source text NOT NULL, description text NOT NULL, metadata jsonb,
        cost numeric NOT NULL, event_key text, billing_entity_type text,
        billing_entity_id text, billing_period_start timestamp, billing_period_end timestamp,
        workspace_id text, workflow_id text, execution_id text,
        created_at timestamp NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX usage_log_event_key_unique ON usage_log(event_key)
      WHERE event_key IS NOT NULL;
      CREATE TABLE driver_probe (id text PRIMARY KEY)
    `)
    transaction.mockImplementation(async (callback: (tx: Transaction) => Promise<unknown>) => {
      const pause = nextPause
      nextPause = undefined
      return database.transaction(async (tx) => {
        const result = await callback(tx)
        if (pause) {
          if (pause.lockOnly) {
            /** Reproduce the old policy: lock_timeout does not expire an idle holder. */
            await tx.execute(sql`select set_config(${holderTimeoutSetting}, '0', true)`)
          }
          pause.reached.resolve()
          await pause.release.promise
        }
        return result
      })
    })
  })

  beforeEach(async () => {
    nextPause = undefined
    await connection`truncate usage_log`
  })

  it.each([
    { name: 'ESM', create: postgres },
    { name: 'CommonJS', create: commonJsPostgres },
  ])(
    'rejects resumed $name transaction queries after its connection is reused',
    async ({ create }) => {
      const pool = create(databaseUrl, {
        max: 1,
        prepare: false,
        fetch_types: false,
        connection: { search_path: schemaName },
      })
      const release = deferred()
      const resumed = deferred()
      let resumedError: unknown
      const holder = pool.begin(async (tx) => {
        await tx`select set_config(${holderTimeoutSetting}, '150ms', true)`
        await tx`select 1`
        await release.promise
        try {
          await tx`insert into driver_probe (id) values (${generateId()})`
        } catch (error) {
          resumedError = error
        } finally {
          resumed.resolve()
        }
      })
      try {
        await expect(holder).rejects.toMatchObject({ code: 'CONNECTION_CLOSED' })
        /** max: 1 forces the underlying connection object to serve a new session. */
        await pool`select 1`
        release.resolve()
        await resumed.promise
        expect(getPostgresErrorCode(resumedError)).toBe('CONNECTION_CLOSED')
        const [row] = await pool`select count(*)::integer as count from driver_probe`
        expect(row.count).toBe(0)
      } finally {
        release.resolve()
        await pool.end({ timeout: 0 })
      }
    }
  )

  it('reproduces a retry timing out behind an idle holder when only lock waits are bounded', async () => {
    const pause = pauseNextTransaction(true)
    const holder = recordCumulativeUsage(usage(0.4))
    try {
      await pause.reached.promise
      const failure = await recordCumulativeUsage(usage(0.8)).catch((error: unknown) => error)
      expect(getPostgresErrorCode(failure)).toBe('55P03')
      expect(await ledgerRows()).toEqual([])
    } finally {
      pause.release.resolve()
      await holder
    }
    expect(await ledgerRows()).toEqual([{ event_key: usage(0).eventKey, cost: '0.4' }])
  }, 10_000)

  it.each([0, 0.2])(
    'expires the idle holder, rolls back its write, and recovers exactly once (initial %s)',
    async (initial) => {
      if (initial > 0) await recordCumulativeUsage(usage(initial))
      const pause = pauseNextTransaction()
      const holder = recordCumulativeUsage(usage(0.4)).catch((error: unknown) => error)
      try {
        await pause.reached.promise
        const failure = await recordCumulativeUsage(usage(0.8)).catch((error: unknown) => error)
        expect(getPostgresErrorCode(failure)).toBe('55P03')
        const recovered = await recordCumulativeUsage(usage(0.8))
        expect(recovered.billed).toBe(true)
        expect(recovered.delta).toBeCloseTo(0.8 - initial, 9)
        expect(recovered.total).toBe(0.8)
        expect(await recordCumulativeUsage(usage(0.8))).toEqual({
          billed: false,
          delta: 0,
          total: 0.8,
        })
        expect(await recordCumulativeUsage(usage(0.3))).toEqual({
          billed: false,
          delta: 0,
          total: 0.8,
        })
        expect(await ledgerRows()).toEqual([{ event_key: usage(0).eventKey, cost: '0.8' }])
      } finally {
        pause.release.resolve()
      }
      expect(getPostgresErrorCode(await holder)).toBe('CONNECTION_CLOSED')
    },
    12_000
  )

  it('converges concurrent out-of-order callbacks and independent events to their exact totals', async () => {
    const costs = [0.4, 0.1, 0.8, 0.3, 0.8, 0.6]
    const results = await Promise.all(costs.map((cost) => recordCumulativeUsage(usage(cost))))
    expect(results.reduce((total, result) => total + result.delta, 0)).toBeCloseTo(0.8, 9)
    await Promise.all(
      Array.from({ length: 32 }, (_, index) =>
        recordCumulativeUsage(usage(0.25, `independent:${index}`))
      )
    )
    expect(await ledgerRows()).toHaveLength(33)
    expect(await recordCumulativeUsage(usage(0.8))).toEqual({ billed: false, delta: 0, total: 0.8 })
  })

  it('reads committed pooled and member charges freshly after concurrent executions', async () => {
    const { billingEntity, billingPeriod } = usage(0)
    if (!billingEntity || !billingPeriod) throw new Error('Billing fixture scope is missing')
    const readPool = () =>
      getBillingPeriodUsageCost(billingEntity, billingPeriod, undefined, database)
    expect(await readPool()).toBe(0)
    await Promise.all(
      Array.from({ length: 64 }, (_, index) =>
        recordCumulativeUsage({
          ...usage(0.005, `concurrent:${index}`),
          userId: `member-${index % 4}`,
        })
      )
    )
    expect(await readPool()).toBeCloseTo(0.32, 9)
    const members = await getBillingPeriodUsageCostByUser(
      billingEntity,
      billingPeriod,
      undefined,
      database
    )
    expect(members).toEqual(
      new Map(Array.from({ length: 4 }, (_, index) => [`member-${index}`, 0.08]))
    )
    await recordCumulativeUsage({ ...usage(0.105, 'concurrent:0'), userId: 'member-0' })
    expect(await readPool()).toBeCloseTo(0.42, 9)
    expect(
      await getBillingPeriodUsageCost(
        { type: 'organization', id: 'other-payer' },
        billingPeriod,
        undefined,
        database
      )
    ).toBe(0)
    expect(
      await getBillingPeriodUsageCost(
        billingEntity,
        {
          start: billingPeriod.end,
          end: new Date('2026-11-01T00:00:00.000Z'),
        },
        undefined,
        database
      )
    ).toBe(0)
  })

  it.each([0.2, 0.8])(
    'rejects an actor mismatch even for a non-increasing callback (%s)',
    async (cost) => {
      await recordCumulativeUsage(usage(0.8))
      await expect(
        recordCumulativeUsage({ ...usage(cost), userId: 'another-actor' })
      ).rejects.toBeInstanceOf(CumulativeUsageContextMismatchError)
      expect(await ledgerRows()).toEqual([{ event_key: usage(0).eventKey, cost: '0.8' }])
    }
  )
})
