import { createLogger } from '@sim/logger'
import { nanoid } from 'nanoid'
import { type NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { acquireLock, releaseLock } from '@/lib/core/config/redis'
import { pollImapWebhooks } from '@/lib/webhooks/imap-polling-service'

const logger = createLogger('ImapPollingAPI')

export const dynamic = 'force-dynamic'
export const maxDuration = 180 // Allow up to 3 minutes for polling to complete

const LOCK_KEY = 'imap-polling-lock'
const LOCK_TTL_SECONDS = 180 // Same as maxDuration (3 min)

export async function GET(request: NextRequest) {
  const requestId = nanoid()
  logger.info(`IMAP webhook polling triggered (${requestId})`)

  let lockValue: string | undefined

  try {
    const authError = verifyCronAuth(request, 'IMAP webhook polling')
    if (authError) {
      return authError
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

    const results = await pollImapWebhooks()

    return NextResponse.json({
      success: true,
      message: 'IMAP polling completed',
      requestId,
      status: 'completed',
      ...results,
    })
  } catch (error) {
    logger.error(`Error during IMAP polling (${requestId}):`, error)
    return NextResponse.json(
      {
        success: false,
        message: 'IMAP polling failed',
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
