import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { acquireLock, releaseLock } from '@/lib/core/config/redis'
import { generateShortId } from '@/lib/core/utils/uuid'
import { pollProvider, VALID_POLLING_PROVIDERS } from '@/lib/webhooks/polling'

const logger = createLogger('PollingAPI')

/** Lock TTL in seconds — must match maxDuration so the lock auto-expires if the function times out. */
const LOCK_TTL_SECONDS = 180

export const dynamic = 'force-dynamic'
export const maxDuration = 180

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params
  const requestId = generateShortId()

  const LOCK_KEY = `${provider}-polling-lock`
  let lockValue: string | undefined

  try {
    const authError = verifyCronAuth(request, `${provider} webhook polling`)
    if (authError) return authError

    if (!VALID_POLLING_PROVIDERS.has(provider)) {
      return NextResponse.json({ error: `Unknown polling provider: ${provider}` }, { status: 404 })
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

    const results = await pollProvider(provider)

    return NextResponse.json({
      success: true,
      message: `${provider} polling completed`,
      requestId,
      status: 'completed',
      ...results,
    })
  } catch (error) {
    logger.error(`Error during ${provider} polling (${requestId}):`, error)
    return NextResponse.json(
      {
        success: false,
        message: `${provider} polling failed`,
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
