import { NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { checkEnterprisePlan } from '@/lib/subscription/utils'
import { db } from '@/db'
import { subscription } from '@/db/schema'

const logger = createLogger('UserSubscriptionAPI')

export async function GET() {
  try {
    const session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const subscriptions = await db
      .select({
        id: subscription.id,
        plan: subscription.plan,
        status: subscription.status,
        seats: subscription.seats,
        metadata: subscription.metadata,
      })
      .from(subscription)
      .where(and(eq(subscription.referenceId, session.user.id), eq(subscription.status, 'active')))
      .limit(1)

    const activeSub = subscriptions[0]

    const isPaid =
      activeSub &&
      activeSub.status === 'active' &&
      (activeSub.plan === 'pro' || activeSub.plan === 'team' || activeSub.plan === 'enterprise')

    const isPro =
      activeSub &&
      activeSub.status === 'active' &&
      (activeSub.plan === 'pro' || activeSub.plan === 'team' || activeSub.plan === 'enterprise')

    const isTeam = activeSub && activeSub.status === 'active' && activeSub.plan === 'team'

    const isEnterprise = checkEnterprisePlan(activeSub)

    return NextResponse.json({
      isPaid,
      isPro,
      isTeam,
      isEnterprise,
      plan: activeSub?.plan || 'free',
      status: activeSub?.status || null,
      seats: activeSub?.seats || null,
      metadata: activeSub?.metadata || null,
    })
  } catch (error) {
    logger.error('Error fetching subscription:', error)
    return NextResponse.json({ error: 'Failed to fetch subscription data' }, { status: 500 })
  }
}
