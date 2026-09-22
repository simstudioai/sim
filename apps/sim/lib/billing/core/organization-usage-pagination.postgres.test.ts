/** @vitest-environment node */
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { databaseUrl, select } = vi.hoisted(() => {
  const databaseUrl = process.env.BILLING_USAGE_TEST_DATABASE_URL
  if (databaseUrl && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(databaseUrl).hostname)) {
    throw new Error('Usage integration tests require a disposable local database')
  }
  return { databaseUrl, select: vi.fn() }
})
vi.unmock('drizzle-orm')
vi.unmock('@sim/db/schema')
vi.mock('@sim/db', () => ({ db: { select }, dbReplica: { select } }))

import { usageLog } from '@sim/db/schema'
import { readUsageBreakdown } from '@/lib/billing/core/usage-analytics-queries'
import { getBillingEntityUsageLogs } from '@/lib/billing/core/usage-log'

const schemaName = `usage_pagination_${generateId().replaceAll('-', '')}`
const connection = databaseUrl
  ? postgres(databaseUrl, {
      max: 1,
      prepare: false,
      connection: { search_path: schemaName },
      onnotice: () => undefined,
    })
  : undefined

beforeAll(async () => {
  if (!connection) return
  await connection.unsafe(`CREATE SCHEMA "${schemaName}"`)
  await connection.unsafe(`CREATE TABLE usage_log (
    id text PRIMARY KEY, user_id text, category text, source text, description text,
    metadata jsonb, cost numeric, billing_entity_type text, billing_entity_id text,
    billing_period_start timestamp, billing_period_end timestamp, workspace_id text,
    workflow_id text, execution_id text, created_at timestamp NOT NULL
  ); CREATE TABLE workflow (id text PRIMARY KEY, name text);`)
  const database = drizzle(connection)
  select.mockImplementation((fields) => database.select(fields))
})
beforeEach(async () => {
  if (!connection) return
  await connection`TRUNCATE usage_log`
  await connection`INSERT INTO usage_log (id, user_id, category, source, description, cost,
      billing_entity_type, billing_entity_id, created_at)
    VALUES ('a', 'a', 'model', 'workspace-chat', 'Model', 0.1, 'organization', 'org', '2026-06-01 00:00:00.123999'),
      ('b', 'b', 'model', 'copilot', 'Model', 0.2, 'organization', 'org', '2026-06-01 00:00:00.123001'),
      ('c', 'c', 'model', 'workflow', 'Model', 0.3, 'organization', 'org', '2026-06-01 00:00:01'),
      ('x', 'x', 'model', 'workflow', 'Model', 999, 'organization', 'other', '2026-06-01 00:00:00.123500')`
})
afterAll(async () => {
  if (!connection) return
  await connection.unsafe(`DROP SCHEMA "${schemaName}" CASCADE`)
  await connection.end()
})

describe.skipIf(!databaseUrl)('organization usage pagination SQL', () => {
  it.each(['asc', 'desc'] as const)(
    'pages millisecond ties exactly once in %s order after the anchor is deleted',
    async (sortOrder) => {
      const options = { limit: 1, includeSummary: false, keyset: { sortOrder } }
      const first = await getBillingEntityUsageLogs({ type: 'organization', id: 'org' }, options)
      const seen = first.logs.map((row) => row.id)
      await connection!`DELETE FROM usage_log WHERE id = ${seen[0]}`
      let cursorKeys = first.pagination.nextCursorKeys
      while (cursorKeys) {
        const page = await getBillingEntityUsageLogs(
          { type: 'organization', id: 'org' },
          {
            ...options,
            keyset: { sortOrder, cursorKeys },
          }
        )
        seen.push(...page.logs.map((row) => row.id))
        cursorKeys = page.pagination.nextCursorKeys
      }
      expect(seen).toEqual(sortOrder === 'asc' ? ['a', 'b', 'c'] : ['c', 'b', 'a'])
    }
  )

  it('rejects malformed keysets before executing SQL', async () => {
    select.mockClear()
    await expect(
      getBillingEntityUsageLogs(
        { type: 'organization', id: 'org' },
        {
          includeSummary: false,
          keyset: { sortOrder: 'desc', cursorKeys: ['not-a-date', 'a'] },
        }
      )
    ).rejects.toMatchObject({ code: 'validation' })
    expect(select).not.toHaveBeenCalled()
  })

  it('caps grouped row materialization without changing legacy aggregate results', async () => {
    const scope = [eq(usageLog.billingEntityId, 'org')]
    expect(await readUsageBreakdown(scope, 'member', undefined, 1)).toHaveLength(2)
    const all = await readUsageBreakdown(scope, 'member')
    expect(all).toHaveLength(3)
    expect(all.reduce((total, row) => total + Number(row.cost), 0)).toBeCloseTo(0.6)
    expect(await readUsageBreakdown(scope, 'model', undefined, 1)).toEqual([
      { key: 'Model', cost: '0.6', events: 3, inputTokens: 0, outputTokens: 0 },
    ])
  })
})
