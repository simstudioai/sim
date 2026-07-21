import { db } from '@sim/db'
import { organization, subscription, userStats } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray } from 'drizzle-orm'

const CREDITS_PER_DOLLAR = 200
const FREE_USAGE_LIMIT_DOLLARS = '5'

export interface SubscriptionArrangement {
  referenceId: string
  plan: 'pro_6000' | 'pro_25000' | 'team_6000' | 'team_25000' | 'enterprise'
  status?: 'active' | 'past_due' | 'canceled'
  seats?: number
  memberUserIds?: string[]
  enterprise?: {
    monthlyPrice: number
  }
}

export async function arrangeSubscription(input: SubscriptionArrangement): Promise<{ id: string }> {
  const entitled = await db
    .select({ id: subscription.id })
    .from(subscription)
    .where(
      and(
        eq(subscription.referenceId, input.referenceId),
        inArray(subscription.status, ['active', 'past_due'])
      )
    )
    .limit(1)
  if (entitled.length > 0 && (input.status ?? 'active') !== 'canceled') {
    throw new Error(`Billing reference already has an entitled subscription: ${input.referenceId}`)
  }

  const now = new Date()
  const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000)
  const id = generateId()
  const status = input.status ?? 'active'
  const metadata =
    input.plan === 'enterprise'
      ? {
          plan: 'enterprise',
          referenceId: input.referenceId,
          monthlyPrice: input.enterprise?.monthlyPrice ?? 500,
          seats: input.seats ?? 1,
        }
      : null

  await db.transaction(async (tx) => {
    await tx.insert(subscription).values({
      id,
      plan: input.plan,
      referenceId: input.referenceId,
      stripeCustomerId: `cus_e2e_${id}`,
      stripeSubscriptionId: `sub_e2e_${id}`,
      status,
      periodStart: now,
      periodEnd,
      cancelAtPeriodEnd: status !== 'active',
      canceledAt: status === 'canceled' ? now : null,
      endedAt: status === 'canceled' ? now : null,
      seats: input.seats,
      billingInterval: 'month',
      metadata,
    })

    if (input.plan.startsWith('pro_')) {
      await tx
        .update(userStats)
        .set({
          currentUsageLimit: String(planCredits(input.plan) / CREDITS_PER_DOLLAR),
          usageLimitUpdatedAt: now,
          billingBlocked: false,
          billingBlockedReason: null,
        })
        .where(eq(userStats.userId, input.referenceId))
      return
    }

    const orgUsageLimit =
      input.plan === 'enterprise'
        ? String(metadata?.monthlyPrice ?? 500)
        : String((planCredits(input.plan) / CREDITS_PER_DOLLAR) * (input.seats ?? 1))
    await tx
      .update(organization)
      .set({ orgUsageLimit, updatedAt: now })
      .where(eq(organization.id, input.referenceId))
    if (input.memberUserIds && input.memberUserIds.length > 0) {
      await tx
        .update(userStats)
        .set({
          currentUsageLimit: null,
          usageLimitUpdatedAt: now,
          billingBlocked: false,
          billingBlockedReason: null,
        })
        .where(inArray(userStats.userId, input.memberUserIds))
    }
  })

  return { id }
}

export async function lapseOrganizationSubscription(input: {
  subscriptionId: string
  organizationId: string
  memberUserIds: string[]
}): Promise<void> {
  const now = new Date()
  await db.transaction(async (tx) => {
    await tx
      .update(subscription)
      .set({
        status: 'canceled',
        cancelAtPeriodEnd: false,
        cancelAt: now,
        canceledAt: now,
        endedAt: now,
        periodEnd: now,
      })
      .where(eq(subscription.id, input.subscriptionId))
    await tx
      .update(organization)
      .set({ orgUsageLimit: null, updatedAt: now })
      .where(eq(organization.id, input.organizationId))
    if (input.memberUserIds.length > 0) {
      await tx
        .update(userStats)
        .set({
          currentUsageLimit: FREE_USAGE_LIMIT_DOLLARS,
          usageLimitUpdatedAt: now,
          billingBlocked: false,
          billingBlockedReason: null,
        })
        .where(inArray(userStats.userId, input.memberUserIds))
    }
  })
}

function planCredits(plan: SubscriptionArrangement['plan']): number {
  const match = plan.match(/_(\d+)$/)
  return match ? Number(match[1]) : 0
}
