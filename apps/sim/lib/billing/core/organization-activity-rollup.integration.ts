import * as schema from '@sim/db/schema'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { generateId } from '@sim/utils/id'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const databaseUrl = readTestDatabaseUrl()
const holder = vi.hoisted(() => ({ database: null as unknown as object }))

/** Every pool of the app is this test's connection, scoped to its own schema. */
vi.mock('@sim/db', () => {
  const pool = new Proxy(
    {},
    {
      get: (_target, key) => {
        const value = Reflect.get(holder.database, key)
        return typeof value === 'function' ? value.bind(holder.database) : value
      },
    }
  )
  return {
    db: pool,
    dbReplica: pool,
    dbFor: () => pool,
    runOutsideTransactionContext: <T>(work: () => T) => work(),
  }
})
vi.mock('@/lib/core/config/redis', () => ({ getRedisClient: () => null }))
/**
 * The legacy oracle is the uncached SQL (a cached settled day would hide the changes the
 * failure-mode cases make), so every segment misses and the window is read in one range, exactly
 * as a cold cache reads it. The rollup's chat days go through the same cold path.
 */
vi.mock('@/lib/billing/core/usage-segment-cache', () => ({
  readThroughSegments: async <T>({
    segments,
    fetchRange,
  }: {
    segments: { from: Date; to: Date }[]
    fetchRange: (from: Date, to: Date) => Promise<Map<string, T>>
  }): Promise<[string, T][]> => {
    const first = segments[0]
    const last = segments[segments.length - 1]
    if (!first || !last) return []
    const hours = await fetchRange(first.from, last.to)
    return [...hours].map(([hour, value]) => [hour.slice(0, 10), value])
  },
}))

import {
  type ActivityRollupPassOptions,
  markStaleHours,
  runActivityRollupPass,
} from '@/lib/billing/activity-rollup/pass'
import { ACTIVITY_ROLLUP_VERSION, readRollupState } from '@/lib/billing/activity-rollup/state'
import {
  ACTIVITY_DIMENSIONS,
  ACTIVITY_SORTS,
  type ActivityScope,
} from '@/lib/billing/core/organization-activity'
import {
  readActivityBreakdown,
  readActivityDays,
} from '@/lib/billing/core/organization-activity-queries'
import {
  planRollupRead,
  readRollupActivityBreakdown,
  readRollupActivityDays,
} from '@/lib/billing/core/organization-activity-rollup-queries'
import { summarizeActivityDays } from '@/lib/billing/core/organization-activity-summary'
import type { ResolvedUsagePeriod } from '@/lib/billing/core/reporting-period'
import {
  resolveUsageAnalyticsWindow,
  resolveUsageBucket,
  type UsageAnalyticsWindow,
  usageBucketTimestamps,
  usageWindowBounds,
} from '@/lib/billing/core/usage-analytics'
import { reopenExecutionLogForNextPause } from '@/lib/workflows/executor/reopen-execution-log'
import { runCleanupLogs } from '@/background/cleanup-logs'

const schemaName = `activity_rollup_${generateId().replaceAll('-', '')}`
const connection = postgres(databaseUrl, {
  max: 4,
  prepare: false,
  fetch_types: false,
  connection: { search_path: schemaName, timezone: 'Pacific/Auckland' },
  onnotice: () => undefined,
})
const database = drizzle(connection, { schema })
holder.database = database

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
/** Real time: the pass and the marks compare against the database clock. */
const NOW = new Date()
const NOW_HOUR = Math.floor(NOW.getTime() / HOUR) * HOUR

const TIMEZONES = [
  'UTC',
  'America/Los_Angeles',
  'Asia/Kolkata',
  'Asia/Kathmandu',
  'Australia/Lord_Howe',
  'Pacific/Chatham',
  'America/Santiago',
]
const STATUSES = ['pending', 'running', 'paused', 'redacting', 'completed', 'failed', 'cancelled']
const TRIGGERS = ['api', 'webhook', 'schedule', 'manual', 'chat', 'mcp']
const WORKSPACES = ['ws1', 'ws2', 'ws3', 'ws4', 'ws5', 'ws6']
/**
 * Each workflow runs in one workspace. The breakdown orders ties by label and id only, so a
 * workflow with runs in two workspaces has two rows the legacy read itself orders arbitrarily.
 */
const WORKFLOWS: Record<string, string[]> = {
  ws1: ['wf1', 'wf2'],
  ws2: ['wf3', 'wf8'],
  ws3: ['wf4'],
  ws4: ['wf5'],
  ws5: ['wf6'],
  ws6: ['wf7'],
}

/** Daylight-saving and offset changes in the matrix's zones, inside the seeded history. */
const TRANSITIONS = [
  '2025-11-02T09:00:00Z',
  '2026-03-08T10:00:00Z',
  '2026-11-01T09:00:00Z',
  '2025-10-04T16:00:00Z',
  '2026-04-04T16:00:00Z',
  '2025-10-04T15:30:00Z',
  '2026-04-04T15:00:00Z',
  '2025-09-27T14:00:00Z',
  '2026-04-04T14:00:00Z',
  '2025-09-07T04:00:00Z',
  '2026-04-05T03:00:00Z',
].map((iso) => new Date(iso).getTime())

