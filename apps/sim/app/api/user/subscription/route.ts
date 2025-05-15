import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { getHighestPrioritySubscription } from '@/lib/subscription/subscription'
import { checkEnterprisePlan, checkTeamPlan } from '@/lib/subscription/utils'

const logger = createLogger('UserSubscriptionAPI')

export async function GET() {
  try {
    const session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const activeSub = await getHighestPrioritySubscription(session.user.id)

    const isPaid =
      activeSub?.status === 'active' &&
      ['pro', 'team', 'enterprise'].includes(activeSub?.plan ?? '')

    const isPro = isPaid

    const isTeam = checkTeamPlan(activeSub)

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
