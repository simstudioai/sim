import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import {
  calculateOrganizationBilling,
  calculateUserBilling,
  generateBillingReport,
  getCurrentBillingPeriod,
  getPreviousBillingPeriod,
} from '@/lib/billing-calculator'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('BillingReportAPI')

// This would typically be restricted to admin users
// For now, we'll add a simple check
const ADMIN_EMAILS = ['admin@simstudio.com'] // Add your admin emails here

export async function GET(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id || !session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if user is admin (implement your own admin check logic)
    if (!ADMIN_EMAILS.includes(session.user.email)) {
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 })
    }

    const url = new URL(request.url)
    const period = url.searchParams.get('period') || 'current'
    const userIdParam = url.searchParams.get('userId')
    const organizationIdParam = url.searchParams.get('organizationId')

    // Get billing period
    const billingPeriod =
      period === 'previous' ? getPreviousBillingPeriod() : getCurrentBillingPeriod()

    // If specific user or organization requested
    if (userIdParam) {
      const userBilling = await calculateUserBilling(userIdParam, billingPeriod)
      if (!userBilling) {
        return NextResponse.json({ error: 'User not found or no billing data' }, { status: 404 })
      }
      return NextResponse.json({ user: userBilling, period: billingPeriod })
    }

    if (organizationIdParam) {
      const orgBilling = await calculateOrganizationBilling(organizationIdParam, billingPeriod)
      if (!orgBilling) {
        return NextResponse.json(
          { error: 'Organization not found or no billing data' },
          { status: 404 }
        )
      }
      return NextResponse.json({ organization: orgBilling, period: billingPeriod })
    }

    // Generate full billing report
    const billingReport = await generateBillingReport(billingPeriod)

    return NextResponse.json({
      report: billingReport,
      period: billingPeriod,
      generatedAt: new Date().toISOString(),
    })
  } catch (error) {
    logger.error('Failed to generate billing report', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id || !session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if user is admin
    if (!ADMIN_EMAILS.includes(session.user.email)) {
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 })
    }

    const body = await request.json()
    const { startDate, endDate } = body

    if (!startDate || !endDate) {
      return NextResponse.json({ error: 'Start date and end date are required' }, { status: 400 })
    }

    const customPeriod = {
      start: new Date(startDate),
      end: new Date(endDate),
    }

    // Validate dates
    if (customPeriod.start >= customPeriod.end) {
      return NextResponse.json({ error: 'Start date must be before end date' }, { status: 400 })
    }

    const billingReport = await generateBillingReport(customPeriod)

    return NextResponse.json({
      report: billingReport,
      period: customPeriod,
      generatedAt: new Date().toISOString(),
    })
  } catch (error) {
    logger.error('Failed to generate custom billing report', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
