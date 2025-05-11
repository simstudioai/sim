import { NextRequest, NextResponse } from 'next/server'
import { nanoid } from 'nanoid'
import { Logger } from '@/lib/logs/console-logger'
import { pollGmailWebhooks } from '@/lib/webhooks/gmail-polling-service'

const logger = new Logger('GmailPollingAPI')

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // Allow up to 5 minutes for polling to complete

// Track active polling tasks to prevent garbage collection
const activePollingTasks = new Map<string, Promise<any>>()

/**
 * Gmail webhook polling endpoint
 * Designed to be called at a fixed 1-minute interval via CRON job
 * This endpoint checks for new emails in Gmail and processes them
 * Each email is processed as a separate workflow trigger
 *
 * This implementation is asynchronous - it starts the polling process
 * in the background and returns immediately to prevent timeouts with
 * large numbers of emails or users.
 */
export async function GET(request: NextRequest) {
  const requestId = nanoid()
  logger.info(`Gmail webhook polling triggered (${requestId})`)

  try {
    // Check for authorization header if provided
    const authHeader = request.headers.get('authorization')
    const webhookSecret = process.env.WEBHOOK_POLLING_SECRET

    if (webhookSecret && (!authHeader || authHeader !== `Bearer ${webhookSecret}`)) {
      logger.warn(`Unauthorized access attempt to Gmail polling endpoint (${requestId})`)
      return new NextResponse('Unauthorized', { status: 401 })
    }

    // Start polling process asynchronously
    const pollingPromise = pollGmailWebhooks()
      .then((results) => {
        logger.info(`Gmail polling completed successfully (${requestId})`, {
          userCount: results?.total || 0,
          successful: results?.successful || 0,
          failed: results?.failed || 0,
        })
        // Remove from tracking map when done
        activePollingTasks.delete(requestId)
        return results
      })
      .catch((error) => {
        logger.error(`Error in background Gmail polling task (${requestId}):`, error)
        // Remove from tracking map on error
        activePollingTasks.delete(requestId)
        throw error
      })

    // Store the promise in the map to prevent garbage collection
    activePollingTasks.set(requestId, pollingPromise)

    // Return immediately with status that polling has started
    return NextResponse.json({
      success: true,
      message: 'Gmail webhook polling started successfully',
      requestId,
      status: 'polling_started',
    })
  } catch (error) {
    logger.error(`Error initiating Gmail webhook polling (${requestId}):`, error)

    return NextResponse.json(
      {
        success: false,
        message: 'Failed to start Gmail webhook polling',
        error: error instanceof Error ? error.message : 'Unknown error',
        requestId,
      },
      { status: 500 }
    )
  }
}
