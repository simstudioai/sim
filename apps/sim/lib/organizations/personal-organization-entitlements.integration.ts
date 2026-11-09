/**
 * Team and Enterprise configuration is refused on a personal organization by the application, with
 * a typed error, before migration 0456's triggers would ever fire. Runs as a self-hosted deployment
 * with every Enterprise feature switched on, the case where only the organization's kind stands
 * between a personal organization and that configuration.
 */
import { db } from '@sim/db'
import { member, organization, user, userStats } from '@sim/db/schema'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { generateId } from '@sim/utils/id'
import { inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.ENTERPRISE_ENABLED = 'true'
  process.env.SCIM_ENABLED = 'true'
})

import {
  isOrganizationFeatureEntitled,
  isOrganizationOnEnterprisePlan,
} from '@/lib/billing/core/subscription'
import { createOrganizationWithOwner } from '@/lib/billing/organizations/create-organization'
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
    ).rejects.toMatchObject({ code: 'forbidden' })
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
    const open = (userId: string, organizationId: string, section: 'members' | 'sso' | 'usage') =>
      authorizeOrganizationSettingsSection({ organizationId, userId, section })

    expect(await open(personalOwnerId, personalId, 'members')).toBe(false)
    expect(await open(personalOwnerId, personalId, 'sso')).toBe(false)
    expect(await open(personalOwnerId, personalId, 'usage')).toBe(true)
    expect(await open(teamOwnerId, teamId, 'members')).toBe(true)
    expect(await open(teamOwnerId, teamId, 'sso')).toBe(true)
  })
})
