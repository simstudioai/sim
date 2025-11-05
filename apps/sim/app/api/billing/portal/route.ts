import { db } from '@sim/db'
import { subscription as subscriptionTable, user } from '@sim/db/schema'
import { and, eq, or } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getLoopsClient } from '@/lib/billing/loops-client'
import { getStripeClient } from '@/lib/billing/stripe-client'
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

    // Try Loops first (primary), fall back to Stripe for backward compatibility
    const loopsClient = getLoopsClient()
    const stripeClient = getStripeClient()

    let customerId: string | null = null
    let customerIdField: 'loopsCustomerId' | 'stripeCustomerId' = 'loopsCustomerId'

    if (context === 'organization') {
      if (!organizationId) {
        return NextResponse.json({ error: 'organizationId is required' }, { status: 400 })
      }

      const rows = await db
        .select({
          loopsCustomer: subscriptionTable.loopsCustomerId,
          stripeCustomer: subscriptionTable.stripeCustomerId,
        })
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

      if (rows.length > 0) {
        // Prefer Loops customer ID
        customerId = rows[0].loopsCustomer || rows[0].stripeCustomer || null
        customerIdField = rows[0].loopsCustomer ? 'loopsCustomerId' : 'stripeCustomerId'
      }
    } else {
      const rows = await db
        .select({
          loopsCustomer: user.loopsCustomerId,
          stripeCustomer: user.stripeCustomerId,
        })
        .from(user)
        .where(eq(user.id, session.user.id))
        .limit(1)

      if (rows.length > 0) {
        // Prefer Loops customer ID
        customerId = rows[0].loopsCustomer || rows[0].stripeCustomer || null
        customerIdField = rows[0].loopsCustomer ? 'loopsCustomerId' : 'stripeCustomerId'
      }
    }

    if (!customerId) {
      logger.error('No customer found for portal session', {
        context,
        organizationId,
        userId: session.user.id,
      })
      return NextResponse.json({ error: 'No billing customer found' }, { status: 404 })
    }

    // Use Loops portal if Loops customer exists and client is available
    if (customerIdField === 'loopsCustomerId' && loopsClient) {
      try {
        // Loops SDK does not currently support a customer portal like Stripe does
        // Redirect to internal billing management page
        //
        // NOTE: The internal billing page should provide:
        // 1. View current subscription details (plan, status, renewal date)
        // 2. View and download past invoices (managed by Loops)
        // 3. Update payment method (via Loops)
        // 4. View current usage and limits
        // 5. Upgrade/downgrade subscription plans
        // 6. Cancel subscription (when Loops API supports it)
        // 7. Update billing information (address, tax ID, etc.)

        logger.info('Redirecting Loops customer to internal billing page', {
          customerId,
          userId: session.user.id,
        })

        // Redirect to the internal billing settings page
        return NextResponse.json({
          url: `${getBaseUrl()}/workspace/settings/billing?return=${encodeURIComponent(returnUrl)}`,
        })
      } catch (error) {
        logger.error('Failed to create Loops portal session', { error })
        return NextResponse.json(
          { error: 'Failed to create billing portal session' },
          { status: 500 }
        )
      }
    }

    // Fall back to Stripe portal for backward compatibility
    if (customerIdField === 'stripeCustomerId' && stripeClient) {
      const portal = await stripeClient.billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl,
      })

      return NextResponse.json({ url: portal.url })
    }

    // No billing provider available
    logger.error('No billing provider available for portal session', {
      customerIdField,
      hasLoopsClient: !!loopsClient,
      hasStripeClient: !!stripeClient,
    })
    return NextResponse.json({ error: 'Billing portal not available' }, { status: 503 })
  } catch (error) {
    logger.error('Failed to create billing portal session', { error })
    return NextResponse.json({ error: 'Failed to create billing portal session' }, { status: 500 })
  }
}
