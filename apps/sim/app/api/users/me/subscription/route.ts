import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getUserSubscriptionState, getUserUsageData } from '@/lib/billing'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('UserSubscriptionAPI')

export async function GET() {
  try {
    const session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    // Get comprehensive subscription state and usage data
    const [subscriptionState, usageData] = await Promise.all([
      getUserSubscriptionState(session.user.id),
      getUserUsageData(session.user.id),
    ])

    return NextResponse.json({
      // Subscription status
      isPaid: !subscriptionState.isFree,
      isPro: subscriptionState.isPro,
      isTeam: subscriptionState.isTeam,
      isEnterprise: subscriptionState.isEnterprise,
      plan: subscriptionState.planName,
      status: subscriptionState.highestPrioritySubscription?.status || null,
      seats: subscriptionState.highestPrioritySubscription?.seats || null,
      metadata: subscriptionState.highestPrioritySubscription?.metadata || null,

      // Feature permissions
      features: subscriptionState.features,

      // Usage information
      usage: {
        current: usageData.currentUsage,
        limit: usageData.limit,
        percentUsed: usageData.percentUsed,
        isWarning: usageData.isWarning,
        isExceeded: usageData.isExceeded,
        billingPeriodStart: usageData.billingPeriodStart,
        billingPeriodEnd: usageData.billingPeriodEnd,
        lastPeriodCost: usageData.lastPeriodCost,
      },
    })
  } catch (error) {
    logger.error('Error fetching subscription:', error)
    return NextResponse.json({ error: 'Failed to fetch subscription data' }, { status: 500 })
  }
}
