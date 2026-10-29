/**
 * The plan an organization's audit-log listing must get, proven on the exact SQL
 * `queryAuditLogs` sends against a table with many workspace-less rows of other organizations:
 * the organization-level metadata part is read through `audit_log_org_level_created_at_id_idx`,
 * which can stream it in keyset order and stop after a page, and never by seeking
 * `workspace_id IS NULL` and filtering every workspace-less row in the table.
 */
import { db } from '@sim/db'
import { auditLog, user, workspace } from '@sim/db/schema'
import { explainCaptured, type PlanNode } from '@sim/db/testing/explain'
import { assertDisposableTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { generateId } from '@sim/utils/id'
import { eq, like, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type AuditLogListScope, queryAuditLogs } from '@/lib/audit-logs/query'

const organizationId = generateId()
const memberId = generateId()
const workspaceId = generateId()
const idPrefix = `audit_plan_${generateId()}_`
const orgLevelIndex = 'audit_log_org_level_created_at_id_idx'

const cursor = Buffer.from(
  JSON.stringify({ createdAt: '2026-01-02T00:00:00.000Z', id: `${idPrefix}~` })
).toString('base64')

const listingPlan = (
  includeDeparted: boolean,
  pageCursor: string | undefined,
  gucs?: Record<string, string>
) => {
  const scope: AuditLogListScope = {
    organizationId,
    orgWorkspaceIds: [workspaceId],
    orgMemberIds: [memberId],
    includeDeparted,
  }
  return explainCaptured(db, () => queryAuditLogs(scope, [], 50, pageCursor), { gucs })
}

const scansOf = (nodes: PlanNode[], index: string) =>
  nodes.filter((node) => node['Index Name'] === index)

const CASES = [
  ['current members', false, undefined],
  ['departed members included', true, undefined],
  ['current members, after a cursor', false, cursor],
  ['departed members included, after a cursor', true, cursor],
] as const

describe('organization audit-log listing plans in PostgreSQL', () => {
  beforeAll(async () => {
    assertDisposableTestDatabaseUrl(process.env.DATABASE_URL ?? '')
    await db.insert(user).values({
      id: memberId,
      name: 'Audit plan fixture',
      email: `${memberId}@audit-plan.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    await insertWorkspaceFixture(db, {
      id: workspaceId,
      name: 'Audit plan fixture',
      ownerId: memberId,
      billedAccountUserId: memberId,
    })
    // Workspace-less rows of many other organizations across the whole history, and a few
    // hundred of this organization's, so a scan that filters workspace-less rows for the
    // organization costs far more than one that reads only the organization's rows.
    await db.execute(sql`
      INSERT INTO ${auditLog} (id, workspace_id, actor_id, action, resource_type, resource_id,
        metadata, created_at)
      SELECT ${idPrefix} || n, CASE WHEN n % 10 = 1 THEN ${workspaceId} END,
        CASE WHEN n % 2 = 0 THEN ${memberId} END, 'organization.updated',
        CASE WHEN n % 997 = 0 THEN 'organization' ELSE 'workflow' END,
        CASE WHEN n % 997 = 0 THEN ${organizationId} ELSE 'resource-' || n END,
        jsonb_build_object('organizationId',
          CASE WHEN n % 50 = 0 THEN ${organizationId} ELSE 'other-organization-' || (n % 400) END),
        timestamp '2026-01-01' + n * interval '1 second'
      FROM generate_series(1, 20000) AS n`)
    await db.execute(sql`VACUUM ANALYZE ${auditLog}`)
  })

  afterAll(async () => {
    await db.delete(auditLog).where(like(auditLog.id, `${idPrefix}%`))
    await deleteWorkspaceFixture(db, eq(workspace.id, workspaceId))
    await db.delete(user).where(eq(user.id, memberId))
  })

  it.each(CASES)(
    'reads organization-level metadata rows through their index, never every workspace-less row (%s)',
    async (_label, includeDeparted, pageCursor) => {
      const nodes = await listingPlan(includeDeparted, pageCursor)
      const orgLevel = scansOf(nodes, orgLevelIndex)
      expect(orgLevel).toHaveLength(1)
      expect(orgLevel[0]['Index Cond']).toMatch(/'organizationId'/)
      expect(nodes.filter((node) => /workspace_id IS NULL/.test(node['Index Cond'] ?? ''))).toEqual(
        []
      )
    }
  )

  /**
   * Whether the planner streams the part or collects and sorts it is a cost choice: the
   * expression has no statistics (a partial index's are not used), so the estimate grows with
   * the table. What must hold is that the index can serve the part in keyset order, so that on a
   * large table the scan stops after a page.
   */
  it.each(CASES)(
    'can stream organization-level metadata rows newest first from their index (%s)',
    async (_label, includeDeparted, pageCursor) => {
      const nodes = await listingPlan(includeDeparted, pageCursor, { enable_bitmapscan: 'off' })
      const [orgLevel] = scansOf(nodes, orgLevelIndex)
      expect(orgLevel).toMatchObject({ 'Node Type': 'Index Scan', 'Scan Direction': 'Backward' })
      if (pageCursor) expect(orgLevel['Index Cond']).toMatch(/ROW\(date_trunc/)
    }
  )
})
