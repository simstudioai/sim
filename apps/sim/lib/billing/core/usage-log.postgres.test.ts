/**
 * @vitest-environment node
 *
 * Uses a disposable schema in local PostgreSQL 15+ selected through
 * BILLING_USAGE_TEST_DATABASE_URL. BILLING_USAGE_RUN_BENCHMARKS=1 also exercises
 * one million annual ledger rows and concurrent counter updates.
 *
 * The paused callback models a client that stops progressing after writing
 * usage but before COMMIT; the database must release its locks without waiting
 * for that client to resume, including locks on the derived cost projection.
 */
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { installUsageCostProjection } from '@sim/db/script-migrations/0017_backfill_usage_daily_cost'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { databaseUrl, runBenchmarks, transaction, select, execute } = vi.hoisted(() => {
  const databaseUrl = process.env.BILLING_USAGE_TEST_DATABASE_URL
  if (databaseUrl && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(databaseUrl).hostname)) {
    throw new Error('Billing usage integration tests require a disposable local database')
  }
  return {
    databaseUrl,
    runBenchmarks: process.env.BILLING_USAGE_RUN_BENCHMARKS === '1',
    transaction: vi.fn(),
    select: vi.fn(),
    execute: vi.fn(),
  }
})

vi.unmock('@sim/db/schema')
vi.unmock('drizzle-orm')
vi.mock('@sim/db', () => ({ db: { transaction, select, execute }, dbReplica: {} }))
vi.mock('@/lib/billing/core/billing', () => ({ getOrganizationSubscription: vi.fn() }))
vi.mock('@/lib/billing/core/plan', () => ({ getHighestPrioritySubscription: vi.fn() }))
vi.mock('@/lib/billing/subscriptions/utils', () => ({ isOrgScopedSubscription: vi.fn() }))

import {
  CumulativeUsageContextMismatchError,
  getBillingPeriodUsageCost,
  getBillingPeriodUsageCostByUser,
  getBillingPeriodUsageCostWithSourceSubset,
  getStampedPeriodRangeUsageCostByUser,
  type RecordCumulativeUsageParams,
  recordCumulativeUsage,
  type UsageQueryPeriod,
} from '@/lib/billing/core/usage-log'
import { getOrgMemberUsageForBillingPeriod } from '@/lib/billing/organizations/member-limits'

const require = createRequire(import.meta.url)
const commonJsPostgres = require('postgres') as typeof postgres

const schemaName = `billing_usage_${generateId().replaceAll('-', '')}`
const connection = databaseUrl
  ? postgres(databaseUrl, {
      max: 8,
      prepare: false,
      fetch_types: false,
      connection: { search_path: schemaName },
      onnotice: () => undefined,
    })
  : undefined
const database = connection ? drizzle(connection) : undefined

type Transaction = Parameters<Parameters<NonNullable<typeof database>['transaction']>[0]>[0]

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
  if (!connection) throw new Error('PostgreSQL fixture is unavailable')
  return connection<{ event_key: string; cost: string }[]>`
    select event_key, cost from usage_log order by event_key
  `
}

interface LedgerFixture {
  cost: string
  createdAt: string
  userId?: string
  source?: 'workspace-chat' | 'workflow' | 'knowledge-base'
  billingEntityId?: string | null
  periodStart?: string
  periodEnd?: string
  workspaceId?: string
}

async function insertLedgerFixtures(rows: readonly LedgerFixture[]): Promise<void> {
  if (!connection) throw new Error('PostgreSQL fixture is unavailable')
  await connection`
    INSERT INTO usage_log ${connection(
      rows.map((row) => ({
        id: generateId(),
        user_id: row.userId ?? 'actor',
        category: 'model',
        source: row.source ?? 'workspace-chat',
        description: 'fixture',
        cost: row.cost,
        created_at: row.createdAt,
        billing_entity_type: row.billingEntityId === null ? null : 'organization',
        billing_entity_id: row.billingEntityId === undefined ? 'payer' : row.billingEntityId,
        billing_period_start:
          row.billingEntityId === null ? null : (row.periodStart ?? '2026-09-01T00:00:00'),
        billing_period_end:
          row.billingEntityId === null ? null : (row.periodEnd ?? '2026-10-01T00:00:00'),
        workspace_id: row.workspaceId ?? 'workspace',
      }))
    )}
  `
}

