/**
 * Payment recovery against real PostgreSQL: a paid invoice lifts the payment-failed block from
 * every member its failure blocked, whoever the organization's owner is by then.
 */
import { db } from '@sim/db'
import { member, organization, subscription, user, userStats } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { inArray } from 'drizzle-orm'
import type Stripe from 'stripe'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleInvoicePaymentSucceeded } from '@/lib/billing/webhooks/invoices'

const { stripeStub } = vi.hoisted(() => ({
  stripeStub: { invoices: { list: vi.fn() } },
}))

vi.mock('@/lib/billing/stripe-client', () => ({
  requireStripeClient: () => stripeStub,
  getStripeClient: () => stripeStub,
}))

const userIds: string[] = []
const organizationIds: string[] = []

async function createUser(blocked: boolean): Promise<string> {
  const id = `invoice-recovery-${generateId()}`
  const now = new Date()
  await db.insert(user).values({
    id,
    name: 'Invoice Recovery Test',
    email: `${id}@invoice-recovery.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(userStats).values({
    id: generateId(),
    userId: id,
    billingBlocked: blocked,
    billingBlockedReason: blocked ? 'payment_failed' : null,
  })
  userIds.push(id)
  return id
}

/** A Team organization whose owner is `ownerBlocked` and whose other members are `membersBlocked`. */
async function createTeam(ownerBlocked: boolean, membersBlocked: boolean) {
  const organizationId = `invoice-recovery-org-${generateId()}`
  await db.insert(organization).values({
    id: organizationId,
    name: 'Invoice Recovery Org',
    slug: organizationId,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  organizationIds.push(organizationId)
  const ownerId = await createUser(ownerBlocked)
  const memberIds = [await createUser(membersBlocked), await createUser(membersBlocked)]
  for (const [index, userId] of [ownerId, ...memberIds].entries()) {
    await db.insert(member).values({
      id: generateId(),
      userId,
      organizationId,
      role: index === 0 ? 'owner' : 'member',
      createdAt: new Date(),
    })
  }
  const stripeSubscriptionId = `sub_${generateId()}`
  await db.insert(subscription).values({
    id: generateId(),
    plan: 'team_6000',
    referenceId: organizationId,
    stripeCustomerId: `cus_${generateId()}`,
    stripeSubscriptionId,
    status: 'active',
    seats: 3,
    periodStart: new Date(Date.now() - 86_400_000),
    periodEnd: new Date(Date.now() + 29 * 86_400_000),
  })
  return { organizationId, ownerId, memberIds, stripeSubscriptionId }
}

function paidOverageInvoice(stripeSubscriptionId: string): Stripe.Event {
  const invoice = {
    id: `in_${generateId()}`,
    object: 'invoice',
    amount_paid: 3582,
    billing_reason: 'manual',
    customer: `cus_${generateId()}`,
    currency: 'usd',
    metadata: {
      billingPeriod: '2026-10',
      subscriptionId: stripeSubscriptionId,
      type: 'overage_threshold_billing_org',
    },
  }
  return {
    id: `evt_${generateId()}`,
    type: 'invoice.payment_succeeded',
    data: { object: invoice },
  } as unknown as Stripe.Event
}

async function blockedUserIds(ids: string[]): Promise<string[]> {
  const rows = await db
    .select({ userId: userStats.userId, billingBlocked: userStats.billingBlocked })
    .from(userStats)
    .where(inArray(userStats.userId, ids))
  return rows.filter((row) => row.billingBlocked).map((row) => row.userId)
}

beforeEach(() => {
  stripeStub.invoices.list.mockReset()
  stripeStub.invoices.list.mockImplementation(async function* () {})
})

afterAll(async () => {
  if (organizationIds.length > 0) {
    await db.delete(subscription).where(inArray(subscription.referenceId, organizationIds))
    await db.delete(member).where(inArray(member.organizationId, organizationIds))
    await db.delete(organization).where(inArray(organization.id, organizationIds))
  }
  if (userIds.length > 0) {
    await db.delete(userStats).where(inArray(userStats.userId, userIds))
    await db.delete(user).where(inArray(user.id, userIds))
  }
})

describe('a paid invoice after a failed one', () => {
  it('unblocks members still blocked when the owner was already unblocked', async () => {
    // The owner's row was cleared by another organization's recovery, or ownership moved to a
    // member who joined after the block.
    const team = await createTeam(false, true)

    await handleInvoicePaymentSucceeded(paidOverageInvoice(team.stripeSubscriptionId))

    expect(await blockedUserIds([team.ownerId, ...team.memberIds])).toEqual([])
  })

  it('keeps members blocked while another invoice for the plan is still failing', async () => {
    const team = await createTeam(true, true)
    stripeStub.invoices.list.mockImplementation(async function* () {
      yield {
        id: `in_${generateId()}`,
        collection_method: 'charge_automatically',
        attempt_count: 1,
        metadata: {
          subscriptionId: team.stripeSubscriptionId,
          type: 'overage_threshold_billing_org',
        },
      }
    })

    await handleInvoicePaymentSucceeded(paidOverageInvoice(team.stripeSubscriptionId))

    expect((await blockedUserIds([team.ownerId, ...team.memberIds])).sort()).toEqual(
      [team.ownerId, ...team.memberIds].sort()
    )
  })

  it('skips the Stripe invoice listing for an organization nobody is blocked in', async () => {
    const team = await createTeam(false, false)

    await handleInvoicePaymentSucceeded(paidOverageInvoice(team.stripeSubscriptionId))

    expect(stripeStub.invoices.list).not.toHaveBeenCalled()
  })
})
