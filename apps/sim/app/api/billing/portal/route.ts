import { db } from '@sim/db'
import { user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { createBillingPortalContract } from '@/lib/api/contracts/subscription'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { getOrganizationSubscription } from '@/lib/billing/core/billing'
import { isOrganizationOwnerOrAdmin } from '@/lib/billing/core/organization'
import { getLagoPortalUrl } from '@/lib/billing/lago/customers'
import { requireStripeClient } from '@/lib/billing/stripe-client'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { isBillingEnabled, isLagoBillingProvider } from '@/lib/core/config/env-flags'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('BillingPortal')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const session = await getSession()

  try {
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!isBillingEnabled) {
      return NextResponse.json({ error: 'Billing is not enabled' }, { status: 400 })
    }

    const parsed = await parseRequest(createBillingPortalContract, request, {})
    if (!parsed.success) return parsed.response

    const context = parsed.data.body.context ?? 'user'
    const organizationId = parsed.data.body.organizationId
    const returnUrl = parsed.data.body.returnUrl || `${getBaseUrl()}/workspace?billing=updated`

    if (isLagoBillingProvider) {
      if (context === 'organization') {
        if (!organizationId) {
          return NextResponse.json({ error: 'organizationId is required' }, { status: 400 })
        }

        const hasPermission = await isOrganizationOwnerOrAdmin(session.user.id, organizationId)
        if (!hasPermission) {
          return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
        }

        const portalUrl = await getLagoPortalUrl('organization', organizationId)
        if (!portalUrl) {
          return NextResponse.json({ error: 'Billing portal unavailable' }, { status: 404 })
        }
        return NextResponse.json({ url: portalUrl })
      }

      const portalUrl = await getLagoPortalUrl('user', session.user.id)
      if (!portalUrl) {
        return NextResponse.json({ error: 'Billing portal unavailable' }, { status: 404 })
      }
      return NextResponse.json({ url: portalUrl })
    }

    const stripe = requireStripeClient()

    let stripeCustomerId: string | null = null

    if (context === 'organization') {
      if (!organizationId) {
        return NextResponse.json({ error: 'organizationId is required' }, { status: 400 })
      }

      const hasPermission = await isOrganizationOwnerOrAdmin(session.user.id, organizationId)
      if (!hasPermission) {
        return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
      }

      const orgSubscription = await getOrganizationSubscription(organizationId)
      stripeCustomerId = orgSubscription?.stripeCustomerId ?? null
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
})