/** Deterministic seeded PRNG (mulberry32). */
function random(seed: number) {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const next = random(24)
const pick = <T>(values: readonly T[]): T => values[Math.floor(next() * values.length)] as T

/** A `timestamp` literal with microseconds: `ms` plus `micro` (0-999). */
function stamp(ms: number, micro: number): string {
  const iso = new Date(ms).toISOString()
  return `${iso.slice(0, 10)} ${iso.slice(11, 23)}${String(micro).padStart(3, '0')}`
}

function seedLogs() {
  const hours = new Set<number>()
  for (let i = 0; i < 150; i++) hours.add(NOW_HOUR - Math.floor(1 + next() * 460 * 24) * HOUR)
  for (const transition of TRANSITIONS) {
    const hour = Math.floor(transition / HOUR) * HOUR
    for (const offset of [-2, -1, 0, 1, 2]) hours.add(hour + offset * HOUR)
  }
  for (let offset = 0; offset <= 12; offset++) hours.add(NOW_HOUR - offset * HOUR)
  const active = [...hours].filter((hour) => hour <= NOW_HOUR)
  const rows = []
  for (let i = 0; i < 2200; i++) {
    const hour = pick(active)
    const edge = next()
    const startedAt =
      edge < 0.15
        ? stamp(hour, 0)
        : edge < 0.3
          ? stamp(hour + HOUR - 1, 999)
          : stamp(hour + Math.floor(next() * HOUR), Math.floor(next() * 1000))
    if (hour === NOW_HOUR && new Date(`${startedAt.replace(' ', 'T')}Z`) > NOW) continue
    const status = pick(STATUSES)
    const duration = next()
    const workspaceId = pick(WORKSPACES)
    rows.push({
      id: `log-${i}`,
      workspace_id: workspaceId,
      workflow_id: next() < 0.1 ? null : pick(WORKFLOWS[workspaceId] ?? []),
      trigger: pick(TRIGGERS),
      status,
      started_at: startedAt,
      total_duration_ms:
        duration < 0.15
          ? null
          : duration < 0.2
            ? -1
            : duration < 0.25
              ? 0
              : Math.floor(next() * 2_000_000),
    })
  }
  return rows
}

async function insertLogs(rows: object[]) {
  await connection.unsafe(
    `INSERT INTO workflow_execution_logs (id, workspace_id, workflow_id, execution_id,
       state_snapshot_id, level, trigger, status, started_at, total_duration_ms, ended_at)
     SELECT r.id, r.workspace_id, r.workflow_id, r.id, 'snapshot', 'info', r.trigger, r.status,
       r.started_at, r.total_duration_ms, r.ended_at
     FROM jsonb_to_recordset($1::jsonb) AS r(id text, workspace_id text, workflow_id text,
       trigger text, status text, started_at timestamp, total_duration_ms integer,
       ended_at timestamp)`,
    [JSON.stringify(rows)]
  )
}

/**
 * Nothing writes while a test's pass runs, so the late-end scan needs no margin for commits still
 * in flight, and an end stamped now is consumed by the next pass, as one five minutes old is in
 * production.
 */
const PASS_OPTIONS: ActivityRollupPassOptions = {
  lateEndMarginMs: 0,
  budgetMs: 10 * 60 * 1000,
  backfillRowsPerSecond: 1e12,
  backfillMinGapMs: 0,
}

function runPass(now = NOW, options: Partial<ActivityRollupPassOptions> = {}) {
  return runActivityRollupPass({ ...PASS_OPTIONS, ...options, now: () => now })
}

/** An end stamped as writers stamp one. */
const SCANNABLE_END = `(now() AT TIME ZONE 'UTC')`

function stripePeriod(start: number, end: number): ResolvedUsagePeriod {
  return {
    start: new Date(start),
    end: new Date(end),
    source: 'stripe',
    anchorDate: null,
    interval: null,
  }
}

/** A billing period starting and ending mid-hour, as a Stripe period does. */
const period = (start: number, end: number): UsageAnalyticsWindow => ({
  kind: 'period',
  period: stripePeriod(start, end),
})

interface Case {
  name: string
  window: UsageAnalyticsWindow
  workspaceId?: string
  organizationId?: string
}

function cases(timezone: string): Case[] {
  const resolve = (preset: 'custom' | '7d' | '30d') =>
    resolveUsageAnalyticsWindow({
      preset,
      customStart: new Date(new Date(NOW.getTime() - 91 * DAY).toISOString().slice(0, 10)),
      customEnd: new Date(NOW.toISOString().slice(0, 10)),
      timezone,
      now: NOW,
      period: stripePeriod(NOW.getTime() - DAY, NOW.getTime()),
    })
  const custom = resolve('custom')
  const trailing = (preset: '7d' | '30d') => resolve(preset)
  return [
    { name: 'custom 92 days', window: custom },
    { name: 'trailing 7d', window: trailing('7d') },
    { name: 'trailing 30d', window: trailing('30d') },
    {
      name: 'mid-hour period',
      window: period(NOW.getTime() - 40 * DAY + 1_043_000, NOW.getTime() + 5 * DAY - 660_000),
    },
    {
      name: '120-day period (weeks)',
      window: period(NOW.getTime() - 120 * DAY + 420_000, NOW.getTime() + HOUR),
    },
    {
      name: '450-day period (months)',
      window: period(NOW.getTime() - 450 * DAY - 780_000, NOW.getTime() - 2 * DAY + 1_740_000),
    },
    { name: 'workspace custom 92 days', window: custom, workspaceId: 'ws2' },
    { name: 'other organization 30d', window: trailing('30d'), organizationId: 'org-b' },
  ]
}

/** The custom 92-day window in UTC, which reaches back past any partial coverage the cases set. */
function longWindow(): Case {
  const testCase = cases('UTC').find((candidate) => candidate.name === 'custom 92 days')
  if (!testCase) throw new Error('Missing the custom 92-day case')
  return testCase
}

function scopeOf(testCase: Case): ActivityScope {
  return {
    organizationId: testCase.organizationId ?? 'org-a',
    ...(testCase.workspaceId ? { workspaceId: testCase.workspaceId } : {}),
    ...usageWindowBounds(testCase.window),
  }
}

/** The rollup read, or the legacy read the use case falls back to when the rollup cannot serve. */
/**
 * Whether every compared read must come from the rollup. Off only in the cases that make the
 * rollup unusable on purpose, where the use case's fallback to the legacy read is what is checked.
 */
interface Expectation {
  served?: boolean
}

async function servedSummary(testCase: Case, timezone: string, { served = true }: Expectation) {
  const scope = scopeOf(testCase)
  const bucket = resolveUsageBucket(testCase.window)
  const timestamps = usageBucketTimestamps(testCase.window, bucket, timezone)
  const rollup = await readRollupActivityDays(scope, timezone)
  if (served) expect(rollup, `${testCase.name} in ${timezone} served`).not.toBeNull()
  const days = rollup ?? (await readActivityDays(scope, timezone))
  return summarizeActivityDays(days, timestamps, bucket)
}

async function legacySummary(testCase: Case, timezone: string) {
  const scope = scopeOf(testCase)
  const bucket = resolveUsageBucket(testCase.window)
  const timestamps = usageBucketTimestamps(testCase.window, bucket, timezone)
  return summarizeActivityDays(await readActivityDays(scope, timezone), timestamps, bucket)
}

async function expectSummariesMatch(timezones: string[], expectation: Expectation = {}) {
  for (const timezone of timezones) {
    for (const testCase of cases(timezone)) {
      expect(
        await servedSummary(testCase, timezone, expectation),
        `${testCase.name} in ${timezone}`
      ).toEqual(await legacySummary(testCase, timezone))
    }
  }
}

async function expectBreakdownsMatch(
  timezones: string[],
  { served: mustServe = true }: Expectation = {}
) {
  for (const timezone of timezones) {
    for (const testCase of cases(timezone)) {
      const scope = scopeOf(testCase)
      for (const dimension of ACTIVITY_DIMENSIONS) {
        for (const sort of ACTIVITY_SORTS) {
          for (let page = 0; ; page++) {
            const legacy = await readActivityBreakdown(scope, dimension, sort, page)
            const label = `${testCase.name} ${dimension}/${sort} page ${page} in ${timezone}`
            const rollup = await readRollupActivityBreakdown(scope, dimension, sort, page)
            if (mustServe) expect(rollup, `${label} served`).not.toBeNull()
            const served = rollup ?? legacy
            expect(
              served,
              `${testCase.name} ${dimension}/${sort} page ${page} in ${timezone}`
            ).toEqual(legacy)
            if (!legacy.hasMore) break
          }
        }
      }
    }
  }
}

async function expectEquivalent(
  timezones = ['UTC', 'Asia/Kathmandu'],
  expectation: Expectation = {}
) {
  await expectSummariesMatch(timezones, expectation)
  await expectBreakdownsMatch(timezones, expectation)
}

/** A seeded run every compared window sees: in the main organization, inside the last 60 days. */
async function oneLog(where: string) {
  const [row] = await connection.unsafe<{ id: string; execution_id: string }[]>(
    `SELECT id, execution_id FROM workflow_execution_logs
     WHERE ${where} AND workspace_id IN ('ws1', 'ws2')
       AND started_at > (now() AT TIME ZONE 'UTC') - interval '60 days'
     ORDER BY id LIMIT 1`
  )
  if (!row) throw new Error(`No seeded log matches ${where}`)
  return row
}

/**
 * Moves `fresh_through` back over the newest settled hour and drops its cells, so the next pass
 * finalizes it again. Returns that hour as a `timestamp` literal.
 */
async function reopenLastSettledHour(): Promise<string> {
  const [row] = await connection.unsafe<{ hour: string }[]>(`
    UPDATE activity_rollup_state SET fresh_through = fresh_through - interval '1 hour'
    RETURNING to_char(fresh_through, 'YYYY-MM-DD HH24:MI:SS') AS hour
  `)
  if (!row) throw new Error('No state')
  await connection.unsafe(
    `DELETE FROM workflow_activity_hourly WHERE bucket_start = $1::timestamp`,
    [row.hour]
  )
  return row.hour
}

/**
 * Puts `workflow_execution_logs` behind a view that runs `action` for every run of `hour` read by a
 * bounded hour read (the only statements bounded at 20s), until {@link ungateHour}.
 */
async function gateHour(hour: string, action: string): Promise<void> {
  await connection.unsafe(`
    ALTER TABLE workflow_execution_logs RENAME TO workflow_execution_logs_base;
    CREATE FUNCTION hour_gate(started timestamp) RETURNS boolean LANGUAGE plpgsql AS $$
    BEGIN
      IF current_setting('statement_timeout') = '20s'
        AND started >= '${hour}'::timestamp AND started < '${hour}'::timestamp + interval '1 hour' THEN
        ${action}
      END IF;
      RETURN true;
    END $$;
    CREATE VIEW workflow_execution_logs AS
      SELECT * FROM workflow_execution_logs_base WHERE hour_gate(started_at);
  `)
}

/** The backoff attempts recorded for `hour`, or null when it is not blocked. */
async function blockedAttempts(hour: string): Promise<number | null> {
  const [row] = await connection.unsafe<{ attempts: number }[]>(
    `SELECT attempts FROM activity_rollup_blocked WHERE bucket_start = $1::timestamp`,
    [hour]
  )
  return row?.attempts ?? null
}

async function ungateHour(): Promise<void> {
  await connection.unsafe(`
    DROP VIEW workflow_execution_logs;
    DROP FUNCTION hour_gate(timestamp);
    ALTER TABLE workflow_execution_logs_base RENAME TO workflow_execution_logs;
  `)
}

beforeAll(async () => {
  await connection.unsafe(`CREATE SCHEMA "${schemaName}"`)
  await connection.unsafe(`
    CREATE TABLE workspace (id text PRIMARY KEY, name text, organization_id text, archived_at timestamp);
    CREATE TABLE workflow (id text PRIMARY KEY, name text);
    CREATE TABLE "user" (id text PRIMARY KEY, name text, image text);
    CREATE TABLE copilot_chats (id text PRIMARY KEY, workspace_id text, organization_id text);
    CREATE TABLE copilot_runs (id text PRIMARY KEY, chat_id text, execution_id text, user_id text,
      started_at timestamp);
    CREATE TABLE paused_executions (LIKE public.paused_executions INCLUDING ALL);
    CREATE TABLE execution_large_values (LIKE public.execution_large_values INCLUDING ALL);
    CREATE TABLE execution_large_value_references
      (LIKE public.execution_large_value_references INCLUDING ALL);
    CREATE TABLE execution_large_value_dependencies
      (LIKE public.execution_large_value_dependencies INCLUDING ALL);
    CREATE TABLE memory (LIKE public.memory INCLUDING ALL);
    CREATE TABLE memory_artifact (LIKE public.memory_artifact INCLUDING ALL);
    CREATE TABLE job_execution_logs (LIKE public.job_execution_logs INCLUDING ALL);
    CREATE TABLE workspace_files (LIKE public.workspace_files INCLUDING ALL);
    CREATE TABLE workflow_execution_logs (LIKE public.workflow_execution_logs INCLUDING ALL);
    CREATE TABLE workflow_activity_hourly (LIKE public.workflow_activity_hourly INCLUDING ALL);
    CREATE TABLE activity_rollup_state (LIKE public.activity_rollup_state INCLUDING ALL);
    CREATE TABLE activity_rollup_dirty (LIKE public.activity_rollup_dirty INCLUDING ALL);
    CREATE TABLE activity_rollup_inflight (LIKE public.activity_rollup_inflight INCLUDING ALL);
    CREATE TABLE activity_rollup_blocked (LIKE public.activity_rollup_blocked INCLUDING ALL);
    INSERT INTO workspace VALUES ('ws1', 'Support', 'org-a', NULL), ('ws2', 'Sales', 'org-a', NULL),
      ('ws3', 'Ops', 'org-a', NULL), ('ws4', 'Archive', 'org-a', now()),
      ('ws5', 'Elsewhere', 'org-b', NULL), ('ws6', 'Private', 'org-foreign', NULL);
    INSERT INTO workflow SELECT 'wf' || i, CASE WHEN i % 3 = 0 THEN 'Same name' ELSE 'Flow ' || i END
      FROM generate_series(1, 8) i;
    INSERT INTO "user" VALUES ('m1', 'Alex', 'alex.png'), ('m2', 'Sam', NULL), ('m3', 'Alex', NULL);
    INSERT INTO copilot_chats VALUES ('c1', 'ws1', NULL), ('c2', 'ws2', NULL), ('c3', NULL, 'org-a'),
      ('c4', 'ws6', NULL), ('c5', 'ws5', NULL);
  `)
  const chatRuns = []
  for (let i = 0; i < 120; i++) {
    const startedAt = NOW_HOUR - Math.floor(next() * 200 * 24) * HOUR + Math.floor(next() * HOUR)
    chatRuns.push({
      id: `run-${i}`,
      chat_id: pick(['c1', 'c2', 'c3', 'c4', 'c5']),
      execution_id: `exec-${Math.floor(i / 2)}`,
      user_id: pick(['m1', 'm2', 'm3', 'gone']),
      started_at: stamp(startedAt, 0),
    })
  }
  await connection.unsafe(
    `INSERT INTO copilot_runs SELECT * FROM jsonb_to_recordset($1::jsonb)
       AS r(id text, chat_id text, execution_id text, user_id text, started_at timestamp)`,
    [JSON.stringify(chatRuns)]
  )
  await insertLogs(seedLogs())

  // The first pass starts the coverage ten hours back and backfills; the second catches up.
  expect((await runPass(new Date(NOW.getTime() - 10 * HOUR))).status).toBe('ran')
  expect((await runPass()).finalizedHours).toBe(10)
}, 300_000)

afterAll(async () => {
  await connection.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
  await connection.end()
})

describe('organization activity rollup', () => {
  it('backfills to the oldest run and keeps the newest hours live', async () => {
    const state = await readRollupState()
    expect(state?.backfillCompletedAt).not.toBeNull()
    expect(state?.freshThrough?.getTime()).toBe(NOW_HOUR - 3 * HOUR)
    const [oldest] = await connection.unsafe<{ hourMs: number }[]>(
      `SELECT (extract(epoch FROM date_trunc('hour', min(started_at))) * 1000)::float8 AS "hourMs"
       FROM workflow_execution_logs`
    )
    expect(state?.coverageStart?.getTime()).toBe(Number(oldest?.hourMs))
    const plan = planRollupRead(state, { from: new Date(NOW.getTime() - 30 * DAY), to: NOW }, NOW)
    expect(plan?.rollup).not.toBeNull()
    expect(plan?.live).toHaveLength(2)
  })

  it('reproduces every summary across time zones, windows, and bucket sizes', async () => {
    await expectSummariesMatch(TIMEZONES)
  }, 300_000)

  it('reproduces every breakdown page for every dimension and sort', async () => {
    await expectBreakdownsMatch(TIMEZONES)
  }, 600_000)

  it('names a workflow deleted after its cells were computed as deleted', async () => {
    await connection.unsafe(`
      DELETE FROM workflow WHERE id = 'wf3';
      UPDATE workflow_execution_logs SET workflow_id = NULL WHERE workflow_id = 'wf3';
    `)
    await expectEquivalent()
  }, 120_000)

  it('attributes a workspace to the organization it belongs to now', async () => {
    await connection.unsafe(`UPDATE workspace SET organization_id = 'org-b' WHERE id = 'ws3'`)
    await expectEquivalent()
  }, 120_000)

  it('recomputes the hours a retention delete removed runs from', async () => {
    await runCleanupLogs({
      workspaceIds: ['ws1', 'ws2'],
      retentionHours: 200 * 24,
      label: 'rollup-test',
      plan: 'pro',
      runGlobalHousekeeping: false,
    })
    const [{ remaining }] = await connection.unsafe<{ remaining: number }[]>(
      `SELECT count(*)::int AS remaining FROM workflow_execution_logs
       WHERE workspace_id IN ('ws1', 'ws2') AND started_at < (now() AT TIME ZONE 'UTC') - interval '200 days'`
    )
    expect(remaining).toBe(0)
    await runPass()
    await expectEquivalent()
  }, 120_000)

  it('picks up a late end of an old run', async () => {
    const run = await oneLog(
      `status = 'paused' AND started_at < (now() AT TIME ZONE 'UTC') - interval '3 days'`
    )
    await connection.unsafe(
      `UPDATE workflow_execution_logs SET status = 'completed', total_duration_ms = 4242,
         ended_at = ${SCANNABLE_END} WHERE id = $1`,
      [run.id]
    )
    await runPass()
    await expectEquivalent()
  }, 120_000)

  it('picks up a run inserted late into an hour already computed', async () => {
    await insertLogs([
      {
        id: 'late-insert',
        workspace_id: 'ws2',
        workflow_id: 'wf8',
        trigger: 'api',
        status: 'failed',
        started_at: stamp(NOW_HOUR - 20 * DAY + 1234, 5),
        total_duration_ms: 777,
        ended_at: stamp(Date.now(), 0),
      },
    ])
    await runPass()
    await expectEquivalent()
  }, 120_000)

  it('recomputes a reopened run, which has no end to find it by', async () => {
    const run = await oneLog(
      `status = 'completed' AND total_duration_ms > 0 AND workflow_id IS NOT NULL
       AND started_at < (now() AT TIME ZONE 'UTC') - interval '5 days'`
    )
    await database.transaction((tx) => reopenExecutionLogForNextPause(tx, run.execution_id))
    await runPass()
    await expectEquivalent()
  }, 120_000)

  it('rechecks an unfinished run that later finishes without a late end', async () => {
    const run = await oneLog(
      `status = 'running' AND started_at < (now() AT TIME ZONE 'UTC') - interval '3 days'`
    )
    // A completion written late but stamped with its real, early end.
    await connection.unsafe(
      `UPDATE workflow_execution_logs SET status = 'completed', total_duration_ms = 1800,
         ended_at = started_at + interval '30 minutes' WHERE id = $1`,
      [run.id]
    )
    await connection.unsafe(
      `UPDATE activity_rollup_inflight SET next_check_at = now() - interval '1 second'`
    )
    await runPass()
    await expectEquivalent()
  }, 120_000)

  it('runs one pass at a time and rewrites nothing when run again', async () => {
    const results = await Promise.all([runPass(), runPass()])
    expect(results.map((result) => result.status).sort()).toEqual(['leased', 'ran'])
    const before = await connection.unsafe(
      `SELECT * FROM workflow_activity_hourly ORDER BY 1, 2, 3, 4`
    )
    await runPass()
    expect(
      await connection.unsafe(`SELECT * FROM workflow_activity_hourly ORDER BY 1, 2, 3, 4`)
    ).toEqual(before)
  }, 120_000)

  it('serves the hours after fresh_through live', async () => {
    const freshThrough = NOW_HOUR - 5 * HOUR
    const at = new Date(freshThrough).toISOString()
    await connection`UPDATE activity_rollup_state SET fresh_through = ${at}::timestamptz AT TIME ZONE 'UTC'`
    await connection`DELETE FROM workflow_activity_hourly
      WHERE bucket_start >= ${at}::timestamptz AT TIME ZONE 'UTC'`
    expect(
      planRollupRead(
        await readRollupState(),
        { from: new Date(NOW.getTime() - 7 * DAY), to: NOW },
        NOW
      )?.rollup?.to.getTime()
    ).toBe(freshThrough)
    await expectEquivalent()
    expect((await runPass()).finalizedHours).toBe(2)
  }, 120_000)

  it('falls back to the source for a window reaching before an unfinished backfill', async () => {
    const coverageStart = NOW_HOUR - 60 * DAY
    const at = new Date(coverageStart).toISOString()
    await connection`UPDATE activity_rollup_state SET backfill_completed_at = NULL,
      coverage_start = ${at}::timestamptz AT TIME ZONE 'UTC'`
    await connection`DELETE FROM workflow_activity_hourly
      WHERE bucket_start < ${at}::timestamptz AT TIME ZONE 'UTC'`
    expect(await readRollupActivityDays(scopeOf(longWindow()), 'UTC')).toBeNull()
    await expectEquivalent(undefined, { served: false })
    await runPass()
    expect((await readRollupState())?.backfillCompletedAt).not.toBeNull()
    await expectEquivalent()
  }, 180_000)

  it('ignores cells of another version, and a newer pass rebuilds them', async () => {
    await connection.unsafe(
      `UPDATE activity_rollup_state SET version = ${ACTIVITY_ROLLUP_VERSION + 1};
       UPDATE workflow_activity_hourly SET runs = runs * 2, completed = completed + 1`
    )
    expect((await runPass()).status).toBe('newer-version')
    expect(await readRollupActivityDays(scopeOf(longWindow()), 'UTC')).toBeNull()
    await expectEquivalent(undefined, { served: false })
    await connection.unsafe(
      `UPDATE activity_rollup_state SET version = ${ACTIVITY_ROLLUP_VERSION - 1}`
    )
    const rebuilt = await runPass()
    expect(rebuilt.backfillComplete).toBe(true)
    await expectEquivalent()
  }, 300_000)

  it('leaves an hour to the next pass when its write fails after the replica read', async () => {
    await connection.unsafe(
      `UPDATE activity_rollup_state SET version = ${ACTIVITY_ROLLUP_VERSION - 1}`
    )
    const [{ hour }] = await connection.unsafe<{ hour: string }[]>(
      `SELECT to_char(h, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS hour FROM (
         SELECT DISTINCT date_trunc('hour', started_at) AS h FROM workflow_execution_logs
         WHERE started_at < (now() AT TIME ZONE 'UTC') - interval '30 days' ORDER BY 1 DESC OFFSET 3 LIMIT 1
       ) hours`
    )
    const failing = new Date(hour)
    await connection.unsafe(`
      CREATE FUNCTION fail_rollup_write() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Synthetic rollup write failure'; END $$;
      CREATE TRIGGER fail_rollup_write BEFORE INSERT ON workflow_activity_hourly
        FOR EACH ROW WHEN (NEW.bucket_start = '${failing.toISOString().replace('T', ' ').slice(0, 19)}')
        EXECUTE FUNCTION fail_rollup_write();
    `)
    await expect(runPass()).rejects.toThrow()
    const crashed = await readRollupState()
    expect(crashed?.coverageStart?.getTime()).toBeGreaterThan(failing.getTime())
    expect(crashed?.leaseOwner).toBeNull()
    await connection.unsafe(
      `DROP TRIGGER fail_rollup_write ON workflow_activity_hourly; DROP FUNCTION fail_rollup_write()`
    )
    expect((await runPass()).backfillComplete).toBe(true)
    await expectEquivalent()
  }, 300_000)
  it('rebuilds when the coverage is cleared by hand, even after a completed backfill', async () => {
    await connection.unsafe(`UPDATE activity_rollup_state SET coverage_start = NULL`)
    expect(await readRollupActivityDays(scopeOf(longWindow()), 'UTC')).toBeNull()
    const rebuilt = await runPass()
    expect(rebuilt).toMatchObject({ reset: 'coverage', backfillComplete: true })
    await expectEquivalent()
  }, 300_000)

  it('finds no stale hours in a workflow deleted after its cells were computed', async () => {
    await connection.unsafe(`
      DELETE FROM workflow WHERE id = 'wf1';
      UPDATE workflow_execution_logs SET workflow_id = NULL WHERE workflow_id = 'wf1';
    `)
    const state = await readRollupState()
    if (!state?.coverageStart || !state.freshThrough) throw new Error('No coverage')
    const covered = { from: state.coverageStart, to: state.freshThrough }
    expect(await markStaleHours('ws1', covered)).toBe(0)
  }, 300_000)

  it('leaves a stale hour already marked dirty to its pending recompute', async () => {
    const state = await readRollupState()
    if (!state?.coverageStart || !state.freshThrough) throw new Error('No coverage')
    const covered = { from: state.coverageStart, to: state.freshThrough }
    const [cell] = await connection.unsafe<{ hour: string }[]>(
      `UPDATE workflow_activity_hourly SET runs = runs + 1
       WHERE ctid = (SELECT ctid FROM workflow_activity_hourly WHERE workspace_id = 'ws2' LIMIT 1)
       RETURNING bucket_start::text AS hour`
    )
    if (!cell) throw new Error('No ws2 cell')
    await connection.unsafe(
      `INSERT INTO activity_rollup_dirty VALUES ('ws2', $1::timestamp, now() + interval '1 hour')`,
      [cell.hour]
    )
    expect(await markStaleHours('ws2', covered)).toBe(0)
    await connection.unsafe(`UPDATE activity_rollup_dirty SET due_at = now()`)
    await runPass()
    expect(await markStaleHours('ws2', covered)).toBe(0)
    await expectEquivalent()
  }, 300_000)

  it('marks every late end tied at a scan boundary when the scan catches up in batches', async () => {
    const state = await readRollupState()
    if (!state?.coverageStart) throw new Error('No coverage')
    const end = stamp(Date.now() - 10 * 60 * 1000, 123)
    await insertLogs(
      Array.from({ length: 7 }, (_, i) => ({
        id: `tied-${i}`,
        workspace_id: i % 2 ? 'ws1' : 'ws2',
        workflow_id: null,
        trigger: 'api',
        status: 'completed',
        started_at: stamp(NOW_HOUR - (20 + i) * DAY + 1000, i),
        total_duration_ms: 100 + i,
        ended_at: end,
      }))
    )
    await connection.unsafe(
      `UPDATE activity_rollup_state SET last_end_scan = $1::timestamp - interval '1 hour'`,
      [end]
    )
    await runPass(NOW, { lateEndBatchRows: 3 })
    await expectEquivalent()
  }, 300_000)

  it('stops marking during a maintenance gap and rebuilds when maintenance resumes', async () => {
    await connection.unsafe(
      `UPDATE activity_rollup_state SET maintained_at = now() - interval '7 hours'`
    )
    await connection.unsafe(`DELETE FROM activity_rollup_dirty`)
    await runCleanupLogs({
      workspaceIds: ['ws4'],
      retentionHours: 60 * 24,
      label: 'rollup-gap-test',
      plan: 'pro',
      runGlobalHousekeeping: false,
    })
    const [{ marks }] = await connection.unsafe<{ marks: number }[]>(
      `SELECT count(*)::int AS marks FROM activity_rollup_dirty`
    )
    expect(marks).toBe(0)
    expect((await runPass()).reset).toBe('maintenance-gap')
    await expectEquivalent()
  }, 300_000)

  it('still rebuilds after a gap when the pass that found it failed before its reset', async () => {
    await connection.unsafe(
      `UPDATE activity_rollup_state SET maintained_at = now() - interval '7 hours'`
    )
    await connection.unsafe(`
      CREATE FUNCTION fail_rollup_reset() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Synthetic reset failure'; END $$;
      CREATE TRIGGER fail_rollup_reset BEFORE DELETE ON activity_rollup_blocked
        FOR EACH STATEMENT EXECUTE FUNCTION fail_rollup_reset();
    `)
    try {
      await expect(runPass()).rejects.toThrow()
    } finally {
      await connection.unsafe(`
        DROP TRIGGER fail_rollup_reset ON activity_rollup_blocked;
        DROP FUNCTION fail_rollup_reset();
      `)
    }
    expect((await runPass()).reset).toBe('maintenance-gap')
    await expectEquivalent()
  }, 300_000)

  it('keeps the heartbeat through a failing step and counts the failures instead of rebuilding', async () => {
    const state = await readRollupState()
    if (!state?.freshThrough) throw new Error('No coverage')
    await connection`UPDATE activity_rollup_state SET maintained_at = now() - interval '5 hours'`
    await connection`INSERT INTO activity_rollup_dirty
      VALUES ('ws1', ${state.freshThrough.toISOString()}::timestamptz AT TIME ZONE 'UTC' - interval '1 hour', now())
      ON CONFLICT (workspace_id, bucket_start) DO UPDATE SET due_at = excluded.due_at`
    await connection.unsafe(`
      CREATE FUNCTION fail_mark_consume() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Synthetic step failure'; END $$;
      CREATE TRIGGER fail_mark_consume BEFORE DELETE ON activity_rollup_dirty
        FOR EACH STATEMENT EXECUTE FUNCTION fail_mark_consume();
    `)
    try {
      await expect(runPass()).rejects.toThrow()
      const failed = await readRollupState()
      expect(failed?.failedPasses).toBe(1)
      expect(Date.now() - (failed?.maintainedAt?.getTime() ?? 0)).toBeLessThan(60 * 1000)
    } finally {
      await connection.unsafe(`
        DROP TRIGGER fail_mark_consume ON activity_rollup_dirty;
        DROP FUNCTION fail_mark_consume();
      `)
    }
    await runPass()
    expect((await readRollupState())?.failedPasses).toBe(0)
    await expectEquivalent()
  }, 300_000)

  it('leaves an hour the pass ran out of budget paging for the next pass, without a backoff', async () => {
    const hour = await reopenLastSettledHour()
    // Every bounded hour read of that hour takes a second and then times out.
    await gateHour(
      hour,
      `PERFORM pg_sleep(1);
      RAISE EXCEPTION 'canceling statement due to statement timeout' USING ERRCODE = '57014';`
    )
    try {
      const deferred = await runPass(NOW, { budgetMs: 1500 })
      expect(deferred).toMatchObject({ finalizedHours: 0, blockedHours: 0 })
      expect(await blockedAttempts(hour)).toBe(0)
    } finally {
      await ungateHour()
    }
    expect(await runPass()).toMatchObject({ finalizedHours: 1, blockedHours: 0 })
    await expectEquivalent()
  }, 300_000)

  it('commits a retry backoff before the retry, so a retry that dies still backs off', async () => {
    const hour = await reopenLastSettledHour()
    await connection.unsafe(
      `INSERT INTO activity_rollup_blocked VALUES ($1::timestamp, 1, now())`,
      [hour]
    )
    await gateHour(hour, `RAISE EXCEPTION 'Synthetic connection loss';`)
    try {
      await expect(runPass()).rejects.toThrow()
    } finally {
      await ungateHour()
    }
    const [row] = await connection.unsafe<{ attempts: number; waiting: boolean }[]>(
      `SELECT attempts, retry_at > now() + interval '15 minutes' AS waiting
       FROM activity_rollup_blocked WHERE bucket_start = $1::timestamp`,
      [hour]
    )
    expect(row).toEqual({ attempts: 2, waiting: true })
    await connection.unsafe(`UPDATE activity_rollup_blocked SET retry_at = now()`)
    expect(await runPass()).toMatchObject({ finalizedHours: 1, blockedHours: 0 })
    await expectEquivalent()
  }, 300_000)

  it('backs off an hour too heavy to read and keeps the rest of the pass running', async () => {
    const [{ hour }] = await connection.unsafe<{ hour: string }[]>(
      `SELECT to_char(h, 'YYYY-MM-DD HH24:MI:SS') AS hour FROM (
         SELECT DISTINCT date_trunc('hour', started_at) AS h FROM workflow_execution_logs
         WHERE started_at < (now() AT TIME ZONE 'UTC') - interval '30 days'
         ORDER BY 1 DESC OFFSET 2 LIMIT 1
       ) hours`
    )
    await gateHour(
      hour,
      `RAISE EXCEPTION 'canceling statement due to statement timeout' USING ERRCODE = '57014';`
    )
    await connection.unsafe(
      `UPDATE activity_rollup_state SET version = ${ACTIVITY_ROLLUP_VERSION - 1}, housekeeping_at = NULL`
    )
    try {
      const blocked = await runPass()
      expect(blocked).toMatchObject({ status: 'ran', blockedHours: 1 })
      expect(await blockedAttempts(hour)).toBe(1)
      const state = await readRollupState()
      expect(state?.housekeepingAt).not.toBeNull()
      expect(state?.coverageStart?.getTime()).toBeGreaterThan(new Date(`${hour}Z`).getTime())

      expect((await runPass()).blockedHours).toBe(1)
      expect(await blockedAttempts(hour)).toBe(1)
    } finally {
      await ungateHour()
    }
    await connection.unsafe(`UPDATE activity_rollup_blocked SET retry_at = now()`)
    const recovered = await runPass()
    expect(recovered).toMatchObject({ blockedHours: 0, backfillComplete: true })
    expect(await blockedAttempts(hour)).toBeNull()
    await expectEquivalent()
  }, 300_000)
})
