/** @vitest-environment node */
import { generateId } from '@sim/utils/id'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const { databaseUrl, execute, select } = vi.hoisted(() => {
  const databaseUrl = process.env.BILLING_USAGE_TEST_DATABASE_URL
  if (databaseUrl && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(databaseUrl).hostname)) {
    throw new Error('Activity integration tests require a disposable local database')
  }
  return { databaseUrl, execute: vi.fn(), select: vi.fn() }
})

vi.unmock('drizzle-orm')
vi.unmock('@sim/db/schema')
vi.mock('@sim/db', () => ({ dbReplica: { execute, select } }))

import {
  readActivityBreakdown,
  readActivitySummary,
  readActivityWorkspace,
} from '@/lib/billing/core/organization-activity-queries'
import {
  resolveUsageAnalyticsWindow,
  usageBucketTimestamps,
} from '@/lib/billing/core/usage-analytics'

const schemaName = `activity_${generateId().replaceAll('-', '')}`
const connection = databaseUrl
  ? postgres(databaseUrl, {
      max: 1,
      prepare: false,
      fetch_types: false,
      connection: { search_path: schemaName, timezone: 'Pacific/Auckland' },
      onnotice: () => undefined,
    })
  : undefined
const database = connection ? drizzle(connection) : undefined
const scope = {
  organizationId: 'org',
  start: new Date('2026-03-08T08:00:00Z'),
  end: new Date('2026-03-10T07:00:00Z'),
}

beforeAll(async () => {
  if (!connection || !database) return
  await connection.unsafe(`CREATE SCHEMA "${schemaName}"`)
  await connection.unsafe(`
    CREATE TABLE workspace (id text PRIMARY KEY, name text, organization_id text);
    CREATE TABLE workflow (id text PRIMARY KEY, name text);
    CREATE TABLE "user" (id text PRIMARY KEY, name text);
    CREATE TABLE workflow_execution_logs (id text PRIMARY KEY, workspace_id text, workflow_id text,
      trigger text, started_at timestamp, status text, total_duration_ms integer);
    CREATE TABLE copilot_chats (id text PRIMARY KEY, workspace_id text, organization_id text);
    CREATE TABLE copilot_runs (id text PRIMARY KEY, chat_id text, execution_id text, user_id text, started_at timestamp);
    INSERT INTO workspace VALUES ('w1', 'Support', 'org'), ('w2', 'Sales', 'org'), ('foreign', 'Private', 'other');
    INSERT INTO workflow VALUES ('f1', 'Triage'), ('f2', 'Follow up');
    INSERT INTO "user" VALUES ('m1', 'Alex'), ('m2', 'Sam');
    INSERT INTO workflow_execution_logs VALUES
      ('l1', 'w1', 'f1', 'manual', '2026-03-08 08:00:00', 'completed', 1000),
      ('l2', 'w1', 'f1', 'api', '2026-03-09 06:59:59', 'failed', 3000),
      ('l3', 'w1', 'f1', 'schedule', '2026-03-09 07:00:00', 'paused', 999999),
      ('l4', 'w2', 'f2', 'api', '2026-03-09 10:00:00', 'cancelled', 999999),
      ('l5', 'w2', NULL, 'webhook', '2026-03-09 11:00:00', 'running', NULL),
      ('before', 'w1', 'f1', 'manual', '2026-03-08 07:59:59', 'failed', 999999),
      ('end', 'w1', 'f1', 'manual', '2026-03-10 07:00:00', 'failed', 999999),
      ('private', 'foreign', 'f1', 'manual', '2026-03-09 10:00:00', 'failed', 999999);
    INSERT INTO copilot_chats VALUES ('c1', 'w1', NULL), ('c2', NULL, 'org'),
      ('c3', 'foreign', NULL), ('personal', NULL, NULL);
    INSERT INTO copilot_runs VALUES
      ('r1', 'c1', 'e1', 'm1', '2026-03-08 08:00:00'),
      ('r2', 'c1', 'e1', 'm1', '2026-03-09 10:00:00'),
      ('r3', 'c2', 'e2', 'm1', '2026-03-09 10:00:00'),
      ('r4', 'c2', 'e3', 'm2', '2026-03-09 10:00:00'),
      ('r5', 'c1', 'old', 'm2', '2026-03-01 08:00:00'),
      ('r6', 'c1', 'old', 'm2', '2026-03-09 10:00:00'),
      ('r7', 'c3', 'foreign', 'm1', '2026-03-09 10:00:00'),
      ('r8', 'personal', 'personal', 'm1', '2026-03-09 10:00:00');
    INSERT INTO workspace VALUES ('edge1', 'First', 'edge'), ('edge2', 'Second', 'edge');
    INSERT INTO workflow_execution_logs VALUES
      ('edge0', 'edge1', 'f1', 'api', '2026-05-01 00:00:00', 'completed', 0),
      ('edge100', 'edge1', 'f1', 'api', '2026-05-02 00:00:00', 'completed', 100),
      ('edge300', 'edge2', 'f2', 'manual', '2026-05-02 00:00:00', 'completed', 300),
      ('negative', 'edge2', 'f2', 'manual', '2026-05-03 00:00:00', 'failed', -1),
      ('missing', 'edge2', 'f2', 'manual', '2026-05-03 00:00:00', 'completed', NULL);
    INSERT INTO copilot_chats VALUES ('edge-chat1', 'edge1', NULL),
      ('edge-chat2', 'edge2', NULL), ('edge-org-chat', NULL, 'edge');
    INSERT INTO copilot_runs VALUES
      ('edge-r1', 'edge-chat1', 'edge-e1', 'm1', '2026-05-01 00:00:00'),
      ('edge-r2', 'edge-chat2', 'edge-e2', 'm1', '2026-05-02 00:00:00'),
      ('edge-r3', 'edge-org-chat', 'edge-e3', 'm1', '2026-05-03 00:00:00');
  `)
  execute.mockImplementation((query) => database.execute(query))
  select.mockImplementation((fields) => database.select(fields))
})

