import { db } from '@sim/db'
import { auditLog, user, workspace } from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { generateId } from '@sim/utils/id'
import { and, desc, eq, inArray, type SQL, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  type AuditLogListScope,
  buildOrgScopeCondition,
  queryAuditLogs,
} from '@/lib/audit-logs/query'

const organizationId = generateId()
const otherOrganizationId = generateId()
const memberId = generateId()
const departedId = generateId()
const ownerId = generateId()
const workspaceA = generateId()
const workspaceB = generateId()
const foreignWorkspace = generateId()
const workspaceIds = [workspaceA, workspaceB, foreignWorkspace]

type Placement = { workspaceId: string | null; resourceId: string; metadata: object }
const PLACEMENTS: Placement[] = [
  { workspaceId: workspaceA, resourceId: generateId(), metadata: {} },
  { workspaceId: workspaceB, resourceId: generateId(), metadata: {} },
  { workspaceId: foreignWorkspace, resourceId: generateId(), metadata: {} },
  { workspaceId: null, resourceId: generateId(), metadata: { organizationId } },
  { workspaceId: null, resourceId: organizationId, metadata: {} },
  {
    workspaceId: null,
    resourceId: generateId(),
    metadata: { organizationId: otherOrganizationId },
  },
]
const ACTORS = [memberId, departedId, null]

const rows = Array.from({ length: 72 }, (_, index) => {
  const placement = PLACEMENTS[index % PLACEMENTS.length]
  return {
    id: `${generateId()}-${String(index).padStart(2, '0')}`,
    index,
    workspaceId: placement.workspaceId,
    actorId: ACTORS[Math.floor(index / PLACEMENTS.length) % ACTORS.length],
    action: index % 4 === 0 ? 'workflow.deployed' : 'workflow.updated',
    resourceType: placement.resourceId === organizationId ? 'organization' : 'workflow',
    resourceId: placement.resourceId,
    metadata: { ...placement.metadata, fixture: 'x'.repeat(200) },
  }
})
const fixtureIds = rows.map((row) => row.id)

const auditLogTimestamp = sql`date_trunc('milliseconds', ${auditLog.createdAt})`

/** The listing's contract as one predicate: every row in scope, newest first. */
async function referenceOrder(scope: AuditLogListScope, filters: SQL<unknown>[]) {
  const matching = await db
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(and(buildOrgScopeCondition(scope), ...filters))
    .orderBy(desc(auditLogTimestamp), desc(auditLog.id))
  return matching.map((row) => row.id)
}

async function paginate(
  scope: AuditLogListScope,
  filters: SQL<unknown>[],
  limit: number,
  maxBytes?: number
) {
  const seen: string[] = []
  let cursor: string | undefined
  for (let page = 0; page <= rows.length; page++) {
    const result = await queryAuditLogs(scope, filters, limit, cursor, maxBytes)
    expect(result.truncated ?? false).toBe(false)
    seen.push(...result.data.map((row) => row.id))
    if (!result.nextCursor) return seen
    cursor = result.nextCursor
  }
  throw new Error('pagination did not terminate')
}

beforeAll(async () => {
  const now = new Date()
  await db.insert(user).values(
    [memberId, departedId, ownerId].map((id) => ({
      id,
      name: 'Audit scope fixture',
      email: `${id}@audit-scope.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    }))
  )
  await insertWorkspaceFixture(
    db,
    workspaceIds.map((id) => ({
      id,
      name: 'Audit scope fixture',
      ownerId,
      billedAccountUserId: ownerId,
    }))
  )
  await db.insert(auditLog).values(rows.map(({ index: _index, ...row }) => row))
  for (const row of rows) {
    // Four rows per PostgreSQL millisecond, 100µs apart, so ties are broken by id alone.
    await db
      .update(auditLog)
      .set({
        createdAt: sql`timestamp '2026-01-01 12:00:00' + ${Math.floor(row.index / 4)} * interval '1 millisecond' + ${row.index % 4} * interval '100 microseconds'`,
      })
      .where(eq(auditLog.id, row.id))
  }
}, 30_000)

afterAll(async () => {
  await db.delete(auditLog).where(inArray(auditLog.id, fixtureIds))
  await deleteWorkspaceFixture(db, inArray(workspace.id, workspaceIds))
  await db.delete(user).where(inArray(user.id, [memberId, departedId, ownerId]))
  await db.$client.end()
})

describe('queryAuditLogs scope against real Postgres', () => {
  const fixtureOnly = inArray(auditLog.id, fixtureIds)

  it.each([
    { includeDeparted: false, action: undefined },
    { includeDeparted: true, action: undefined },
    { includeDeparted: false, action: 'workflow.deployed' },
    { includeDeparted: true, action: 'workflow.deployed' },
  ])(
    'pages through exactly the single-predicate result (%o)',
    async ({ includeDeparted, action }) => {
      const scope: AuditLogListScope = {
        organizationId,
        orgWorkspaceIds: [workspaceA, workspaceB, workspaceA],
        orgMemberIds: [memberId],
        includeDeparted,
      }
      const filters = action ? [fixtureOnly, eq(auditLog.action, action)] : [fixtureOnly]
      const expected = await referenceOrder(scope, filters)
      expect(expected.length).toBeGreaterThan(4)

      for (const limit of [1, 3, 7, 100]) {
        expect(await paginate(scope, filters, limit)).toEqual(expected)
        expect(await paginate(scope, filters, limit, 1_000_000)).toEqual(expected)
      }
    }
  )

  it('reads only organization-level rows when the organization has no workspaces', async () => {
    const scope: AuditLogListScope = {
      organizationId,
      orgWorkspaceIds: [],
      orgMemberIds: [],
      includeDeparted: true,
    }
    const expected = await referenceOrder(scope, [fixtureOnly])
    const ids = await paginate(scope, [fixtureOnly], 5)

    expect(ids).toEqual(expected)
    expect(
      new Set(rows.filter((row) => ids.includes(row.id)).map((row) => row.workspaceId))
    ).toEqual(new Set([null]))
  })

  it('narrows to one workspace when the filter names it', async () => {
    const scope: AuditLogListScope = {
      organizationId,
      orgWorkspaceIds: [workspaceA, workspaceB],
      orgMemberIds: [memberId],
      includeDeparted: true,
    }
    const filters = [fixtureOnly, eq(auditLog.workspaceId, workspaceB)]
    const expected = await referenceOrder(scope, filters)

    expect(await paginate(scope, filters, 4)).toEqual(expected)
    expect(expected).toEqual(
      rows
        .filter((row) => row.workspaceId === workspaceB)
        .sort((left, right) => right.index - left.index)
        .map((row) => row.id)
    )
  })
})
