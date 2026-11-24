/**
 * A paid plan's included usage against real PostgreSQL: an annual plan carries twelve months of
 * credits for its yearly billing period (limit floor, overage, the hourly re-sync), and a plan
 * switch moves an untouched usage limit to the new plan's allowance.
 */
import { db } from '@sim/db'
import { organization, subscription, usageLog, user, userStats } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { calculateSubscriptionOverage } from '@/lib/billing/core/billing'
import { recordPlanSwitch } from '@/lib/billing/core/plan-switch'
import { getOrgUsageLimit, syncUsageLimitsFromSubscription } from '@/lib/billing/core/usage'
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

async function createUser(usageLimit: number | null = null): Promise<string> {
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
    const organizationId = `allowance-org-${generateId()}`
    await db.insert(organization).values({
      id: organizationId,
      name: 'Allowance Org',
      slug: organizationId,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    organizationIds.push(organizationId)

    const { minimum } = await getOrgUsageLimit(organizationId, {
      plan: 'team_6000',
      seats: 3,
      billingInterval: 'year',
    })

    expect(minimum).toBe(PRO_MONTHLY_DOLLARS * 12 * 3)
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

  it('keeps a limit the payer raised above the old plan', async () => {
    const userId = await createUser(500)
    const sub = await addSubscription(userId, { plan: 'pro_25000', billingInterval: 'month' })

    await recordPlanSwitch({
      subscription: sub,
      targetPlanName: 'pro_6000',
      targetInterval: 'month',
      orgScoped: false,
    })

    expect(await readLimit(userId)).toBe(500)
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
