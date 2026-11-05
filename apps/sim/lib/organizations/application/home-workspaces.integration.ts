/**
 * The Home Workspaces read against real PostgreSQL: which workspaces a viewer's activity covers, and
 * what makes each status true. Every signal is seeded through the real tables, so a status cannot
 * pass here on a row shape production never writes.
 */
import type { SessionPrincipal } from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  member,
  organization,
  pausedExecutions,
  permissions,
  user,
  workflow,
  workflowExecutionLogs,
  workflowExecutionSnapshots,
  workspace,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { authMock, authMockFns } from '@sim/testing/mocks/auth.mock'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PrincipalKindAuthorizationError } from '@/lib/core/application/workspace-authorization'
import { getExecutionReservationTtlMs } from '@/lib/core/execution-limits'
import { readOrganizationHomeWorkspaceActivity } from '@/lib/organizations/application/home-workspaces'
import { GET as getWorkspaceActivityRoute } from '@/app/api/organizations/[id]/home/workspace-activity/route'

vi.mock('@/lib/auth', () => authMock)

const organizationId = generateId()
const otherOrganizationId = generateId()
const adminId = generateId()
const memberId = generateId()
const noAccessMemberId = generateId()
const outsiderId = generateId()
const everyone = [adminId, memberId, noAccessMemberId, outsiderId]
const granted = generateId()
const ungranted = generateId()
const otherOrganizationWorkspace = generateId()
const archivedWorkspace = generateId()
const workspaces = [granted, ungranted, otherOrganizationWorkspace, archivedWorkspace]
const snapshotId = generateId()
const workflowIds = { first: generateId(), second: generateId(), hidden: generateId() }
const input = { organizationId }

const session = (userId: string): SessionPrincipal => ({
  kind: 'session',
  userId,
  sessionId: generateId(),
})

async function readAs(userId: string) {
  return readOrganizationHomeWorkspaceActivity.execute({ principal: session(userId), input })
}

async function readGranted() {
  const { workspaces: rows } = await readAs(memberId)
  const row = rows.find((candidate) => candidate.workspaceId === granted)
  if (!row) throw new Error('The granted workspace is missing from the read')
  return row
}

function insertRun(
  values: Partial<typeof workflowExecutionLogs.$inferInsert> &
    Pick<typeof workflowExecutionLogs.$inferInsert, 'status' | 'startedAt'>
) {
  return db.insert(workflowExecutionLogs).values({
    id: generateId(),
    workflowId: workflowIds.first,
    workspaceId: granted,
    executionId: generateId(),
    stateSnapshotId: snapshotId,
    level: 'info',
    trigger: 'api',
    ...values,
  })
}

function insertPause(
  pausePoints: Record<string, Record<string, unknown>>,
  values: { status?: string; workflowId?: string } = {}
) {
  return db.insert(pausedExecutions).values({
    id: generateId(),
    workflowId: workflowIds.first,
    executionId: generateId(),
    executionSnapshot: {},
    pausePoints,
    totalPauseCount: Object.keys(pausePoints).length,
    ...values,
  })
}

const minutesFromNow = (minutes: number) => new Date(Date.now() + minutes * 60_000)

