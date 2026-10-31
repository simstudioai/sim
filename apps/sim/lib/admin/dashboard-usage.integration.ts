import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { generateId } from '@sim/utils/id'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const { select } = vi.hoisted(() => ({ select: vi.fn() }))
const databaseUrl = readTestDatabaseUrl()
vi.mock('@sim/db', () => ({ db: { select } }))

import {
  type DashboardLedgerWindow,
  readDashboardHistoricalActorUsage,
  readDashboardLedgerUsage,
  readDashboardLedgerUsageByUser,
} from '@/lib/admin/dashboard-usage'
import type { ResolvedUsagePeriod } from '@/lib/billing/core/reporting-period'

const stampedPeriod: ResolvedUsagePeriod = {
  start: new Date('2026-08-01T00:00:00.000Z'),
  end: new Date('2026-09-01T00:00:00.000Z'),
  source: 'stripe',
  anchorDate: null,
  interval: 'month',
}
const reportingPeriod: ResolvedUsagePeriod = {
  start: new Date('2026-08-15T00:00:00.000Z'),
  end: new Date('2026-09-15T00:00:00.000Z'),
  source: 'reporting',
  anchorDate: '2026-01-15',
  interval: 'month',
}
const organizationWindow = (id: string, period: ResolvedUsagePeriod): DashboardLedgerWindow => ({
  entity: { type: 'organization', id },
  period,
})

const P = `'2026-08-01', '2026-09-01'`
const PREVIOUS = `'2026-07-01', '2026-08-01'`

const schemaName = `dashboard_usage_${generateId().replaceAll('-', '')}`
const connection = postgres(databaseUrl, {
  max: 1,
  prepare: false,
  connection: { search_path: schemaName },
  onnotice: () => undefined,
})

beforeAll(async () => {
  await connection.unsafe(`CREATE SCHEMA "${schemaName}"`)
  await connection.unsafe(`
    CREATE TABLE usage_log (
      id text PRIMARY KEY DEFAULT gen_random_uuid()::text, user_id text NOT NULL,
      category text NOT NULL DEFAULT 'model', source text NOT NULL, cost numeric NOT NULL,
      billing_entity_type text, billing_entity_id text, billing_period_start timestamp,
      billing_period_end timestamp, execution_id text, created_at timestamp NOT NULL
    );
    CREATE TABLE member (id text PRIMARY KEY, organization_id text, user_id text);
    CREATE TABLE workspace (id text PRIMARY KEY, organization_id text);
    CREATE TABLE permissions (id text PRIMARY KEY, entity_type text, entity_id text, user_id text);

    INSERT INTO member VALUES ('m1', 'org-a', 'u1');
    INSERT INTO workspace VALUES ('ws-a', 'org-a'), ('ws-other', 'org-other');
    INSERT INTO permissions VALUES ('p2', 'workspace', 'ws-a', 'u2'), ('p5', 'workspace', 'ws-other', 'u5');

    INSERT INTO usage_log (user_id, category, source, cost, billing_entity_type, billing_entity_id,
        billing_period_start, billing_period_end, execution_id, created_at) VALUES
      -- org-a, stamped period: e1 writes one row per charged line and boundary — one run.
      ('u1', 'model', 'workflow', 0.5, 'organization', 'org-a', ${P}, 'e1', '2026-08-02'),
      ('u1', 'tool', 'workflow', 0.25, 'organization', 'org-a', ${P}, 'e1', '2026-08-02'),
      ('u1', 'fixed', 'workflow', 0.01, 'organization', 'org-a', ${P}, 'e1', '2026-08-02'),
      -- resumed after the period ended, still stamped with the period it started in
      ('u1', 'model', 'workflow', 0.1, 'organization', 'org-a', ${P}, 'e1', '2026-09-02'),
      -- a free run is still a run
      ('u2', 'model_unbilled', 'workflow', 0, 'organization', 'org-a', ${P}, 'e2', '2026-08-03'),
      -- one run with rows from two actors
      ('u1', 'model', 'workflow', 0.2, 'organization', 'org-a', ${P}, 'e4', '2026-08-04'),
      ('u2', 'model', 'workflow', 0.3, 'organization', 'org-a', ${P}, 'e4', '2026-08-04'),
      -- spend that is not a workflow run
      ('u1', 'model', 'copilot', 0.4, 'organization', 'org-a', ${P}, NULL, '2026-08-05'),
      ('u1', 'model', 'workflow-test', 0.05, 'organization', 'org-a', ${P}, 'e9', '2026-08-05'),
      ('u2', 'fixed', 'workflow', 0.07, 'organization', 'org-a', ${P}, NULL, '2026-08-05'),
      -- the previous stamped period, though created inside this one
      ('u1', 'model', 'workflow', 8, 'organization', 'org-a', ${PREVIOUS}, 'e3', '2026-08-01'),
      -- billed to someone else
      ('u1', 'model', 'workflow', 9, 'user', 'org-a', ${P}, 'e3b', '2026-08-06'),
      ('u1', 'model', 'workflow', 9, NULL, NULL, NULL, NULL, 'e3c', '2026-08-06'),
      -- actors who are no longer members or collaborators of org-a
      ('u3', 'model', 'workflow', 0.9, 'organization', 'org-a', ${P}, 'e10', '2026-08-07'),
      ('u3', 'model', 'copilot', 0.1, 'organization', 'org-a', ${P}, NULL, '2026-08-07'),
      ('u4', 'model', 'copilot', 0.2, 'organization', 'org-a', ${P}, NULL, '2026-08-07'),
      ('u5', 'model', 'workflow', 0.3, 'organization', 'org-a', ${P}, 'e11', '2026-08-07'),

      -- org-b, reporting period: matched on created_at, start inclusive and end exclusive,
      -- whatever the rows are stamped with.
      ('u6', 'model', 'workflow', 1, 'organization', 'org-b', ${P}, 'e5', '2026-08-15 00:00:00'),
      ('u6', 'model', 'workflow', 0.5, 'organization', 'org-b', ${PREVIOUS}, 'e7', '2026-08-20'),
      ('u6', 'model', 'workflow', 2, 'organization', 'org-b', ${P}, 'e6', '2026-09-15 00:00:00'),
      ('u6', 'model', 'workflow', 4, 'organization', 'org-b', ${P}, 'e6b', '2026-08-14 23:59:59.999'),
      -- e1 also billed a line to org-b: each entity counts the run
      ('u6', 'model', 'workflow', 0.25, 'organization', 'org-b', ${P}, 'e1', '2026-08-16'),

      -- a personal payer
      ('p1', 'model', 'workflow', 0.3, 'user', 'p1', ${P}, 'e8', '2026-08-08'),
      ('p1', 'tool', 'workflow', 0.3, 'user', 'p1', ${P}, 'e8', '2026-08-08');
  `)
  const database = drizzle(connection)
  select.mockImplementation((fields) => database.select(fields))
})

