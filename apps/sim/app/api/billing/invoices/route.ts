import { db } from '@sim/db'
import { user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getInvoicesContract } from '@/lib/api/contracts/subscription'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { getOrganizationSubscription } from '@/lib/billing/core/billing'
import { isOrganizationOwnerOrAdmin } from '@/lib/billing/core/organization'
import { listLagoInvoices } from '@/lib/billing/lago/invoices'
import { getStripeClient } from '@/lib/billing/stripe-client'
import { isLagoBillingProvider } from '@/lib/core/config/env-flags'
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

  if (isLagoBillingProvider) {
    if (context === 'organization') {
      const hasPermission = await isOrganizationOwnerOrAdmin(session.user.id, organizationId!)
      if (!hasPermission) {
        return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
      }
      const result = await listLagoInvoices('organization', organizationId!, MAX_INVOICES)
      return NextResponse.json({ success: true, ...result })
    }

    const result = await listLagoInvoices('user', session.user.id, MAX_INVOICES)
    return NextResponse.json({ success: true, ...result })
  }

  let stripeCustomerId: string | null = null

  if (context === 'organization') {
    const hasPermission = await isOrganizationOwnerOrAdmin(session.user.id, organizationId!)
    if (!hasPermission) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
    }

    // Resolve the org's customer via the canonical resolver so we deterministically
    // pick the same subscription (most recent entitled, ordered) the rest of the
    // billing UI uses — a bare limit(1) here could select a stale row.
    const orgSubscription = await getOrganizationSubscription(organizationId!)
    stripeCustomerId = orgSubscription?.stripeCustomerId ?? null
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
