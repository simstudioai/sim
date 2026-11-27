/**
 * A paid plan's included usage against real PostgreSQL: an annual plan carries twelve months of
 * credits for its yearly billing period (limit floor, overage, the hourly re-sync), and a plan
 * switch moves an untouched usage limit to the new plan's allowance while the closed period keeps
 * its own.
 */
import { db } from '@sim/db'
import { organization, subscription, usageLog, user, userStats } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { ON_DEMAND_UNLIMITED } from '@/lib/billing/constants'
import { calculateSubscriptionOverage } from '@/lib/billing/core/billing'
import { readSwitchBasis, recordPlanSwitch } from '@/lib/billing/core/plan-switch'
import { getOrgUsageLimit, syncUsageLimitsFromSubscription } from '@/lib/billing/core/usage'
import { closeElapsedBillingPeriod } from '@/lib/billing/cycle-close'
import { syncAnnualPlanUsageLimits } from '@/lib/billing/organization'

vi.mock('@/lib/core/config/env-flags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/core/config/env-flags')>()),
  isBillingEnabled: true,
}))

const DAY_MS = 86_400_000
const PRO_MONTHLY_DOLLARS = 30
const MAX_MONTHLY_DOLLARS = 125

const userIds: string[] = []
const organizationIds: string[] = []

