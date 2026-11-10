/**
 * Team and Enterprise configuration is refused on a personal organization by the application, with
 * a typed error, before migration 0456's triggers would ever fire. Runs as a self-hosted deployment
 * with every Enterprise feature switched on, the case where only the organization's kind stands
 * between a personal organization and that configuration.
 */
import { db } from '@sim/db'
import {
  member,
  organization,
  organizationMemberUsageLimit,
  subscription,
  user,
  userStats,
} from '@sim/db/schema'
import { deleteOutboxEventsNaming } from '@sim/db/testing/outbox-fixtures'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.ENTERPRISE_ENABLED = 'true'
  process.env.SCIM_ENABLED = 'true'
})

import { transferSubscriptionToOrganization } from '@/lib/billing/application/subscription-transfer'
import {
  isOrganizationFeatureEntitled,
  isOrganizationOnEnterprisePlan,
} from '@/lib/billing/core/subscription'
import { createOrganizationWithOwner } from '@/lib/billing/organizations/create-organization'
import { setOrgMemberUsageLimit } from '@/lib/billing/organizations/member-limits'
import {
  updateOrganizationDataRetention,
  updateOrganizationWhitelabel,
} from '@/lib/organizations/application/configuration'
import { provisionPersonalOrganization } from '@/lib/organizations/provision-personal'
import { isOrganizationPermissionRegimeActive } from '@/lib/permission-groups/resolve.server'
import { authorizeOrganizationSettingsSection } from '@/lib/settings/application/organization-section-access'
import { isCustomBlocksEligibleForOrganization } from '@/lib/workflows/custom-blocks/operations'
import { isScimEntitledForOrganization } from '@/ee/scim/lib/entitlement'

const userIds: string[] = []

