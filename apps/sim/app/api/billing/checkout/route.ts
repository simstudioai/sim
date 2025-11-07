import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLoopsCheckoutSession } from '@/lib/billing/loops-checkout'
import { isLoopsEnabled } from '@/lib/billing/loops-client'
import { createLogger } from '@/lib/logs/console/logger'
import { getBaseUrl } from '@/lib/urls/utils'

const logger = createLogger('BillingCheckout')

/**
 * POST /api/billing/checkout
 * Creates a Loops v3 checkout session for subscription upgrade
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession()

    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!isLoopsEnabled()) {
      return NextResponse.json(
        { error: 'Loops checkout is not enabled' },
        { status: 400 }
      )
    }

    const body = await request.json()
    const { plan, successUrl, cancelUrl, metadata } = body

    if (!plan) {
      return NextResponse.json({ error: 'Plan is required' }, { status: 400 })
    }

    // Use provided URLs or default to current page
    const finalSuccessUrl = successUrl || `${getBaseUrl()}/workspace`
    const finalCancelUrl = cancelUrl || `${getBaseUrl()}/workspace`

    logger.info('Creating Loops checkout session', {
      userId: session.user.id,
      plan,
      successUrl: finalSuccessUrl,
      cancelUrl: finalCancelUrl,
    })

    const checkoutSession = await createLoopsCheckoutSession({
      plan,
      externalCustomerId: session.user.id,
      successUrl: finalSuccessUrl,
      cancelUrl: finalCancelUrl,
      metadata: {
        userId: session.user.id,
        userEmail: session.user.email,
        ...metadata,
      },
    })

    return NextResponse.json({
      url: checkoutSession.url,
      sessionId: checkoutSession.sessionId,
    })
  } catch (error) {
    logger.error('Failed to create checkout session', { error })
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to create checkout session',
      },
      { status: 500 }
    )
  }
}

