import { type NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { processDailyBillingCheck } from '@/lib/billing/core/billing'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('DailyBillingCron')

/**
 * Daily billing CRON job endpoint that checks individual billing periods
 */
export async function POST(request: NextRequest) {
  try {
    const authError = verifyCronAuth(request, 'daily billing check')
    if (authError) {
      return authError
    }

    logger.info('Starting daily billing check cron job')

    const startTime = Date.now()

    // Process overage billing for users and organizations with periods ending today
    const result = await processDailyBillingCheck()

    const duration = Date.now() - startTime

    if (result.success) {
      logger.info('Daily billing check completed successfully', {
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

    logger.error('Daily billing check completed with errors', {
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
    logger.error('Fatal error in daily billing cron job', { error })

    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error during daily billing check',
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
    const authError = verifyCronAuth(request, 'daily billing check health check')
    if (authError) {
      return authError
    }

    const startTime = Date.now()
    const result = await processDailyBillingCheck()
    const duration = Date.now() - startTime

    if (result.success) {
      logger.info('Daily billing check (GET) completed successfully', {
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

    logger.error('Daily billing check (GET) completed with errors', {
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
    logger.error('Fatal error in daily billing (GET) cron job', { error })
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error during daily billing check',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
