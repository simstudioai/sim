import { db } from '@sim/db'
import { awsMarketplaceLicense, member, organization, user } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { inArray } from 'drizzle-orm'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

const ACCOUNT = '000000000000'
const TEAM_PLAN = 'team_6000'
const RETIRED_PRODUCT = 'retired-product-placeholder'

const marketplace = vi.hoisted(() => ({ enabled: true, product: 'product-placeholder' }))
const PRODUCT = marketplace.product

vi.mock('@/lib/billing/aws-marketplace/config', async () => {
  const { parseAwsMarketplaceProducts } = await vi.importActual<
    typeof import('@/lib/billing/aws-marketplace/products')
  >('@/lib/billing/aws-marketplace/products')
  const sold = parseAwsMarketplaceProducts(`${marketplace.product}=contract`)
  return { getAwsMarketplaceProducts: () => (marketplace.enabled ? sold : new Map()) }
})

import {
  assertPersonalCheckoutAllowed,
  authorizeSubscriptionReference,
} from '@/lib/billing/authorization'

type LicenseStatus = (typeof awsMarketplaceLicense.$inferInsert)['status']

const MARKETPLACE_REFUSAL = /billed through AWS Marketplace/

const userIds: string[] = []
const organizationIds: string[] = []

async function createUser(): Promise<string> {
  const id = generateId()
  userIds.push(id)
  await db.insert(user).values({
    id,
    name: 'Checkout guard fixture',
    email: `${id}@example.test`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  return id
}

/** An organization `ownerId` owns, so every check but the one under test admits the checkout. */
async function createOwnedOrganization(ownerId: string): Promise<string> {
  const id = generateId()
  organizationIds.push(id)
  await db
    .insert(organization)
    .values({ id, name: 'Checkout guard org', slug: id, createdAt: new Date() })
  await db.insert(member).values({
    id: generateId(),
    organizationId: id,
    userId: ownerId,
    role: 'owner',
    createdAt: new Date(),
  })
  return id
}

async function insertLicense(link: {
  organizationId: string | null
  linkedByUserId: string
  status: LicenseStatus
  productCode?: string
}) {
  const now = new Date()
  await db.insert(awsMarketplaceLicense).values({
    id: generateId(),
    licenseArn: `license-${generateId()}`,
    productCode: link.productCode ?? PRODUCT,
    customerAwsAccountId: ACCOUNT,
    dimension: 'enterprise',
    quantity: 25,
    lastVerifiedAt: now,
    lastVerificationAttemptAt: now,
    ...link,
  })
}

async function organizationWithLicense(status: LicenseStatus | null) {
  const ownerId = await createUser()
  const organizationId = await createOwnedOrganization(ownerId)
  if (status) await insertLicense({ organizationId, linkedByUserId: ownerId, status })
  return { ownerId, organizationId }
}

afterEach(() => {
  marketplace.enabled = true
})

afterAll(async () => {
  if (organizationIds.length) {
    await db
      .delete(awsMarketplaceLicense)
      .where(inArray(awsMarketplaceLicense.organizationId, organizationIds))
    await db.delete(organization).where(inArray(organization.id, organizationIds))
  }
  if (userIds.length) {
    await db
      .delete(awsMarketplaceLicense)
      .where(inArray(awsMarketplaceLicense.linkedByUserId, userIds))
    await db.delete(user).where(inArray(user.id, userIds))
  }
})

describe('Stripe checkout for an AWS Marketplace-billed reference', () => {
  it.each(['pending', 'active'] as const)(
    'refuses an organization whose license is %s',
    async (status) => {
      const { ownerId, organizationId } = await organizationWithLicense(status)

      await expect(
        authorizeSubscriptionReference(ownerId, organizationId, 'upgrade-subscription', TEAM_PLAN)
      ).rejects.toMatchObject({
        statusCode: 409,
        message: expect.stringMatching(MARKETPLACE_REFUSAL),
      })
    }
  )

  it('refuses a personal checkout for a user whose account holds a license', async () => {
    const userId = await createUser()
    await insertLicense({ organizationId: null, linkedByUserId: userId, status: 'active' })

    await expect(assertPersonalCheckoutAllowed(userId)).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringMatching(MARKETPLACE_REFUSAL),
    })
  })

  it('allows an organization whose license is inactive', async () => {
    const { ownerId, organizationId } = await organizationWithLicense('inactive')

    await expect(
      authorizeSubscriptionReference(ownerId, organizationId, 'upgrade-subscription', TEAM_PLAN)
    ).resolves.toBe(true)
  })

  it('allows an organization whose only license is on a listing this deployment no longer sells', async () => {
    const ownerId = await createUser()
    const organizationId = await createOwnedOrganization(ownerId)
    await insertLicense({
      organizationId,
      linkedByUserId: ownerId,
      status: 'active',
      productCode: RETIRED_PRODUCT,
    })

    await expect(
      authorizeSubscriptionReference(ownerId, organizationId, 'upgrade-subscription', TEAM_PLAN)
    ).resolves.toBe(true)
  })

  it('allows an organization with no license', async () => {
    const { ownerId, organizationId } = await organizationWithLicense(null)

    await expect(
      authorizeSubscriptionReference(ownerId, organizationId, 'upgrade-subscription', TEAM_PLAN)
    ).resolves.toBe(true)
  })

  it('allows a licensed organization and account where Sim does not sell on AWS', async () => {
    const { ownerId, organizationId } = await organizationWithLicense('active')
    const userId = await createUser()
    await insertLicense({ organizationId: null, linkedByUserId: userId, status: 'active' })
    marketplace.enabled = false

    await expect(
      authorizeSubscriptionReference(ownerId, organizationId, 'upgrade-subscription', TEAM_PLAN)
    ).resolves.toBe(true)
    await expect(assertPersonalCheckoutAllowed(userId)).resolves.toBeUndefined()
  })

  it.each(['billing-portal', 'cancel-subscription', 'list-subscription'])(
    'still allows %s for a licensed organization',
    async (action) => {
      const { ownerId, organizationId } = await organizationWithLicense('active')

      await expect(authorizeSubscriptionReference(ownerId, organizationId, action)).resolves.toBe(
        true
      )
    }
  )
})
