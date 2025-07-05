import { type NextRequest, NextResponse } from 'next/server'
import { processMonthlyOverageBilling } from '@/lib/billing/core/billing'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('MonthlyBillingCron')

/**
 * Monthly billing CRON job endpoint that runs daily
 */
export async function POST(request: NextRequest) {
  try {
    // Verify the request is from an authorized source (cron job)
    const authHeader = request.headers.get('authorization')
    const expectedAuth = `Bearer ${env.CRON_SECRET || 'your-cron-secret'}`

    if (authHeader !== expectedAuth) {
      logger.warn('Unauthorized attempt to trigger daily billing', {
        providedAuth: authHeader,
        ip: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown',
      })
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    logger.info('Starting monthly billing cron job')

    const startTime = Date.now()

    // Process monthly overage billing for all users and organizations
    const result = await processMonthlyOverageBilling()

    const duration = Date.now() - startTime

    if (result.success) {
      logger.info('Monthly billing completed successfully', {
        processedUsers: result.processedUsers,
        processedOrganizations: result.processedOrganizations,
        totalChargedAmount: result.totalChargedAmount,
        duration: `${duration}ms`,
      })

      return NextResponse.json({
        success: true,
        summary: {
          processedUsers: result.processedUsers,
          processedOrganizations: result.processedOrganizations,
          totalChargedAmount: result.totalChargedAmount,
          duration: `${duration}ms`,
        },
      })
    }

    logger.error('Monthly billing completed with errors', {
      processedUsers: result.processedUsers,
      processedOrganizations: result.processedOrganizations,
      totalChargedAmount: result.totalChargedAmount,
      errorCount: result.errors.length,
      errors: result.errors,
      duration: `${duration}ms`,
    })

    return NextResponse.json(
      {
        success: false,
        summary: {
          processedUsers: result.processedUsers,
          processedOrganizations: result.processedOrganizations,
          totalChargedAmount: result.totalChargedAmount,
          errorCount: result.errors.length,
          duration: `${duration}ms`,
        },
        errors: result.errors,
      },
      { status: 500 }
    )
  } catch (error) {
    logger.error('Fatal error in monthly billing cron job', { error })

    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error during monthly billing',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}

/**
 * GET endpoint for manual testing and health checks
 */
export async function GET(request: NextRequest) {
  try {
    // This endpoint can be used for testing or health checks
    const authHeader = request.headers.get('authorization')
    const expectedAuth = `Bearer ${env.CRON_SECRET || 'your-cron-secret'}`

    if (authHeader !== expectedAuth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // For health checks, we can't easily predict what entities will be billed
    // since it depends on active subscriptions
    return NextResponse.json({
      status: 'ready',
      message: 'Monthly billing cron job is ready to process both users and organizations',
      currentDate: new Date().toISOString().split('T')[0],
    })
  } catch (error) {
    logger.error('Error in billing health check', { error })
    return NextResponse.json(
      {
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
