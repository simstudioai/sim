import { NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { checkEnterprisePlan } from '@/lib/subscription/utils'
import { db } from '@/db'
import { member, subscription } from '@/db/schema'

const logger = createLogger('EnterpriseSubscriptionAPI')

export async function GET() {
  try {
    const session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const userId = session.user.id

    const userSubscriptions = await db
      .select()
      .from(subscription)
      .where(and(eq(subscription.referenceId, userId), eq(subscription.status, 'active')))
      .limit(1)

    if (userSubscriptions.length > 0 && checkEnterprisePlan(userSubscriptions[0])) {
      const enterpriseSub = userSubscriptions[0]
      logger.info('Found direct enterprise subscription', { userId, subId: enterpriseSub.id })

      return NextResponse.json({
        success: true,
        subscription: enterpriseSub,
      })
    }

    const memberships = await db
      .select({ organizationId: member.organizationId })
      .from(member)
      .where(eq(member.userId, userId))

    for (const { organizationId } of memberships) {
      const orgSubscriptions = await db
        .select()
        .from(subscription)
        .where(and(eq(subscription.referenceId, organizationId), eq(subscription.status, 'active')))
        .limit(1)

      if (orgSubscriptions.length > 0 && checkEnterprisePlan(orgSubscriptions[0])) {
        const enterpriseSub = orgSubscriptions[0]
        logger.info('Found organization enterprise subscription', {
          userId,
          orgId: organizationId,
          subId: enterpriseSub.id,
        })

        return NextResponse.json({
          success: true,
          subscription: enterpriseSub,
        })
      }
    }

    return NextResponse.json({
      success: false,
      subscription: null,
    })
  } catch (error) {
    logger.error('Error fetching enterprise subscription:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch enterprise subscription data',
      },
      { status: 500 }
    )
  }
}
