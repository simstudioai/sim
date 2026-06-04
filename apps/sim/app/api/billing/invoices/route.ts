import { db } from '@sim/db'
import { subscription as subscriptionTable, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, inArray, or } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getInvoicesContract } from '@/lib/api/contracts/subscription'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { isOrganizationOwnerOrAdmin } from '@/lib/billing/core/organization'
import { getStripeClient } from '@/lib/billing/stripe-client'
import { ENTITLED_SUBSCRIPTION_STATUSES } from '@/lib/billing/subscriptions/utils'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('BillingInvoices')

/** Cap the number of invoices returned to the most recent statements. */
const MAX_INVOICES = 12

/**
 * Lists finalized Stripe invoices for the caller's billing customer (personal
 * or organization-scoped). Returns an empty list when there is no Stripe
 * customer yet or when Stripe is not configured, so the UI can simply hide the
 * Invoices section instead of surfacing an error.
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(getInvoicesContract, request, {})
  if (!parsed.success) return parsed.response

  const { context, organizationId } = parsed.data.query

  if (context === 'organization' && !organizationId) {
    return NextResponse.json(
      { error: 'organizationId is required when context=organization' },
      { status: 400 }
    )
  }

  let stripeCustomerId: string | null = null

  if (context === 'organization') {
    const hasPermission = await isOrganizationOwnerOrAdmin(session.user.id, organizationId!)
    if (!hasPermission) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
    }

    const rows = await db
      .select({ customer: subscriptionTable.stripeCustomerId })
      .from(subscriptionTable)
      .where(
        and(
          eq(subscriptionTable.referenceId, organizationId!),
          or(
            inArray(subscriptionTable.status, ENTITLED_SUBSCRIPTION_STATUSES),
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

  const stripe = getStripeClient()
  if (!stripeCustomerId || !stripe) {
    return NextResponse.json({ success: true, invoices: [], hasMore: false })
  }

  try {
    const result = await stripe.invoices.list({ customer: stripeCustomerId, limit: MAX_INVOICES })

    const invoices = result.data
      .filter((invoice) => invoice.id && invoice.status && invoice.status !== 'draft')
      .map((invoice) => ({
        id: invoice.id as string,
        number: invoice.number ?? null,
        created: invoice.created,
        total: invoice.total,
        amountPaid: invoice.amount_paid,
        currency: invoice.currency,
        status: invoice.status ?? null,
        hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
        invoicePdf: invoice.invoice_pdf ?? null,
      }))

    return NextResponse.json({ success: true, invoices, hasMore: result.has_more })
  } catch (error) {
    logger.error('Failed to list invoices', { error, userId: session.user.id, context })
    return NextResponse.json({ error: 'Failed to list invoices' }, { status: 500 })
  }
})
