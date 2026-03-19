import { db } from '@sim/db'
import { subscription as subscriptionTable } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { isOrganizationOwnerOrAdmin } from '@/lib/billing/core/organization'
import { getHighestPrioritySubscription } from '@/lib/billing/core/plan'
import { writeBillingInterval } from '@/lib/billing/core/subscription'
import { getPlanType, isEnterprise, isOrgPlan } from '@/lib/billing/plan-helpers'
import { getPlanByName } from '@/lib/billing/plans'
import { requireStripeClient } from '@/lib/billing/stripe-client'
import { isBillingEnabled } from '@/lib/core/config/feature-flags'

const logger = createLogger('SwitchPlan')

const switchPlanSchema = z.object({
  targetPlanName: z.string(),
  interval: z.enum(['month', 'year']).optional(),
})

/**
 * POST /api/billing/switch-plan
 *
 * Switches a subscription's tier and/or billing interval via direct Stripe API.
 * Covers: Pro <-> Max, monthly <-> annual, and team tier changes.
 * Uses proration -- no Billing Portal redirect.
 *
 * Body:
 *   targetPlanName: string  -- e.g. 'pro_6000', 'team_25000'
 *   interval?: 'month' | 'year'  -- if omitted, keeps the current interval
 */
export async function POST(request: NextRequest) {
  const session = await getSession()

  try {
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!isBillingEnabled) {
      return NextResponse.json({ error: 'Billing is not enabled' }, { status: 400 })
    }

    const body = await request.json()
    const parsed = switchPlanSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const { targetPlanName, interval } = parsed.data
    const userId = session.user.id

    const sub = await getHighestPrioritySubscription(userId)
    if (!sub || !sub.stripeSubscriptionId) {
      return NextResponse.json({ error: 'No active subscription found' }, { status: 404 })
    }

    if (isEnterprise(sub.plan) || isEnterprise(targetPlanName)) {
      return NextResponse.json(
        { error: 'Enterprise plan changes must be handled via support' },
        { status: 400 }
      )
    }

    const targetPlan = getPlanByName(targetPlanName)
    if (!targetPlan) {
      return NextResponse.json({ error: 'Target plan not found' }, { status: 400 })
    }

    const currentPlanType = getPlanType(sub.plan)
    const targetPlanType = getPlanType(targetPlanName)
    if (currentPlanType !== targetPlanType) {
      return NextResponse.json(
        { error: 'Cannot switch between individual and team plans via this endpoint' },
        { status: 400 }
      )
    }

    if (isOrgPlan(sub.plan)) {
      const hasPermission = await isOrganizationOwnerOrAdmin(userId, sub.referenceId)
      if (!hasPermission) {
        return NextResponse.json({ error: 'Only team admins can change the plan' }, { status: 403 })
      }
    }

    const stripe = requireStripeClient()
    const stripeSubscription = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId)

    if (stripeSubscription.status !== 'active') {
      return NextResponse.json({ error: 'Stripe subscription is not active' }, { status: 400 })
    }

    const subscriptionItem = stripeSubscription.items.data[0]
    if (!subscriptionItem) {
      return NextResponse.json({ error: 'No subscription item found in Stripe' }, { status: 500 })
    }

    const currentInterval = subscriptionItem.price?.recurring?.interval
    const targetInterval = interval ?? currentInterval ?? 'month'

    const targetPriceId =
      targetInterval === 'year' ? targetPlan.annualDiscountPriceId : targetPlan.priceId

    if (!targetPriceId) {
      return NextResponse.json(
        { error: `No ${targetInterval} price configured for plan ${targetPlanName}` },
        { status: 400 }
      )
    }

    const alreadyOnStripePrice = subscriptionItem.price?.id === targetPriceId
    const alreadyInDb = sub.plan === targetPlanName

    if (alreadyOnStripePrice && alreadyInDb) {
      return NextResponse.json({ success: true, message: 'Already on this plan and interval' })
    }

    logger.info('Switching subscription', {
      userId,
      subscriptionId: sub.id,
      stripeSubscriptionId: sub.stripeSubscriptionId,
      fromPlan: sub.plan,
      toPlan: targetPlanName,
      fromInterval: currentInterval,
      toInterval: targetInterval,
      targetPriceId,
    })

    if (!alreadyOnStripePrice) {
      const currentQuantity = subscriptionItem.quantity ?? 1

      await stripe.subscriptions.update(sub.stripeSubscriptionId, {
        items: [
          {
            id: subscriptionItem.id,
            price: targetPriceId,
            quantity: currentQuantity,
          },
        ],
        proration_behavior: 'always_invoice',
      })
    }

    if (!alreadyInDb) {
      await db
        .update(subscriptionTable)
        .set({ plan: targetPlanName })
        .where(eq(subscriptionTable.id, sub.id))
    }

    await writeBillingInterval(sub.id, targetInterval as 'month' | 'year')

    logger.info('Subscription switched successfully', {
      userId,
      subscriptionId: sub.id,
      fromPlan: sub.plan,
      toPlan: targetPlanName,
      interval: targetInterval,
    })

    return NextResponse.json({ success: true, plan: targetPlanName, interval: targetInterval })
  } catch (error) {
    logger.error('Failed to switch subscription', {
      userId: session?.user?.id,
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to switch plan' },
      { status: 500 }
    )
  }
}