beforeAll(async () => {
  const now = new Date()
  await db.insert(user).values(
    everyone.map((id) => ({
      id,
      name: 'Home workspaces fixture',
      email: `${id}@home-workspaces.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    }))
  )
  await db.insert(organization).values(
    [organizationId, otherOrganizationId].map((id) => ({
      id,
      name: 'Home workspaces fixture',
      slug: id,
      createdAt: now,
    }))
  )
  await db.insert(member).values([
    { id: generateId(), userId: adminId, organizationId, role: 'admin' },
    { id: generateId(), userId: memberId, organizationId, role: 'member' },
    { id: generateId(), userId: noAccessMemberId, organizationId, role: 'member' },
    { id: generateId(), userId: outsiderId, organizationId: otherOrganizationId, role: 'member' },
  ])
  await insertWorkspaceFixture(
    db,
    [
      { id: granted, organizationId },
      { id: ungranted, organizationId },
      { id: otherOrganizationWorkspace, organizationId: otherOrganizationId },
      { id: archivedWorkspace, organizationId, archivedAt: now },
    ].map((row) => ({
      ...row,
      name: 'Home workspaces fixture',
      ownerId: adminId,
      billedAccountUserId: adminId,
    }))
  )
  await db.insert(permissions).values(
    [granted, otherOrganizationWorkspace, archivedWorkspace].map((entityId) => ({
      id: generateId(),
      userId: memberId,
      entityType: 'workspace' as const,
      entityId,
      permissionType: 'read' as const,
    }))
  )
  await db.insert(workflow).values(
    [
      { id: workflowIds.first, workspaceId: granted, name: 'Renewal approval' },
      { id: workflowIds.second, workspaceId: granted, name: 'Invoice sync' },
      { id: workflowIds.hidden, workspaceId: ungranted, name: 'Not for this member' },
    ].map((row) => ({
      ...row,
      userId: adminId,
      lastSynced: now,
      createdAt: now,
      updatedAt: now,
    }))
  )
  await db.insert(workflowExecutionSnapshots).values({
    id: snapshotId,
    workflowId: workflowIds.first,
    stateHash: generateId(),
    stateData: {},
  })
})

beforeEach(async () => {
  await db
    .delete(workflowExecutionLogs)
    .where(inArray(workflowExecutionLogs.workspaceId, workspaces))
  await db
    .delete(pausedExecutions)
    .where(inArray(pausedExecutions.workflowId, Object.values(workflowIds)))
})

afterAll(async () => {
  await db
    .delete(workflowExecutionLogs)
    .where(inArray(workflowExecutionLogs.workspaceId, workspaces))
  await db.delete(workflowExecutionSnapshots).where(eq(workflowExecutionSnapshots.id, snapshotId))
  await deleteWorkspaceFixture(db, inArray(workspace.id, workspaces))
  await db
    .delete(organization)
    .where(inArray(organization.id, [organizationId, otherOrganizationId]))
  await db.delete(user).where(inArray(user.id, everyone))
})

describe('whose workspaces the read covers', () => {
  const coveredBy = async (userId: string) =>
    (await readAs(userId)).workspaces.map((row) => row.workspaceId).sort()

  it('gives a member only the granted workspaces of this organization', async () => {
    expect(await coveredBy(memberId)).toEqual([granted])
  })

  it('gives an organization admin the whole organization and nothing beyond it', async () => {
    expect(await coveredBy(adminId)).toEqual([granted, ungranted].sort())
  })

  it('answers empty for a member with no workspaces', async () => {
    expect(await coveredBy(noAccessMemberId)).toEqual([])
  })

  it('reports nothing from a workspace the viewer cannot open', async () => {
    await insertRun({
      workflowId: workflowIds.hidden,
      workspaceId: ungranted,
      status: 'running',
      startedAt: new Date(),
      executionDeadlineAt: minutesFromNow(10),
    })
    await insertPause(
      { point: { resumeStatus: 'paused', pauseKind: 'human' } },
      { workflowId: workflowIds.hidden }
    )
    const body = JSON.stringify(await readAs(memberId))
    expect(body).not.toContain(ungranted)
    expect(body).not.toContain('Not for this member')
  })

  it('refuses a viewer outside the organization', async () => {
    await expect(readAs(outsiderId)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('takes a session only', async () => {
    await expect(
      readOrganizationHomeWorkspaceActivity.execute({
        principal: { kind: 'personal_api_key', userId: memberId, keyId: generateId() },
        input,
      })
    ).rejects.toBeInstanceOf(PrincipalKindAuthorizationError)
  })

  it('answers 404 over HTTP to a session from another organization', async () => {
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: outsiderId },
      session: { id: generateId() },
    })
    const response = await getWorkspaceActivityRoute(
      new NextRequest(
        `http://localhost:3000/api/organizations/${organizationId}/home/workspace-activity`
      ),
      { params: Promise.resolve({ id: organizationId }) }
    )
    expect(response.status).toBe(404)
  })
})

