import { db } from '@sim/db'
import {
  awsMarketplaceLicense,
  member,
  organization,
  outboxEvent,
  subscription,
  user,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

const ACCOUNT = '000000000000'
const TEAM_PLAN = 'team_6000'

const marketplace = vi.hoisted(() => ({ enabled: true, product: 'product-placeholder' }))

vi.mock('@/lib/billing/aws-marketplace/config', async () => {
  const actual = await vi.importActual<typeof import('@/lib/billing/aws-marketplace/config')>(
    '@/lib/billing/aws-marketplace/config'
  )
  const { parseAwsMarketplaceProducts } = await vi.importActual<
    typeof import('@/lib/billing/aws-marketplace/products')
  >('@/lib/billing/aws-marketplace/products')
  const sold = parseAwsMarketplaceProducts(`${marketplace.product}=contract`)
  return {
    ...actual,
    getAwsMarketplaceProducts: () => (marketplace.enabled ? sold : new Map()),
  }
})

import { linkAwsMarketplaceLicenseAsAdmin } from '@/lib/billing/aws-marketplace/application/admin'
import { cancelStripeSubscriptionBilledThroughMarketplace } from '@/lib/billing/aws-marketplace/stripe-fence'
import { acquireOrganizationMutationLock } from '@/lib/billing/organizations/membership'
import { OUTBOX_EVENT_TYPES } from '@/lib/billing/webhooks/outbox-events'
import type { DbTransaction } from '@/lib/db/types'

type LicenseStatus = (typeof awsMarketplaceLicense.$inferInsert)['status']

const ADMIN = { id: null, name: 'Fence fixture admin', email: null }
/** Long enough that a statement not waiting on a lock has finished. */
const LOCK_WAIT_PROBE_MS = 300

const userIds: string[] = []
const organizationIds: string[] = []
const subscriptionIds: string[] = []

async function createUser(): Promise<string> {
  const id = generateId()
  userIds.push(id)
  await db.insert(user).values({
    id,
    name: 'Stripe fence fixture',
    email: `${id}@example.test`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  return id
}

async function createOrganization(ownerId: string): Promise<string> {
  const id = generateId()
  organizationIds.push(id)
  await db
    .insert(organization)
    .values({ id, name: 'Stripe fence org', slug: id, createdAt: new Date() })
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
  linkedByUserId: string | null
  status?: LicenseStatus
}): Promise<string> {
  const id = generateId()
  const now = new Date()
  await db.insert(awsMarketplaceLicense).values({
    id,
    licenseArn: `license-${generateId()}`,
    productCode: marketplace.product,
    customerAwsAccountId: ACCOUNT,
    dimension: 'enterprise',
    quantity: 25,
    lastVerifiedAt: now,
    lastVerificationAttemptAt: now,
    status: link.status ?? 'active',
    organizationId: link.organizationId,
    linkedByUserId: link.linkedByUserId,
  })
  return id
}

/** The row Better Auth's Stripe plugin has just bound when `onSubscriptionComplete` runs. */
async function bindSubscription(
  referenceId: string,
  overrides: { plan?: string; bound?: boolean } = {}
): Promise<string> {
  const id = generateId()
  subscriptionIds.push(id)
  const plan = overrides.plan ?? TEAM_PLAN
  await db.insert(subscription).values({
    id,
    plan,
    referenceId,
    status: 'active',
    stripeSubscriptionId: overrides.bound === false ? null : `sub_${generateId()}`,
    metadata: { plan, referenceId, seats: 5, monthlyPrice: 100 },
  })
  return id
}

async function queuedCancellations(subscriptionId: string) {
  return db
    .select({ id: outboxEvent.id, payload: outboxEvent.payload })
    .from(outboxEvent)
    .where(
      and(
        eq(outboxEvent.eventType, OUTBOX_EVENT_TYPES.STRIPE_CANCEL_SUBSCRIPTION_IMMEDIATELY),
        sql`${outboxEvent.payload} ->> 'subscriptionId' = ${subscriptionId}`
      )
    )
}

async function queuedTeamNotices(subscriptionId: string) {
  return db
    .select({ id: outboxEvent.id })
    .from(outboxEvent)
    .where(eq(outboxEvent.id, `aws-marketplace-stripe-cancel-notice-${subscriptionId}`))
}

/** Settles `promise` into whether it finished within the probe window, without awaiting it. */
async function finishesWithinProbe(promise: Promise<unknown>): Promise<boolean> {
  return Promise.race([
    promise.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), LOCK_WAIT_PROBE_MS)),
  ])
}

