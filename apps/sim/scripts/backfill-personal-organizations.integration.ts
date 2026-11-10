/**
 * The personal-organization backfill's candidate selection, against real PostgreSQL. Failure
 * modes: a team member, or a personal-organization owner with nothing left to attach, selected
 * (wasted or wrong writes); a personal-organization owner who still owns an organization-less
 * workspace skipped (that workspace never moves); instance mode selecting a team member, or
 * skipping a personal-organization owner (stranded outside the instance organization); instance
 * mode re-adding someone removed from the instance organization, directly or with their last
 * workspace in it, or skipping someone who was only ever removed from another organization or
 * from the instance organization's workspaces as an outsider; cursor paging that skips or repeats
 * a user; an out-of-range `--batch-size`.
 */
import { db } from '@sim/db'
import {
  auditLog,
  member,
  organization,
  permissions,
  project,
  user,
  userStats,
  workspace,
} from '@sim/db/schema'
import { insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { generateId } from '@sim/utils/id'
import { inArray, or, sql } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { createOrganizationWithOwner } from '@/lib/billing/organizations/create-organization'
import { removeOrganizationMember } from '@/lib/organizations/application/members'
import { createPersonalOrganization } from '@/lib/organizations/provision-personal'
import { removeWorkspaceMember } from '@/lib/workspaces/application/remove-member'
import { createWorkspaceInTransaction } from '@/lib/workspaces/create'
import {
  type InstanceOrganizationScope,
  loadInstanceOrganizationScope,
  parseBatchSize,
  selectCandidateBatch,
} from '@/scripts/backfill-personal-organizations'

const prefix = `backfill-${generateId()}-`
const userIds: string[] = []

async function createUser(suffix: string): Promise<string> {
  const id = `${prefix}${suffix}`
  const now = new Date()
  await db.insert(user).values({
    id,
    name: 'Backfill Test',
    email: `${id}@backfill.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(userStats).values({ id: generateId(), userId: id, storageUsedBytes: 0 })
  userIds.push(id)
  return id
}

/** A workspace without an organization, created while the owner belongs to `observedOrganizationId`. */
async function ownOrganizationlessWorkspace(
  ownerId: string,
  observedOrganizationId: string | null = null
): Promise<void> {
  await db.transaction((tx) =>
    createWorkspaceInTransaction(tx, {
      userId: ownerId,
      name: 'Unassigned',
      organizationId: null,
      observedOrganizationId,
      governingPermissionGroupOrganizationId: null,
      workspaceMode: 'personal',
      billedAccountUserId: ownerId,
      skipDefaultWorkflow: true,
    })
  )
}

async function createTeam(ownerId: string): Promise<string> {
  const { organizationId } = await createOrganizationWithOwner({
    actor: { type: 'system', name: 'Test' },
    ownerUserId: ownerId,
    name: 'Team',
    slug: `team-${generateId()}`.toLowerCase(),
  })
  return organizationId
}

async function joinTeam(userId: string, organizationId: string): Promise<void> {
  await db.insert(member).values({ id: generateId(), organizationId, userId, role: 'member' })
}

async function grantWorkspace(userId: string, workspaceId: string): Promise<void> {
  await db.insert(permissions).values({
    id: generateId(),
    userId,
    entityType: 'workspace',
    entityId: workspaceId,
    permissionType: 'write',
  })
}

/** Removal records its audit entry after the commit, without waiting for it. */
async function waitForRemovalAudit(userId: string): Promise<void> {
  await vi.waitFor(
    async () => {
      const [row] = await db
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(
          or(
            sql`${auditLog.metadata}->>'targetUserId' = ${userId}`,
            sql`${auditLog.metadata}->>'removedUserId' = ${userId}`
          )
        )
        .limit(1)
      expect(row).toBeDefined()
    },
    { timeout: 10_000, interval: 50 }
  )
}

const seeded = await (async () => {
  const noOrganization = await createUser('a-no-org')
  await ownOrganizationlessWorkspace(noOrganization)
  const personalWithWork = await createUser('b-personal-with-work')
  await ownOrganizationlessWorkspace(
    personalWithWork,
    await createPersonalOrganization(personalWithWork)
  )
  const personalDone = await createUser('c-personal-done')
  await createPersonalOrganization(personalDone)
  const teamMember = await createUser('d-team')
  const teamId = await createTeam(teamMember)
  await ownOrganizationlessWorkspace(teamMember, teamId)
  const secondNoOrganization = await createUser('e-no-org')
  return { noOrganization, personalWithWork, personalDone, teamMember, secondNoOrganization }
})()

/**
 * An instance organization (any team serves: selection reads only its id) whose admin removed one
 * member directly and another by taking away their last workspace in it, beside accounts that were
 * never in it: one removed from another team, one removed as an outsider from an instance
 * workspace, and one untouched.
 */
const instanceSeeded = await (async () => {
  const owner = await createUser('f-instance-owner')
  const organizationId = await createTeam(owner)
  const workspaceId = generateId()
  await insertWorkspaceFixture(db, {
    id: workspaceId,
    name: 'Instance workspace',
    ownerId: owner,
    billedAccountUserId: owner,
    organizationId,
  })
  await db.insert(permissions).values({
    id: generateId(),
    userId: owner,
    entityType: 'workspace',
    entityId: workspaceId,
    permissionType: 'admin',
  })
  const ownerPrincipal = createSessionPrincipal({ userId: owner, sessionId: `session-${owner}` })

  const removed = await createUser('g-removed')
  await joinTeam(removed, organizationId)
  await removeOrganizationMember.execute({
    principal: ownerPrincipal,
    input: { organizationId, userId: removed },
  })

  const removedWithWorkspace = await createUser('h-removed-with-workspace')
  await joinTeam(removedWithWorkspace, organizationId)
  await grantWorkspace(removedWithWorkspace, workspaceId)
  await removeWorkspaceMember.execute({
    principal: ownerPrincipal,
    input: { workspaceId, userId: removedWithWorkspace },
  })

  const removedOutsider = await createUser('i-removed-outsider')
  await createPersonalOrganization(removedOutsider)
  await grantWorkspace(removedOutsider, workspaceId)
  await removeOrganizationMember.execute({
    principal: ownerPrincipal,
    input: { organizationId, userId: removedOutsider },
  })

  const otherTeamOwner = await createUser('j-other-team-owner')
  const otherTeamId = await createTeam(otherTeamOwner)
  const removedElsewhere = await createUser('k-removed-elsewhere')
  await joinTeam(removedElsewhere, otherTeamId)
  await removeOrganizationMember.execute({
    principal: createSessionPrincipal({
      userId: otherTeamOwner,
      sessionId: `session-${otherTeamOwner}`,
    }),
    input: { organizationId: otherTeamId, userId: removedElsewhere },
  })

  const neverMember = await createUser('l-never-member')
  await createPersonalOrganization(neverMember)

  for (const userId of [removed, removedWithWorkspace, removedOutsider, removedElsewhere]) {
    await waitForRemovalAudit(userId)
  }
  return {
    organizationId,
    removed,
    removedWithWorkspace,
    removedOutsider,
    removedElsewhere,
    neverMember,
  }
})()

afterAll(async () => {
  await db
    .delete(auditLog)
    .where(
      or(
        inArray(sql`${auditLog.metadata}->>'targetUserId'`, userIds),
        inArray(sql`${auditLog.metadata}->>'removedUserId'`, userIds),
        inArray(auditLog.actorId, userIds)
      )
    )
  const workspaces = await db
    .select({ id: workspace.id, projectId: workspace.projectId })
    .from(workspace)
    .where(inArray(workspace.ownerId, userIds))
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
  const organizations = await db
    .select({ id: member.organizationId })
    .from(member)
    .where(inArray(member.userId, userIds))
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

/** Every candidate after the seeded prefix in one page, narrowed to the given seeded users. */
async function seededCandidates(
  instance: InstanceOrganizationScope | null,
  among: string[] = userIds
): Promise<string[]> {
  const all = await selectCandidateBatch(prefix, 100_000, instance)
  return all.filter((id) => among.includes(id))
}

const baseSeededUsers = () => Object.values(seeded)

describe('backfill candidate selection', () => {
  it('selects users in no organization and personal owners with workspaces left to attach', async () => {
    expect(new Set(await seededCandidates(null, baseSeededUsers()))).toEqual(
      new Set([seeded.noOrganization, seeded.personalWithWork, seeded.secondNoOrganization])
    )
  })

  it('selects everyone outside a team on an instance-organization deployment', async () => {
    expect(
      new Set(await seededCandidates(await loadInstanceOrganizationScope(null), baseSeededUsers()))
    ).toEqual(
      new Set([
        seeded.noOrganization,
        seeded.personalWithWork,
        seeded.personalDone,
        seeded.secondNoOrganization,
      ])
    )
  })

  it('keeps everyone removed from the instance organization out of it, and no one else', async () => {
    const instanceUsers = [
      instanceSeeded.removed,
      instanceSeeded.removedWithWorkspace,
      instanceSeeded.removedOutsider,
      instanceSeeded.removedElsewhere,
      instanceSeeded.neverMember,
    ]
    expect(
      new Set(await seededCandidates(await loadInstanceOrganizationScope(null), instanceUsers))
    ).toEqual(new Set(instanceUsers))

    expect(
      new Set(
        await seededCandidates(
          await loadInstanceOrganizationScope(instanceSeeded.organizationId),
          instanceUsers
        )
      )
    ).toEqual(
      new Set([
        instanceSeeded.removedOutsider,
        instanceSeeded.removedElsewhere,
        instanceSeeded.neverMember,
      ])
    )
  })

  it('pages one user at a time through exactly the single-page result, in order', async () => {
    const reference = await selectCandidateBatch(prefix, 100_000, null)
    const lastSeeded = Math.max(...userIds.map((id) => reference.indexOf(id)))
    const expected = reference.slice(0, lastSeeded + 1)

    const paged: string[] = []
    let cursor: string | null = prefix
    while (paged.length < expected.length) {
      const batch = await selectCandidateBatch(cursor, 1, null)
      if (batch.length === 0) break
      paged.push(...batch)
      cursor = batch[batch.length - 1]
    }

    expect(paged).toEqual(expected)
    expect(await selectCandidateBatch(seeded.secondNoOrganization, 100_000, null)).not.toContain(
      seeded.secondNoOrganization
    )
  })

  it('bounds the batch size', () => {
    expect(parseBatchSize(undefined)).toBe(200)
    expect(parseBatchSize('2000')).toBe(2000)
    for (const invalid of ['0', '2001', '1.5', 'many', '-3']) {
      expect(() => parseBatchSize(invalid)).toThrow('--batch-size')
    }
  })
})
