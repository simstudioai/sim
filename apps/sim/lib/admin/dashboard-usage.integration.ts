import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { generateId } from '@sim/utils/id'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const { select, transaction } = vi.hoisted(() => ({ select: vi.fn(), transaction: vi.fn() }))
const databaseUrl = readTestDatabaseUrl()
vi.mock('@sim/db', () => ({ db: { select, transaction } }))

import {
  organizationWindow,
  readDashboardHistoricalActorSpend,
  readDashboardLedgerSpend,
  readDashboardLedgerSpendByUser,
  readDashboardOrganizationWorkflowRuns,
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
      -- one run shared by two former actors
      ('u3', 'model', 'workflow', 0.1, 'organization', 'org-a', ${P}, 'e12', '2026-08-08'),
      ('u5', 'model', 'workflow', 0.1, 'organization', 'org-a', ${P}, 'e12', '2026-08-08'),

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
  transaction.mockImplementation((run, config) => database.transaction(run, config))
})

afterAll(async () => {
  await connection.unsafe(`DROP SCHEMA "${schemaName}" CASCADE`)
  await connection.end()
})

describe('dashboard ledger usage', () => {
  it('sums spend per entity over each period', async () => {
    const spend = await readDashboardLedgerSpend([
      organizationWindow('org-a', stampedPeriod),
      organizationWindow('org-b', reportingPeriod),
      organizationWindow('org-c', stampedPeriod),
      { entity: { type: 'user', id: 'p1' }, period: stampedPeriod },
    ])

    expect(Object.fromEntries(spend)).toEqual({ 'org-a': 3.58, 'org-b': 1.75, p1: 0.6 })
  })

  it('reads an entity once however many times it is asked for', async () => {
    const spend = await readDashboardLedgerSpend([
      organizationWindow('org-a', stampedPeriod),
      organizationWindow('org-a', stampedPeriod),
    ])
    expect(spend.get('org-a')).toBe(3.58)
  })

  it('splits spend by acting user', async () => {
    const spend = await readDashboardLedgerSpendByUser([
      organizationWindow('org-a', stampedPeriod),
      organizationWindow('org-b', reportingPeriod),
    ])

    expect(Object.fromEntries(spend.get('org-a') ?? [])).toEqual({
      u1: 1.51,
      u2: 0.37,
      u3: 1.1,
      u4: 0.2,
      u5: 0.4,
    })
    expect(Object.fromEntries(spend.get('org-b') ?? [])).toEqual({ u6: 1.75 })
  })

  it('narrows the per-user split to the requested users', async () => {
    const window = organizationWindow('org-a', stampedPeriod)

    const spend = await readDashboardLedgerSpendByUser([window], ['u2', 'u4'])
    expect(Object.fromEntries(spend.get('org-a') ?? [])).toEqual({ u2: 0.37, u4: 0.2 })
    expect((await readDashboardLedgerSpendByUser([window], [])).size).toBe(0)
  })

  it('counts distinct workflow runs in total, for each actor of a shared run, and once across former actors', async () => {
    const orgA = await readDashboardOrganizationWorkflowRuns('org-a', stampedPeriod)
    expect(orgA?.total).toBe(6)
    expect(Object.fromEntries(orgA?.byUser ?? [])).toEqual({ u1: 2, u2: 2, u3: 2, u5: 2 })
    expect(orgA?.formerActors).toBe(3)

    const orgB = await readDashboardOrganizationWorkflowRuns('org-b', reportingPeriod)
    expect(orgB?.total).toBe(3)
    expect(Object.fromEntries(orgB?.byUser ?? [])).toEqual({ u6: 3 })
    expect(orgB?.formerActors).toBe(3)

    const empty = await readDashboardOrganizationWorkflowRuns('org-c', stampedPeriod)
    expect(empty?.total).toBe(0)
    expect(empty?.byUser.size).toBe(0)
    expect(empty?.formerActors).toBe(0)
  })

  it('reports runs as unknown when the count outlasts its budget', async () => {
    const locker = postgres(databaseUrl, {
      max: 1,
      prepare: false,
      connection: { search_path: schemaName },
      onnotice: () => undefined,
    })
    let release: () => void = () => undefined
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    let markLocked: () => void = () => undefined
    const locked = new Promise<void>((resolve) => {
      markLocked = resolve
    })
    const holder = locker.begin(async (tx) => {
      await tx.unsafe('LOCK TABLE usage_log IN ACCESS EXCLUSIVE MODE')
      markLocked()
      await released
    })
    try {
      await locked
      expect(await readDashboardOrganizationWorkflowRuns('org-a', stampedPeriod)).toBeNull()
    } finally {
      release()
      await holder
      await locker.end()
    }
  }, 20_000)

  it('spends only for actors who are neither members nor collaborators of the organization', async () => {
    const spend = await readDashboardHistoricalActorSpend('org-a', stampedPeriod)
    expect(Object.fromEntries(spend)).toEqual({ u3: 1.1, u4: 0.2, u5: 0.4 })
  })
})
