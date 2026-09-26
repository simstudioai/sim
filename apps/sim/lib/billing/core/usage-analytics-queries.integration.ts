import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const { select } = vi.hoisted(() => ({ select: vi.fn() }))
const databaseUrl = readTestDatabaseUrl()

vi.mock('@sim/db', () => ({ dbReplica: { select } }))

import { usageLog } from '@sim/db/schema'
import {
  readUsageBreakdownOverTime,
  readUsageTimeSeries,
} from '@/lib/billing/core/usage-analytics-queries'

const schemaName = `usage_series_${generateId().replaceAll('-', '')}`
const connection = postgres(databaseUrl, {
  max: 1,
  prepare: false,
  connection: { search_path: schemaName, timezone: 'Pacific/Auckland' },
  onnotice: () => undefined,
})

beforeAll(async () => {
  await connection.unsafe(`CREATE SCHEMA "${schemaName}"`)
  await connection.unsafe(`
    CREATE TABLE usage_log (
      billing_entity_id text, created_at timestamp, cost numeric,
      source text DEFAULT 'workflow', category text DEFAULT 'fixed',
      description text DEFAULT 'run', metadata jsonb, user_id text DEFAULT 'u1'
    );
    INSERT INTO usage_log (billing_entity_id, created_at, cost) VALUES
      ('org', '2026-03-08 08:00:00+00', 0.1),
      ('org', '2026-03-09 06:59:59+00', 0.2),
      ('org', '2026-03-09 07:00:00+00', 0.4),
      ('other', '2026-03-09 07:00:00+00', 999);
    INSERT INTO usage_log
      (billing_entity_id, created_at, cost, source, category, description, metadata, user_id)
    VALUES
      ('models', '2026-03-09 07:30:00+00', 0.5, 'copilot', 'model', 'gpt-x',
        '{"inputTokens": 10, "outputTokens": 3}', 'u1'),
      ('models', '2026-03-09 08:00:00+00', 0.25, 'workflow', 'model', 'gpt-x',
        '{"inputTokens": 5}', 'u2'),
      ('models', '2026-03-09 09:00:00+00', 0, 'workflow', 'model_unbilled', 'claude-y',
        '{"inputTokens": 7, "outputTokens": 1}', 'u2'),
      ('models', '2026-03-09 09:30:00+00', 0.05, 'workflow', 'fixed', 'run', NULL, 'u2');
  `)
  const database = drizzle(connection)
  select.mockImplementation((fields) => database.select(fields))
})

afterAll(async () => {
  await connection.unsafe(`DROP SCHEMA "${schemaName}" CASCADE`)
  await connection.end()
})

describe('usage series SQL', () => {
  it('groups the viewer calendar across DST and preserves numeric event counts', async () => {
    const rows = await readUsageTimeSeries(
      [eq(usageLog.billingEntityId, 'org')],
      'day',
      'America/Los_Angeles'
    )
    expect(
      [...rows].sort((a, b) => String(a.bucketStart).localeCompare(String(b.bucketStart)))
    ).toEqual([
      { bucketStart: '2026-03-08T00:00:00', cost: '0.3', events: 2 },
      { bucketStart: '2026-03-09T00:00:00', cost: '0.4', events: 1 },
    ])
  })

  it('formats one monthly aggregate and returns no buckets for an empty scope', async () => {
    expect(
      await readUsageTimeSeries([eq(usageLog.billingEntityId, 'org')], 'month', 'UTC')
    ).toEqual([{ bucketStart: '2026-03-01T00:00:00', cost: '0.7', events: 3 }])
    expect(
      await readUsageTimeSeries([eq(usageLog.billingEntityId, 'empty')], 'day', 'UTC')
    ).toEqual([])
  })
})

describe('usage breakdown by hour SQL', () => {
  it('keys each group by the viewer’s local hour across DST', async () => {
    const hours = await readUsageBreakdownOverTime(
      [eq(usageLog.billingEntityId, 'org')],
      'member',
      'America/Los_Angeles',
      'hour'
    )
    expect(Object.fromEntries(hours)).toEqual({
      '2026-03-08T00': [{ key: 'u1', cost: 0.1, events: 1 }],
      '2026-03-08T23': [{ key: 'u1', cost: 0.2, events: 1 }],
      '2026-03-09T00': [{ key: 'u1', cost: 0.4, events: 1 }],
    })
  })

  it('narrows a model dimension to its category and sums its tokens', async () => {
    const scope = [eq(usageLog.billingEntityId, 'models')]
    expect(
      Object.fromEntries(await readUsageBreakdownOverTime(scope, 'model', 'UTC', 'hour'))
    ).toEqual({
      '2026-03-09T07': [{ key: 'gpt-x', cost: 0.5, events: 1, inputTokens: 10, outputTokens: 3 }],
      '2026-03-09T08': [{ key: 'gpt-x', cost: 0.25, events: 1, inputTokens: 5, outputTokens: 0 }],
    })
    expect(
      Object.fromEntries(await readUsageBreakdownOverTime(scope, 'byok', 'UTC', 'hour'))
    ).toEqual({
      '2026-03-09T09': [{ key: 'claude-y', cost: 0, events: 1, inputTokens: 7, outputTokens: 1 }],
    })
  })

  it('keeps unbilled groups, leaving the billed filter to the summed window', async () => {
    const hours = await readUsageBreakdownOverTime(
      [eq(usageLog.billingEntityId, 'models')],
      'source',
      'UTC',
      'hour'
    )
    expect(hours.get('2026-03-09T09')).toEqual([{ key: 'workflow', cost: 0.05, events: 2 }])
  })
})
