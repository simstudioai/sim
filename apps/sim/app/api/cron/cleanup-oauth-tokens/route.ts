import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { verifyCronAuth } from '@/lib/auth/internal'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { purgeExpiredDeletedAccountIdentities } from '@/lib/users/deleted-identity'
import { runCleanupOAuthTokens } from '@/background/cleanup-oauth-tokens'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const logger = createLogger('CleanupOAuthTokensAPI')

/**
 * Retention sweep for lapsed OAuth token rows. Issuance state does not gate
 * retention: a deployment that disables the provider must still drain rows
 * created while it was enabled.
 *
 * The same hourly run drains expired deleted-account identity digests first,
 * within its own short budget, so they never outlive their retention window. A
 * failed purge is logged and never holds up the token sweep.
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const authError = verifyCronAuth(request, 'OAuth token cleanup')
  if (authError) return authError

  try {
    const deletedAccountIdentities = await purgeExpiredDeletedAccountIdentities().catch((error) => {
      logger.error('Failed to purge expired deleted-account identities', { error })
      return null
    })
    const result = await runCleanupOAuthTokens()
    return NextResponse.json({ success: true, ...result, deletedAccountIdentities })
  } catch (error) {
    logger.error('Failed to sweep expired OAuth tokens', { error })
    return NextResponse.json(
      { error: getErrorMessage(error, 'Failed to sweep expired OAuth tokens') },
      { status: 500 }
    )
  }
})
