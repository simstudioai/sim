import { db } from '@sim/db'
import { member, organization, simLink, user } from '@sim/db/schema'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, expect, it, vi } from 'vitest'
import { removeUserFromOrganization } from '@/lib/billing/organizations/membership'
import { createSimLink } from '@/lib/sim-links/application/use-cases'

vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)

readTestDatabaseUrl()

const ownerId = generateId()
const creatorId = generateId()
const organizationId = generateId()
const creatorMemberId = generateId()

afterAll(async () => {
  await db.delete(organization).where(eq(organization.id, organizationId))
  await db.delete(user).where(inArray(user.id, [ownerId, creatorId]))
})

it('refuses a link whose creator is removed after authorization but before the insert', async () => {
  await db.insert(user).values(
    [ownerId, creatorId].map((id) => ({
      id,
      name: 'Sim link fixture',
      email: `${id}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }))
  )
  await db.insert(organization).values({
    id: organizationId,
    name: 'Sim link organization',
    slug: organizationId,
    createdAt: new Date(),
  })
  await db.insert(member).values([
    { id: generateId(), organizationId, userId: ownerId, role: 'owner', createdAt: new Date() },
    {
      id: creatorMemberId,
      organizationId,
      userId: creatorId,
      role: 'member',
      createdAt: new Date(),
    },
  ])

  const authorized = createDeferred<void>()
  const proceed = createDeferred<void>()
  featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(async (flag) => {
    if (flag !== 'sim-links') return false
    authorized.resolve()
    await proceed.promise
    return true
  })

  const creation = createSimLink.execute({
    principal: createSessionPrincipal({ userId: creatorId }),
    input: {
      organizationId,
      name: 'handbook',
      url: 'https://example.test/handbook',
      defaultUrl: null,
      description: null,
      unlisted: true,
      restrictEdit: true,
    },
  })
  const settled = creation.then(
    () => null,
    (error: unknown) => error
  )
  await authorized.promise
  expect(
    (
      await removeUserFromOrganization({
        organizationId,
        userId: creatorId,
        memberId: creatorMemberId,
        skipBillingLogic: true,
        onError: 'throw',
      })
    ).success
  ).toBe(true)
  proceed.resolve()

  expect(await settled).toMatchObject({ message: 'Organization not found' })
  expect(
    await db
      .select({ id: simLink.id })
      .from(simLink)
      .where(eq(simLink.organizationId, organizationId))
  ).toEqual([])
})
