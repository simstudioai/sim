import { db } from '@sim/db'
import { subscription as subscriptionTable, user } from '@sim/db/schema'
import { and, eq, or } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { requireStripeClient } from '@/lib/billing/stripe-client'
import { createLogger } from '@/lib/logs/console/logger'
import { getBaseUrl } from '@/lib/urls/utils'

const logger = createLogger('BillingPortal')

export async function POST(request: NextRequest) {
  const session = await getSession()

  try {
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const context: 'user' | 'organization' =
      body?.context === 'organization' ? 'organization' : 'user'
    const organizationId: string | undefined = body?.organizationId || undefined
    const returnUrl: string = body?.returnUrl || `${getBaseUrl()}/workspace?billing=updated`

    const stripe = requireStripeClient()

    let stripeCustomerId: string | null = null

    if (context === 'organization') {
      if (!organizationId) {
        return NextResponse.json({ error: 'organizationId is required' }, { status: 400 })
      }

      const rows = await db
        .select({ customer: subscriptionTable.stripeCustomerId })
        .from(subscriptionTable)
        .where(
          and(
            eq(subscriptionTable.referenceId, organizationId),
            or(
              eq(subscriptionTable.status, 'active'),
              eq(subscriptionTable.cancelAtPeriodEnd, true)
            )
          )
        )
        .limit(1)

      stripeCustomerId = rows.length > 0 ? rows[0].customer || null : null
    } else {
      const rows = await db
        .select({ customer: user.stripeCustomerId })
        .from(user)
        .where(eq(user.id, session.user.id))
        .limit(1)

      stripeCustomerId = rows.length > 0 ? rows[0].customer || null : null
    }

    if (!stripeCustomerId) {
      logger.error('Stripe customer not found for portal session', {
        context,
        organizationId,
        userId: session.user.id,
      })
      return NextResponse.json({ error: 'Stripe customer not found' }, { status: 404 })
    }

    const portal = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: returnUrl,
    })

    return NextResponse.json({ url: portal.url })
  } catch (error) {
    logger.error('Failed to create billing portal session', { error })
    return NextResponse.json({ error: 'Failed to create billing portal session' }, { status: 500 })
  }
}