async function createUser(usageLimit: number | null = null, creditBalance = 0): Promise<string> {
  const id = `allowance-user-${generateId()}`
  const now = new Date()
  await db.insert(user).values({
    id,
    name: 'Allowance Test',
    email: `${id}@allowance.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(userStats).values({
    id: generateId(),
    userId: id,
    currentUsageLimit: usageLimit === null ? null : String(usageLimit),
    creditBalance: String(creditBalance),
  })
  userIds.push(id)
  return id
}

async function addSubscription(
  referenceId: string,
  fields: {
    plan: string
    billingInterval: 'month' | 'year' | null
    status?: string
    seats?: number
    metadata?: Record<string, unknown>
  }
) {
  const now = Date.now()
  const days = fields.billingInterval === 'year' ? 365 : 30
  const row = {
    id: generateId(),
    plan: fields.plan,
    referenceId,
    status: fields.status ?? 'active',
    seats: fields.seats ?? 1,
    billingInterval: fields.billingInterval,
    metadata: fields.metadata ?? null,
    stripeSubscriptionId: `sub_${generateId()}`,
    periodStart: new Date(now - DAY_MS),
    periodEnd: new Date(now + (days - 1) * DAY_MS),
  }
  await db.insert(subscription).values(row)
  return row
}

async function createOrganization(): Promise<string> {
  const id = `allowance-org-${generateId()}`
  await db.insert(organization).values({
    id,
    name: 'Allowance Org',
    slug: id,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  organizationIds.push(id)
  return id
}

async function readLimit(userId: string): Promise<number> {
  const [stats] = await db
    .select({ currentUsageLimit: userStats.currentUsageLimit })
    .from(userStats)
    .where(eq(userStats.userId, userId))
  return Number(stats?.currentUsageLimit)
}

afterAll(async () => {
  if (userIds.length > 0) {
    await db.delete(subscription).where(inArray(subscription.referenceId, userIds))
    await db.delete(usageLog).where(inArray(usageLog.userId, userIds))
    await db.delete(user).where(inArray(user.id, userIds))
  }
  if (organizationIds.length > 0) {
    await db.delete(subscription).where(inArray(subscription.referenceId, organizationIds))
    await db.delete(organization).where(inArray(organization.id, organizationIds))
  }
})

describe('annual plan allowance', () => {
  it('floors an annual Pro usage limit at twelve months of included usage', async () => {
    const userId = await createUser(PRO_MONTHLY_DOLLARS)
    await addSubscription(userId, { plan: 'pro_6000', billingInterval: 'year' })

    await syncUsageLimitsFromSubscription(userId)

    expect(await readLimit(userId)).toBe(PRO_MONTHLY_DOLLARS * 12)
  })

  it('reads the annual interval from metadata when the column is empty', async () => {
    const userId = await createUser(PRO_MONTHLY_DOLLARS)
    await addSubscription(userId, {
      plan: 'pro_6000',
      billingInterval: null,
      metadata: { billingInterval: 'year' },
    })

    await syncUsageLimitsFromSubscription(userId)

    expect(await readLimit(userId)).toBe(PRO_MONTHLY_DOLLARS * 12)
  })

  it('owes no overage on an annual plan until usage passes the yearly allowance', async () => {
    const userId = await createUser(PRO_MONTHLY_DOLLARS * 12)
    const sub = await addSubscription(userId, { plan: 'pro_6000', billingInterval: 'year' })
    await db.insert(usageLog).values({
      id: generateId(),
      userId,
      category: 'model',
      source: 'workflow',
      description: 'annual allowance test',
      cost: '100',
      billingEntityType: 'user',
      billingEntityId: userId,
      billingPeriodStart: sub.periodStart,
      billingPeriodEnd: sub.periodEnd,
      createdAt: new Date(sub.periodStart.getTime() + 60_000),
    })

    expect(await calculateSubscriptionOverage(sub)).toBe(0)
  })

  it('floors an annual Team organization at twelve months per seat', async () => {
    const organizationId = await createOrganization()

    const { minimum } = await getOrgUsageLimit(organizationId, {
      plan: 'team_6000',
      seats: 3,
      billingInterval: 'year',
    })

    expect(minimum).toBe(PRO_MONTHLY_DOLLARS * 12 * 3)
  })

  it('includes only the months left for a Team seat added partway through the year', async () => {
    const organizationId = await createOrganization()
    const sub = await addSubscription(organizationId, {
      plan: 'team_6000',
      billingInterval: 'year',
      seats: 3,
    })

    await syncAnnualPlanUsageLimits()
    // Two seats join with two months left in the year.
    await db
      .update(subscription)
      .set({ seats: 5, periodEnd: new Date(Date.now() + 60 * DAY_MS) })
      .where(eq(subscription.id, sub.id))
    await syncAnnualPlanUsageLimits()

    const [row] = await db.select().from(subscription).where(eq(subscription.id, sub.id))
    const recorded = Number(row?.allowanceSeatMonths)
    expect(recorded).toBeCloseTo(3 * 12 + 2 * (60 / 30.44), 3)
    const { minimum } = await getOrgUsageLimit(organizationId, row as NonNullable<typeof row>)
    expect(minimum).toBe(Math.round(recorded * PRO_MONTHLY_DOLLARS * 100) / 100)
  })

  it('credits a seat added in the last days of the year for the days left', async () => {
    const organizationId = await createOrganization()
    const sub = await addSubscription(organizationId, {
      plan: 'team_6000',
      billingInterval: 'year',
      seats: 1,
    })
    await syncAnnualPlanUsageLimits()
    await db
      .update(subscription)
      .set({ seats: 2, periodEnd: new Date(Date.now() + 10 * DAY_MS) })
      .where(eq(subscription.id, sub.id))

    await syncAnnualPlanUsageLimits()

    const [row] = await db.select().from(subscription).where(eq(subscription.id, sub.id))
    expect(Number(row?.allowanceSeatMonths)).toBeCloseTo(12 + 10 / 30.44, 3)
  })

  it('lowers an untouched Team limit when a seat leaves partway through the year', async () => {
    const organizationId = await createOrganization()
    const sub = await addSubscription(organizationId, {
      plan: 'team_6000',
      billingInterval: 'year',
      seats: 2,
    })
    await syncAnnualPlanUsageLimits()
    await db
      .update(subscription)
      .set({ seats: 1, periodEnd: new Date(Date.now() + 182 * DAY_MS) })
      .where(eq(subscription.id, sub.id))

    await syncAnnualPlanUsageLimits()

    const [org] = await db
      .select({ orgUsageLimit: organization.orgUsageLimit })
      .from(organization)
      .where(eq(organization.id, organizationId))
    expect(Number(org?.orgUsageLimit)).toBeCloseTo((2 * 12 - 182 / 30.44) * PRO_MONTHLY_DOLLARS, 1)
  })

  it('raises annual subscriptions still capped at one month and leaves monthly ones alone', async () => {
    const annualUser = await createUser(PRO_MONTHLY_DOLLARS)
    await addSubscription(annualUser, { plan: 'pro_6000', billingInterval: 'year' })
    const monthlyUser = await createUser(PRO_MONTHLY_DOLLARS)
    await addSubscription(monthlyUser, { plan: 'pro_6000', billingInterval: 'month' })

    await syncAnnualPlanUsageLimits()

    expect(await readLimit(annualUser)).toBe(PRO_MONTHLY_DOLLARS * 12)
    expect(await readLimit(monthlyUser)).toBe(PRO_MONTHLY_DOLLARS)
  })
})

describe('closing a period after an interval switch', () => {
  it('bills the closed monthly period against one month, not the new annual allowance', async () => {
    const userId = await createUser(PRO_MONTHLY_DOLLARS * 12)
    const periodStart = new Date(Date.now() - 2 * DAY_MS)
    const closedStart = new Date(periodStart.getTime() - 30 * DAY_MS)
    const row = {
      id: generateId(),
      plan: 'pro_6000',
      referenceId: userId,
      status: 'active',
      seats: 1,
      billingInterval: 'year',
      stripeCustomerId: `cus_${generateId()}`,
      stripeSubscriptionId: `sub_${generateId()}`,
      periodStart,
      periodEnd: new Date(periodStart.getTime() + 365 * DAY_MS),
      lastClosedPeriodStart: closedStart,
    }
    await db.insert(subscription).values(row)
    await db.insert(usageLog).values({
      id: generateId(),
      userId,
      category: 'model',
      source: 'workflow',
      description: 'closed monthly period',
      cost: '100',
      billingEntityType: 'user',
      billingEntityId: userId,
      billingPeriodStart: closedStart,
      billingPeriodEnd: periodStart,
      createdAt: new Date(closedStart.getTime() + DAY_MS),
    })
    const [sub] = await db.select().from(subscription).where(eq(subscription.id, row.id))

    const result = await closeElapsedBillingPeriod(sub as NonNullable<typeof sub>, {
      bypassSettlementGrace: true,
    })

    // $100 used, less one week's $10 refresh and one month's $30 allowance.
    expect(result.overageBilled).toBe(60)
  })
})

describe('recordPlanSwitch', () => {
  it('lowers an untouched limit to the cheaper plan on a Max to Pro downgrade', async () => {
    const userId = await createUser(MAX_MONTHLY_DOLLARS)
    const sub = await addSubscription(userId, { plan: 'pro_25000', billingInterval: 'month' })

    await recordPlanSwitch({
      subscription: sub,
      targetPlanName: 'pro_6000',
      targetInterval: 'month',
      orgScoped: false,
    })

    expect(await readLimit(userId)).toBe(PRO_MONTHLY_DOLLARS)
    const [row] = await db.select().from(subscription).where(eq(subscription.id, sub.id))
    expect(row?.plan).toBe('pro_6000')
  })

  it('keeps chosen headroom on an upgrade to a pricier tier', async () => {
    const userId = await createUser(100)
    const sub = await addSubscription(userId, { plan: 'pro_6000', billingInterval: 'month' })

    await recordPlanSwitch({
      subscription: sub,
      targetPlanName: 'pro_25000',
      targetInterval: 'month',
      orgScoped: false,
    })

    expect(await readLimit(userId)).toBe(MAX_MONTHLY_DOLLARS + (100 - PRO_MONTHLY_DOLLARS))
  })

  it('keeps the on-demand headroom a payer raised above the old plan', async () => {
    const userId = await createUser(500)
    const sub = await addSubscription(userId, { plan: 'pro_25000', billingInterval: 'month' })

    await recordPlanSwitch({
      subscription: sub,
      targetPlanName: 'pro_6000',
      targetInterval: 'month',
      orgScoped: false,
    })

    expect(await readLimit(userId)).toBe(PRO_MONTHLY_DOLLARS + (500 - MAX_MONTHLY_DOLLARS))
  })

  it("rescales a year's on-demand headroom to a month on a switch to monthly billing", async () => {
    const userId = await createUser(PRO_MONTHLY_DOLLARS * 12 + 120)
    const sub = await addSubscription(userId, { plan: 'pro_6000', billingInterval: 'year' })

    await recordPlanSwitch({
      subscription: sub,
      targetPlanName: 'pro_6000',
      targetInterval: 'month',
      orgScoped: false,
    })

    expect(await readLimit(userId)).toBe(PRO_MONTHLY_DOLLARS + 10)
    const [row] = await db.select().from(subscription).where(eq(subscription.id, sub.id))
    expect(row?.billingInterval).toBe('month')
  })

  it('counts prepaid credit once when rebasing an untouched limit', async () => {
    const userId = await createUser(MAX_MONTHLY_DOLLARS + 50, 50)
    const sub = await addSubscription(userId, { plan: 'pro_25000', billingInterval: 'month' })

    await recordPlanSwitch({
      subscription: sub,
      targetPlanName: 'pro_6000',
      targetInterval: 'month',
      orgScoped: false,
    })

    expect(await readLimit(userId)).toBe(PRO_MONTHLY_DOLLARS + 50)
  })

  it('does not read a limit the webhook already raised as chosen headroom', async () => {
    // The checkout webhook raised the monthly limit to the annual floor before the switch recorded.
    const userId = await createUser(PRO_MONTHLY_DOLLARS * 12)
    const sub = await addSubscription(userId, { plan: 'pro_6000', billingInterval: 'month' })

    await recordPlanSwitch({
      subscription: sub,
      targetPlanName: 'pro_6000',
      targetInterval: 'year',
      orgScoped: false,
    })

    expect(await readLimit(userId)).toBe(PRO_MONTHLY_DOLLARS * 12)
  })

  it('keeps headroom chosen before the switch when the webhook raised the limit first', async () => {
    // $10 of on-demand headroom over the monthly plan; the webhook then raised it to the annual floor.
    const userId = await createUser(PRO_MONTHLY_DOLLARS * 12)
    const sub = await addSubscription(userId, { plan: 'pro_6000', billingInterval: 'month' })

    await recordPlanSwitch({
      subscription: sub,
      targetPlanName: 'pro_6000',
      targetInterval: 'year',
      orgScoped: false,
      previous: { limit: String(PRO_MONTHLY_DOLLARS + 10), creditBalance: '0' },
    })

    expect(await readLimit(userId)).toBe(PRO_MONTHLY_DOLLARS * 12 + 120)
  })

  it('keeps chosen headroom when credit is granted while the switch is in flight', async () => {
    // $70 of headroom over Pro before the switch; $50 of credit landed (raising the limit) since.
    const userId = await createUser(100 + 50, 50)
    const sub = await addSubscription(userId, { plan: 'pro_6000', billingInterval: 'month' })

    await recordPlanSwitch({
      subscription: sub,
      targetPlanName: 'pro_25000',
      targetInterval: 'month',
      orgScoped: false,
      previous: { limit: '100', creditBalance: '0' },
    })

    expect(await readLimit(userId)).toBe(MAX_MONTHLY_DOLLARS + 50 + 70)
  })

  it('keeps headroom a payer chose that happens to equal the new plan allowance', async () => {
    // Raised to Max's allowance on Pro before the switch: that is chosen headroom, not a webhook's.
    const userId = await createUser(MAX_MONTHLY_DOLLARS)
    const sub = await addSubscription(userId, { plan: 'pro_6000', billingInterval: 'month' })

    await recordPlanSwitch({
      subscription: sub,
      targetPlanName: 'pro_25000',
      targetInterval: 'month',
      orgScoped: false,
      previous: { limit: String(MAX_MONTHLY_DOLLARS), creditBalance: '0' },
    })

    expect(await readLimit(userId)).toBe(
      MAX_MONTHLY_DOLLARS + (MAX_MONTHLY_DOLLARS - PRO_MONTHLY_DOLLARS)
    )
  })

  it('records the period Stripe restarted with an interval switch, before the webhook', async () => {
    const userId = await createUser(PRO_MONTHLY_DOLLARS * 12)
    const sub = await addSubscription(userId, { plan: 'pro_6000', billingInterval: 'year' })
    const start = new Date(Date.UTC(2026, 10, 20))
    const end = new Date(Date.UTC(2026, 11, 20))

    await recordPlanSwitch({
      subscription: sub,
      targetPlanName: 'pro_6000',
      targetInterval: 'month',
      orgScoped: false,
      period: { start, end },
    })

    const [row] = await db.select().from(subscription).where(eq(subscription.id, sub.id))
    expect(row?.periodStart?.getTime()).toBe(start.getTime())
    expect(row?.periodEnd?.getTime()).toBe(end.getTime())
  })

  it('keeps an unlimited limit unlimited', async () => {
    const userId = await createUser(ON_DEMAND_UNLIMITED)
    const sub = await addSubscription(userId, { plan: 'pro_25000', billingInterval: 'month' })

    await recordPlanSwitch({
      subscription: sub,
      targetPlanName: 'pro_6000',
      targetInterval: 'month',
      orgScoped: false,
    })

    expect(await readLimit(userId)).toBe(ON_DEMAND_UNLIMITED)
  })

  it('moves an annual limit back to one month on a switch to monthly billing', async () => {
    const userId = await createUser(PRO_MONTHLY_DOLLARS * 12)
    const sub = await addSubscription(userId, { plan: 'pro_6000', billingInterval: 'year' })

    await recordPlanSwitch({
      subscription: sub,
      targetPlanName: 'pro_6000',
      targetInterval: 'month',
      orgScoped: false,
    })

    expect(await readLimit(userId)).toBe(PRO_MONTHLY_DOLLARS)
  })

  it('leaves a trial at its fixed allowance', async () => {
    const userId = await createUser(10)
    const sub = await addSubscription(userId, {
      plan: 'pro_6000',
      billingInterval: 'month',
      status: 'trialing',
    })

    await recordPlanSwitch({
      subscription: sub,
      targetPlanName: 'pro_25000',
      targetInterval: 'month',
      orgScoped: false,
    })

    expect(await readLimit(userId)).toBe(10)
  })
})

describe('readSwitchBasis', () => {
  it('refuses a switch computed from a plan another switch has since moved', async () => {
    const userId = await createUser(PRO_MONTHLY_DOLLARS)
    const sub = await addSubscription(userId, { plan: 'pro_6000', billingInterval: 'month' })
    expect(await readSwitchBasis(sub, { type: 'user', id: userId })).not.toBeNull()

    // A concurrent request switched to Max after this one read the subscription.
    await recordPlanSwitch({
      subscription: sub,
      targetPlanName: 'pro_25000',
      targetInterval: 'month',
      orgScoped: false,
    })

    expect(await readSwitchBasis(sub, { type: 'user', id: userId })).toBeNull()
  })

  it('refuses a switch computed from an interval another switch has since moved', async () => {
    const userId = await createUser(PRO_MONTHLY_DOLLARS)
    const sub = await addSubscription(userId, { plan: 'pro_6000', billingInterval: 'month' })

    await recordPlanSwitch({
      subscription: sub,
      targetPlanName: 'pro_6000',
      targetInterval: 'year',
      orgScoped: false,
    })

    expect(await readSwitchBasis(sub, { type: 'user', id: userId })).toBeNull()
  })

  it('computes a Team switch from seats a sync added after the request read the plan', async () => {
    const organizationId = await createOrganization()
    const sub = await addSubscription(organizationId, {
      plan: 'team_6000',
      billingInterval: 'month',
      seats: 5,
    })
    // After the request read five seats, a seat sync added a sixth and raised the limit with it,
    // keeping $50 of headroom the admin chose.
    await db.update(subscription).set({ seats: 6 }).where(eq(subscription.id, sub.id))
    await db
      .update(organization)
      .set({ orgUsageLimit: String(PRO_MONTHLY_DOLLARS * 6 + 50) })
      .where(eq(organization.id, organizationId))

    const basis = await readSwitchBasis(sub, { type: 'organization', id: organizationId })
    if (!basis) throw new Error('expected the switch basis to still match')
    await recordPlanSwitch({
      subscription: basis.subscription,
      targetPlanName: 'team_25000',
      targetInterval: 'month',
      orgScoped: true,
      previous: basis.pool,
    })

    const [org] = await db
      .select({ orgUsageLimit: organization.orgUsageLimit })
      .from(organization)
      .where(eq(organization.id, organizationId))
    expect(Number(org?.orgUsageLimit)).toBe(MAX_MONTHLY_DOLLARS * 6 + 50)
  })
})
