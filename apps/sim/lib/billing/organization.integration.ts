/**
 * A Team subscription accepted for an account with a personal organization converts that
 * organization in place, moves the subscription onto it, and attaches the owner's workspaces, all
 * inside the caller's transaction. Failure mode: one step commits on its own, so a failed workspace
 * attachment leaves a converted Team organization (or a subscription pointed at it) behind while
 * the acceptance reports failure.
 */
import { db } from '@sim/db'
import { member, organization, subscription, user } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'

/** The one injected fault: attaching workspaces fails after everything before it has written. */
const attachFault = vi.hoisted(() => ({ armed: false }))
vi.mock('@/lib/workspaces/organization-workspaces', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/workspaces/organization-workspaces')>()
  return {
    ...actual,
    attachOwnedWorkspacesToOrganizationTx: async (
      ...args: Parameters<typeof actual.attachOwnedWorkspacesToOrganizationTx>
    ) => {
      if (attachFault.armed) throw new Error('workspace attachment failed')
      return actual.attachOwnedWorkspacesToOrganizationTx(...args)
    },
  }
})

import { ensureOrganizationForTeamSubscriptionTx } from '@/lib/billing/organization'
import { createPersonalOrganization } from '@/lib/organizations/provision-personal'

const userIds: string[] = []
const subscriptionIds: string[] = []

async function ownerWithPersonalOrganization() {
  const userId = `team-accept-${generateId()}`
  const now = new Date()
  await db.insert(user).values({
    id: userId,
    name: 'Team acceptance owner',
    email: `${userId}@team-accept.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  userIds.push(userId)
  const organizationId = await createPersonalOrganization(userId)
  if (!organizationId) throw new Error('expected a personal organization')
  const subscriptionId = generateId()
  await db
    .insert(subscription)
    .values({ id: subscriptionId, plan: 'team', referenceId: userId, status: 'active', seats: 1 })
  subscriptionIds.push(subscriptionId)
  return { userId, organizationId, subscriptionId }
}

afterAll(async () => {
  attachFault.armed = false
  if (subscriptionIds.length) {
    await db.delete(subscription).where(inArray(subscription.id, subscriptionIds))
  }
  if (userIds.length) {
    const organizations = await db
      .select({ id: member.organizationId })
      .from(member)
      .where(inArray(member.userId, userIds))
    if (organizations.length) {
      await db.delete(organization).where(
        inArray(
          organization.id,
          organizations.map((row) => row.id)
        )
      )
    }
    await db.delete(user).where(inArray(user.id, userIds))
  }
})

describe('accepting a Team subscription for a personal organization', () => {
  it('rolls the conversion and the subscription move back when attaching workspaces fails', async () => {
    const { userId, organizationId, subscriptionId } = await ownerWithPersonalOrganization()
    attachFault.armed = true

    await expect(
      db.transaction((tx) =>
        ensureOrganizationForTeamSubscriptionTx(
          tx,
          {
            id: subscriptionId,
            plan: 'team',
            referenceId: userId,
            status: 'active',
            seats: 1,
            workspaceIdsToAttach: [],
          },
          { type: 'user', userId }
        )
      )
    ).rejects.toThrow('workspace attachment failed')
    attachFault.armed = false

    const [personal] = await db
      .select({ kind: organization.kind })
      .from(organization)
      .where(eq(organization.id, organizationId))
    expect(personal).toEqual({ kind: 'personal' })
    const [moved] = await db
      .select({ referenceId: subscription.referenceId })
      .from(subscription)
      .where(eq(subscription.id, subscriptionId))
    expect(moved).toEqual({ referenceId: userId })
    const memberships = await db
      .select({ organizationId: member.organizationId })
      .from(member)
      .where(eq(member.userId, userId))
    expect(memberships).toEqual([{ organizationId }])
  })
})
