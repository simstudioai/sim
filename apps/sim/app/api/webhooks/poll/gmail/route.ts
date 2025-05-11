import { NextRequest, NextResponse } from 'next/server'
import { nanoid } from 'nanoid'
import { Logger } from '@/lib/logs/console-logger'
import { pollGmailWebhooks } from '@/lib/webhooks/gmail-polling-service'

const logger = new Logger('GmailPollingAPI')

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // Allow up to 5 minutes for polling to complete

const activePollingTasks = new Map<string, Promise<any>>()

export async function GET(request: NextRequest) {
  const requestId = nanoid()
  logger.info(`Gmail webhook polling triggered (${requestId})`)

  try {
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

    activePollingTasks.set(requestId, pollingPromise)

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
