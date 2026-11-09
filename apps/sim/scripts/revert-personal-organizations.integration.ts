/**
 * The personal-organization rollback against real PostgreSQL. Failure modes: a reverted
 * workspace left pointing at a deleted organization (or its Project left behind); a rerun failing
 * on an already-reverted organization; a personal organization holding its owner's content deleted
 * without being asked to; a skipped organization left half-reverted with its workspaces detached.
 */
import { db } from '@sim/db'
import {
  copilotChats,
  member,
  organization,
  project,
  user,
  userStats,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { provisionPersonalOrganization } from '@/lib/organizations/provision-personal'
import { createWorkspaceInTransaction } from '@/lib/workspaces/create'
import { revertPersonalOrganization } from '@/scripts/revert-personal-organizations'

const userIds: string[] = []

/** A backfilled account: its organization-less workspace attached to its new personal organization. */
async function backfilledOwner() {
  const userId = `revert-${generateId()}`
  const now = new Date()
  await db.insert(user).values({
    id: userId,
    name: 'Revert Test',
    email: `${userId}@revert.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(userStats).values({ id: generateId(), userId, storageUsedBytes: 0 })
  userIds.push(userId)
  const created = await db.transaction((tx) =>
    createWorkspaceInTransaction(tx, {
      userId,
      name: 'Personal',
      organizationId: null,
      observedOrganizationId: null,
      governingPermissionGroupOrganizationId: null,
      workspaceMode: 'personal',
      billedAccountUserId: userId,
      skipDefaultWorkflow: true,
    })
  )
  const provisioned = await provisionPersonalOrganization(userId)
  if (provisioned.status !== 'provisioned') throw new Error('expected provisioning')
  return { userId, workspaceId: created.id, organizationId: provisioned.organizationId }
}

async function workspaceOrganizations(workspaceId: string) {
  const [row] = await db
    .select({
      organizationId: workspace.organizationId,
      projectOrganizationId: project.organizationId,
      billedAccountUserId: workspace.billedAccountUserId,
    })
    .from(workspace)
    .innerJoin(project, eq(project.id, workspace.projectId))
    .where(eq(workspace.id, workspaceId))
  return row
}

async function organizationExists(organizationId: string) {
  const rows = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.id, organizationId))
  return rows.length > 0
}

afterAll(async () => {
  if (userIds.length === 0) return
  const workspaces = await db
    .select({ id: workspace.id, projectId: workspace.projectId })
    .from(workspace)
    .where(inArray(workspace.ownerId, userIds))
  const organizations = await db
    .select({ id: member.organizationId })
    .from(member)
    .where(inArray(member.userId, userIds))
  if (workspaces.length > 0) {
    await db.delete(workspace).where(
      inArray(
        workspace.id,
        workspaces.map((row) => row.id)
      )
    )
    await db.delete(project).where(
      inArray(
        project.id,
        workspaces.flatMap((row) => (row.projectId ? [row.projectId] : []))
      )
    )
  }
  if (organizations.length > 0) {
    await db.delete(organization).where(
      inArray(
        organization.id,
        organizations.map((row) => row.id)
      )
    )
  }
  await db.delete(user).where(inArray(user.id, userIds))
})

describe('reverting personal organizations', () => {
  it('returns workspaces to organization-less personal and deletes the organization, once', async () => {
    const { userId, workspaceId, organizationId } = await backfilledOwner()

    const reverted = await revertPersonalOrganization(organizationId, { deleteContent: false })

    expect(reverted).toEqual({
      status: 'reverted',
      detachedWorkspaceIds: [workspaceId],
      deletedContent: false,
    })
    expect(await workspaceOrganizations(workspaceId)).toEqual({
      organizationId: null,
      projectOrganizationId: null,
      billedAccountUserId: userId,
    })
    expect(await organizationExists(organizationId)).toBe(false)
    expect(await db.select().from(member).where(eq(member.userId, userId))).toEqual([])
    expect(await revertPersonalOrganization(organizationId, { deleteContent: false })).toEqual({
      status: 'gone',
    })
  })

  it('skips an organization holding its owner’s chats, changing nothing, unless told to delete them', async () => {
    const { userId, workspaceId, organizationId } = await backfilledOwner()
    const [chat] = await db
      .insert(copilotChats)
      .values({ userId, organizationId, type: 'mothership', title: 'Organization chat' })
      .returning({ id: copilotChats.id })

    expect(await revertPersonalOrganization(organizationId, { deleteContent: false })).toEqual({
      status: 'holds-content',
      table: 'copilot_chats',
    })
    expect((await workspaceOrganizations(workspaceId)).organizationId).toBe(organizationId)
    expect(await organizationExists(organizationId)).toBe(true)

    expect(await revertPersonalOrganization(organizationId, { deleteContent: true })).toMatchObject(
      {
        status: 'reverted',
        deletedContent: true,
      }
    )
    expect((await workspaceOrganizations(workspaceId)).organizationId).toBeNull()
    expect(await db.select().from(copilotChats).where(eq(copilotChats.id, chat.id))).toEqual([])
  })
})
