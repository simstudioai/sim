import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { createBillingCheckoutContract } from '@/lib/api/contracts/subscription'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { authorizeSubscriptionReference } from '@/lib/billing/authorization'
import { safeCreateLagoCheckout } from '@/lib/billing/lago/checkout'
import { isBillingEnabled, isLagoBillingProvider } from '@/lib/core/config/env-flags'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('BillingCheckout')

/**
 * Creates a Lago checkout session for plan upgrades when `BILLING_PROVIDER=lago`.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!isBillingEnabled || !isLagoBillingProvider) {
    return NextResponse.json({ error: 'Lago billing is not enabled' }, { status: 400 })
  }

  const parsed = await parseRequest(createBillingCheckoutContract, request, {})
  if (!parsed.success) return parsed.response

  const { planName, referenceId, successUrl, cancelUrl, seats } = parsed.data.body
  const userId = session.user.id

  const authorized = await authorizeSubscriptionReference(
    userId,
    referenceId,
    'upgrade-subscription'
  )
  if (!authorized) {
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
  }

  const entityType = referenceId.startsWith('org_') ? 'organization' : 'user'

  try {
    const result = await safeCreateLagoCheckout({
      entityType,
      entityId: referenceId,
      planName,
      seats,
      successUrl,
      cancelUrl,
    })

    logger.info('Created Lago checkout session', {
      userId,
      referenceId,
      planName,
      subscriptionExternalId: result.subscriptionExternalId,
    })

    return NextResponse.json({
      url: result.checkoutUrl,
      subscriptionExternalId: result.subscriptionExternalId,
    })
  } catch (error) {
    logger.error('Failed to create Lago checkout session', {
      userId,
      referenceId,
      planName,
      error: getErrorMessage(error),
    })
    return NextResponse.json({ error: 'Failed to create checkout session' }, { status: 500 })
  }
})