describe('Running', () => {
  it('holds for a run inside its deadline, and names its workflow', async () => {
    await insertRun({
      status: 'running',
      startedAt: new Date(),
      executionDeadlineAt: minutesFromNow(10),
    })
    expect(await readGranted()).toMatchObject({
      status: 'running',
      statusWorkflowName: 'Renewal approval',
    })
  })

  it('holds for a resumed run long past its start, whose deadline is what counts', async () => {
    await insertRun({
      status: 'running',
      startedAt: minutesFromNow(-60 * 24 * 7),
      executionDeadlineAt: minutesFromNow(10),
    })
    expect((await readGranted()).status).toBe('running')
  })

  it('does not hold for a row past its deadline, which the sweeper has yet to fail', async () => {
    await insertRun({
      status: 'running',
      startedAt: minutesFromNow(-30),
      executionDeadlineAt: minutesFromNow(-1),
    })
    expect((await readGranted()).status).toBeNull()
  })

  it('without a deadline, holds only inside the reservation window', async () => {
    const window = getExecutionReservationTtlMs() / 60_000
    await insertRun({ status: 'running', startedAt: minutesFromNow(-window - 1) })
    expect((await readGranted()).status).toBeNull()
    await insertRun({ status: 'running', startedAt: minutesFromNow(-1) })
    expect((await readGranted()).status).toBe('running')
  })

  it.each(['completed', 'failed', 'cancelled', 'pending', 'redacting'])(
    'does not hold for a %s run',
    async (status) => {
      await insertRun({ status, startedAt: new Date(), executionDeadlineAt: minutesFromNow(10) })
      expect((await readGranted()).status).toBeNull()
    }
  )
})

describe('Review', () => {
  it('holds for a run paused on a person, and names its workflow', async () => {
    await insertPause({ approval: { resumeStatus: 'paused', pauseKind: 'human' } })
    expect(await readGranted()).toMatchObject({
      status: 'review',
      statusWorkflowName: 'Renewal approval',
    })
  })

  it('holds for a point written before pauseKind existed', async () => {
    await insertPause({ approval: { resumeStatus: 'paused' } })
    expect((await readGranted()).status).toBe('review')
  })

  it('holds while one human point of a partly resumed run still waits', async () => {
    await insertPause(
      {
        answered: { resumeStatus: 'resumed', pauseKind: 'human' },
        waiting: { resumeStatus: 'paused', pauseKind: 'human' },
      },
      { status: 'partially_resumed' }
    )
    expect((await readGranted()).status).toBe('review')
  })

  it('does not hold for a timed wait, which nobody can act on', async () => {
    await insertPause({ wait: { resumeStatus: 'paused', pauseKind: 'time' } })
    expect((await readGranted()).status).toBeNull()
  })

  it('does not hold once the person has answered', async () => {
    await insertPause({ approval: { resumeStatus: 'resuming', pauseKind: 'human' } })
    expect((await readGranted()).status).toBeNull()
  })

  it.each(['fully_resumed', 'cancelling', 'cancelled'])(
    'does not hold for a %s run',
    async (status) => {
      await insertPause({ approval: { resumeStatus: 'paused', pauseKind: 'human' } }, { status })
      expect((await readGranted()).status).toBeNull()
    }
  )

  it('does not hold for an archived workflow', async () => {
    await db
      .update(workflow)
      .set({ archivedAt: new Date() })
      .where(eq(workflow.id, workflowIds.second))
    await insertPause(
      { approval: { resumeStatus: 'paused', pauseKind: 'human' } },
      { workflowId: workflowIds.second }
    )
    expect((await readGranted()).status).toBeNull()
    await db.update(workflow).set({ archivedAt: null }).where(eq(workflow.id, workflowIds.second))
  })

  it('outranks a live run, because it needs a person', async () => {
    await insertRun({
      workflowId: workflowIds.second,
      status: 'running',
      startedAt: new Date(),
      executionDeadlineAt: minutesFromNow(10),
    })
    await insertPause({ approval: { resumeStatus: 'paused', pauseKind: 'human' } })
    expect(await readGranted()).toMatchObject({
      status: 'review',
      statusWorkflowName: 'Renewal approval',
    })
  })
})

describe('the last run', () => {
  it('is null with no retained run', async () => {
    expect((await readGranted()).lastRun).toBeNull()
  })

  it('is the newest run, with its workflow and whether it failed', async () => {
    await insertRun({ status: 'completed', startedAt: minutesFromNow(-60) })
    const startedAt = minutesFromNow(-5)
    await insertRun({ workflowId: workflowIds.second, status: 'failed', startedAt })
    expect((await readGranted()).lastRun).toEqual({
      workflowName: 'Invoice sync',
      startedAt: startedAt.toISOString(),
      failed: true,
    })
  })

  it('still reads when its workflow was deleted', async () => {
    await insertRun({ workflowId: null, status: 'completed', startedAt: minutesFromNow(-5) })
    expect((await readGranted()).lastRun).toMatchObject({ workflowName: null, failed: false })
  })
})
