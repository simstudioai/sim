import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateShortId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { webhookPollingContract } from '@/lib/api/contracts/webhooks'
import { parseRequest } from '@/lib/api/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { acquireLock, releaseLock } from '@/lib/core/config/redis'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { pollProvider, VALID_POLLING_PROVIDERS } from '@/lib/webhooks/polling'

const logger = createLogger('PollingAPI')

/** Lock TTL in seconds — must match maxDuration so the lock auto-expires if the function times out. */
const LOCK_TTL_SECONDS = 180

export const dynamic = 'force-dynamic'
export const maxDuration = 180

export const GET = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ provider: string }> }) => {
    const requestId = generateShortId()
    let provider: string | undefined

    try {
      const authError = verifyCronAuth(request, 'webhook polling')
      if (authError) return authError

      const parsed = await parseRequest(webhookPollingContract, request, context)
      if (!parsed.success) return parsed.response
      provider = parsed.data.params.provider

      if (!VALID_POLLING_PROVIDERS.has(provider)) {
        return NextResponse.json(
          { error: `Unknown polling provider: ${provider}` },
          { status: 404 }
        )
      }

      const LOCK_KEY = `${provider}-polling-lock`
      let lockValue: string | undefined

      try {
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
      } finally {
        if (lockValue) {
          await releaseLock(LOCK_KEY, lockValue).catch(() => {})
        }
      }
    } catch (error) {
      const providerLabel = provider ?? 'webhook'
      logger.error(`Error during ${providerLabel} polling (${requestId}):`, error)
      return NextResponse.json(
        {
          success: false,
          message: `${providerLabel} polling failed`,
          error: getErrorMessage(error, 'Unknown error'),
          requestId,
        },
        { status: 500 }
      )
    }
  }
)
