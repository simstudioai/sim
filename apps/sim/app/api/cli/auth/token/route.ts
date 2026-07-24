import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { exchangeCliAuthCodeContract } from '@/lib/api/contracts'
import { parseRequest } from '@/lib/api/server'
import { consumeAuthCode } from '@/lib/cli-auth/code-store'
import { CopilotApiKeyError, generateCopilotApiKey } from '@/lib/copilot/server/generate-api-key'
import { enforceIpRateLimit } from '@/lib/core/rate-limiter'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('CliAuthTokenAPI')

/** Keys are named for the day they were issued, matching what the CLI prints. */
function cliKeyName(): string {
  return `CLI (${new Date().toISOString().slice(0, 10)})`
}

/**
 * Unauthenticated by necessity — the CLI has no session — but the code is a
 * 256-bit single-use bearer paired with a PKCE verifier, and redemption creates
 * no server state. Every rejection returns the same response so the endpoint
 * cannot be used to learn which codes exist.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const rateLimited = await enforceIpRateLimit('cli-auth-token', request)
  if (rateLimited) return rateLimited

  const parsed = await parseRequest(exchangeCliAuthCodeContract, request, {})
  if (!parsed.success) return parsed.response

  const { code, verifier } = parsed.data.body

  const userId = await consumeAuthCode(code, verifier)
  if (!userId) {
    logger.warn('Rejected CLI code exchange')
    return NextResponse.json({ error: 'Invalid or expired authorization code' }, { status: 400 })
  }

  try {
    const key = await generateCopilotApiKey(userId, cliKeyName())
    logger.info('Exchanged CLI authorization code for a key', { userId })
    return NextResponse.json({ key })
  } catch (error) {
    const status = error instanceof CopilotApiKeyError ? error.upstreamStatus : undefined
    return NextResponse.json(
      { error: 'Failed to generate copilot API key' },
      { status: status ?? 500 }
    )
  }
})
