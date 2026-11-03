/**
 * The plans the Workspaces drill-down reads get in PostgreSQL, proven on the exact SQL the
 * analytics queries send: every read narrowed to one workspace over a `created_at` window is an
 * index-only scan of `usage_log_workspace_created_at_cost_idx`, bounded by that workspace's rows
 * in the window, whether the workspace holds a sliver of its organization's usage or nearly all
 * of it. Every other index leaves the workspace or the entity to a heap fetch per matched row.
 */
import { db } from '@sim/db'
import { usageLog, user, workflow, workspace } from '@sim/db/schema'
import { explainCaptured, type PlanNode } from '@sim/db/testing/explain'
import { assertDisposableTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { generateId } from '@sim/utils/id'
import { eq, inArray, type SQL, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildUsageAnalyticsScope } from '@/lib/billing/core/usage-analytics'
import {
  readUsageBreakdown,
  readUsageBreakdownOverTime,
  readUsageTimeSeries,
  readUsageTotals,
} from '@/lib/billing/core/usage-analytics-queries'

const COVERING_INDEX = 'usage_log_workspace_created_at_cost_idx'

const member = generateId()
const organization = { type: 'organization', id: `org-${generateId()}` } as const
const otherOrganization = `org-${generateId()}`
const workspaces = { dominant: generateId(), minor: generateId(), other: generateId() }
const workflowIds = [generateId(), generateId(), generateId()]
const anchor = new Date('2026-06-01T00:00:00Z')
const window = {
  kind: 'range',
  from: new Date(anchor.getTime() - 30 * 24 * 60 * 60 * 1000),
  to: anchor,
} as const

/**
 * Ledger rows a minute apart over sixty days. The organization's rows go mostly to the dominant
 * workspace and an eighth to the minor one, and an unrelated organization's workspace holds as
 * many again, so a scan bounded by the organization or by the whole window is never the cheap
 * one. The minor workspace also carries rows billed to its creator before it joined the
 * organization, which the drill-down must skip.
 */
async function seedLedger() {
  await db.execute(sql`
    INSERT INTO ${usageLog} (id, user_id, category, source, description, cost,
      billing_entity_type, billing_entity_id, billing_period_start, billing_period_end,
      workspace_id, workflow_id, created_at)
    SELECT 'ul_plan_' || n || '_' || ${member}, ${member}, 'fixed',
      (ARRAY['workflow', 'copilot', 'wand']::usage_log_source[])[1 + n % 3], 'run', 0.01,
      CASE WHEN n % 16 = 15 THEN 'user' ELSE 'organization' END::billing_entity_type,
      CASE WHEN n % 16 = 15 THEN ${member} WHEN n % 2 = 0 THEN ${otherOrganization}
        ELSE ${organization.id} END,
      timestamp '2026-03-01', timestamp '2026-07-01',
      CASE WHEN n % 2 = 0 THEN ${workspaces.other} WHEN n % 16 IN (7, 15) THEN ${workspaces.minor}
        ELSE ${workspaces.dominant} END,
      CASE WHEN n % 2 = 1 AND n % 5 < 3 THEN (ARRAY[${workflowIds[0]}, ${workflowIds[1]},
        ${workflowIds[2]}])[1 + n % 3] END,
      ${anchor.toISOString()}::timestamp - n * interval '1 minute'
    FROM generate_series(1, 86400) AS n`)
  await db.execute(sql`VACUUM ANALYZE ${usageLog}`)
}

const coveringScan = (nodes: PlanNode[]) =>
  nodes.find((node) => node['Index Name'] === COVERING_INDEX)

describe('Workspaces drill-down plans in PostgreSQL', () => {
  beforeAll(async () => {
    assertDisposableTestDatabaseUrl(process.env.DATABASE_URL ?? '')
    const now = new Date()
    await db.insert(user).values({
      id: member,
      name: 'Plan fixture',
      email: `${member}@fixture.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    await insertWorkspaceFixture(
      db,
      Object.values(workspaces).map((id) => ({
        id,
        name: 'Plan fixture',
        ownerId: member,
        billedAccountUserId: member,
      }))
    )
    await db.insert(workflow).values(
      workflowIds.map((id, index) => ({
        id,
        userId: member,
        workspaceId: workspaces.dominant,
        name: `Plan fixture ${index}`,
        lastSynced: now,
        createdAt: now,
        updatedAt: now,
      }))
    )
    await seedLedger()
  })

  afterAll(async () => {
    await db.delete(usageLog).where(eq(usageLog.userId, member))
    await deleteWorkspaceFixture(db, inArray(workspace.id, Object.values(workspaces)))
    await db.delete(user).where(eq(user.id, member))
  })

  const reads: [string, (scope: SQL[]) => Promise<unknown>][] = [
    ['total', (scope) => readUsageTotals(scope)],
    ['time series', (scope) => readUsageTimeSeries(scope, 'day', 'America/Los_Angeles')],
    [
      'source series',
      (scope) => readUsageBreakdownOverTime(scope, 'source', 'America/Los_Angeles', 'hour'),
    ],
    [
      'member series',
      (scope) => readUsageBreakdownOverTime(scope, 'member', 'America/Los_Angeles', 'hour'),
    ],
    ['workflow ranking', (scope) => readUsageBreakdown(scope, 'workflow')],
  ]

  it.each(
    (['dominant', 'minor'] as const).flatMap((share) =>
      reads.map(([label, read]) => ({ label, share, read }))
    )
  )(
    'reads the $label of the $share workspace index-only from its rows in the window',
    async ({ share, read }) => {
      const scope = buildUsageAnalyticsScope(organization, window, workspaces[share])
      const scan = coveringScan(await explainCaptured(db, () => read(scope)))
      expect(scan?.['Node Type']).toBe('Index Only Scan')
      expect(scan?.['Index Cond']).toMatch(/^\(\(workspace_id = .+\) AND \(created_at >= .+\)/)
    }
  )
})
