import { createLogger } from '@sim/logger'
import { nanoid } from 'nanoid'
import { type NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { acquireLock, releaseLock } from '@/lib/core/config/redis'
import { pollRssWebhooks } from '@/lib/webhooks/rss-polling-service'

const logger = createLogger('RssPollingAPI')

export const dynamic = 'force-dynamic'
export const maxDuration = 180 // Allow up to 3 minutes for polling to complete

const LOCK_KEY = 'rss-polling-lock'
const LOCK_TTL_SECONDS = 180 // Same as maxDuration (3 min)

export async function GET(request: NextRequest) {
  const requestId = nanoid()
  logger.info(`RSS webhook polling triggered (${requestId})`)

  let lockValue: string | undefined

  try {
    const authError = verifyCronAuth(request, 'RSS webhook polling')
    if (authError) {
      return authError
    }

    lockValue = requestId
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

    const results = await pollRssWebhooks()

    return NextResponse.json({
      success: true,
      message: 'RSS polling completed',
      requestId,
      status: 'completed',
      ...results,
    })
  } catch (error) {
    logger.error(`Error during RSS polling (${requestId}):`, error)
    return NextResponse.json(
      {
        success: false,
        message: 'RSS polling failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        requestId,
      },
      { status: 500 }
    )
  } finally {
    if (lockValue) {
      await releaseLock(LOCK_KEY, lockValue).catch(() => {})
    }
  }
}
