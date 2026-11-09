/**
 * With the `pause-personal-organizations` flag on, as before rolling the release back, nothing
 * creates a personal organization and nobody's new workspace lands in one.
 */
import { db } from '@sim/db'
import { member, organization, user } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.PAUSE_PERSONAL_ORGANIZATIONS = 'true'
})

import {
  createPersonalOrganization,
  provisionPersonalOrganization,
} from '@/lib/organizations/provision-personal'
import { getWorkspaceCreationPolicy } from '@/lib/workspaces/policy'

const userIds: string[] = []
const organizationIds: string[] = []

async function createUser(): Promise<string> {
  const id = `flag-user-${generateId()}`
  const now = new Date()
  await db.insert(user).values({
    id,
    name: 'Flag Test',
    email: `${id}@flag.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  userIds.push(id)
  return id
}

afterAll(async () => {
  if (organizationIds.length > 0) {
    await db.delete(organization).where(inArray(organization.id, organizationIds))
  }
  if (userIds.length > 0) await db.delete(user).where(inArray(user.id, userIds))
})

describe('personal organizations paused', () => {
  it('provisions none at signup or in the product shell', async () => {
    const userId = await createUser()

    expect(await createPersonalOrganization(userId)).toBeNull()
    expect(await db.select().from(member).where(eq(member.userId, userId))).toEqual([])
  })

  it('reports a backfilled user as paused, not missing, and writes nothing', async () => {
    const userId = await createUser()

    expect(await provisionPersonalOrganization(userId)).toEqual({ status: 'paused' })
    expect(await db.select().from(member).where(eq(member.userId, userId))).toEqual([])
  })

  it('creates a new workspace outside the personal organization someone already holds', async () => {
    const userId = await createUser()
    const organizationId = `org_${generateId()}`
    organizationIds.push(organizationId)
    await db.insert(organization).values({
      id: organizationId,
      name: 'Rolled back',
      slug: `personal-${userId.toLowerCase()}`,
      kind: 'personal',
      metadata: {},
    })
    await db
      .insert(member)
      .values({ id: generateId(), userId, organizationId, role: 'owner', createdAt: new Date() })

    const policy = await getWorkspaceCreationPolicy({ userId })

    expect(policy).toMatchObject({
      canCreate: true,
      workspaceMode: 'personal',
      organizationId: null,
      billedAccountUserId: userId,
    })
  })
})