/** A transaction left open until `release` is called, holding what `hold` takes. */
function openTransaction(hold: (tx: DbTransaction) => Promise<void>) {
  let release: () => void = () => {}
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  let holding: () => void = () => {}
  const held = new Promise<void>((resolve) => {
    holding = resolve
  })
  const done = db.transaction(async (tx) => {
    await hold(tx)
    holding()
    await released
  })
  return { held, release, done }
}

afterEach(() => {
  marketplace.enabled = true
})

afterAll(async () => {
  if (subscriptionIds.length) {
    await db.delete(outboxEvent).where(
      inArray(
        outboxEvent.id,
        subscriptionIds.flatMap((id) => [
          `aws-marketplace-stripe-cancel-${id}`,
          `aws-marketplace-stripe-cancel-notice-${id}`,
        ])
      )
    )
    await db.delete(subscription).where(inArray(subscription.id, subscriptionIds))
  }
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

describe('a Stripe subscription binding to a customer AWS Marketplace bills', () => {
  it('cancels it at once and tells the team, once however often the webhook is redelivered', async () => {
    const ownerId = await createUser()
    const organizationId = await createOrganization(ownerId)
    const licenseId = await insertLicense({ organizationId, linkedByUserId: ownerId })
    const subscriptionId = await bindSubscription(organizationId)

    await expect(cancelStripeSubscriptionBilledThroughMarketplace(subscriptionId)).resolves.toBe(
      true
    )
    await expect(cancelStripeSubscriptionBilledThroughMarketplace(subscriptionId)).resolves.toBe(
      true
    )

    const cancellations = await queuedCancellations(subscriptionId)
    expect(cancellations).toHaveLength(1)
    expect(cancellations[0]?.payload).toMatchObject({
      subscriptionId,
      organizationId,
      reason: 'billed-through-aws-marketplace',
    })
    expect(await queuedTeamNotices(subscriptionId)).toHaveLength(1)
    const [notice] = await db
      .select({ payload: outboxEvent.payload })
      .from(outboxEvent)
      .where(eq(outboxEvent.id, `aws-marketplace-stripe-cancel-notice-${subscriptionId}`))
    expect(notice?.payload).toMatchObject({ kind: 'stripe-cancelled', licenseIds: [licenseId] })
  })

  it('cancels a personal plan for an account holding a license with no organization yet', async () => {
    const userId = await createUser()
    await insertLicense({ organizationId: null, linkedByUserId: userId })
    const subscriptionId = await bindSubscription(userId, { plan: 'pro_6000' })

    await expect(cancelStripeSubscriptionBilledThroughMarketplace(subscriptionId)).resolves.toBe(
      true
    )
    const [cancellation] = await queuedCancellations(subscriptionId)
    expect(cancellation?.payload).not.toHaveProperty('organizationId')
  })

  it.each([
    ['no license', { license: null, plan: TEAM_PLAN, bound: true }],
    ['only an inactive license', { license: 'inactive', plan: TEAM_PLAN, bound: true }],
    [
      'an Enterprise subscription the team issued',
      { license: 'active', plan: 'enterprise', bound: true },
    ],
    ['no Stripe subscription bound yet', { license: 'active', plan: TEAM_PLAN, bound: false }],
  ] as const)('leaves it alone with %s', async (_, setup) => {
    const ownerId = await createUser()
    const organizationId = await createOrganization(ownerId)
    if (setup.license) {
      await insertLicense({ organizationId, linkedByUserId: ownerId, status: setup.license })
    }
    const subscriptionId = await bindSubscription(organizationId, {
      plan: setup.plan,
      bound: setup.bound,
    })

    await expect(cancelStripeSubscriptionBilledThroughMarketplace(subscriptionId)).resolves.toBe(
      false
    )
    expect(await queuedCancellations(subscriptionId)).toHaveLength(0)
  })

  it('leaves it alone where Sim does not sell on AWS Marketplace', async () => {
    const ownerId = await createUser()
    const organizationId = await createOrganization(ownerId)
    await insertLicense({ organizationId, linkedByUserId: ownerId })
    const subscriptionId = await bindSubscription(organizationId)
    marketplace.enabled = false

    await expect(cancelStripeSubscriptionBilledThroughMarketplace(subscriptionId)).resolves.toBe(
      false
    )
    expect(await queuedCancellations(subscriptionId)).toHaveLength(0)
  })
})

describe('a Stripe checkout racing an AWS Marketplace link', () => {
  it('cancels the subscription when the link commits first', async () => {
    const ownerId = await createUser()
    const organizationId = await createOrganization(ownerId)
    const licenseId = await insertLicense({ organizationId: null, linkedByUserId: null })

    await linkAwsMarketplaceLicenseAsAdmin({ licenseId, organizationId }, ADMIN)
    const subscriptionId = await bindSubscription(organizationId)

    await expect(cancelStripeSubscriptionBilledThroughMarketplace(subscriptionId)).resolves.toBe(
      true
    )
    expect(await queuedCancellations(subscriptionId)).toHaveLength(1)
  })

  it('refuses the link when the subscription binds first, and keeps the subscription', async () => {
    const ownerId = await createUser()
    const organizationId = await createOrganization(ownerId)
    const licenseId = await insertLicense({ organizationId: null, linkedByUserId: null })
    const subscriptionId = await bindSubscription(organizationId)

    await expect(
      linkAwsMarketplaceLicenseAsAdmin({ licenseId, organizationId }, ADMIN)
    ).rejects.toMatchObject({ code: 'conflict' })
    await expect(cancelStripeSubscriptionBilledThroughMarketplace(subscriptionId)).resolves.toBe(
      false
    )
    expect(await queuedCancellations(subscriptionId)).toHaveLength(0)
  })

  it('waits for a link that passed its Stripe check, then sees the license it commits', async () => {
    const ownerId = await createUser()
    const organizationId = await createOrganization(ownerId)
    const licenseId = await insertLicense({ organizationId: null, linkedByUserId: null })
    // The link's state between its Stripe check and its commit: lock held, license taken.
    const link = openTransaction(async (tx) => {
      await acquireOrganizationMutationLock(tx, organizationId)
      await tx
        .update(awsMarketplaceLicense)
        .set({ organizationId })
        .where(eq(awsMarketplaceLicense.id, licenseId))
    })
    await link.held
    const subscriptionId = await bindSubscription(organizationId)

    const fence = cancelStripeSubscriptionBilledThroughMarketplace(subscriptionId)
    const finishedEarly = await finishesWithinProbe(fence)
    link.release()
    await link.done

    expect(finishedEarly).toBe(false)
    await expect(fence).resolves.toBe(true)
    expect(await queuedCancellations(subscriptionId)).toHaveLength(1)
  })

  it('makes a link wait for a binding that is checking the organization', async () => {
    const ownerId = await createUser()
    const organizationId = await createOrganization(ownerId)
    const licenseId = await insertLicense({ organizationId: null, linkedByUserId: null })
    const binding = openTransaction((tx) => acquireOrganizationMutationLock(tx, organizationId))
    await binding.held

    const linking = linkAwsMarketplaceLicenseAsAdmin({ licenseId, organizationId }, ADMIN)
    const finishedEarly = await finishesWithinProbe(linking)
    binding.release()
    await binding.done

    expect(finishedEarly).toBe(false)
    await expect(linking).resolves.toMatchObject({ id: licenseId, organizationId })
  })
})
