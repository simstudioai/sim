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
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { transaction } = vi.hoisted(() => ({ transaction: vi.fn() }))
const databaseUrl = readTestDatabaseUrl()

vi.mock('@sim/db', () => ({ db: { transaction }, dbReplica: {} }))
vi.mock('@/lib/billing/core/plan', () => ({ getHighestPrioritySubscription: vi.fn() }))
vi.mock('@/lib/billing/subscriptions/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/billing/subscriptions/utils')>()),
  isOrgScopedSubscription: vi.fn(),
}))

import {
  CumulativeUsageContextMismatchError,
  CumulativeUsagePeriodClosedError,
  getBillingPeriodUsageCost,
  getBillingPeriodUsageCostByUser,
  getStampedPeriodRangeUsageCostByUser,
  type RecordCumulativeUsageParams,
  recordCumulativeUsage,
} from '@/lib/billing/core/usage-log'
import { claimTerminalPeriod } from '@/lib/billing/cycle-close'

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
      CREATE TABLE driver_probe (id text PRIMARY KEY);
      CREATE TABLE subscription (
        id text PRIMARY KEY, period_start timestamp, period_end timestamp,
        last_closed_period_start timestamp
      )
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
    await connection`truncate subscription`
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
        expect(await recordCumulativeUsage(usage(0.8))).toMatchObject({
          billed: false,
          delta: 0,
          total: 0.8,
        })
        expect(await recordCumulativeUsage(usage(0.3))).toMatchObject({
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
    expect(await recordCumulativeUsage(usage(0.8))).toMatchObject({
      billed: false,
      delta: 0,
      total: 0.8,
    })
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

  it("counts a reporting run's top-ups after its window ends in that window, and a later run's charges in the next", async () => {
    const payer = { type: 'organization', id: 'payer' } as const
    const dayMs = 24 * 60 * 60 * 1000
    // A reporting window is summed by when each row was created; the stamped period only binds a
    // request's rows to each other.
    const stamp = {
      start: new Date('2026-01-01'),
      end: new Date('2027-01-01'),
      source: 'reporting' as const,
    }
    await recordCumulativeUsage({ ...usage(0.4, 'update-cost:long-run'), billingPeriod: stamp })
    const [first] = await database
      .select({ createdAt: schema.usageLog.createdAt })
      .from(schema.usageLog)
      .where(eq(schema.usageLog.eventKey, 'update-cost:long-run'))
    // The admitted window ends right after the run's first charge, and every later write starts
    // once the database clock has passed that boundary.
    const boundary = new Date(first.createdAt.getTime() + 1)
    for (;;) {
      const [{ passed }] = await connection<{ passed: boolean }[]>`
        select clock_timestamp()::timestamp > created_at + interval '1 millisecond' as passed
        from usage_log where event_key = 'update-cost:long-run'
      `
      if (passed) break
    }

    await recordCumulativeUsage({ ...usage(1, 'update-cost:long-run'), billingPeriod: stamp })
    await recordCumulativeUsage({ ...usage(0.25, 'update-cost:next-run'), billingPeriod: stamp })

    const windowTotal = (start: Date, end: Date) =>
      getBillingPeriodUsageCost(payer, { start, end, source: 'reporting' }, undefined, database)
    expect(await windowTotal(new Date(boundary.getTime() - 30 * dayMs), boundary)).toBeCloseTo(1, 9)
    expect(await windowTotal(boundary, new Date(boundary.getTime() + 30 * dayMs))).toBeCloseTo(
      0.25,
      9
    )
  })

  describe('a request that outlives its billing period', () => {
    // Past periods: the old period's row is written under the subscription lock only once
    // that period has ended.
    const periods = [
      new Date('2025-09-01T00:00:00.000Z'),
      new Date('2025-10-01T00:00:00.000Z'),
      new Date('2025-11-01T00:00:00.000Z'),
      new Date('2025-12-01T00:00:00.000Z'),
    ]
    const payer = { type: 'organization', id: 'payer' } as const

    /** Moves the subscription to a window whose predecessor the cycle close has settled. */
    async function setSubscriptionWindow(start: Date, end: Date) {
      await connection`
        insert into subscription (id, period_start, period_end, last_closed_period_start)
        values ('sub-1', ${start.toISOString()}::timestamptz at time zone 'UTC', ${end.toISOString()}::timestamptz at time zone 'UTC', ${start.toISOString()}::timestamptz at time zone 'UTC')
        on conflict (id) do update
          set period_start = excluded.period_start, period_end = excluded.period_end,
            last_closed_period_start = greatest(
              subscription.last_closed_period_start, excluded.last_closed_period_start
            )
      `
    }

    async function setSubscriptionPeriod(index: number) {
      await setSubscriptionWindow(periods[index], periods[index + 1])
    }

    function charge(cost: number, frozen = { start: periods[0], end: periods[1] }) {
      return recordCumulativeUsage({
        ...usage(cost),
        billingPeriod: frozen,
        payerSubscriptionId: 'sub-1',
      })
    }

    /** What the cycle close invoices for one period: the ledger rows stamped with it. */
    async function stampedWindowTotal(from: Date, to: Date) {
      const byUser = await getStampedPeriodRangeUsageCostByUser(
        payer,
        { from, to },
        undefined,
        database
      )
      return [...byUser.values()].reduce((total, cost) => total + cost, 0)
    }

    function stampedTotal(index: number) {
      return stampedWindowTotal(periods[index], periods[index + 1])
    }

    it('invoices a charge that spans a period close exactly once in total', async () => {
      await setSubscriptionPeriod(0)
      expect(await charge(0.4)).toMatchObject({ billed: true, total: 0.4 })

      await setSubscriptionPeriod(1)
      const closedTotal = await stampedTotal(0)
      expect(closedTotal).toBeCloseTo(0.4, 9)

      const afterClose = await charge(1)
      expect(afterClose).toMatchObject({ billed: true, total: 1 })
      expect(afterClose.billingPeriod).toEqual({ start: periods[1], end: periods[2] })
      expect(await charge(0.9)).toMatchObject({ billed: false, total: 1 })
      expect(await charge(1.3)).toMatchObject({ billed: true, total: 1.3 })
      expect(await charge(1.3)).toMatchObject({ billed: false, total: 1.3 })

      await setSubscriptionPeriod(2)
      expect(await charge(1.5)).toMatchObject({ billed: true, total: 1.5 })

      expect(await stampedTotal(0)).toBeCloseTo(closedTotal, 9)
      expect(await stampedTotal(1)).toBeCloseTo(0.9, 9)
      expect(await stampedTotal(2)).toBeCloseTo(0.2, 9)
      const invoiced = (await stampedTotal(0)) + (await stampedTotal(1)) + (await stampedTotal(2))
      expect(invoiced).toBeCloseTo(1.5, 9)
    })

    it('gives each period row only the tokens spent after the rows before it', async () => {
      await setSubscriptionPeriod(0)
      await recordCumulativeUsage({
        ...usage(0.4),
        billingPeriod: { start: periods[0], end: periods[1] },
        payerSubscriptionId: 'sub-1',
      })
      await setSubscriptionPeriod(1)
      await recordCumulativeUsage({
        ...usage(1),
        billingPeriod: { start: periods[0], end: periods[1] },
        payerSubscriptionId: 'sub-1',
        metadata: { inputTokens: 25, outputTokens: 12 },
      })

      const rows = await connection<{ event_key: string; metadata: Record<string, number> }[]>`
        select event_key, metadata from usage_log order by event_key
      `
      expect(rows.map((row) => [row.event_key, row.metadata])).toEqual([
        ['update-cost:shared-request', { inputTokens: 10, outputTokens: 5 }],
        ['update-cost:shared-request@1', { inputTokens: 15, outputTokens: 7 }],
      ])
    })

    it('never stamps a charge into a period earlier than its latest row', async () => {
      await setSubscriptionPeriod(0)
      await charge(0.4)
      await setSubscriptionPeriod(1)
      await charge(1)
      await setSubscriptionPeriod(0)
      expect(await charge(1.2)).toMatchObject({ billed: true, total: 1.2 })
      expect(await stampedTotal(0)).toBeCloseTo(0.4, 9)
      expect(await stampedTotal(1)).toBeCloseTo(0.8, 9)
    })

    it('stamps a first charge that lands after the close into the current period', async () => {
      await setSubscriptionPeriod(1)
      expect(await charge(0.7)).toMatchObject({ billed: true, total: 0.7 })
      expect(await charge(0.9)).toMatchObject({ billed: true, total: 0.9 })
      expect(await stampedTotal(0)).toBe(0)
      expect(await stampedTotal(1)).toBeCloseTo(0.9, 9)
    })

    it('holds the period advance until an in-flight top-up of the old period commits', async () => {
      await setSubscriptionPeriod(0)
      await charge(0.4)
      const pause = pauseNextTransaction()
      const inFlight = charge(0.6)
      try {
        await pause.reached.promise
        const advance = await connection
          .begin(async (tx) => {
            await tx`select set_config('lock_timeout', '300ms', true)`
            await tx`update subscription set period_start = ${periods[1].toISOString()}::timestamptz at time zone 'UTC' where id = 'sub-1'`
          })
          .catch((error: unknown) => error)
        expect(getPostgresErrorCode(advance)).toBe('55P03')
      } finally {
        pause.release.resolve()
        await inFlight
      }
      expect(await stampedTotal(0)).toBeCloseTo(0.6, 9)
    })

    it('rolls into a period whose start moved forward before the old period ended', async () => {
      await setSubscriptionPeriod(0)
      await charge(0.4)
      const resetStart = new Date('2025-09-15T00:00:00.000Z')
      const resetEnd = new Date('2025-10-15T00:00:00.000Z')
      await setSubscriptionWindow(resetStart, resetEnd)

      expect(await charge(1)).toMatchObject({
        billed: true,
        billingPeriod: { start: resetStart, end: resetEnd },
      })
      expect(await stampedTotal(0)).toBeCloseTo(0.4, 9)
      expect(await stampedWindowTotal(resetStart, resetEnd)).toBeCloseTo(0.6, 9)
    })

    it('keeps billing a request whose period start moved forward before its first charge', async () => {
      const resetStart = new Date('2025-09-15T00:00:00.000Z')
      const resetEnd = new Date('2025-10-15T00:00:00.000Z')
      await setSubscriptionWindow(resetStart, resetEnd)

      expect(await charge(0.4)).toMatchObject({ billed: true, total: 0.4 })
      expect(await charge(1)).toMatchObject({
        billed: true,
        total: 1,
        billingPeriod: { start: resetStart, end: resetEnd },
      })
      expect(await ledgerRows()).toEqual([{ event_key: usage(0).eventKey, cost: '1' }])
      expect(await stampedWindowTotal(resetStart, resetEnd)).toBeCloseTo(1, 9)
    })

    it('refuses a request admitted after the period its first charge was stamped with', async () => {
      await setSubscriptionPeriod(0)
      await charge(0.4)

      await expect(charge(1, { start: periods[1], end: periods[2] })).rejects.toMatchObject({
        name: CumulativeUsageContextMismatchError.name,
        mismatchedFields: ['billing period'],
      })
      expect(await ledgerRows()).toEqual([{ event_key: usage(0).eventKey, cost: '0.4' }])
    })

    it('refuses a charge that would roll into a period the terminal settlement already summed', async () => {
      await setSubscriptionPeriod(0)
      await charge(0.4)
      await setSubscriptionPeriod(1)
      await connection`
        update subscription
        set last_closed_period_start = ${periods[2].toISOString()}::timestamptz at time zone 'UTC'
      `

      await expect(charge(1)).rejects.toBeInstanceOf(CumulativeUsagePeriodClosedError)
      expect(await ledgerRows()).toEqual([{ event_key: usage(0).eventKey, cost: '0.4' }])
    })

    /**
     * Resolves true once a session waits on a row lock of the subscription table, or false once
     * `work` settles without anyone waiting, so a missing lock fails instead of hanging.
     */
    async function waitsOnSubscriptionRow(work: Promise<unknown>) {
      let settled = false
      work.then(
        () => {
          settled = true
        },
        () => {
          settled = true
        }
      )
      while (!settled) {
        const [row] = await connection<{ waiting: boolean }[]>`
          select exists (
            select 1 from pg_locks
            where locktype = 'tuple' and relation = 'subscription'::regclass
          ) as waiting
        `
        if (row.waiting) return true
        await sleep(10)
      }
      return false
    }

    it('makes the terminal claim wait for an in-flight charge, so the final sum includes it', async () => {
      await setSubscriptionPeriod(0)
      await charge(0.4)
      const pause = pauseNextTransaction()
      const inFlight = charge(0.6)
      let claim: Promise<unknown> = Promise.resolve()
      try {
        await pause.reached.promise
        claim = claimTerminalPeriod('sub-1')
        expect(await waitsOnSubscriptionRow(claim)).toBe(true)
      } finally {
        pause.release.resolve()
        await inFlight
        await claim
      }
      expect(await stampedTotal(0)).toBeCloseTo(0.6, 9)
      await expect(charge(0.8)).rejects.toBeInstanceOf(CumulativeUsagePeriodClosedError)
    })

    it('refuses a charge that waited on an in-flight terminal claim', async () => {
      await setSubscriptionPeriod(0)
      await charge(0.4)
      const pause = pauseNextTransaction()
      const claim = claimTerminalPeriod('sub-1')
      let late: Promise<unknown> = Promise.resolve()
      try {
        await pause.reached.promise
        late = charge(0.6)
        expect(await waitsOnSubscriptionRow(late)).toBe(true)
      } finally {
        pause.release.resolve()
        await claim
      }
      await expect(late).rejects.toBeInstanceOf(CumulativeUsagePeriodClosedError)
      expect(await stampedTotal(0)).toBeCloseTo(0.4, 9)
    })

    it('holds an early period-start move until an in-flight top-up commits', async () => {
      const start = new Date(Date.now() - 24 * 60 * 60 * 1000)
      const end = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      await setSubscriptionWindow(start, end)
      await charge(0.4, { start, end })
      const pause = pauseNextTransaction()
      const inFlight = charge(0.6, { start, end })
      try {
        await pause.reached.promise
        const reset = await connection
          .begin(async (tx) => {
            await tx`select set_config('lock_timeout', '300ms', true)`
            await tx`update subscription set period_start = now() at time zone 'UTC' where id = 'sub-1'`
          })
          .catch((error: unknown) => error)
        expect(getPostgresErrorCode(reset)).toBe('55P03')
      } finally {
        pause.release.resolve()
        await inFlight
      }
      expect(await stampedWindowTotal(start, end)).toBeCloseTo(0.6, 9)
    })
  })
})
