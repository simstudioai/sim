/**
 * Personal organizations against real PostgreSQL: provisioning is idempotent and resumable and
 * leaves billing where it was; joining another organization retires the personal organization
 * without losing anything; starting a team converts it in place; its organization-level activity
 * bills its owner; leaving a team never leaves a person without an organization; and deleting an
 * account behaves as it did before personal organizations.
 */
import { db } from '@sim/db'
import {
  copilotChats,
  member,
  mothershipMemorySpaces,
  organization,
  permissions,
  project,
  simLink,
  subscription,
  user,
  userStats,
  workspace,
  workspaceFiles,
} from '@sim/db/schema'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { getOrganizationBillingSummary } from '@/lib/billing/application/organization-billing/get-organization-billing-summary'
import {
  assertBillingAttributionSnapshot,
  resolveOrganizationBillingAttribution,
  resolveWorkspaceBillingPayer,
} from '@/lib/billing/core/attribution'
import { ensureOrganizationForTeamSubscription } from '@/lib/billing/organization'
import { createOrganizationWithOwner } from '@/lib/billing/organizations/create-organization'
import {
  addUserToOrganization,
  ensureUserInOrganizationTx,
  removeUserFromOrganization,
} from '@/lib/billing/organizations/membership'
import { resolveStorageBillingContext } from '@/lib/billing/storage/context'
import { listMothershipChats } from '@/lib/mothership/chat/list-mothership-chats'
import { provisionPersonalOrganization } from '@/lib/organizations/provision-personal'
import { deleteUserAccount, getAccountDeletionPlan } from '@/lib/users/account-deletion'
import { createWorkspaceInTransaction } from '@/lib/workspaces/create'
import { getUsersWithPermissions } from '@/lib/workspaces/permissions/utils'
import { getWorkspaceCreationPolicy } from '@/lib/workspaces/policy'

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

async function organizationExists(organizationId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.id, organizationId))
  return row !== undefined
}

/** An organization-level chat, knowledge file and memory space, as the organization view creates them. */
async function createOrganizationContent(ownerId: string, organizationId: string) {
  const [chat] = await db
    .insert(copilotChats)
    .values({ userId: ownerId, organizationId, title: 'Organization chat' })
    .returning({ id: copilotChats.id })
  const fileId = generateId()
  await db.insert(workspaceFiles).values({
    id: fileId,
    key: `personal-org-test/${generateId()}`,
    userId: ownerId,
    organizationId,
    context: 'knowledge-base',
    originalName: 'notes.txt',
    contentType: 'text/plain',
    sizeBytes: 12,
  })
  const memorySpaceId = generateId()
  await db
    .insert(mothershipMemorySpaces)
    .values({ id: memorySpaceId, userId: ownerId, organizationId, name: 'Research' })
  return { chatId: chat.id, fileId, memorySpaceId }
}