afterAll(async () => {
  if (!connection) return
  await connection.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
  await connection.end()
})

describe.skipIf(!databaseUrl)('organization activity SQL', () => {
  it('isolates tenants and personal chats, deduplicates continuations, and excludes unfinished durations', async () => {
    const result = await readActivitySummary(scope, 'day', 'America/Los_Angeles')
    expect(result.totals).toEqual({
      workflowRuns: 5,
      completed: 1,
      failed: 1,
      chatRuns: 3,
      chatMembers: 2,
      failureRate: 0.5,
      averageDurationMs: 2000,
    })
    expect(result.series.toSorted((a, b) => a.timestamp.localeCompare(b.timestamp))).toEqual([
      { timestamp: '2026-03-08T00:00:00', workflowRuns: 2, chatRuns: 1, failed: 1 },
      { timestamp: '2026-03-09T00:00:00', workflowRuns: 3, chatRuns: 2, failed: 0 },
    ])
  })

  it('uses a half-open local calendar window across daylight saving time', () => {
    const window = resolveUsageAnalyticsWindow({
      preset: 'custom',
      customStart: new Date('2026-03-08'),
      customEnd: new Date('2026-03-09'),
      timezone: 'America/Los_Angeles',
      period: { start: scope.start, end: scope.end, source: 'stripe' },
    })
    expect(window).toEqual({ kind: 'range', from: scope.start, to: scope.end })
    expect(usageBucketTimestamps(window, 'day', 'America/Los_Angeles')).toEqual([
      '2026-03-08T00:00:00',
      '2026-03-09T00:00:00',
    ])
  })

  it('scopes workspace summaries and rejects foreign workspace lookups', async () => {
    const result = await readActivitySummary({ ...scope, workspaceId: 'w1' }, 'day', 'UTC')
    expect(result.totals).toMatchObject({ workflowRuns: 3, chatRuns: 1, chatMembers: 1 })
    expect(await readActivityWorkspace('org', 'foreign')).toBeNull()
    expect(await readActivityWorkspace('org', 'w1')).toEqual({ id: 'w1', name: 'Support' })
  })

  it('keeps missing terminal outcomes distinct from zero failure and ranks the complete population', async () => {
    const result = await readActivityBreakdown(scope, 'workspace', 'failures', 0)
    expect(result.rows[0]).toMatchObject({ id: 'w1', failed: 1, failureRate: 0.5 })
    expect(result.rows.find((row) => row.id === 'w2')).toMatchObject({
      failureRate: null,
      averageDurationMs: null,
    })
    expect(result.rows.find((row) => row.id === 'organization')).toMatchObject({ chatRuns: 2 })
    expect(result.rows.reduce((sum, row) => sum + row.workflowRuns, 0)).toBe(5)
    expect(result.rows.reduce((sum, row) => sum + row.chatRuns, 0)).toBe(3)
  })

  it('supports all grouping dimensions without attributing workflows to billed members', async () => {
    const members = await readActivityBreakdown(scope, 'member', 'runs', 0)
    expect(members.rows.map((row) => [row.id, row.chatRuns, row.workflowRuns])).toEqual([
      ['m1', 2, 0],
      ['m2', 1, 0],
    ])
    const workflows = await readActivityBreakdown(scope, 'workflow', 'duration', 0)
    expect(workflows.rows[0]).toMatchObject({ id: 'f1', averageDurationMs: 2000, workflowRuns: 3 })
    expect(workflows.rows.find((row) => row.id === 'deleted:w2')).toMatchObject({
      label: 'Deleted workflows',
    })
    const triggers = await readActivityBreakdown(scope, 'trigger', 'runs', 0)
    expect(triggers.rows[0]).toMatchObject({ id: 'api', workflowRuns: 2 })
  })

  it('paginates aggregated rows deterministically without losing tied rows', async () => {
    if (!connection) throw new Error('Missing fixture')
    await connection`INSERT INTO workflow_execution_logs
      SELECT 'page-' || i, 'w1', 'f1', 'trigger-' || lpad(i::text, 2, '0'),
        '2026-04-01'::timestamp, 'completed', 0 FROM generate_series(1, 27) i`
    const pageScope = { ...scope, start: new Date('2026-04-01'), end: new Date('2026-04-02') }
    const first = await readActivityBreakdown(pageScope, 'trigger', 'runs', 0)
    const second = await readActivityBreakdown(pageScope, 'trigger', 'runs', 1)
    expect(first.rows).toHaveLength(25)
    expect(first.hasMore).toBe(true)
    expect(second.rows).toHaveLength(2)
    expect(second.hasMore).toBe(false)
    expect(new Set([...first.rows, ...second.rows].map((row) => row.id)).size).toBe(27)
    expect(first.rows[0]).toMatchObject({ averageDurationMs: 0, failureRate: 0 })
  })

  it('returns true zeros and null rates for an empty organization', async () => {
    expect(
      (await readActivitySummary({ ...scope, organizationId: 'empty' }, 'day', 'UTC')).totals
    ).toEqual({
      workflowRuns: 0,
      completed: 0,
      failed: 0,
      chatRuns: 0,
      chatMembers: 0,
      failureRate: null,
      averageDurationMs: null,
    })
  })

  it('counts members across the whole period and weights durations by eligible runs', async () => {
    const edgeScope = {
      organizationId: 'edge',
      start: new Date('2026-05-01'),
      end: new Date('2026-05-04'),
    }
    const result = await readActivitySummary(edgeScope, 'day', 'UTC')
    expect(result.totals).toMatchObject({
      workflowRuns: 5,
      completed: 4,
      failed: 1,
      chatRuns: 3,
      chatMembers: 1,
      failureRate: 0.2,
    })
    expect(result.totals.averageDurationMs).toBeCloseTo(400 / 3)
    const breakdown = await readActivityBreakdown(edgeScope, 'workspace', 'duration', 0)
    expect(breakdown.rows.map((row) => [row.id, row.averageDurationMs, row.chatMembers])).toEqual([
      ['edge2', 300, 1],
      ['edge1', 50, 1],
      ['organization', null, 1],
    ])
  })

  it.each(['day', 'week', 'month'] as const)('preserves totals with %s buckets', async (bucket) => {
    const result = await readActivitySummary(scope, bucket, 'Pacific/Auckland')
    expect(result.totals).toMatchObject({ workflowRuns: 5, chatRuns: 3, chatMembers: 2 })
    expect(result.series.reduce((sum, point) => sum + point.workflowRuns, 0)).toBe(5)
    expect(result.series.reduce((sum, point) => sum + point.chatRuns, 0)).toBe(3)
  })

  it('returns workflow-only and chat-only periods without dropping either source', async () => {
    const workflowOnly = await readActivitySummary({ ...scope, workspaceId: 'w2' }, 'day', 'UTC')
    expect(workflowOnly.totals).toMatchObject({ workflowRuns: 2, chatRuns: 0, chatMembers: 0 })
    const chatOnly = await readActivitySummary(
      { ...scope, start: new Date('2026-03-01'), end: new Date('2026-03-02') },
      'day',
      'UTC'
    )
    expect(chatOnly.totals).toMatchObject({
      workflowRuns: 0,
      chatRuns: 1,
      chatMembers: 1,
      failureRate: null,
      averageDurationMs: null,
    })
  })
})
