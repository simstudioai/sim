import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { pollCliAuthContract } from '@/lib/api/contracts'
import { parseRequest } from '@/lib/api/server'
import { completeApproval, pollApproval, releaseMint } from '@/lib/cli-auth/approval-store'
import { CopilotApiKeyError, generateCopilotApiKey } from '@/lib/copilot/server/api-keys'
import { enforceIpRateLimit } from '@/lib/core/rate-limiter'
import type { TokenBucketConfig } from '@/lib/core/rate-limiter/storage'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('CliAuthPollAPI')

/**
 * The CLI polls every 2s (30/min) for up to 15 minutes. The default public-IP
 * bucket (10 burst, 5/min) would 429 within ~20s, so size the limit to the poll
 * cadence with headroom. The endpoint is not a brute-force surface — an unknown
 * request id just returns `pending`, and minting needs the 256-bit verifier — so
 * a generous per-IP limit is safe.
 */
const POLL_RATE_LIMIT: TokenBucketConfig = {
  maxTokens: 60,
  refillRate: 60,
  refillIntervalMs: 60_000,
}

/** Keys are named for the day they were issued, matching what the CLI prints. */
function cliKeyName(): string {
  return `CLI (${new Date().toISOString().slice(0, 10)})`
}

/**
 * The CLI's poll endpoint. Unauthenticated by necessity — the CLI has no
 * session — but the request id is only a rendezvous handle and minting requires
 * the poll secret, which never leaves the CLI. Returns `pending` until the user
 * approves; on an authorized poll it mints, then consumes the approval — a
 * failed mint releases the reservation so a later poll can retry.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const rateLimited = await enforceIpRateLimit('cli-auth-poll', request, POLL_RATE_LIMIT)
  if (rateLimited) return rateLimited

  const parsed = await parseRequest(pollCliAuthContract, request, {})
  if (!parsed.success) return parsed.response

  const { request: requestId, verifier } = parsed.data.body

  const result = await pollApproval(requestId, verifier)
  if (result.status === 'pending') {
    return NextResponse.json({ status: 'pending' })
  }

  let key: Awaited<ReturnType<typeof generateCopilotApiKey>>
  try {
    key = await generateCopilotApiKey(result.userId, cliKeyName())
  } catch (error) {
    // Mint failed — release the reservation so a later poll can retry.
    await releaseMint(requestId)
    const status = error instanceof CopilotApiKeyError ? error.upstreamStatus : undefined
    return NextResponse.json(
      { error: 'Failed to generate copilot API key' },
      { status: status ?? 500 }
    )
  }

  // Mint succeeded — the key exists. Consuming the approval is best-effort: a
  // cleanup failure must NOT release the lock (that would let a later poll mint
  // a second, orphaned key). The record and lock share a TTL and expire together.
  await completeApproval(requestId).catch((error) => {
    logger.error('Failed to consume CLI approval after minting', {
      error,
      userId: result.userId,
    })
  })
  logger.info('Minted CLI key on approved poll', { userId: result.userId })
  return NextResponse.json({ status: 'complete', key })
})
