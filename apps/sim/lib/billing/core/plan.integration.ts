/** Subscription selection against real PostgreSQL: tier priority, scope tie-break, and entitlement. */
import { db } from '@sim/db'
import { member, organization, subscription, user } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { getHighestPrioritySubscription } from '@/lib/billing/core/plan'

const userIds: string[] = []
const organizationIds: string[] = []

async function createUser(): Promise<string> {
  const id = `plan-user-${generateId()}`
  const now = new Date()
  await db.insert(user).values({
    id,
    name: 'Plan Test',
    email: `${id}@plan.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  userIds.push(id)
  return id
}

async function createOrganizationWithMember(userId: string): Promise<string> {
  const id = `plan-org-${generateId()}`
  await db.insert(organization).values({ id, name: 'Plan Org', slug: id })
  await db.insert(member).values({ id: generateId(), userId, organizationId: id, role: 'member' })
  organizationIds.push(id)
  return id
}

async function createSubscription(
  referenceId: string,
  plan: 'pro' | 'team' | 'enterprise',
  status = 'active'
): Promise<string> {
  const id = generateId()
  await db.insert(subscription).values({
    id,
    plan,
    referenceId,
    status,
    ...(plan === 'enterprise' ? { metadata: { workspaces: 'unlimited' } } : {}),
  })
  return id
}

afterAll(async () => {
  await db
    .delete(subscription)
    .where(inArray(subscription.referenceId, [...userIds, ...organizationIds]))
  if (organizationIds.length > 0) {
    await db.delete(organization).where(inArray(organization.id, organizationIds))
  }
  if (userIds.length > 0) await db.delete(user).where(inArray(user.id, userIds))
})

describe('getHighestPrioritySubscription', () => {
  it('returns null when the user has no entitled subscription', async () => {
    const userId = await createUser()
    await createOrganizationWithMember(userId)

    expect(await getHighestPrioritySubscription(userId)).toBeNull()
  })

  it('prefers the higher tier regardless of scope', async () => {
    const userId = await createUser()
    const organizationId = await createOrganizationWithMember(userId)
    await createSubscription(userId, 'pro')
    const enterpriseId = await createSubscription(organizationId, 'enterprise')

    expect((await getHighestPrioritySubscription(userId))?.id).toBe(enterpriseId)

    const personalTeamUserId = await createUser()
    const proOrganizationId = await createOrganizationWithMember(personalTeamUserId)
    await createSubscription(proOrganizationId, 'pro')
    const personalTeamId = await createSubscription(personalTeamUserId, 'team')

    expect((await getHighestPrioritySubscription(personalTeamUserId))?.id).toBe(personalTeamId)
  })

  it('prefers the organization subscription over a personal one of the same tier', async () => {
    const userId = await createUser()
    const organizationId = await createOrganizationWithMember(userId)
    await createSubscription(userId, 'team')
    const organizationTeamId = await createSubscription(organizationId, 'team')

    expect((await getHighestPrioritySubscription(userId))?.id).toBe(organizationTeamId)
  })

  it('ignores subscriptions that are not in an entitled status', async () => {
    const userId = await createUser()
    const organizationId = await createOrganizationWithMember(userId)
    await createSubscription(organizationId, 'enterprise', 'canceled')
    const personalProId = await createSubscription(userId, 'pro', 'past_due')

    expect((await getHighestPrioritySubscription(userId))?.id).toBe(personalProId)
  })

  it('reads a personal subscription for a user with no organization', async () => {
    const userId = await createUser()
    const personalProId = await createSubscription(userId, 'pro')

    expect((await getHighestPrioritySubscription(userId))?.id).toBe(personalProId)
  })
})
