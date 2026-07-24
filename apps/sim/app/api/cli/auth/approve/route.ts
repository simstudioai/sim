import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { approveCliAuthContract } from '@/lib/api/contracts'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { createAuthCode } from '@/lib/cli-auth/code-store'
import { enforceUserRateLimit } from '@/lib/core/rate-limiter'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('CliAuthApproveAPI')

/**
 * The approving user comes from the session and nothing else — a client-supplied
 * user id here would let any caller mint a code redeemable for someone else's
 * key. No key is generated until redemption.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimited = await enforceUserRateLimit('cli-auth-approve', session.user.id)
  if (rateLimited) return rateLimited

  const parsed = await parseRequest(approveCliAuthContract, request, {})
  if (!parsed.success) return parsed.response

  const code = await createAuthCode(session.user.id, parsed.data.body.challenge)
  logger.info('Issued CLI authorization code', { userId: session.user.id })

  return NextResponse.json({ code })
})
