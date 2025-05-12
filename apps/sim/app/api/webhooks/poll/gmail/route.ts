import { NextRequest, NextResponse } from 'next/server'
import { nanoid } from 'nanoid'
import { Logger } from '@/lib/logs/console-logger'
import { pollGmailWebhooks } from '@/lib/webhooks/gmail-polling-service'

const logger = new Logger('GmailPollingAPI')

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // Allow up to 5 minutes for polling to complete

interface PollingTask {
  promise: Promise<any>
  startedAt: number
}

const activePollingTasks = new Map<string, PollingTask>()
const STALE_TASK_THRESHOLD_MS = 10 * 60 * 1000 // 10 minutes

function cleanupStaleTasks() {
  const now = Date.now()
  let removedCount = 0

  for (const [requestId, task] of activePollingTasks.entries()) {
    if (now - task.startedAt > STALE_TASK_THRESHOLD_MS) {
      activePollingTasks.delete(requestId)
      removedCount++
    }
  }

  if (removedCount > 0) {
    logger.info(`Cleaned up ${removedCount} stale polling tasks`)
  }

  return removedCount
}

export async function GET(request: NextRequest) {
  const requestId = nanoid()
  logger.info(`Gmail webhook polling triggered (${requestId})`)

  try {
    const authHeader = request.headers.get('authorization')
    const webhookSecret = process.env.CRON_SECRET || process.env.WEBHOOK_POLLING_SECRET

    if (!webhookSecret) {
      return new NextResponse('Configuration error: Webhook secret is not set', { status: 500 })
    }

    if (!authHeader || authHeader !== `Bearer ${webhookSecret}`) {
      logger.warn(`Unauthorized access attempt to Gmail polling endpoint (${requestId})`)
      return new NextResponse('Unauthorized', { status: 401 })
    }

    cleanupStaleTasks()

    const pollingTask: PollingTask = {
      promise: null as any,
      startedAt: Date.now(),
    }

    pollingTask.promise = pollGmailWebhooks()
      .then((results) => {
        logger.info(`Gmail polling completed successfully (${requestId})`, {
          userCount: results?.total || 0,
          successful: results?.successful || 0,
          failed: results?.failed || 0,
        })
        activePollingTasks.delete(requestId)
        return results
      })
      .catch((error) => {
        logger.error(`Error in background Gmail polling task (${requestId}):`, error)
        activePollingTasks.delete(requestId)
        throw error
      })

    activePollingTasks.set(requestId, pollingTask)

    return NextResponse.json({
      success: true,
      message: 'Gmail webhook polling started successfully',
      requestId,
      status: 'polling_started',
      activeTasksCount: activePollingTasks.size,
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
