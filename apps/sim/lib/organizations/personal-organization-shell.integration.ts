/**
 * Which organization the product shell opens a workspace in, and on-demand personal organization
 * provisioning, against real PostgreSQL. Failure modes: a guest on someone's personal workspace,
 * or an external collaborator on a team's workspace, sent to an organization surface they are not
 * a member of (access denied); an account outside every organization answering not found on its
 * own workspaces; on-demand provisioning attaching existing workspaces (a payer change during a
 * rolling deploy, owed only to the backfill); concurrent first page loads creating two
 * personal organizations; the surface read rendering an organization the URL names that the
 * viewer does not belong to; and a retired organization's link reading as one the viewer is
 * excluded from, which leaves a saved link at access denied instead of the viewer's organization.
 */
import { db } from '@sim/db'
import {
  member,
  organization,
  permissions,
  project,
  user,
  userStats,
  workspace,
} from '@sim/db/schema'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { eq, inArray, sql } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { createOrganizationWithOwner } from '@/lib/billing/organizations/create-organization'
import { OrganizationMembershipNotFoundError } from '@/lib/core/application/organization-authorization'
import {
  OrganizationNotFoundError,
  readOrganizationSurface,
} from '@/lib/organizations/application/surface'
import { ensureViewerOrganization } from '@/lib/organizations/application/viewer-organization'
import { createPersonalOrganizationTx } from '@/lib/organizations/personal'
import {
  ensureUserOrganization,
  provisionPersonalOrganization,
} from '@/lib/organizations/provision-personal'
import {
  isWorkspaceShellRefusal,
  readWorkspaceShell,
} from '@/lib/workspaces/application/workspace-shell'
import { createWorkspaceInTransaction } from '@/lib/workspaces/create'

// The surface's navigation flags read rollout configuration, which says nothing about whose
// organization a viewer may read.
vi.mock('@/lib/organizations/surface-flags', () => ({
  resolveOrganizationSurfaceFlags: async () => ({ flags: {}, benchmarkEnabled: false }),
}))
vi.mock('@/lib/people/feature-flag', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/people/feature-flag')>()),
  canBrowsePeople: async () => false,
}))
vi.mock('@/lib/sim-links/feature-flag', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/sim-links/feature-flag')>()),
  isSimLinksEnabled: async () => false,
}))

const userIds: string[] = []

