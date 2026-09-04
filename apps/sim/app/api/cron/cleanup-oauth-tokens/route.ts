import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { isOAuthProviderEnabled } from '@/lib/core/config/env-flags'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { runCleanupOAuthTokens } from '@/background/cleanup-oauth-tokens'

export const dynamic = 'force-dynamic'

const logger = createLogger('CleanupOAuthTokensAPI')

/**
 * Retention sweep for lapsed OAuth token rows. A deployment with the provider
 * switched off issues none, so the sweep answers immediately rather than
 * scanning two empty tables on a schedule.
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const authError = verifyCronAuth(request, 'OAuth token cleanup')
  if (authError) return authError

  if (!isOAuthProviderEnabled) {
    return NextResponse.json({ success: true, refreshTokens: 0, accessTokens: 0 })
  }

  try {
    const result = await runCleanupOAuthTokens()
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    logger.error('Failed to sweep expired OAuth tokens', { error })
    return NextResponse.json(
      { error: getErrorMessage(error, 'Failed to sweep expired OAuth tokens') },
      { status: 500 }
    )
  }
})