async function organizationContentOwners(content: {
  chatId: string
  fileId: string
  memorySpaceId: string
}) {
  const [chat] = await db
    .select({ organizationId: copilotChats.organizationId, userId: copilotChats.userId })
    .from(copilotChats)
    .where(eq(copilotChats.id, content.chatId))
  const [file] = await db
    .select({ organizationId: workspaceFiles.organizationId, userId: workspaceFiles.userId })
    .from(workspaceFiles)
    .where(eq(workspaceFiles.id, content.fileId))
  const [memorySpace] = await db
    .select({
      organizationId: mothershipMemorySpaces.organizationId,
      userId: mothershipMemorySpaces.userId,
    })
    .from(mothershipMemorySpaces)
    .where(eq(mothershipMemorySpaces.id, content.memorySpaceId))
  return { chat, file, memorySpace }
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
  await db
    .delete(subscription)
    .where(inArray(subscription.referenceId, [...userIds, ...organizations.map((row) => row.id)]))
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

describe('chats in a personal organization', () => {
  it('lists the workspace chats a person already had, on their own and shared workspaces, in their organization', async () => {
    const ownerId = await createUser()
    const guestId = await createUser()
    const own = await createLegacyPersonalWorkspace(ownerId, 'Own')
    const shared = await createLegacyPersonalWorkspace(guestId, 'Shared')
    const revoked = await createLegacyPersonalWorkspace(guestId, 'Revoked')
    const now = new Date()
    for (const entityId of [shared, revoked]) {
      await db.insert(permissions).values({
        id: generateId(),
        userId: ownerId,
        entityType: 'workspace',
        entityId,
        permissionType: 'write',
        createdAt: now,
        updatedAt: now,
      })
    }
    const chats = await db
      .insert(copilotChats)
      .values(
        [own, shared, revoked].map((workspaceId) => ({
          userId: ownerId,
          workspaceId,
          type: 'mothership' as const,
          title: workspaceId,
        }))
      )
      .returning({ id: copilotChats.id, workspaceId: copilotChats.workspaceId })
    await db
      .delete(permissions)
      .where(and(eq(permissions.entityId, revoked), eq(permissions.userId, ownerId)))

    const provisioned = await provisionPersonalOrganization(ownerId)
    if (provisioned.status !== 'provisioned') throw new Error('expected provisioning')
    const listed = await listMothershipChats(ownerId, {
      organizationId: provisioned.organizationId,
    })

    expect(listed.map((chat) => chat.id).sort()).toEqual(
      chats
        .filter((chat) => chat.workspaceId !== revoked)
        .map((chat) => chat.id)
        .sort()
    )
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

describe('joining another organization', () => {
  it('returns personal workspaces to personal, moves private organization content and drops shared Knowledge files', async () => {
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
    const content = await createOrganizationContent(joinerId, provisioned.organizationId)

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
    expect(await organizationExists(provisioned.organizationId)).toBe(false)
    expect(await workspaceRow(joinerWorkspace)).toMatchObject({
      organizationId: null,
      projectOrganizationId: null,
      workspaceMode: 'personal',
      billedAccountUserId: joinerId,
      storageUsedBytes: 2048,
    })
    expect(await userStorage(joinerId)).toBe(2048)
    expect(await organizationContentOwners(content)).toEqual({
      chat: { organizationId: teamId, userId: joinerId },
      file: undefined,
      memorySpace: { organizationId: teamId, userId: joinerId },
    })
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

describe('starting a team from a personal organization', () => {
  it('converts the personal organization in place and keeps a collaborator with their own as an external member', async () => {
    const ownerId = await createUser()
    const collaboratorId = await createUser()
    const ownerWorkspace = await createLegacyPersonalWorkspace(ownerId, 'Owner workspace')
    await storeFile(ownerId, ownerWorkspace, 1000)
    const collaboratorWorkspace = await createLegacyPersonalWorkspace(collaboratorId, 'Own work')
    const now = new Date()
    await db.insert(permissions).values({
      id: generateId(),
      userId: collaboratorId,
      entityType: 'workspace',
      entityId: ownerWorkspace,
      permissionType: 'write',
      createdAt: now,
      updatedAt: now,
    })
    const ownerPersonal = await provisionPersonalOrganization(ownerId)
    const collaboratorPersonal = await provisionPersonalOrganization(collaboratorId)
    if (ownerPersonal.status !== 'provisioned' || collaboratorPersonal.status !== 'provisioned') {
      throw new Error('expected provisioning')
    }
    const ownerContent = await createOrganizationContent(ownerId, ownerPersonal.organizationId)
    const collaboratorContent = await createOrganizationContent(
      collaboratorId,
      collaboratorPersonal.organizationId
    )
    const teamSubscriptionId = generateId()
    await db.insert(subscription).values({
      id: teamSubscriptionId,
      plan: 'team',
      referenceId: ownerId,
      status: 'active',
      seats: 5,
    })

    const upgraded = await ensureOrganizationForTeamSubscription({
      id: teamSubscriptionId,
      plan: 'team',
      referenceId: ownerId,
      status: 'active',
      seats: 5,
    })

    const teamId = ownerPersonal.organizationId
    expect(upgraded.referenceId).toBe(teamId)
    expect(await membershipOf(ownerId)).toEqual({
      organizationId: teamId,
      role: 'owner',
      kind: 'team',
    })
    expect(await organizationContentOwners(ownerContent)).toEqual({
      chat: { organizationId: teamId, userId: ownerId },
      file: { organizationId: teamId, userId: ownerId },
      memorySpace: { organizationId: teamId, userId: ownerId },
    })
    expect(await workspaceRow(ownerWorkspace)).toMatchObject({
      organizationId: teamId,
      projectOrganizationId: teamId,
      workspaceMode: 'organization',
      billedAccountUserId: ownerId,
      storageUsedBytes: 1000,
    })
    const [team] = await db
      .select({ storageUsedBytes: organization.storageUsedBytes })
      .from(organization)
      .where(eq(organization.id, teamId))
    expect(team.storageUsedBytes).toBe(1000)
    expect(await userStorage(ownerId)).toBe(0)

    expect(await membershipOf(collaboratorId)).toEqual({
      organizationId: collaboratorPersonal.organizationId,
      role: 'owner',
      kind: 'personal',
    })
    expect(await workspaceRow(collaboratorWorkspace)).toMatchObject({
      organizationId: collaboratorPersonal.organizationId,
      billedAccountUserId: collaboratorId,
    })
    expect(await organizationContentOwners(collaboratorContent)).toEqual({
      chat: { organizationId: collaboratorPersonal.organizationId, userId: collaboratorId },
      file: { organizationId: collaboratorPersonal.organizationId, userId: collaboratorId },
      memorySpace: { organizationId: collaboratorPersonal.organizationId, userId: collaboratorId },
    })
    const [collaboratorAccess] = await db
      .select({ permissionType: permissions.permissionType })
      .from(permissions)
      .where(and(eq(permissions.userId, collaboratorId), eq(permissions.entityId, ownerWorkspace)))
    expect(collaboratorAccess).toEqual({ permissionType: 'write' })
  })

  it('attaches the owner’s workspaces when the webhook retries after the first attach failed', async () => {
    const ownerId = await createUser()
    const ownerWorkspace = await createLegacyPersonalWorkspace(ownerId, 'Owner workspace')
    const personal = await provisionPersonalOrganization(ownerId)
    if (personal.status !== 'provisioned') throw new Error('expected provisioning')
    // The first delivery committed the team and the subscription transfer, then its attach threw.
    const { organizationId: teamId } = await createOrganizationWithOwner({
      ownerUserId: ownerId,
      name: 'Team',
      slug: `team-${generateId()}`.toLowerCase(),
      metadata: { createdForTeamPlan: true, originalUserId: ownerId },
    })
    const teamSubscription = {
      id: generateId(),
      plan: 'team',
      referenceId: teamId,
      status: 'active',
      seats: 5,
    }
    await db.insert(subscription).values(teamSubscription)
    expect((await workspaceRow(ownerWorkspace)).organizationId).toBeNull()

    await ensureOrganizationForTeamSubscription(teamSubscription)

    expect(await workspaceRow(ownerWorkspace)).toMatchObject({
      organizationId: teamId,
      workspaceMode: 'organization',
      billedAccountUserId: ownerId,
    })
  })
})

describe('organization-level activity in a personal organization', () => {
  it('bills the owner from their own plan, as personal workspace activity does', async () => {
    const ownerId = await createUser()
    const provisioned = await provisionPersonalOrganization(ownerId)
    if (provisioned.status !== 'provisioned') throw new Error('expected provisioning')
    const proId = generateId()
    await db.insert(subscription).values({
      id: proId,
      plan: 'pro',
      referenceId: ownerId,
      status: 'active',
    })

    const attribution = await resolveOrganizationBillingAttribution({
      actorUserId: ownerId,
      organizationId: provisioned.organizationId,
    })

    expect(attribution).toMatchObject({
      workspaceId: null,
      organizationId: null,
      billedAccountUserId: ownerId,
      billingEntity: { type: 'user', id: ownerId },
    })
    expect(attribution.payerSubscription?.id).toBe(proId)
    const wire = JSON.stringify(attribution)
    expect(assertBillingAttributionSnapshot(JSON.parse(wire))).toEqual(attribution)
  })
})

describe('leaving a team', () => {
  it('gives the person their personal organization in the removal transaction', async () => {
    const teamOwnerId = await createUser()
    const leaverId = await createUser()
    const { organizationId: teamId } = await createOrganizationWithOwner({
      ownerUserId: teamOwnerId,
      name: 'Left Team',
      slug: `left-${generateId()}`.toLowerCase(),
    })
    const joined = await addUserToOrganization({
      userId: leaverId,
      organizationId: teamId,
      role: 'member',
      skipBillingLogic: true,
      skipSeatValidation: true,
    })
    if (!joined.success || !joined.memberId) throw new Error('expected the join to succeed')

    const removed = await removeUserFromOrganization({
      userId: leaverId,
      organizationId: teamId,
      memberId: joined.memberId,
      skipBillingLogic: true,
    })

    expect(removed).toMatchObject({ success: true })
    expect((await membershipOf(leaverId))?.kind).toBe('personal')
  })
})

describe('deleting an account', () => {
  it('is not blocked by the personal organization and leaves nothing of it behind', async () => {
    const ownerId = await createUser()
    const privateWorkspace = await createLegacyPersonalWorkspace(ownerId, 'Private')
    const provisioned = await provisionPersonalOrganization(ownerId)
    if (provisioned.status !== 'provisioned') throw new Error('expected provisioning')
    await createOrganizationContent(ownerId, provisioned.organizationId)

    const plan = await getAccountDeletionPlan(ownerId)
    expect(plan.blockers).toEqual([])
    expect(plan.workspacesToDelete.map((row) => row.id)).toEqual([privateWorkspace])

    await deleteUserAccount(ownerId, { recordIdentity: false })

    expect(await organizationExists(provisioned.organizationId)).toBe(false)
    const [privateRow] = await db
      .select({ id: workspace.id })
      .from(workspace)
      .where(eq(workspace.id, privateWorkspace))
    expect(privateRow).toBeUndefined()
    const [membership] = await db
      .select({ id: member.id })
      .from(member)
      .where(eq(member.organizationId, provisioned.organizationId))
    expect(membership).toBeUndefined()
  })
})

describe('joining another organization over colliding content', () => {
  it('admits an SSO or invitation join whose personal go link shares a name with the team’s, keeping the team’s', async () => {
    const teamOwnerId = await createUser()
    const joinerId = await createUser()
    const { organizationId: teamId } = await createOrganizationWithOwner({
      ownerUserId: teamOwnerId,
      name: 'Colliding Team',
      slug: `colliding-${generateId()}`.toLowerCase(),
    })
    const provisioned = await provisionPersonalOrganization(joinerId)
    if (provisioned.status !== 'provisioned') throw new Error('expected provisioning')
    const teamLinkId = generateId()
    for (const [id, organizationId, createdBy, url] of [
      [teamLinkId, teamId, teamOwnerId, 'https://example.com/team-docs'],
      [generateId(), provisioned.organizationId, joinerId, 'https://example.com/private-docs'],
    ]) {
      await db.insert(simLink).values({
        id,
        organizationId,
        name: 'docs',
        normalizedName: 'docs',
        url,
        createdBy,
      })
    }

    await db.transaction((tx) =>
      ensureUserInOrganizationTx(tx, {
        userId: joinerId,
        organizationId: teamId,
        role: 'member',
        skipBillingLogic: true,
        skipSeatValidation: true,
      })
    )

    expect(await membershipOf(joinerId)).toMatchObject({ organizationId: teamId, kind: 'team' })
    const links = await db
      .select({ id: simLink.id, url: simLink.url })
      .from(simLink)
      .where(inArray(simLink.organizationId, [teamId, provisioned.organizationId]))
    expect(links).toEqual([{ id: teamLinkId, url: 'https://example.com/team-docs' }])
  })

  it('never lets anyone join a personal organization', async () => {
    const ownerId = await createUser()
    const outsiderId = await createUser()
    const provisioned = await provisionPersonalOrganization(ownerId)
    if (provisioned.status !== 'provisioned') throw new Error('expected provisioning')

    const joined = await addUserToOrganization({
      userId: outsiderId,
      organizationId: provisioned.organizationId,
      role: 'member',
      skipBillingLogic: true,
      skipSeatValidation: true,
    })

    expect(joined.success).toBe(false)
    expect(await membershipOf(outsiderId)).toBeNull()
  })
})

describe('forking a workspace in a personal organization', () => {
  it('lands a collaborator fork beside its source, billed to the collaborator', async () => {
    const ownerId = await createUser()
    const collaboratorId = await createUser()
    const ownerPersonal = await provisionPersonalOrganization(ownerId)
    const collaboratorPersonal = await provisionPersonalOrganization(collaboratorId)
    if (ownerPersonal.status !== 'provisioned' || collaboratorPersonal.status !== 'provisioned') {
      throw new Error('expected provisioning')
    }

    const policy = await getWorkspaceCreationPolicy({
      userId: collaboratorId,
      activeOrganizationId: ownerPersonal.organizationId,
      pinOrganization: true,
      pinnedToAuthorizedSource: true,
    })
    expect(policy).toMatchObject({
      canCreate: true,
      organizationId: ownerPersonal.organizationId,
      workspaceMode: 'personal',
      billedAccountUserId: collaboratorId,
    })
    const fork = await db.transaction((tx) =>
      createWorkspaceInTransaction(tx, {
        userId: collaboratorId,
        name: 'Fork',
        organizationId: policy.organizationId,
        observedOrganizationId: policy.observedOrganizationId,
        governingPermissionGroupOrganizationId: policy.governingPermissionGroupOrganizationId,
        workspaceMode: policy.workspaceMode,
        billedAccountUserId: policy.billedAccountUserId,
        skipDefaultWorkflow: true,
      })
    )
    expect(fork.organizationId).toBe(ownerPersonal.organizationId)
    expect((await resolveWorkspaceBillingPayer(fork.id))?.billedAccountUserId).toBe(collaboratorId)

    const unpinned = await getWorkspaceCreationPolicy({
      userId: collaboratorId,
      activeOrganizationId: ownerPersonal.organizationId,
      pinOrganization: true,
    })
    expect(unpinned.canCreate).toBe(false)
  })

  it('keeps an organization-less source fork organization-less, as before', async () => {
    const ownerId = await createUser()
    await provisionPersonalOrganization(ownerId)

    const policy = await getWorkspaceCreationPolicy({
      userId: ownerId,
      activeOrganizationId: null,
      pinOrganization: true,
      pinnedToAuthorizedSource: true,
    })

    expect(policy).toMatchObject({
      canCreate: true,
      organizationId: null,
      workspaceMode: 'personal',
    })
  })
})

describe('billing settings of a personal organization', () => {
  it('reads the owner’s own subscription, usage limit and upgrade workspace', async () => {
    const ownerId = await createUser()
    const workspaceId = await createLegacyPersonalWorkspace(ownerId, 'Billed personally')
    const provisioned = await provisionPersonalOrganization(ownerId)
    if (provisioned.status !== 'provisioned') throw new Error('expected provisioning')
    await db.insert(subscription).values({
      id: generateId(),
      plan: 'pro',
      referenceId: ownerId,
      status: 'active',
    })

    const summary = await getOrganizationBillingSummary.execute({
      principal: createSessionPrincipal({ userId: ownerId }),
      input: { organizationId: provisioned.organizationId },
    })

    expect(summary).toMatchObject({
      billingScope: 'personal',
      subscriptionState: 'active',
      subscriptionPlan: 'pro',
      totalSeats: 1,
      upgradeWorkspaceId: workspaceId,
    })
  })

  it('reads a team’s billing as the organization’s', async () => {
    const ownerId = await createUser()
    const { organizationId } = await createOrganizationWithOwner({
      ownerUserId: ownerId,
      name: 'Billed Team',
      slug: `billed-${generateId()}`.toLowerCase(),
    })

    const summary = await getOrganizationBillingSummary.execute({
      principal: createSessionPrincipal({ userId: ownerId }),
      input: { organizationId },
    })

    expect(summary).toMatchObject({ billingScope: 'organization', subscriptionState: 'free' })
  })
})
