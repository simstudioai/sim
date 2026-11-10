/**
 * Instance-organization membership against real PostgreSQL. Failure mode: a member removed from the
 * instance organization (by an admin, the Admin API, or SCIM deprovisioning that keeps the account)
 * is re-added on their next page load, because the landing command treated every visitor still in
 * their personal organization as a signup whose instance join had failed.
 */
import { db } from '@sim/db'
import { member, organization, user, userStats, workspace } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { removeUserFromOrganization } from '@/lib/billing/organizations/membership'
import { ensureViewerOrganization } from '@/lib/organizations/application/viewer-organization'
import { getInstanceOrganizationId } from '@/lib/organizations/instance-org'
import { ensureSignupOrganization } from '@/lib/organizations/provision-personal'

vi.hoisted(() => {
  const suffix = `${process.pid}-${Date.now().toString(36)}`
  process.env.INSTANCE_ORG_NAME = `Instance Membership ${suffix}`
  process.env.INSTANCE_ORG_SLUG = `instance-membership-${suffix}`
})

const userIds: string[] = []

async function createUser(): Promise<string> {
  const id = `instance-org-user-${generateId()}`
  const now = new Date()
  await db.insert(user).values({
    id,
    name: 'Instance Org Test',
    email: `${id}@instance-org.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(userStats).values({ id: generateId(), userId: id, storageUsedBytes: 0 })
  userIds.push(id)
  return id
}

async function membershipOf(userId: string) {
  const [row] = await db
    .select({ id: member.id, organizationId: member.organizationId, kind: organization.kind })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, userId))
  return row
}

afterAll(async () => {
  if (userIds.length === 0) return
  const instanceOrganizationId = await getInstanceOrganizationId()
  const organizations = await db
    .select({ id: member.organizationId })
    .from(member)
    .where(inArray(member.userId, userIds))
  const organizationIds = [
    ...new Set([
      ...organizations.map((row) => row.id),
      ...(instanceOrganizationId ? [instanceOrganizationId] : []),
    ]),
  ]
  await db.delete(workspace).where(inArray(workspace.ownerId, userIds))
  if (organizationIds.length > 0) {
    await db.delete(organization).where(inArray(organization.id, organizationIds))
  }
  await db.delete(user).where(inArray(user.id, userIds))
})

describe('instance organization membership', () => {
  it('keeps a removed member out of the instance organization on their next page load', async () => {
    const ownerId = await createUser()
    const memberId = await createUser()
    const instanceOrganizationId = await ensureSignupOrganization(ownerId)
    expect(await ensureSignupOrganization(memberId)).toBe(instanceOrganizationId)
    if (!instanceOrganizationId) throw new Error('Expected the instance organization')

    const membership = await membershipOf(memberId)
    const removal = await removeUserFromOrganization({
      userId: memberId,
      organizationId: instanceOrganizationId,
      memberId: membership.id,
      actor: { type: 'user', userId: ownerId },
      skipBillingLogic: true,
    })
    expect(removal.success).toBe(true)

    const landing = await ensureViewerOrganization.execute({
      principal: { kind: 'session', userId: memberId, sessionId: `session-${memberId}` },
      input: {},
    })

    expect(landing).not.toBe(instanceOrganizationId)
    expect((await membershipOf(memberId))?.kind).toBe('personal')
    const readmitted = await db
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.userId, memberId), eq(member.organizationId, instanceOrganizationId)))
    expect(readmitted).toEqual([])
  })
})
