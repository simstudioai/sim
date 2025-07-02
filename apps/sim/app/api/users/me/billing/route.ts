import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getBillingSummary } from '@/lib/billing/calculations/billing-calculator'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('BillingSummaryAPI')

/**
 * GET /api/users/me/billing
 * Get billing summary for the current user, including organization data if applicable
 */
export async function GET(request: NextRequest) {
  let session

  try {
    session = await getSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get query parameter for organization ID
    const { searchParams } = new URL(request.url)
    const organizationId = searchParams.get('organizationId')

    // Get billing summary
    const billingSummary = await getBillingSummary(session.user.id, organizationId || undefined)

    return NextResponse.json({
      success: true,
      data: billingSummary,
    })
  } catch (error) {
    logger.error('Failed to get billing summary', {
      userId: session?.user?.id,
      error,
    })

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