async function createUser(): Promise<string> {
  const id = `shell-org-user-${generateId()}`
  const now = new Date()
  await db.insert(user).values({
    id,
    name: 'Shell Org Test',
    email: `${id}@shell-org.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(userStats).values({ id: generateId(), userId: id, storageUsedBytes: 0 })
  userIds.push(id)
  return id
}

async function createWorkspace(
  ownerId: string,
  organizationId: string | null,
  observedOrganizationId: string | null = organizationId
): Promise<string> {
  const created = await db.transaction((tx) =>
    createWorkspaceInTransaction(tx, {
      userId: ownerId,
      name: 'Workspace',
      organizationId,
      observedOrganizationId,
      governingPermissionGroupOrganizationId: null,
      workspaceMode: organizationId ? 'organization' : 'personal',
      billedAccountUserId: ownerId,
      skipDefaultWorkflow: true,
    })
  )
  return created.id
}

async function grantWorkspace(userId: string, workspaceId: string): Promise<void> {
  const now = new Date()
  await db.insert(permissions).values({
    id: generateId(),
    userId,
    entityType: 'workspace',
    entityId: workspaceId,
    permissionType: 'write',
    createdAt: now,
    updatedAt: now,
  })
}

async function membershipsOf(userId: string) {
  return db
    .select({ organizationId: member.organizationId, role: member.role, kind: organization.kind })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, userId))
}

async function workspaceOrganizationId(workspaceId: string): Promise<string | null> {
  const [row] = await db
    .select({ organizationId: workspace.organizationId })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
  return row.organizationId
}

function viewer(userId: string) {
  return { kind: 'session' as const, userId, sessionId: `session-${userId}` }
}

/** The landing command the shell runs for a viewer in no organization. */
function landingOrganization(userId: string) {
  return ensureViewerOrganization.execute({ principal: viewer(userId), input: {} })
}

/** The product shell's resolution: `readWorkspaceShellOrganizationId` composes exactly these. */
async function shellOrganization(workspaceId: string, userId: string) {
  try {
    const shell = await readWorkspaceShell.execute({
      principal: viewer(userId),
      input: { workspaceId },
    })
    return shell.organizationId ?? (await landingOrganization(userId))
  } catch (error) {
    if (isWorkspaceShellRefusal(error)) return null
    throw error
  }
}

/** Resolves once some backend sits waiting on a lock, i.e. the racing statement is parked. */
async function waitForLockWaiter(): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const [{ waiting }] = await db.execute<{ waiting: number }>(sql`
      SELECT count(*)::int AS waiting FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'
    `)
    if (waiting > 0) return
    await sleep(25)
  }
  throw new Error('no statement ever waited on a lock')
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

describe('the organization a workspace opens in', () => {
  it("opens a guest's view of someone's personal workspace in the guest's own organization", async () => {
    const ownerId = await createUser()
    const guestId = await createUser()
    const ownerOrganizationId = await ensureUserOrganization(ownerId, { atSignup: false })
    const guestOrganizationId = await ensureUserOrganization(guestId, { atSignup: false })
    const shared = await createWorkspace(ownerId, ownerOrganizationId)
    await grantWorkspace(guestId, shared)

    expect(await shellOrganization(shared, guestId)).toBe(guestOrganizationId)
    expect(await shellOrganization(shared, ownerId)).toBe(ownerOrganizationId)
  })

  it("opens an external collaborator's view of a team workspace in their own organization", async () => {
    const teamOwnerId = await createUser()
    const externalId = await createUser()
    const { organizationId: teamId } = await createOrganizationWithOwner({
      actor: { type: 'system', name: 'Test' },
      ownerUserId: teamOwnerId,
      name: 'Team',
      slug: `team-${generateId()}`.toLowerCase(),
    })
    const externalOrganizationId = await ensureUserOrganization(externalId, { atSignup: false })
    const teamWorkspace = await createWorkspace(teamOwnerId, teamId)
    await grantWorkspace(externalId, teamWorkspace)

    expect(await shellOrganization(teamWorkspace, externalId)).toBe(externalOrganizationId)
    expect(await shellOrganization(teamWorkspace, teamOwnerId)).toBe(teamId)
  })

  it('names no organization for a workspace the viewer cannot open', async () => {
    const ownerId = await createUser()
    const strangerId = await createUser()
    const ownerOrganizationId = await ensureUserOrganization(ownerId, { atSignup: false })
    const privateWorkspace = await createWorkspace(ownerId, ownerOrganizationId)

    expect(await shellOrganization(privateWorkspace, strangerId)).toBeNull()
    expect(await membershipsOf(strangerId)).toEqual([])
  })

  it('reads the shell of an account in no organization without provisioning one', async () => {
    const ownerId = await createUser()
    const legacy = await createWorkspace(ownerId, null)

    expect(
      await readWorkspaceShell.execute({
        principal: viewer(ownerId),
        input: { workspaceId: legacy },
      })
    ).toEqual({ organizationId: null })
    expect(await membershipsOf(ownerId)).toEqual([])
  })

  it('opens the workspaces of an account in no organization in a personal one made on demand', async () => {
    const ownerId = await createUser()
    const legacy = await createWorkspace(ownerId, null)

    const organizationId = await shellOrganization(legacy, ownerId)

    expect(await membershipsOf(ownerId)).toEqual([
      { organizationId, role: 'owner', kind: 'personal' },
    ])
    expect(await workspaceOrganizationId(legacy)).toBeNull()
  })
})

describe('on-demand personal organization provisioning', () => {
  it('creates the organization and owner membership only, attaching no existing workspace', async () => {
    const ownerId = await createUser()
    const first = await createWorkspace(ownerId, null)
    const second = await createWorkspace(ownerId, null)

    const organizationId = await ensureUserOrganization(ownerId, { atSignup: false })

    expect(await membershipsOf(ownerId)).toEqual([
      { organizationId, role: 'owner', kind: 'personal' },
    ])
    expect(await workspaceOrganizationId(first)).toBeNull()
    expect(await workspaceOrganizationId(second)).toBeNull()

    const backfilled = await provisionPersonalOrganization(ownerId)
    expect(backfilled).toMatchObject({ status: 'provisioned', organizationId, created: false })
    expect(await workspaceOrganizationId(first)).toBe(organizationId)
  })

  it('creates one organization for concurrent first page loads', async () => {
    const ownerId = await createUser()

    // One page load's provisioning has written its organization and holds it uncommitted while a
    // second load provisions: the second must wait for it and land in the same organization.
    let commitFirst: () => void = () => undefined
    const firstHeld = new Promise<void>((resolve) => {
      commitFirst = resolve
    })
    let firstWritten: () => void = () => undefined
    const written = new Promise<void>((resolve) => {
      firstWritten = resolve
    })
    const first = db.transaction(async (tx) => {
      const organizationId = await createPersonalOrganizationTx(tx, ownerId, {
        type: 'user',
        userId: ownerId,
      })
      firstWritten()
      await firstHeld
      return organizationId
    })
    await written

    const second = landingOrganization(ownerId)
    await waitForLockWaiter()
    commitFirst()
    const [firstId, secondId] = await Promise.all([first, second])

    const memberships = await membershipsOf(ownerId)
    expect(memberships).toEqual([{ organizationId: firstId, role: 'owner', kind: 'personal' }])
    expect(secondId).toBe(firstId)
  })

  it('leaves a team member in their team', async () => {
    const ownerId = await createUser()
    const { organizationId: teamId } = await createOrganizationWithOwner({
      actor: { type: 'system', name: 'Test' },
      ownerUserId: ownerId,
      name: 'Team',
      slug: `team-${generateId()}`.toLowerCase(),
    })

    expect(await landingOrganization(ownerId)).toBe(teamId)
    expect(await membershipsOf(ownerId)).toEqual([
      { organizationId: teamId, role: 'owner', kind: 'team' },
    ])
  })
})

describe('the organization surface a shell renders', () => {
  it('refuses an organization the viewer does not belong to', async () => {
    const viewerId = await createUser()
    const ownerId = await createUser()
    await ensureUserOrganization(viewerId, { atSignup: false })
    const { organizationId: othersId } = await createOrganizationWithOwner({
      actor: { type: 'system', name: 'Test' },
      ownerUserId: ownerId,
      name: 'Others',
      slug: `others-${generateId()}`.toLowerCase(),
    })

    await expect(
      readOrganizationSurface.execute({
        principal: createSessionPrincipal({ userId: viewerId }),
        input: { organizationId: othersId },
      })
    ).rejects.toSatisfy(
      (error) =>
        error instanceof OrganizationMembershipNotFoundError &&
        !(error instanceof OrganizationNotFoundError)
    )
  })

  it('tells an organization that no longer exists apart from one the viewer is outside', async () => {
    const viewerId = await createUser()
    await ensureUserOrganization(viewerId, { atSignup: false })

    await expect(
      readOrganizationSurface.execute({
        principal: createSessionPrincipal({ userId: viewerId }),
        input: { organizationId: `retired-${generateId()}` },
      })
    ).rejects.toBeInstanceOf(OrganizationNotFoundError)
  })
})
