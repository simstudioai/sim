import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { pollCliAuthContract } from '@/lib/api/contracts'
import { parseRequest } from '@/lib/api/server'
import { pollApproval } from '@/lib/cli-auth/approval-store'
import { CopilotApiKeyError, generateCopilotApiKey } from '@/lib/copilot/server/api-keys'
import { enforceIpRateLimit } from '@/lib/core/rate-limiter'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('CliAuthPollAPI')

/** Keys are named for the day they were issued, matching what the CLI prints. */
function cliKeyName(): string {
  return `CLI (${new Date().toISOString().slice(0, 10)})`
}

/**
 * The CLI's poll endpoint. Unauthenticated by necessity — the CLI has no
 * session — but the request id is only a rendezvous handle and minting requires
 * the poll secret, which never leaves the CLI. Returns `pending` until the user
 * approves; on the first authorized poll it consumes the approval and mints.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const rateLimited = await enforceIpRateLimit('cli-auth-poll', request)
  if (rateLimited) return rateLimited

  const parsed = await parseRequest(pollCliAuthContract, request, {})
  if (!parsed.success) return parsed.response

  const { request: requestId, verifier } = parsed.data.body

  const result = await pollApproval(requestId, verifier)
  if (result.status === 'pending') {
    return NextResponse.json({ status: 'pending' })
  }

  try {
    const key = await generateCopilotApiKey(result.userId, cliKeyName())
    logger.info('Minted CLI key on approved poll', { userId: result.userId })
    return NextResponse.json({ status: 'complete', key })
  } catch (error) {
    const status = error instanceof CopilotApiKeyError ? error.upstreamStatus : undefined
    return NextResponse.json(
      { error: 'Failed to generate copilot API key' },
      { status: status ?? 500 }
    )
  }
})