afterAll(async () => {
  await connection.unsafe(`DROP SCHEMA "${schemaName}" CASCADE`)
  await connection.end()
})

describe('dashboard ledger usage', () => {
  it('sums spend and counts distinct workflow runs per entity over each period', async () => {
    const usage = await readDashboardLedgerUsage([
      organizationWindow('org-a', stampedPeriod),
      organizationWindow('org-b', reportingPeriod),
      organizationWindow('org-c', stampedPeriod),
      { entity: { type: 'user', id: 'p1' }, period: stampedPeriod },
    ])

    expect(Object.fromEntries(usage)).toEqual({
      'org-a': { cost: 3.38, workflowRuns: 5 },
      'org-b': { cost: 1.75, workflowRuns: 3 },
      p1: { cost: 0.6, workflowRuns: 1 },
    })
  })

  it('reads an entity once however many times it is asked for', async () => {
    const usage = await readDashboardLedgerUsage([
      organizationWindow('org-a', stampedPeriod),
      organizationWindow('org-a', stampedPeriod),
    ])
    expect(usage.get('org-a')).toEqual({ cost: 3.38, workflowRuns: 5 })
  })

  it('splits spend and runs by acting user, counting a shared run for each actor', async () => {
    const usage = await readDashboardLedgerUsageByUser([
      organizationWindow('org-a', stampedPeriod),
      organizationWindow('org-b', reportingPeriod),
    ])

    expect(Object.fromEntries(usage.get('org-a') ?? [])).toEqual({
      u1: { cost: 1.51, workflowRuns: 2 },
      u2: { cost: 0.37, workflowRuns: 2 },
      u3: { cost: 1, workflowRuns: 1 },
      u4: { cost: 0.2, workflowRuns: 0 },
      u5: { cost: 0.3, workflowRuns: 1 },
    })
    expect(Object.fromEntries(usage.get('org-b') ?? [])).toEqual({
      u6: { cost: 1.75, workflowRuns: 3 },
    })
  })

  it('narrows the per-user split to the requested users', async () => {
    const window = organizationWindow('org-a', stampedPeriod)

    const usage = await readDashboardLedgerUsageByUser([window], ['u2', 'u4'])
    expect(Object.fromEntries(usage.get('org-a') ?? [])).toEqual({
      u2: { cost: 0.37, workflowRuns: 2 },
      u4: { cost: 0.2, workflowRuns: 0 },
    })
    expect((await readDashboardLedgerUsageByUser([window], [])).size).toBe(0)
  })

  it('counts only actors who are neither members nor collaborators of the organization', async () => {
    expect(await readDashboardHistoricalActorUsage('org-a', stampedPeriod)).toEqual({
      usedDollars: 1.5,
      workflowRuns: 2,
      actorCount: 3,
    })
  })
})