async function assertProjectionMatchesLedger(): Promise<void> {
  if (!connection) throw new Error('PostgreSQL fixture is unavailable')
  const [row] = await connection`
    SELECT
      (SELECT COALESCE(SUM(cost), 0) FROM usage_log WHERE billing_entity_type IS NOT NULL)
      = (SELECT COALESCE(SUM(cost), 0) FROM usage_daily_cost) AS agrees,
      (SELECT COUNT(*)::integer FROM usage_log WHERE NOT cost_projected) AS uncovered
  `
  expect(row.agrees).toBe(true)
  expect(row.uncovered).toBe(0)
}

async function timed<T>(operation: () => Promise<T>): Promise<{ value: T; milliseconds: number }> {
  const startedAt = performance.now()
  const value = await operation()
  return { value, milliseconds: performance.now() - startedAt }
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)]
}

afterAll(async () => {
  nextPause?.release.resolve()
  if (connection) {
    await connection.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
    await connection.end()
  }
})

describe.skipIf(!databaseUrl)('Billing ledger and cost projection with PostgreSQL', () => {
  beforeAll(async () => {
    if (!connection || !database) throw new Error('PostgreSQL fixture is unavailable')
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
      CREATE TYPE billing_entity_type AS ENUM ('user', 'organization');
      CREATE TYPE usage_log_source AS ENUM ('workspace-chat', 'workflow', 'knowledge-base');
      CREATE TABLE usage_log (
        id text PRIMARY KEY, user_id text NOT NULL, category text NOT NULL,
        source usage_log_source NOT NULL, description text NOT NULL, metadata jsonb,
        cost numeric NOT NULL, event_key text, billing_entity_type billing_entity_type,
        billing_entity_id text, billing_period_start timestamp, billing_period_end timestamp,
        workspace_id text, workflow_id text, execution_id text,
        created_at timestamp NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX usage_log_event_key_unique ON usage_log(event_key)
      WHERE event_key IS NOT NULL;
      CREATE TABLE driver_probe (id text PRIMARY KEY);
      CREATE TABLE workspace (
        id text PRIMARY KEY, organization_id text, organization_assigned_at timestamp
      );
      CREATE INDEX usage_log_billing_period_cost_idx ON usage_log (
        billing_entity_type, billing_entity_id, billing_period_start, user_id,
        created_at, billing_period_end, source, cost
      ) WHERE billing_entity_type IS NOT NULL;
      CREATE INDEX usage_log_billing_entity_created_at_cost_idx ON usage_log (
        billing_entity_type, billing_entity_id, created_at, user_id, source, cost
      ) WHERE billing_entity_type IS NOT NULL
    `)
    const migration = await readFile(
      join(
        dirname(require.resolve('@sim/db/schema')),
        'migrations/0351_usage_cost_projection_and_search_lookup.sql'
      ),
      'utf8'
    )
    for (const statement of migration.split('--> statement-breakpoint')) {
      if (
        /CREATE TABLE(?: IF NOT EXISTS)? "usage_daily_cost"/.test(statement) ||
        /ALTER TABLE "usage_log" ADD COLUMN(?: IF NOT EXISTS)? "cost_projected"/.test(statement) ||
        /CREATE INDEX(?: IF NOT EXISTS)? "usage_daily_cost_entity_date_idx"/.test(statement)
      ) {
        await connection.unsafe(statement)
      }
    }
    await installUsageCostProjection(connection)
    select.mockImplementation(database.select.bind(database))
    execute.mockImplementation(database.execute.bind(database))
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
    if (!connection) throw new Error('PostgreSQL fixture is unavailable')
    await connection`truncate usage_log, workspace`
  })

  afterEach(assertProjectionMatchesLedger)

  it.each([
    { name: 'ESM', create: postgres },
    { name: 'CommonJS', create: commonJsPostgres },
  ])(
    'rejects resumed $name transaction queries after its connection is reused',
    async ({ create }) => {
      const pool = create(databaseUrl!, {
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

  it('preserves numeric costs, captured periods, source subsets, and actor filters', async () => {
    if (!database || !connection) throw new Error('PostgreSQL fixture is unavailable')
    await insertLedgerFixtures([
      { cost: '0.100000000000000001', createdAt: '2026-09-05T12:00:00' },
      { cost: '0.200000000000000002', createdAt: '2026-09-05T12:00:00' },
      { cost: '0.300000000000000003', createdAt: '2026-10-02T12:00:00', source: 'workflow' },
      { cost: '1.125', createdAt: '2026-09-06T12:00:00', userId: 'another-actor' },
      { cost: '100', createdAt: '2026-09-05T12:00:00', billingEntityId: 'other-payer' },
      {
        cost: '1000',
        createdAt: '2026-09-05T12:00:00',
        periodStart: '2026-08-01T00:00:00',
        periodEnd: '2026-09-01T00:00:00',
      },
    ])
    const [precision] = await connection`
      SELECT SUM(cost)::text AS exact
      FROM usage_daily_cost
      WHERE billing_entity_id = 'payer' AND user_id = 'actor'
        AND billing_period_start = '2026-09-01'
    `
    expect(precision.exact).toBe('0.600000000000000006')
    const { billingEntity, billingPeriod } = usage(0)
    expect(
      await getBillingPeriodUsageCost(billingEntity!, billingPeriod!, undefined, database)
    ).toBeCloseTo(1.725, 12)
    expect(
      await getBillingPeriodUsageCost(billingEntity!, billingPeriod!, 'workflow', database)
    ).toBeCloseTo(0.3, 12)
    expect(
      await getBillingPeriodUsageCostWithSourceSubset(
        billingEntity!,
        billingPeriod!,
        ['workspace-chat'],
        database
      )
    ).toEqual({ total: 1.725, subset: 1.425 })
    expect(
      await getBillingPeriodUsageCostByUser(billingEntity!, billingPeriod!, undefined, database, [
        'actor',
      ])
    ).toEqual(new Map([['actor', 0.6]]))
    expect(
      await getStampedPeriodRangeUsageCostByUser(
        billingEntity!,
        { from: billingPeriod!.start, to: billingPeriod!.end },
        ['workspace-chat', 'workflow'],
        database
      )
    ).toEqual(
      new Map([
        ['actor', 0.6],
        ['another-actor', 1.125],
      ])
    )
  })

  it.each([
    { start: '2026-09-02T00:00:00.000Z', end: '2026-09-04T00:00:00.000Z', total: 62 },
    { start: '2026-09-02T12:00:00.000Z', end: '2026-09-04T12:00:00.000Z', total: 124 },
    { start: '2026-09-02T12:00:00.000Z', end: '2026-09-02T18:00:00.000Z', total: 4 },
    { start: '2026-09-02T18:00:00.000Z', end: '2026-09-03T12:00:00.000Z', total: 24 },
    { start: '2026-09-02T00:00:00.000Z', end: '2026-09-02T00:00:00.001Z', total: 2 },
    { start: '2026-09-02T12:00:00.000Z', end: '2026-09-03T00:00:00.000Z', total: 12 },
  ])('matches exact half-open reporting range $start to $end', async ({ start, end, total }) => {
    if (!database || !connection) throw new Error('PostgreSQL fixture is unavailable')
    await insertLedgerFixtures([
      { cost: '1', createdAt: '2026-09-01T23:59:59.999999' },
      { cost: '2', createdAt: '2026-09-02T00:00:00' },
      { cost: '4', createdAt: '2026-09-02T12:00:00' },
      { cost: '8', createdAt: '2026-09-02T18:00:00' },
      { cost: '16', createdAt: '2026-09-03T00:00:00' },
      { cost: '32', createdAt: '2026-09-03T12:00:00', userId: 'another-actor' },
      { cost: '64', createdAt: '2026-09-04T00:00:00', source: 'workflow' },
      { cost: '128', createdAt: '2026-09-04T12:00:00' },
      { cost: '256', createdAt: '2026-09-04T12:00:00.000001' },
      { cost: '1000', createdAt: '2026-09-02T12:00:00', billingEntityId: 'other-payer' },
    ])
    const period: UsageQueryPeriod = {
      start: new Date(start),
      end: new Date(end),
      source: 'reporting',
    }
    const [baseline] = await connection`
      SELECT SUM(cost)::text AS cost FROM usage_log
      WHERE billing_entity_type = 'organization' AND billing_entity_id = 'payer'
        AND created_at >= ${start}::timestamp AND created_at < ${end}::timestamp
    `
    expect(Number(baseline.cost)).toBe(total)
    expect(
      await getBillingPeriodUsageCost(
        { type: 'organization', id: 'payer' },
        period,
        undefined,
        database
      )
    ).toBe(total)
    const actors = await getBillingPeriodUsageCostByUser(
      { type: 'organization', id: 'payer' },
      period,
      undefined,
      database
    )
    expect([...actors.values()].reduce((sum, cost) => sum + cost, 0)).toBe(total)
  })

  it('keeps reporting source and actor predicates on both raw boundaries and projected days', async () => {
    if (!database) throw new Error('PostgreSQL fixture is unavailable')
    await insertLedgerFixtures([
      { cost: '1', createdAt: '2026-09-02T13:00:00', source: 'workflow' },
      { cost: '2', createdAt: '2026-09-03T13:00:00', source: 'workflow' },
      { cost: '4', createdAt: '2026-09-04T01:00:00', source: 'workflow' },
      { cost: '8', createdAt: '2026-09-02T13:00:00', userId: 'another-actor', source: 'workflow' },
      { cost: '16', createdAt: '2026-09-03T13:00:00', source: 'workspace-chat' },
      { cost: '32', createdAt: '2026-09-04T01:00:00', userId: 'another-actor', source: 'workflow' },
    ])
    const entity = { type: 'organization', id: 'payer' } as const
    const period: UsageQueryPeriod = {
      start: new Date('2026-09-02T12:00:00Z'),
      end: new Date('2026-09-04T12:00:00Z'),
      source: 'reporting',
    }
    expect(await getBillingPeriodUsageCost(entity, period, 'workflow', database)).toBe(47)
    expect(
      await getBillingPeriodUsageCostWithSourceSubset(entity, period, ['workflow'], database)
    ).toEqual({ total: 63, subset: 47 })
    expect(
      await getBillingPeriodUsageCostByUser(entity, period, ['workflow'], database, ['actor'])
    ).toEqual(new Map([['actor', 7]]))
  })

  it('includes actors with zero-cost ledger rows and removes actors whose last row was deleted', async () => {
    if (!database || !connection) throw new Error('PostgreSQL fixture is unavailable')
    await insertLedgerFixtures([
      { cost: '0', createdAt: '2026-09-03T12:00:00', userId: 'zero-cost-actor' },
      { cost: '1', createdAt: '2026-09-03T12:00:00', userId: 'deleted-actor' },
    ])
    await connection`DELETE FROM usage_log WHERE user_id = 'deleted-actor'`
    const entity = { type: 'organization', id: 'payer' } as const
    const period = usage(0).billingPeriod!
    expect(await getBillingPeriodUsageCostByUser(entity, period, undefined, database)).toEqual(
      new Map([['zero-cost-actor', 0]])
    )
    expect(
      await getBillingPeriodUsageCostByUser(
        entity,
        { ...period, source: 'reporting' },
        undefined,
        database
      )
    ).toEqual(new Map([['zero-cost-actor', 0]]))
    expect(
      await getStampedPeriodRangeUsageCostByUser(
        entity,
        { from: period.start, to: period.end },
        undefined,
        database
      )
    ).toEqual(new Map([['zero-cost-actor', 0]]))
  })

  it('preserves the disjoint legacy workspace attribution used by member caps', async () => {
    if (!connection) throw new Error('PostgreSQL fixture is unavailable')
    await connection`
      INSERT INTO workspace (id, organization_id, organization_assigned_at)
      VALUES ('workspace', 'payer', '2026-09-02T12:00:00'),
        ('other-workspace', 'other-payer', NULL)
    `
    await insertLedgerFixtures([
      { cost: '1', createdAt: '2026-09-03T00:00:00' },
      { cost: '2', createdAt: '2026-09-03T00:00:00', billingEntityId: null },
      { cost: '4', createdAt: '2026-09-02T11:59:59.999999', billingEntityId: null },
      { cost: '8', createdAt: '2026-09-03T00:00:00', billingEntityId: 'other-payer' },
      {
        cost: '16',
        createdAt: '2026-09-03T00:00:00',
        billingEntityId: null,
        workspaceId: 'other-workspace',
      },
      { cost: '32', createdAt: '2026-09-03T00:00:00', userId: 'another-actor' },
      { cost: '64', createdAt: '2026-10-01T00:00:00', billingEntityId: null },
    ])
    const period = usage(0).billingPeriod!
    expect(await getOrgMemberUsageForBillingPeriod('payer', 'actor', period)).toBe(3)
    expect(
      await getOrgMemberUsageForBillingPeriod('payer', 'actor', { ...period, source: 'reporting' })
    ).toBe(1)
    await connection`UPDATE workspace SET organization_id = 'other-payer' WHERE id = 'workspace'`
    expect(await getOrgMemberUsageForBillingPeriod('payer', 'actor', period)).toBe(1)
  })

  it.skipIf(!runBenchmarks)(
    'benchmarks one million annual ledger rows against exact projected readers',
    async () => {
      if (!connection || !database) throw new Error('PostgreSQL fixture is unavailable')
      const loaded = await timed(async () => {
        for (let offset = 0; offset < 1_000_000; offset += 25_000) {
          await connection`
          INSERT INTO usage_log (
            id, user_id, category, source, description, cost,
            billing_entity_type, billing_entity_id, billing_period_start,
            billing_period_end, created_at
          )
          SELECT
            'benchmark:' || item, 'actor:' || (item % 12), 'model',
            (ARRAY['workspace-chat', 'workflow', 'knowledge-base']::usage_log_source[])[1 + ((item / 12) % 3)],
            'Annual billing fixture', (1 + item % 99)::numeric / 100000,
            'organization', 'benchmark-payer', '2026-01-01', '2027-01-01',
            timestamp '2026-01-01' + (item % 365) * interval '1 day'
              + (item % 86400) * interval '1 second'
          FROM generate_series(${offset + 1}::integer, ${offset + 25_000}::integer) AS item
        `
        }
      })
      await connection`VACUUM ANALYZE usage_log`
      await connection`VACUUM ANALYZE usage_daily_cost`
      const entity = { type: 'organization', id: 'benchmark-payer' } as const
      const period = {
        start: new Date('2026-01-01T00:00:00Z'),
        end: new Date('2027-01-01T00:00:00Z'),
      }
      const baseline = () => connection<{ cost: string }[]>`
      SELECT SUM(cost)::text AS cost FROM usage_log
      WHERE billing_entity_type = 'organization' AND billing_entity_id = 'benchmark-payer'
        AND billing_period_start = '2026-01-01' AND billing_period_end = '2027-01-01'
    `
      const expected = Number((await baseline())[0].cost)
      const samples: { ledger: number[]; stamped: number[]; reporting: number[] } = {
        ledger: [],
        stamped: [],
        reporting: [],
      }
      for (let repeat = 0; repeat < 7; repeat++) {
        const ledger = await timed(baseline)
        const stamped = await timed(() =>
          getBillingPeriodUsageCost(entity, period, undefined, database)
        )
        const reporting = await timed(() =>
          getBillingPeriodUsageCost(entity, { ...period, source: 'reporting' }, undefined, database)
        )
        expect(Number(ledger.value[0].cost)).toBe(expected)
        expect(stamped.value).toBe(expected)
        expect(reporting.value).toBe(expected)
        samples.ledger.push(ledger.milliseconds)
        samples.stamped.push(stamped.milliseconds)
        samples.reporting.push(reporting.milliseconds)
      }
      const [sizes] = await connection`
      SELECT
        (SELECT COUNT(*)::integer FROM usage_log) AS ledger_rows,
        (SELECT COUNT(*)::integer FROM usage_daily_cost) AS projected_rows,
        pg_total_relation_size('usage_log')::text AS ledger_bytes,
        pg_total_relation_size('usage_daily_cost')::text AS projected_bytes
    `
      expect(sizes.ledger_rows).toBe(1_000_000)
      expect(sizes.projected_rows).toBeLessThan(sizes.ledger_rows)
      process.stdout.write(
        `${JSON.stringify({
          benchmark: 'annual-billing-ledger',
          ...sizes,
          fixtureLoadMs: loaded.milliseconds,
          medianMs: {
            ledger: median(samples.ledger),
            stamped: median(samples.stamped),
            reporting: median(samples.reporting),
          },
          samples,
        })}\n`
      )
    },
    180_000
  )

  it.skipIf(!runBenchmarks)(
    'benchmarks eight concurrent writers against ledger-only and single-counter controls',
    async () => {
      if (!connection) throw new Error('PostgreSQL fixture is unavailable')
      const clients = 8
      const results: Array<{
        mode: string
        batchSize: number
        milliseconds: number
        rowsPerSecond: number
      }> = []
      const modes = ['ledger-only', 'shared', 'distributed'] as const
      for (const batchSize of [1, 16]) {
        const batches = batchSize === 1 ? 100 : 20
        const count = clients * batches * batchSize
        for (let repeat = 0; repeat < 3; repeat++) {
          const orderedModes = [...modes.slice(repeat), ...modes.slice(0, repeat)]
          for (const mode of orderedModes) {
            await connection`TRUNCATE usage_log`
            const ids = await connection<{ id: string }[]>`
        SELECT 'contention:' || item AS id
        FROM generate_series(1, ${count * 12}::integer) AS item
        WHERE ${mode} <> 'shared'
          OR get_byte(decode(md5('contention:' || item), 'hex'), 0) % 8 = 0
        LIMIT ${count}
      `
            expect(ids).toHaveLength(count)
            if (mode === 'ledger-only') await connection`ALTER TABLE usage_log DISABLE TRIGGER USER`
            try {
              const measured = await timed(() =>
                Promise.all(
                  Array.from({ length: clients }, async (_, worker) => {
                    for (let batch = 0; batch < batches; batch++) {
                      const offset = (worker * batches + batch) * batchSize
                      const rows = ids.slice(offset, offset + batchSize).map(({ id }) => ({
                        id,
                        user_id: 'contention-actor',
                        category: 'model',
                        source: 'workspace-chat',
                        description: 'Concurrent usage',
                        cost: '0.00000001',
                        billing_entity_type: 'organization',
                        billing_entity_id: 'contention-payer',
                        billing_period_start: '2026-09-01',
                        billing_period_end: '2026-10-01',
                        created_at: '2026-09-16T12:00:00',
                      }))
                      await connection`INSERT INTO usage_log ${connection(rows)}`
                    }
                  })
                )
              )
              const [counts] = await connection`
        SELECT (SELECT COUNT(*)::integer FROM usage_log) AS ledger_rows,
          (SELECT COUNT(*)::integer FROM usage_daily_cost) AS counters,
          (SELECT COALESCE(SUM(cost), 0)::text FROM usage_daily_cost) AS total
      `
              expect(counts.ledger_rows).toBe(count)
              expect(Number(counts.total)).toBeCloseTo(
                mode === 'ledger-only' ? 0 : count * 0.00000001,
                12
              )
              expect(counts.counters).toBe(mode === 'ledger-only' ? 0 : mode === 'shared' ? 1 : 8)
              if (mode !== 'ledger-only') await assertProjectionMatchesLedger()
              results.push({
                mode,
                batchSize,
                milliseconds: measured.milliseconds,
                rowsPerSecond: (count * 1000) / measured.milliseconds,
              })
            } finally {
              if (mode === 'ledger-only') {
                await connection`ALTER TABLE usage_log ENABLE TRIGGER USER`
                await connection`TRUNCATE usage_log`
              }
            }
          }
        }
      }
      process.stdout.write(
        `${JSON.stringify({
          benchmark: 'billing-counter-contention',
          clients,
          medians: [1, 16].flatMap((batchSize) =>
            modes.map((mode) => {
              const samples = results.filter(
                (sample) => sample.mode === mode && sample.batchSize === batchSize
              )
              return {
                batchSize,
                mode,
                milliseconds: median(samples.map((sample) => sample.milliseconds)),
                rowsPerSecond: median(samples.map((sample) => sample.rowsPerSecond)),
              }
            })
          ),
          samples: results,
        })}\n`
      )
    },
    60_000
  )
})
