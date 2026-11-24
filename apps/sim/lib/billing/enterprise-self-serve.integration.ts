/**
 * Self-serve Enterprise billing against real PostgreSQL, with Stripe stubbed at its client.
 *
 * Failure modes covered:
 * - a contract outside self-serve (or one still carrying a reporting anchor) lets its customer
 *   raise the usage limit, or bills overage on usage the flat contract already covers;
 * - a self-serve customer sets a limit below what the contract covers;
 * - a self-serve contract's seats still cap who can join, or a hard-capped contract's do not;
 * - a contract missing its seat rate runs as self-serve;
 * - auto-pay switches a contract from a session that is not its own, or one that no longer
 *   belongs to a self-serve contract;
 * - the seat true-up misses the window's peak, bills an open window, bills a window twice, or
 *   bills a contract that is not self-serve.
 */
import { db } from '@sim/db'
import {
  enterpriseSeatTrueUp,
  member,
  organization,
  outboxEvent,
  subscription,
  usageLog,
  user,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type Stripe from 'stripe'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { calculateSubscriptionOverage } from '@/lib/billing/core/billing'
import { updateOrganizationUsageLimit } from '@/lib/billing/core/organization'
import {
  resolveSeatTrueUpWindow,
  runEnterpriseSeatTrueUps,
} from '@/lib/billing/enterprise-seat-true-up'
import { ensureUserInOrganization } from '@/lib/billing/organizations/membership'
import {
  ENTERPRISE_AUTO_PAY_PURPOSE,
  handleEnterpriseAutoPaySetup,
} from '@/lib/billing/webhooks/enterprise-auto-pay'
import { OUTBOX_EVENT_TYPES } from '@/lib/billing/webhooks/outbox-events'

const { stripeStub } = vi.hoisted(() => ({
  stripeStub: {
    setupIntents: { retrieve: vi.fn() },
    customers: { update: vi.fn() },
    subscriptions: { update: vi.fn() },
  },
}))

vi.mock('@/lib/billing/stripe-client', () => ({
  requireStripeClient: () => stripeStub,
  getStripeClient: () => stripeStub,
}))
// Seat caps are enforced only where billing runs.
vi.mock('@/lib/core/config/env-flags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/core/config/env-flags')>()),
  isBillingEnabled: true,
}))

const DAY_MS = 86_400_000
/** $1,000 of included usage. */
const INCLUDED_CREDITS = 200_000
const SEAT_PRICE_CENTS = 1_000

const userIds: string[] = []
const organizationIds: string[] = []
const subscriptionIds: string[] = []

