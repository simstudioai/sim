import { NextResponse } from 'next/server'
import { and, eq, inArray } from 'drizzle-orm'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { checkEnterprisePlan } from '@/lib/subscription/utils'
import { db } from '@/db'
import { subscription } from '@/db/schema'
import { member } from '@/db/schema'

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
        referenceId: subscription.referenceId,
      })
      .from(subscription)
      .where(and(eq(subscription.referenceId, session.user.id), eq(subscription.status, 'active')))
      .limit(1)

    let activeSub: (typeof subscriptions)[number] | undefined = subscriptions[0]

    // -------------------------------------------------------------
    // If no active personal subscription, check the user's organizations
    // and use the highest‐tier active subscription (enterprise > team > pro)
    // -------------------------------------------------------------
    if (!activeSub) {
      // Get all organizations the user belongs to
      const memberships = await db
        .select({ organizationId: member.organizationId })
        .from(member)
        .where(eq(member.userId, session.user.id))

      if (memberships.length > 0) {
        const organizationIds = memberships.map((m) => m.organizationId)

        // Fetch all active subscriptions for these organizations
        const orgSubs = await db
          .select({
            id: subscription.id,
            plan: subscription.plan,
            status: subscription.status,
            seats: subscription.seats,
            metadata: subscription.metadata,
            referenceId: subscription.referenceId,
          })
          .from(subscription)
          .where(
            and(
              inArray(subscription.referenceId, organizationIds),
              eq(subscription.status, 'active')
            )
          )

        if (orgSubs.length > 0) {
          // Prefer enterprise, then team, then pro
          const enterpriseSub = orgSubs.find((s) => checkEnterprisePlan(s))
          const teamSub = orgSubs.find((s) => s.plan === 'team')
          const proSub = orgSubs.find((s) => s.plan === 'pro')

          activeSub = enterpriseSub || teamSub || proSub || undefined
        }
      }
    }

    // Determine flags based on the discovered active subscription
    const isPaid =
      activeSub?.status === 'active' &&
      ['pro', 'team', 'enterprise'].includes(activeSub?.plan ?? '')

    const isPro = isPaid // treat any paid plan as pro-level features

    const isTeam = activeSub?.plan === 'team'

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
