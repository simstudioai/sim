/**
 * The plans an organization's audit-log listing must get, proven on the exact SQL `queryAuditLogs`
 * sends. Narrowed by nothing but a time range, each workspace is read by a keyset scan of
 * `audit_log_workspace_created_at_id_idx` that a page limit stops, never by collecting and sorting
 * the whole scope. Any other filter keeps the single scope predicate, so its plan is the one the
 * filter's own index drives.
 */
import { db } from '@sim/db'
import { auditLog, user, workspace } from '@sim/db/schema'
import { explainCaptured, type PlanNode } from '@sim/db/testing/explain'
import { assertDisposableTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { generateId } from '@sim/utils/id'
import { eq, like, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  type AuditLogFilterParams,
  type AuditLogListScope,
  queryAuditLogs,
} from '@/lib/audit-logs/query'

const organizationId = generateId()
const memberId = generateId()
const workspaceId = generateId()
const idPrefix = `audit_plan_${generateId()}_`
const workspaceIndex = 'audit_log_workspace_created_at_id_idx'
const orgLevelIndex = 'audit_log_org_level_created_at_id_idx'

const cursor = Buffer.from(
  JSON.stringify({ createdAt: '2026-01-01T03:00:00.000Z', id: `${idPrefix}~` })
).toString('base64')

const listingPlan = (
  filters: AuditLogFilterParams,
  options: { includeDeparted?: boolean; cursor?: string } = {}
) => {
  const scope: AuditLogListScope = {
    organizationId,
    orgWorkspaceIds: [workspaceId],
    orgMemberIds: [memberId],
    includeDeparted: options.includeDeparted ?? false,
  }
  return explainCaptured(db, () => queryAuditLogs(scope, filters, 50, options.cursor))
}

/** The workspace part's keyset scans, each directly under the limit that stops it after a page. */
const limitedWorkspaceScans = (nodes: PlanNode[]) =>
  nodes
    .filter((node) => node['Node Type'] === 'Limit')
    .map((node) => node.Plans?.[0])
    .filter((child) => child?.['Index Name'] === workspaceIndex)

const KEYSET_CASES: [
  string,
  AuditLogFilterParams,
  { includeDeparted?: boolean; cursor?: string },
][] = [
  ['no filter, current members', {}, {}],
  ['no filter, departed members included', {}, { includeDeparted: true }],
  ['no filter, after a cursor', {}, { cursor }],
  ['a start date', { startDate: '2026-01-01T01:00:00.000Z' }, {}],
  [
    'a date range, after a cursor',
    { startDate: '2026-01-01T01:00:00.000Z', endDate: '2026-01-01T04:00:00.000Z' },
    { cursor },
  ],
]

const NARROWED_CASES: [string, AuditLogFilterParams][] = [
  ['an action', { action: 'organization.updated' }],
  [
    'an action and a start date',
    { action: 'organization.updated', startDate: '2026-01-01T01:00:00.000Z' },
  ],
  ['a resource type', { resourceType: 'workflow' }],
  ['a resource', { resourceType: 'workflow', resourceId: 'resource-7' }],
  ['an actor', { actorId: memberId }],
  ['a workspace', { workspaceId }],
  ['a search', { search: 'fixture' }],
]

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
    // A workspace with a long history, and workspace-less rows of many other organizations, so
    // collecting the scope and sorting it costs far more than a keyset scan that stops at a page.
    await db.execute(sql`
      INSERT INTO ${auditLog} (id, workspace_id, actor_id, action, resource_type, resource_id,
        metadata, created_at)
      SELECT ${idPrefix} || n, CASE WHEN n % 4 = 1 THEN ${workspaceId} END,
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

  it.each(KEYSET_CASES)(
    'reads each workspace newest first through its keyset index and stops after a page (%s)',
    async (_label, filters, options) => {
      const nodes = await listingPlan(filters, options)
      const [scan] = limitedWorkspaceScans(nodes)
      expect(scan).toMatchObject({ 'Node Type': 'Index Scan', 'Scan Direction': 'Backward' })
      expect(scan?.['Index Cond']).toMatch(/workspace_id = org_workspace\.workspace_id/)
      if (filters.startDate) expect(scan?.['Index Cond']).toMatch(/date_trunc\(.*\) >= /)
      if (filters.endDate) expect(scan?.['Index Cond']).toMatch(/date_trunc\(.*\) <= /)
      if (options.cursor) expect(scan?.['Index Cond']).toMatch(/ROW\(date_trunc/)
      expect(nodes.filter((node) => node['Index Name'] === orgLevelIndex)).toHaveLength(1)
    }
  )

  it.each(NARROWED_CASES)(
    'keeps the single scope predicate when the listing is narrowed by %s',
    async (_label, filters) => {
      const nodes = await listingPlan(filters)
      expect(nodes.filter((node) => node['Node Type'] === 'Function Scan')).toEqual([])
      expect(nodes.filter((node) => /org_workspace/.test(node['Index Cond'] ?? ''))).toEqual([])
    }
  )
})
