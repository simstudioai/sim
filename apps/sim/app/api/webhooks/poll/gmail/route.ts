import { nanoid } from 'nanoid'
import { type NextRequest, NextResponse } from 'next/server'
import { env } from '@/lib/env'
import { Logger } from '@/lib/logs/console-logger'
import { acquireLock, releaseLock } from '@/lib/redis'
import { pollGmailWebhooks } from '@/lib/webhooks/gmail-polling-service'

const logger = new Logger('GmailPollingAPI')

export const dynamic = 'force-dynamic'
export const maxDuration = 180 // Allow up to 3 minutes for polling to complete

const LOCK_KEY = 'gmail-polling-lock'
const LOCK_TTL_SECONDS = 180 // Same as maxDuration (3 min)

export async function GET(request: NextRequest) {
  const requestId = nanoid()
  logger.info(`Gmail webhook polling triggered (${requestId})`)

  let lockValue: string | undefined

  try {
    const authHeader = request.headers.get('authorization')
    const webhookSecret = env.CRON_SECRET

    if (!webhookSecret) {
      return new NextResponse('Configuration error: Webhook secret is not set', { status: 500 })
    }

    if (!authHeader || authHeader !== `Bearer ${webhookSecret}`) {
      logger.warn(`Unauthorized access attempt to Gmail polling endpoint (${requestId})`)
      return new NextResponse('Unauthorized', { status: 401 })
    }

    lockValue = requestId // unique value to identify the holder
    const locked = await acquireLock(LOCK_KEY, lockValue, LOCK_TTL_SECONDS)

    if (!locked) {
      return NextResponse.json(
        {
          success: true,
          message: 'Polling already in progress – skipped',
          requestId,
          status: 'skip',
        },
        { status: 202 }
      )
    }

    const results = await pollGmailWebhooks()

    return NextResponse.json({
      success: true,
      message: 'Gmail polling completed',
      requestId,
      status: 'completed',
      ...results,
    })
  } catch (error) {
    logger.error(`Error during Gmail polling (${requestId}):`, error)
    return NextResponse.json(
      {
        success: false,
        message: 'Gmail polling failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        requestId,
      },
      { status: 500 }
    )
  } finally {
    await releaseLock(LOCK_KEY).catch(() => {})
  }
}
