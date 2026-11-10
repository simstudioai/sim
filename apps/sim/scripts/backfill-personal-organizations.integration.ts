/**
 * The personal-organization backfill's candidate selection, against real PostgreSQL. Failure
 * modes: a team member, or a personal-organization owner with nothing left to attach, selected
 * (wasted or wrong writes); a personal-organization owner who still owns an organization-less
 * workspace skipped (that workspace never moves); instance mode selecting a team member, or
 * skipping a personal-organization owner (stranded outside the instance organization); cursor
 * paging that skips or repeats a user; an out-of-range `--batch-size`.
 */
import { db } from '@sim/db'
import { member, organization, project, user, userStats, workspace } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { createOrganizationWithOwner } from '@/lib/billing/organizations/create-organization'
import { createPersonalOrganization } from '@/lib/organizations/provision-personal'
import { createWorkspaceInTransaction } from '@/lib/workspaces/create'
import { parseBatchSize, selectCandidateBatch } from '@/scripts/backfill-personal-organizations'

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
  const { organizationId: teamId } = await createOrganizationWithOwner({
    ownerUserId: teamMember,
    name: 'Team',
    slug: `team-${generateId()}`.toLowerCase(),
  })
  await ownOrganizationlessWorkspace(teamMember, teamId)
  const secondNoOrganization = await createUser('e-no-org')
  return { noOrganization, personalWithWork, personalDone, teamMember, secondNoOrganization }
})()

afterAll(async () => {
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

/** Every candidate after the seeded prefix in one page, narrowed to the seeded users. */
async function seededCandidates(instanceMode: boolean): Promise<string[]> {
  const all = await selectCandidateBatch(prefix, 100_000, instanceMode)
  return all.filter((id) => userIds.includes(id))
}

describe('backfill candidate selection', () => {
  it('selects users in no organization and personal owners with workspaces left to attach', async () => {
    expect(new Set(await seededCandidates(false))).toEqual(
      new Set([seeded.noOrganization, seeded.personalWithWork, seeded.secondNoOrganization])
    )
  })

  it('selects everyone outside a team on an instance-organization deployment', async () => {
    expect(new Set(await seededCandidates(true))).toEqual(
      new Set([
        seeded.noOrganization,
        seeded.personalWithWork,
        seeded.personalDone,
        seeded.secondNoOrganization,
      ])
    )
  })

  it('pages one user at a time through exactly the single-page result, in order', async () => {
    const reference = await selectCandidateBatch(prefix, 100_000, false)
    const lastSeeded = Math.max(...userIds.map((id) => reference.indexOf(id)))
    const expected = reference.slice(0, lastSeeded + 1)

    const paged: string[] = []
    let cursor: string | null = prefix
    while (paged.length < expected.length) {
      const batch = await selectCandidateBatch(cursor, 1, false)
      if (batch.length === 0) break
      paged.push(...batch)
      cursor = batch[batch.length - 1]
    }

    expect(paged).toEqual(expected)
    expect(await selectCandidateBatch(seeded.secondNoOrganization, 100_000, false)).not.toContain(
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
