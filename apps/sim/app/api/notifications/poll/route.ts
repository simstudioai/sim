import { createLogger } from '@sim/logger'
import { nanoid } from 'nanoid'
import { type NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { acquireLock, releaseLock } from '@/lib/core/config/redis'
import { pollInactivityAlerts } from '@/lib/notifications/inactivity-polling'

const logger = createLogger('InactivityAlertPoll')

export const maxDuration = 120

const LOCK_KEY = 'inactivity-alert-polling-lock'
const LOCK_TTL_SECONDS = 120

export async function GET(request: NextRequest) {
  const requestId = nanoid()
  logger.info(`Inactivity alert polling triggered (${requestId})`)

  let lockAcquired = false

  try {
    const authError = verifyCronAuth(request, 'Inactivity alert polling')
    if (authError) {
      return authError
    }

    lockAcquired = await acquireLock(LOCK_KEY, requestId, LOCK_TTL_SECONDS)

    if (!lockAcquired) {
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

    const results = await pollInactivityAlerts()

    return NextResponse.json({
      success: true,
      message: 'Inactivity alert polling completed',
      requestId,
      status: 'completed',
      ...results,
    })
  } catch (error) {
    logger.error(`Error during inactivity alert polling (${requestId}):`, error)
    return NextResponse.json(
      {
        success: false,
        message: 'Inactivity alert polling failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        requestId,
      },
      { status: 500 }
    )
  } finally {
    if (lockAcquired) {
      await releaseLock(LOCK_KEY, requestId).catch(() => {})
    }
  }
}
