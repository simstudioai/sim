/** @vitest-environment node */
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const { databaseUrl, select } = vi.hoisted(() => {
  const databaseUrl = process.env.BILLING_USAGE_TEST_DATABASE_URL
  if (databaseUrl && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(databaseUrl).hostname)) {
    throw new Error('Usage integration tests require a disposable local database')
  }
  return { databaseUrl, select: vi.fn() }
})

vi.unmock('drizzle-orm')
vi.unmock('@sim/db/schema')
vi.mock('@sim/db', () => ({ dbReplica: { select } }))

import { usageLog } from '@sim/db/schema'
import { readUsageTimeSeries } from '@/lib/billing/core/usage-analytics-queries'

const schemaName = `usage_series_${generateId().replaceAll('-', '')}`
const connection = databaseUrl
  ? postgres(databaseUrl, {
      max: 1,
      prepare: false,
      connection: { search_path: schemaName, timezone: 'Pacific/Auckland' },
      onnotice: () => undefined,
    })
  : undefined

beforeAll(async () => {
  if (!connection) return
  await connection.unsafe(`CREATE SCHEMA "${schemaName}"`)
  await connection.unsafe(`
    CREATE TABLE usage_log (billing_entity_id text, created_at timestamp, cost numeric);
    INSERT INTO usage_log VALUES
      ('org', '2026-03-08 08:00:00+00', 0.1),
      ('org', '2026-03-09 06:59:59+00', 0.2),
      ('org', '2026-03-09 07:00:00+00', 0.4),
      ('other', '2026-03-09 07:00:00+00', 999);
  `)
  const database = drizzle(connection)
  select.mockImplementation((fields) => database.select(fields))
})

afterAll(async () => {
  if (!connection) return
  await connection.unsafe(`DROP SCHEMA "${schemaName}" CASCADE`)
  await connection.end()
})

describe.skipIf(!databaseUrl)('usage series SQL', () => {
  it('groups the viewer calendar across DST and preserves numeric event counts', async () => {
    const rows = await readUsageTimeSeries(
      [eq(usageLog.billingEntityId, 'org')],
      'day',
      'America/Los_Angeles'
    )
    expect(
      rows.toSorted((a, b) => String(a.bucketStart).localeCompare(String(b.bucketStart)))
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
