import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { approveCliAuthContract } from '@/lib/api/contracts'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { createApproval } from '@/lib/cli-auth/approval-store'
import { enforceUserRateLimit } from '@/lib/core/rate-limiter'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('CliAuthApproveAPI')

/**
 * Records a signed-in user's approval of a CLI handoff so the waiting terminal's
 * poll can complete.
 *
 * The approving user comes from the session and nothing else — a client-supplied
 * user id here would let any caller approve a request redeemable for someone
 * else's key. No key is generated until the CLI polls.
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

  await createApproval(session.user.id, parsed.data.body.request, parsed.data.body.challenge)
  logger.info('Recorded CLI authorization approval', { userId: session.user.id })

  return NextResponse.json({ ok: true })
})