async function createUser(): Promise<string> {
  const id = `ent-self-serve-${generateId()}`
  const now = new Date()
  await db.insert(user).values({
    id,
    name: 'Self Serve Test',
    email: `${id}@self-serve.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  userIds.push(id)
  return id
}

async function createOrganization(memberCount: number, creditBalance = '0') {
  const id = `ent-self-serve-org-${generateId()}`
  await db.insert(organization).values({
    id,
    name: 'Self Serve Org',
    slug: id,
    creditBalance,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  organizationIds.push(id)
  const members: string[] = []
  for (let index = 0; index < memberCount; index++) {
    const userId = await createUser()
    await db.insert(member).values({
      id: generateId(),
      userId,
      organizationId: id,
      role: index === 0 ? 'owner' : 'member',
      createdAt: new Date(),
    })
    members.push(userId)
  }
  return { id, members }
}

async function addEnterpriseSubscription(
  organizationId: string,
  options: {
    selfServe: boolean
    seatPriceCents?: number | null
    seats: number
    periodStart: Date
    billingInterval?: 'month' | 'year'
    reportingPeriodAnchorDate?: string
  }
) {
  const id = generateId()
  const billingInterval = options.billingInterval ?? 'year'
  const periodEnd = new Date(options.periodStart)
  if (billingInterval === 'year') periodEnd.setUTCFullYear(periodEnd.getUTCFullYear() + 1)
  else periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1)
  await db.insert(subscription).values({
    id,
    plan: 'enterprise',
    referenceId: organizationId,
    stripeCustomerId: `cus_${generateId()}`,
    stripeSubscriptionId: `sub_${generateId()}`,
    status: 'active',
    periodStart: options.periodStart,
    periodEnd,
    seats: 1,
    billingInterval,
    metadata: {
      plan: 'enterprise',
      referenceId: organizationId,
      invoiceAmountCents: '1000000',
      usageLimitCredits: String(INCLUDED_CREDITS),
      seats: String(options.seats),
      ...(options.seatPriceCents === null
        ? {}
        : { seatPriceCents: String(options.seatPriceCents ?? SEAT_PRICE_CENTS) }),
      ...(options.selfServe ? { selfServe: 'true' } : {}),
      ...(options.reportingPeriodAnchorDate
        ? {
            reportingPeriodAnchorDate: options.reportingPeriodAnchorDate,
            reportingPeriodInterval: billingInterval,
          }
        : {}),
    },
  })
  subscriptionIds.push(id)
  const [row] = await db.select().from(subscription).where(eq(subscription.id, id))
  return row
}

async function recordOrganizationUsage(
  organizationId: string,
  userId: string,
  period: { start: Date; end: Date },
  cost: number
) {
  await db.insert(usageLog).values({
    id: generateId(),
    userId,
    category: 'model',
    source: 'workflow',
    description: 'self-serve overage test',
    cost: String(cost),
    billingEntityType: 'organization',
    billingEntityId: organizationId,
    billingPeriodStart: period.start,
    billingPeriodEnd: period.end,
    createdAt: new Date(period.start.getTime() + DAY_MS),
  })
}

async function trueUpInvoices(stripeSubscriptionId: string | null) {
  return db
    .select({ payload: outboxEvent.payload })
    .from(outboxEvent)
    .where(
      and(
        eq(outboxEvent.eventType, OUTBOX_EVENT_TYPES.STRIPE_THRESHOLD_OVERAGE_INVOICE),
        sql`${outboxEvent.payload} ->> 'stripeSubscriptionId' = ${stripeSubscriptionId}`
      )
    )
}

function monthsAgo(months: number): Date {
  const date = new Date()
  date.setUTCMonth(date.getUTCMonth() - months)
  return date
}

afterAll(async () => {
  if (subscriptionIds.length > 0) {
    const rows = await db
      .select({ stripeSubscriptionId: subscription.stripeSubscriptionId })
      .from(subscription)
      .where(inArray(subscription.id, subscriptionIds))
    for (const row of rows) {
      await db
        .delete(outboxEvent)
        .where(sql`${outboxEvent.payload} ->> 'stripeSubscriptionId' = ${row.stripeSubscriptionId}`)
    }
    await db.delete(subscription).where(inArray(subscription.id, subscriptionIds))
  }
  if (userIds.length > 0) {
    await db.delete(usageLog).where(inArray(usageLog.userId, userIds))
    await db.delete(user).where(inArray(user.id, userIds))
  }
  if (organizationIds.length > 0) {
    await db.delete(organization).where(inArray(organization.id, organizationIds))
  }
})

describe('the customer usage limit', () => {
  it('stays fixed on a contract outside self-serve', async () => {
    const org = await createOrganization(1)
    await addEnterpriseSubscription(org.id, {
      selfServe: false,
      seats: 5,
      periodStart: monthsAgo(1),
    })

    const result = await updateOrganizationUsageLimit(org.id, 5_000)

    expect(result.success).toBe(false)
  })

  it('stays fixed while a self-serve contract still carries a reporting anchor', async () => {
    const org = await createOrganization(1)
    await addEnterpriseSubscription(org.id, {
      selfServe: true,
      seats: 5,
      periodStart: monthsAgo(1),
      reportingPeriodAnchorDate: monthsAgo(1).toISOString().slice(0, 10),
    })

    const result = await updateOrganizationUsageLimit(org.id, 5_000)

    expect(result.success).toBe(false)
  })

  it('cannot fall below the included usage plus prepaid credit', async () => {
    const org = await createOrganization(1, '50')
    await addEnterpriseSubscription(org.id, {
      selfServe: true,
      seats: 5,
      periodStart: monthsAgo(1),
    })

    const result = await updateOrganizationUsageLimit(org.id, 1_000)

    expect(result).toMatchObject({ success: false })
    expect(result.error).toContain('1050.00')
  })

  it('is stored apart from the enforced limit once a self-serve customer raises it', async () => {
    const org = await createOrganization(1, '50')
    await addEnterpriseSubscription(org.id, {
      selfServe: true,
      seats: 5,
      periodStart: monthsAgo(1),
    })

    const result = await updateOrganizationUsageLimit(org.id, 2_500)

    expect(result).toEqual({ success: true })
    const [row] = await db
      .select({
        orgUsageLimit: organization.orgUsageLimit,
        selfServeUsageLimit: organization.selfServeUsageLimit,
      })
      .from(organization)
      .where(eq(organization.id, org.id))
    expect(Number(row?.orgUsageLimit)).toBe(2_500)
    expect(Number(row?.selfServeUsageLimit)).toBe(2_500)
  })
})

describe('overage', () => {
  it('bills usage past the included allowance on a self-serve contract', async () => {
    const org = await createOrganization(1)
    const sub = await addEnterpriseSubscription(org.id, {
      selfServe: true,
      seats: 5,
      periodStart: monthsAgo(1),
      billingInterval: 'month',
    })
    if (!sub?.periodStart || !sub.periodEnd) throw new Error('subscription period missing')
    await recordOrganizationUsage(
      org.id,
      org.members[0],
      { start: sub.periodStart, end: sub.periodEnd },
      1_500
    )

    expect(await calculateSubscriptionOverage(sub)).toBeCloseTo(500, 6)
  })

  it('never bills usage on a contract outside self-serve', async () => {
    const org = await createOrganization(1)
    const sub = await addEnterpriseSubscription(org.id, {
      selfServe: false,
      seats: 5,
      periodStart: monthsAgo(1),
      billingInterval: 'month',
    })
    if (!sub?.periodStart || !sub.periodEnd) throw new Error('subscription period missing')
    await recordOrganizationUsage(
      org.id,
      org.members[0],
      { start: sub.periodStart, end: sub.periodEnd },
      1_500
    )

    expect(await calculateSubscriptionOverage(sub)).toBe(0)
  })
})

describe('the seat cap', () => {
  it('admits members past a self-serve contract and refuses them past a hard-capped one', async () => {
    const selfServeOrg = await createOrganization(2)
    await addEnterpriseSubscription(selfServeOrg.id, {
      selfServe: true,
      seats: 2,
      periodStart: monthsAgo(1),
    })
    const fixedOrg = await createOrganization(2)
    await addEnterpriseSubscription(fixedOrg.id, {
      selfServe: false,
      seats: 2,
      periodStart: monthsAgo(1),
    })

    const joinedSelfServe = await ensureUserInOrganization({
      userId: await createUser(),
      organizationId: selfServeOrg.id,
      role: 'member',
    })
    const joinedFixed = await ensureUserInOrganization({
      userId: await createUser(),
      organizationId: fixedOrg.id,
      role: 'member',
    })

    expect(joinedSelfServe.success).toBe(true)
    expect(joinedFixed).toMatchObject({ success: false, failureCode: 'no-seats-available' })
  })

  it('stays capped when a self-serve contract has no seat rate', async () => {
    const org = await createOrganization(2)
    await addEnterpriseSubscription(org.id, {
      selfServe: true,
      seatPriceCents: null,
      seats: 2,
      periodStart: monthsAgo(1),
    })

    const joined = await ensureUserInOrganization({
      userId: await createUser(),
      organizationId: org.id,
      role: 'member',
    })

    expect(joined).toMatchObject({ success: false, failureCode: 'no-seats-available' })
  })
})

describe('auto-pay', () => {
  beforeEach(() => {
    stripeStub.setupIntents.retrieve.mockReset()
    stripeStub.customers.update.mockReset()
    stripeStub.subscriptions.update.mockReset()
    stripeStub.setupIntents.retrieve.mockResolvedValue({
      status: 'succeeded',
      payment_method: 'pm_saved',
      payment_method_types: ['card'],
    })
  })

  function setupSession(
    sub: {
      referenceId: string
      stripeCustomerId: string | null
      stripeSubscriptionId: string | null
    },
    overrides: Partial<Stripe.Checkout.Session> = {}
  ): Stripe.Checkout.Session {
    return {
      id: `cs_${generateId()}`,
      mode: 'setup',
      customer: sub.stripeCustomerId,
      setup_intent: 'seti_1',
      metadata: {
        purpose: ENTERPRISE_AUTO_PAY_PURPOSE,
        organizationId: sub.referenceId,
        stripeSubscriptionId: sub.stripeSubscriptionId ?? '',
      },
      ...overrides,
    } as Stripe.Checkout.Session
  }

  it('switches a self-serve contract to its saved payment method', async () => {
    const org = await createOrganization(1)
    const sub = await addEnterpriseSubscription(org.id, {
      selfServe: true,
      seats: 2,
      periodStart: monthsAgo(1),
    })
    if (!sub) throw new Error('subscription missing')

    await handleEnterpriseAutoPaySetup(setupSession(sub))

    expect(stripeStub.subscriptions.update).toHaveBeenCalledWith(
      sub.stripeSubscriptionId,
      { collection_method: 'charge_automatically', default_payment_method: 'pm_saved' },
      expect.anything()
    )
  })

  it("ignores another customer's session and a contract outside self-serve", async () => {
    const org = await createOrganization(1)
    const sub = await addEnterpriseSubscription(org.id, {
      selfServe: true,
      seats: 2,
      periodStart: monthsAgo(1),
    })
    const fixedOrg = await createOrganization(1)
    const fixedSub = await addEnterpriseSubscription(fixedOrg.id, {
      selfServe: false,
      seats: 2,
      periodStart: monthsAgo(1),
    })
    if (!sub || !fixedSub) throw new Error('subscriptions missing')

    await handleEnterpriseAutoPaySetup(setupSession(sub, { customer: 'cus_someone_else' }))
    await handleEnterpriseAutoPaySetup(setupSession(fixedSub))

    expect(stripeStub.customers.update).not.toHaveBeenCalled()
    expect(stripeStub.subscriptions.update).not.toHaveBeenCalled()
  })
})

describe('the seat true-up', () => {
  it('records the peak, bills a closed window once, and skips contracts outside self-serve', async () => {
    const selfServeOrg = await createOrganization(3)
    const selfServeSub = await addEnterpriseSubscription(selfServeOrg.id, {
      selfServe: true,
      seats: 2,
      periodStart: monthsAgo(4),
    })
    // Asks for self-serve but keeps a reporting anchor, so only the self-serve check excludes it.
    const fixedOrg = await createOrganization(3)
    const fixedSub = await addEnterpriseSubscription(fixedOrg.id, {
      selfServe: true,
      seats: 2,
      periodStart: monthsAgo(4),
      reportingPeriodAnchorDate: monthsAgo(4).toISOString().slice(0, 10),
    })
    if (!selfServeSub || !fixedSub) throw new Error('subscriptions missing')

    const now = new Date()
    const window = resolveSeatTrueUpWindow(selfServeSub, now)
    if (!window) throw new Error('no open true-up window')
    await runEnterpriseSeatTrueUps(now)

    // A member leaving after the sample does not lower the window's peak.
    await db.delete(member).where(eq(member.userId, selfServeOrg.members[2]))
    await runEnterpriseSeatTrueUps(now)

    const [open] = await db
      .select()
      .from(enterpriseSeatTrueUp)
      .where(
        and(
          eq(enterpriseSeatTrueUp.subscriptionId, selfServeSub.id),
          eq(enterpriseSeatTrueUp.windowStart, window.start)
        )
      )
    expect(open).toMatchObject({
      peakExtraSeats: 1,
      seatPriceCents: SEAT_PRICE_CENTS,
      billedAt: null,
    })
    expect(await trueUpInvoices(selfServeSub.stripeSubscriptionId)).toHaveLength(0)

    const afterClose = new Date(window.end.getTime() + 60_000)
    await runEnterpriseSeatTrueUps(afterClose)
    await runEnterpriseSeatTrueUps(afterClose)

    const [closed] = await db
      .select()
      .from(enterpriseSeatTrueUp)
      .where(eq(enterpriseSeatTrueUp.id, open?.id ?? ''))
    expect(closed).toMatchObject({ amountCents: SEAT_PRICE_CENTS * 3 })
    expect(closed?.billedAt).not.toBeNull()
    const invoices = await trueUpInvoices(selfServeSub.stripeSubscriptionId)
    expect(invoices).toHaveLength(1)
    expect(invoices[0]?.payload).toMatchObject({ amountCents: SEAT_PRICE_CENTS * 3 })

    const fixedWindows = await db
      .select()
      .from(enterpriseSeatTrueUp)
      .where(eq(enterpriseSeatTrueUp.subscriptionId, fixedSub.id))
    expect(fixedWindows).toHaveLength(0)
  })

  it('splits an annual term into quarters and a monthly term into one window', () => {
    const periodStart = new Date('2026-01-31T12:00:00.000Z')
    const annual = {
      periodStart,
      periodEnd: new Date('2027-01-31T12:00:00.000Z'),
      billingInterval: 'year',
    }
    expect(resolveSeatTrueUpWindow(annual, new Date('2026-05-15T00:00:00.000Z'))).toEqual({
      start: new Date('2026-04-30T12:00:00.000Z'),
      end: new Date('2026-07-31T12:00:00.000Z'),
    })
    expect(resolveSeatTrueUpWindow(annual, new Date('2026-12-01T00:00:00.000Z'))).toEqual({
      start: new Date('2026-10-31T12:00:00.000Z'),
      end: annual.periodEnd,
    })
    const monthly = {
      ...annual,
      periodEnd: new Date('2026-02-28T12:00:00.000Z'),
      billingInterval: 'month',
    }
    expect(resolveSeatTrueUpWindow(monthly, new Date('2026-02-10T00:00:00.000Z'))).toEqual({
      start: periodStart,
      end: monthly.periodEnd,
    })
  })
})