async function createUser(): Promise<string> {
  const id = `entitlement-user-${generateId()}`
  const now = new Date()
  await db.insert(user).values({
    id,
    name: 'Entitlement Test',
    email: `${id}@entitlement.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(userStats).values({ id: generateId(), userId: id })
  userIds.push(id)
  return id
}

async function personalAndTeam() {
  const personalOwnerId = await createUser()
  const teamOwnerId = await createUser()
  const provisioned = await provisionPersonalOrganization(personalOwnerId)
  if (provisioned.status !== 'provisioned') throw new Error('expected provisioning')
  const { organizationId: teamId } = await createOrganizationWithOwner({
    actor: { type: 'system', name: 'Test' },
    ownerUserId: teamOwnerId,
    name: 'Entitled Team',
    slug: `entitled-${generateId()}`.toLowerCase(),
  })
  return { personalOwnerId, personalId: provisioned.organizationId, teamOwnerId, teamId }
}

afterAll(async () => {
  if (userIds.length === 0) return
  const organizations = await db
    .select({ id: member.organizationId })
    .from(member)
    .where(inArray(member.userId, userIds))
  await deleteOutboxEventsNaming(db, [...userIds, ...organizations.map((row) => row.id)])
  await db
    .delete(subscription)
    .where(inArray(subscription.referenceId, [...userIds, ...organizations.map((row) => row.id)]))
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

describe('team configuration on a personal organization', () => {
  it('refuses whitelabeling through the use case with a typed error', async () => {
    const { personalOwnerId, personalId, teamOwnerId, teamId } = await personalAndTeam()

    await expect(
      updateOrganizationWhitelabel.execute({
        principal: createSessionPrincipal({ userId: personalOwnerId }),
        input: { organizationId: personalId, settings: { brandName: 'Mine' } },
      })
    ).rejects.toMatchObject({
      code: 'forbidden',
      message: 'Whitelabeling is available to team organizations only.',
    })
    await expect(
      updateOrganizationWhitelabel.execute({
        principal: createSessionPrincipal({ userId: teamOwnerId }),
        input: { organizationId: teamId, settings: { brandName: 'Ours' } },
      })
    ).resolves.toBeDefined()
  })

  it('refuses data retention through the use case with a typed error', async () => {
    const { personalOwnerId, personalId, teamOwnerId, teamId } = await personalAndTeam()
    const settings = {
      logRetentionHours: null,
      softDeleteRetentionHours: null,
      taskCleanupHours: null,
      fileVersionRetentionHours: null,
    }

    await expect(
      updateOrganizationDataRetention.execute({
        principal: createSessionPrincipal({ userId: personalOwnerId }),
        input: { organizationId: personalId, settings },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    await expect(
      updateOrganizationDataRetention.execute({
        principal: createSessionPrincipal({ userId: teamOwnerId }),
        input: { organizationId: teamId, settings },
      })
    ).resolves.toBeDefined()
  })

  it('withholds SSO, session policy and custom blocks entitlement', async () => {
    const { personalId, teamId } = await personalAndTeam()

    expect(await isOrganizationFeatureEntitled(personalId, true)).toBe(false)
    expect(await isOrganizationFeatureEntitled(teamId, true)).toBe(true)
    expect(await isCustomBlocksEligibleForOrganization(personalId)).toBe(false)
    expect(await isCustomBlocksEligibleForOrganization(teamId)).toBe(true)
  })

  it('withholds data drains and domain verification entitlement', async () => {
    const { personalId, teamId } = await personalAndTeam()

    expect(await isOrganizationOnEnterprisePlan(personalId)).toBe(false)
    expect(await isOrganizationOnEnterprisePlan(teamId)).toBe(true)
  })

  it('withholds SCIM provisioning', async () => {
    const { personalId, teamId } = await personalAndTeam()

    expect(await isScimEntitledForOrganization(personalId)).toBe(false)
    expect(await isScimEntitledForOrganization(teamId)).toBe(true)
  })

  it('withholds the permission-group regime', async () => {
    const { personalId, teamId } = await personalAndTeam()

    expect(await isOrganizationPermissionRegimeActive(personalId)).toBe(false)
    expect(await isOrganizationPermissionRegimeActive(teamId)).toBe(true)
  })

  it('offers its owner only the personal settings sections', async () => {
    const { personalOwnerId, personalId, teamOwnerId, teamId } = await personalAndTeam()
    const open = (
      userId: string,
      organizationId: string,
      section: 'members' | 'sso' | 'recently-deleted'
    ) => authorizeOrganizationSettingsSection({ organizationId, userId, section })

    expect(await open(personalOwnerId, personalId, 'members')).toBe(false)
    expect(await open(personalOwnerId, personalId, 'sso')).toBe(false)
    expect(await open(personalOwnerId, personalId, 'recently-deleted')).toBe(true)
    expect(await open(teamOwnerId, teamId, 'members')).toBe(true)
    expect(await open(teamOwnerId, teamId, 'sso')).toBe(true)
  })
})

describe('billing on a personal organization', () => {
  it('refuses moving a Team subscription onto it, and moves one onto a team', async () => {
    const { personalOwnerId, personalId, teamOwnerId, teamId } = await personalAndTeam()
    const subscriptionFor = async (referenceId: string) => {
      const id = generateId()
      await db
        .insert(subscription)
        .values({ id, plan: 'team', referenceId, status: 'active', seats: 1 })
      return id
    }
    const personalSubscription = await subscriptionFor(personalOwnerId)
    const teamSubscription = await subscriptionFor(teamOwnerId)

    await expect(
      transferSubscriptionToOrganization.execute({
        principal: createSessionPrincipal({ userId: personalOwnerId }),
        input: { subscriptionId: personalSubscription, organizationId: personalId },
      })
    ).rejects.toMatchObject({
      code: 'validation',
      message: 'A subscription cannot be transferred to a personal organization.',
    })
    await expect(
      transferSubscriptionToOrganization.execute({
        principal: createSessionPrincipal({ userId: teamOwnerId }),
        input: { subscriptionId: teamSubscription, organizationId: teamId },
      })
    ).resolves.toMatchObject({ transferred: true })
  })

  it('refuses a per-member usage limit, and sets one on a team', async () => {
    const { personalOwnerId, personalId, teamOwnerId, teamId } = await personalAndTeam()
    const limitOf = (organizationId: string, userId: string) =>
      db
        .select({ usageLimit: organizationMemberUsageLimit.usageLimit })
        .from(organizationMemberUsageLimit)
        .where(
          and(
            eq(organizationMemberUsageLimit.organizationId, organizationId),
            eq(organizationMemberUsageLimit.userId, userId)
          )
        )

    await expect(setOrgMemberUsageLimit(personalId, personalOwnerId, 10)).rejects.toMatchObject({
      code: 'forbidden',
      message: 'Only team organizations can use per-member usage limits.',
    })
    expect(await limitOf(personalId, personalOwnerId)).toEqual([])
    await setOrgMemberUsageLimit(teamId, teamOwnerId, 10)
    expect(await limitOf(teamId, teamOwnerId)).toHaveLength(1)
  })
})
