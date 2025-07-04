import { type NextRequest, NextResponse } from 'next/server'
import { processUserOverageBilling } from '@/lib/billing/core/billing'
import { getUsersWithEndedBillingPeriods } from '@/lib/billing/core/billing-periods'
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

    logger.info('Starting daily billing cron job')

    const startTime = Date.now()

    // Get users whose billing periods end today
    const usersToProcess = await getUsersWithEndedBillingPeriods()

    let processedUsers = 0
    const processedOrganizations = 0
    let totalChargedAmount = 0
    const errors: string[] = []

    // Process each user individually
    for (const userId of usersToProcess) {
      try {
        const result = await processUserOverageBilling(userId)
        if (result.success) {
          processedUsers++
          totalChargedAmount += result.chargedAmount || 0
          logger.info('Successfully processed user billing period end', {
            userId,
            chargedAmount: result.chargedAmount,
          })
        } else {
          errors.push(`User ${userId}: ${result.error}`)
          logger.error('Failed to process user billing period end', { userId, error: result.error })
        }
      } catch (error) {
        const errorMsg = `User ${userId}: ${error instanceof Error ? error.message : 'Unknown error'}`
        errors.push(errorMsg)
        logger.error('Exception during user billing period end processing', { userId, error })
      }
    }

    const duration = Date.now() - startTime
    const success = errors.length === 0

    if (success) {
      logger.info('Daily billing completed successfully', {
        usersToProcess: usersToProcess.length,
        processedUsers,
        processedOrganizations,
        totalChargedAmount,
        duration: `${duration}ms`,
      })

      return NextResponse.json({
        success: true,
        summary: {
          usersToProcess: usersToProcess.length,
          processedUsers,
          processedOrganizations,
          totalChargedAmount,
          duration: `${duration}ms`,
        },
      })
    }

    logger.error('Daily billing completed with errors', {
      usersToProcess: usersToProcess.length,
      processedUsers,
      processedOrganizations,
      totalChargedAmount,
      errorCount: errors.length,
      errors,
      duration: `${duration}ms`,
    })

    return NextResponse.json(
      {
        success: false,
        summary: {
          usersToProcess: usersToProcess.length,
          processedUsers,
          processedOrganizations,
          totalChargedAmount,
          errorCount: errors.length,
          duration: `${duration}ms`,
        },
        errors,
      },
      { status: 500 }
    )
  } catch (error) {
    logger.error('Fatal error in daily billing cron job', { error })

    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error during daily billing',
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

    // Get billing summary without actually processing
    const usersToProcess = await getUsersWithEndedBillingPeriods()

    return NextResponse.json({
      status: 'ready',
      summary: {
        usersWithBillingPeriodsEndingToday: usersToProcess.length,
        userIds: usersToProcess,
        currentDate: new Date().toISOString().split('T')[0],
      },
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
