import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { pollCliAuthContract } from '@/lib/api/contracts'
import { parseRequest } from '@/lib/api/server'
import {
  performCreatePersonalApiKey,
  performCreateWorkspaceApiKey,
} from '@/lib/api-key/orchestration'
import type { ApprovalGrant } from '@/lib/cli-auth/approval-store'
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
 * Mints from the key space the approval recorded.
 *
 * A name collision is reported as a conflict rather than retried under a
 * generated name: two logins on the same day from the same terminal should
 * reuse the existing key, and silently accumulating `CLI (date) (2)` rows
 * would hide that.
 */
async function mintForGrant(
  grant: ApprovalGrant
): Promise<
  { ok: true; key: { id: string; apiKey: string } } | { ok: false; status: number; message: string }
> {
  const name = cliKeyName()

  if (grant.scope === 'copilot') {
    try {
      const key = await generateCopilotApiKey(grant.userId, name)
      return { ok: true, key }
    } catch (error) {
      const status = error instanceof CopilotApiKeyError ? error.upstreamStatus : undefined
      return { ok: false, status: status ?? 500, message: 'Failed to generate copilot API key' }
    }
  }

  // `workspaceId` alone only names the terminal's default workspace; binding the
  // key to it is a separate, admin-gated decision made at approval.
  const result =
    grant.workspaceBound && grant.workspaceId
      ? await performCreateWorkspaceApiKey({
          workspaceId: grant.workspaceId,
          userId: grant.userId,
          name,
          source: 'cli',
        })
      : await performCreatePersonalApiKey({ userId: grant.userId, name, source: 'cli' })

  if (!result.success || !result.key) {
    return {
      ok: false,
      status: result.errorCode === 'conflict' ? 409 : 500,
      message: result.error ?? 'Failed to generate API key',
    }
  }

  return { ok: true, key: { id: result.key.id, apiKey: result.key.key } }
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

  const minted = await mintForGrant(result)
  if (!minted.ok) {
    // Mint failed — release the reservation so a later poll can retry.
    await releaseMint(requestId)
    return NextResponse.json({ error: minted.message }, { status: minted.status })
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
  logger.info('Minted CLI key on approved poll', {
    userId: result.userId,
    scope: result.scope,
    workspaceId: result.workspaceId,
    workspaceBound: result.workspaceBound,
  })
  return NextResponse.json({
    status: 'complete',
    key: minted.key,
    scope: result.scope,
    workspaceId: result.workspaceId,
    workspaceBound: result.workspaceBound,
  })
})
