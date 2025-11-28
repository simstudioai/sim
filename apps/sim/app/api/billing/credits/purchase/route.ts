import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createCreditPurchaseCheckout } from '@/lib/billing/credits/purchase'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('CreditPurchaseAPI')

/**
 * POST /api/billing/credits/purchase
 * Creates a Stripe Checkout session for purchasing prepaid credits.
 *
 * Request body:
 * - amount: number (minimum $50, maximum $10,000)
 * - referenceId: string (userId for Pro, organizationId for Team)
 * - referenceType: 'user' | 'organization'
 */
export async function POST(request: NextRequest) {
  const session = await getSession()

  try {
    if (!session?.user?.id || !session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { amount, referenceId, referenceType } = body

    // Validate request body
    if (typeof amount !== 'number' || amount < 50) {
      return NextResponse.json({ error: 'Amount must be at least $50' }, { status: 400 })
    }

    if (amount > 10000) {
      return NextResponse.json(
        { error: 'Amount cannot exceed $10,000. Please contact support for larger purchases.' },
        { status: 400 }
      )
    }

    if (!referenceId || typeof referenceId !== 'string') {
      return NextResponse.json({ error: 'referenceId is required' }, { status: 400 })
    }

    if (!referenceType || !['user', 'organization'].includes(referenceType)) {
      return NextResponse.json(
        { error: 'referenceType must be "user" or "organization"' },
        { status: 400 }
      )
    }

    // Create checkout session
    const result = await createCreditPurchaseCheckout({
      amount,
      referenceId,
      referenceType: referenceType as 'user' | 'organization',
      currentUser: {
        id: session.user.id,
        email: session.user.email,
      },
    })

    logger.info('Credit purchase checkout created', {
      userId: session.user.id,
      amount,
      referenceType,
      referenceId,
      sessionId: result.sessionId,
    })

    return NextResponse.json(result)
  } catch (error: any) {
    logger.error('Error creating credit purchase checkout', {
      userId: session?.user?.id,
      error: error.message,
      stack: error.stack,
    })

    // Return user-friendly error messages
    const statusCode =
      error.message.includes('only available') || error.message.includes('only')
        ? 403
        : error.message.includes('not found')
          ? 404
          : 500

    return NextResponse.json(
      {
        error: error.message || 'Failed to create credit purchase checkout',
      },
      { status: statusCode }
    )
  }
}
