/**
 * Personal organizations against real PostgreSQL: the backfill/signup provisioning is idempotent
 * and resumable and leaves billing where it was, and joining a team dissolves the personal
 * organization into it instead of refusing the join.
 */
import { db } from '@sim/db'
import {
  member,
  organization,
  permissions,
  project,
  subscription,
  user,
  userStats,
  workspace,
  workspaceFiles,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { resolveWorkspaceBillingPayer } from '@/lib/billing/core/attribution'
import { createOrganizationWithOwner } from '@/lib/billing/organizations/create-organization'
import { addUserToOrganization } from '@/lib/billing/organizations/membership'
import { resolveStorageBillingContext } from '@/lib/billing/storage/context'
import { provisionPersonalOrganization } from '@/lib/organizations/provision-personal'
import { createWorkspaceInTransaction } from '@/lib/workspaces/create'
import { getUsersWithPermissions } from '@/lib/workspaces/permissions/utils'

const userIds: string[] = []

async function createUser(): Promise<string> {
  const id = `personal-org-user-${generateId()}`
  const now = new Date()
  await db.insert(user).values({
    id,
    name: 'Personal Org Test',
    email: `${id}@personal-org.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(userStats).values({ id: generateId(), userId: id, storageUsedBytes: 0 })
  userIds.push(id)
  return id
}

/**
 * An organization-less workspace, as every personal workspace was before personal organizations
 * and as the previous release still creates them during cutover. `observedOrganizationId` is the
 * membership the creator holds, which the creation lock re-checks.
 */
async function createLegacyPersonalWorkspace(
  ownerId: string,
  name: string,
  observedOrganizationId: string | null = null
): Promise<string> {
  const created = await db.transaction((tx) =>
    createWorkspaceInTransaction(tx, {
      userId: ownerId,
      name,
      organizationId: null,
      observedOrganizationId,
      governingPermissionGroupOrganizationId: null,
      workspaceMode: 'personal',
      billedAccountUserId: ownerId,
      skipDefaultWorkflow: true,
    })
  )
  return created.id
}

/** A stored file of `bytes`, counted on both the workspace ledger and its payer's. */
async function storeFile(ownerId: string, workspaceId: string, bytes: number): Promise<void> {
  await db.insert(workspaceFiles).values({
    id: generateId(),
    key: `personal-org-test/${generateId()}`,
    userId: ownerId,
    workspaceId,
    context: 'workspace',
    originalName: 'file.txt',
    contentType: 'text/plain',
    sizeBytes: bytes,
  })
  await db.update(workspace).set({ storageUsedBytes: bytes }).where(eq(workspace.id, workspaceId))
  await db.update(userStats).set({ storageUsedBytes: bytes }).where(eq(userStats.userId, ownerId))
}

async function membershipOf(userId: string) {
  const [row] = await db
    .select({ organizationId: member.organizationId, role: member.role, kind: organization.kind })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, userId))
  return row ?? null
}

async function workspaceRow(workspaceId: string) {
  const [row] = await db
    .select({
      organizationId: workspace.organizationId,
      workspaceMode: workspace.workspaceMode,
      billedAccountUserId: workspace.billedAccountUserId,
      storageUsedBytes: workspace.storageUsedBytes,
      projectOrganizationId: project.organizationId,
    })
    .from(workspace)
    .innerJoin(project, eq(project.id, workspace.projectId))
    .where(eq(workspace.id, workspaceId))
  return row
}

async function userStorage(userId: string): Promise<number> {
  const [row] = await db
    .select({ bytes: userStats.storageUsedBytes })
    .from(userStats)
    .where(eq(userStats.userId, userId))
  return row.bytes
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
  await db.delete(subscription).where(inArray(subscription.referenceId, userIds))
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

describe('personal organization provisioning', () => {
  it('attaches every organization-less workspace once, and a rerun changes nothing', async () => {
    const ownerId = await createUser()
    const first = await createLegacyPersonalWorkspace(ownerId, 'First')
    const second = await createLegacyPersonalWorkspace(ownerId, 'Second')

    const provisioned = await provisionPersonalOrganization(ownerId)
    expect(provisioned).toMatchObject({ status: 'provisioned', created: true })
    if (provisioned.status !== 'provisioned') throw new Error('expected provisioning')
    expect([...provisioned.attachedWorkspaceIds].sort()).toEqual([first, second].sort())

    const membership = await membershipOf(ownerId)
    expect(membership).toEqual({
      organizationId: provisioned.organizationId,
      role: 'owner',
      kind: 'personal',
    })
    for (const workspaceId of [first, second]) {
      expect(await workspaceRow(workspaceId)).toMatchObject({
        organizationId: provisioned.organizationId,
        projectOrganizationId: provisioned.organizationId,
        workspaceMode: 'personal',
        billedAccountUserId: ownerId,
      })
    }

    const rerun = await provisionPersonalOrganization(ownerId)
    expect(rerun).toEqual({
      status: 'provisioned',
      organizationId: provisioned.organizationId,
      created: false,
      attachedWorkspaceIds: [],
      skippedWorkspaceIds: [],
    })
  })

  it('resumes by attaching a workspace created without an organization after the first run', async () => {
    const ownerId = await createUser()
    const provisioned = await provisionPersonalOrganization(ownerId)
    if (provisioned.status !== 'provisioned') throw new Error('expected provisioning')
    expect(provisioned.attachedWorkspaceIds).toEqual([])

    const late = await createLegacyPersonalWorkspace(
      ownerId,
      'Created by the previous release',
      provisioned.organizationId
    )
    const resumed = await provisionPersonalOrganization(ownerId)

    expect(resumed).toMatchObject({
      status: 'provisioned',
      organizationId: provisioned.organizationId,
      created: false,
      attachedWorkspaceIds: [late],
    })
  })

  it('leaves a team member and their organization-less workspaces alone', async () => {
    const ownerId = await createUser()
    const legacy = await createLegacyPersonalWorkspace(ownerId, 'Legacy')
    const { organizationId: teamId } = await createOrganizationWithOwner({
      ownerUserId: ownerId,
      name: 'Team',
      slug: `team-${generateId()}`.toLowerCase(),
    })

    expect(await provisionPersonalOrganization(ownerId)).toEqual({
      status: 'team-member',
      organizationId: teamId,
    })
    expect((await workspaceRow(legacy)).organizationId).toBeNull()
  })

  it('keeps a collaborator on a personal workspace a plain guest, not external', async () => {
    const ownerId = await createUser()
    const collaboratorId = await createUser()
    const shared = await createLegacyPersonalWorkspace(ownerId, 'Shared')
    const now = new Date()
    await db.insert(permissions).values({
      id: generateId(),
      userId: collaboratorId,
      entityType: 'workspace',
      entityId: shared,
      permissionType: 'write',
      createdAt: now,
      updatedAt: now,
    })

    await provisionPersonalOrganization(ownerId)
    await provisionPersonalOrganization(collaboratorId)

    expect((await membershipOf(collaboratorId))?.kind).toBe('personal')
    const collaborator = (await getUsersWithPermissions(shared)).find(
      (row) => row.userId === collaboratorId
    )
    expect(collaborator).toMatchObject({ isExternal: false, permissionType: 'write' })
  })
})

describe('billing in a personal organization', () => {
  it('keeps a Pro owner on their own plan, pool and storage ledger after attach', async () => {
    const ownerId = await createUser()
    const workspaceId = await createLegacyPersonalWorkspace(ownerId, 'Pro workspace')
    await storeFile(ownerId, workspaceId, 4096)
    const proId = generateId()
    await db.insert(subscription).values({
      id: proId,
      plan: 'pro',
      referenceId: ownerId,
      status: 'active',
    })

    const provisioned = await provisionPersonalOrganization(ownerId)
    if (provisioned.status !== 'provisioned') throw new Error('expected provisioning')

    const payer = await resolveWorkspaceBillingPayer(workspaceId)
    expect(payer).toMatchObject({ billedAccountUserId: ownerId, organizationId: null })
    expect(payer?.payerSubscription?.id).toBe(proId)

    const storage = await resolveStorageBillingContext(workspaceId)
    expect(storage.billingEntity).toEqual({ type: 'user', id: ownerId })
    expect(storage.plan).toBe('pro')

    expect((await workspaceRow(workspaceId)).storageUsedBytes).toBe(4096)
    expect(await userStorage(ownerId)).toBe(4096)
    const [personalOrganization] = await db
      .select({ storageUsedBytes: organization.storageUsedBytes })
      .from(organization)
      .where(eq(organization.id, provisioned.organizationId))
    expect(personalOrganization.storageUsedBytes).toBe(0)
  })
})

describe('joining a team', () => {
  it('dissolves the personal organization into the team, moving its workspaces and storage', async () => {
    const teamOwnerId = await createUser()
    const joinerId = await createUser()
    const { organizationId: teamId } = await createOrganizationWithOwner({
      ownerUserId: teamOwnerId,
      name: 'Joined Team',
      slug: `joined-${generateId()}`.toLowerCase(),
    })
    const joinerWorkspace = await createLegacyPersonalWorkspace(joinerId, 'Joiner workspace')
    await storeFile(joinerId, joinerWorkspace, 2048)
    const provisioned = await provisionPersonalOrganization(joinerId)
    if (provisioned.status !== 'provisioned') throw new Error('expected provisioning')

    const joined = await addUserToOrganization({
      userId: joinerId,
      organizationId: teamId,
      role: 'member',
      skipBillingLogic: true,
      skipSeatValidation: true,
    })

    expect(joined).toMatchObject({ success: true })
    expect(await membershipOf(joinerId)).toEqual({
      organizationId: teamId,
      role: 'member',
      kind: 'team',
    })
    const [personal] = await db
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, provisioned.organizationId))
    expect(personal).toBeUndefined()
    expect(await workspaceRow(joinerWorkspace)).toMatchObject({
      organizationId: teamId,
      projectOrganizationId: teamId,
      workspaceMode: 'organization',
      billedAccountUserId: teamOwnerId,
      storageUsedBytes: 2048,
    })
    const [team] = await db
      .select({ storageUsedBytes: organization.storageUsedBytes })
      .from(organization)
      .where(eq(organization.id, teamId))
    expect(team.storageUsedBytes).toBe(2048)
    expect(await userStorage(joinerId)).toBe(0)
    const [ownerGrant] = await db
      .select({ permissionType: permissions.permissionType })
      .from(permissions)
      .where(
        and(
          eq(permissions.userId, teamOwnerId),
          eq(permissions.entityType, 'workspace'),
          eq(permissions.entityId, joinerWorkspace)
        )
      )
    expect(ownerGrant?.permissionType).toBe('admin')
  })

  it('still refuses someone who already belongs to another team', async () => {
    const firstOwnerId = await createUser()
    const secondOwnerId = await createUser()
    await createOrganizationWithOwner({
      ownerUserId: firstOwnerId,
      name: 'First Team',
      slug: `first-${generateId()}`.toLowerCase(),
    })
    const { organizationId: secondTeamId } = await createOrganizationWithOwner({
      ownerUserId: secondOwnerId,
      name: 'Second Team',
      slug: `second-${generateId()}`.toLowerCase(),
    })

    const joined = await addUserToOrganization({
      userId: firstOwnerId,
      organizationId: secondTeamId,
      role: 'member',
      skipBillingLogic: true,
      skipSeatValidation: true,
    })

    expect(joined).toMatchObject({
      success: false,
      failureCode: 'already-in-other-organization',
    })
  })
})
