import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { startCredentialGroupMcpOAuthContract } from '@/lib/api/contracts/credential-groups'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { authenticateCredentialGroupEnrollment } from '@/lib/credential-groups/application/enrollment-auth'
import { startPublicCredentialGroupMcpOAuth } from '@/lib/credential-groups/application/public-enrollment'
import {
  enforceCredentialGroupEnrollmentOAuthRateLimit,
  enforcePublicCredentialGroupOAuthStartIpRateLimit,
} from '@/lib/credential-groups/rate-limit'
import { makeTimedStep } from '@/lib/mcp/oauth'
import { createCredentialGroupEnrollmentRedirect } from '@/app/api/credential-groups/enrollment-redirect'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const logger = createLogger('CredentialGroupMcpOAuthStartAPI')
const timedStep = makeTimedStep(logger)
const MANAGED_MCP_OAUTH_START_TIMEOUT_MS = 26_000

export const GET = withRouteHandler(
  async (
    request: NextRequest,
    context: { params: Promise<{ token: string; mcpServerId: string }> }
  ) => {
    const limited = await enforcePublicCredentialGroupOAuthStartIpRateLimit(request)
    const parsed = await parseRequest(startCredentialGroupMcpOAuthContract, request, context)
    if (!parsed.success) return limited ?? parsed.response
    const { token, mcpServerId } = parsed.data.params
    if (limited) return createCredentialGroupEnrollmentRedirect(token, { oauth: 'rate_limited' })

    const principal = await authenticateCredentialGroupEnrollment(token)
    if (!principal) {
      return createCredentialGroupEnrollmentRedirect(token, { oauth: 'unavailable' })
    }
    const enrollmentLimited = await enforceCredentialGroupEnrollmentOAuthRateLimit(
      principal.enrollmentId
    )
    if (enrollmentLimited) {
      return createCredentialGroupEnrollmentRedirect(token, { oauth: 'rate_limited' })
    }

    try {
      const { authorizationUrl } = await timedStep(
        'startPublicCredentialGroupMcpOAuth',
        MANAGED_MCP_OAUTH_START_TIMEOUT_MS,
        () =>
          startPublicCredentialGroupMcpOAuth.execute({
            principal,
            input: { invitationToken: token, mcpServerId },
            request,
          })
      )
      const response = NextResponse.redirect(authorizationUrl)
      response.headers.set('Cache-Control', 'no-store')
      response.headers.set('Referrer-Policy', 'no-referrer')
      return response
    } catch (error) {
      logger.error('Failed to start managed MCP OAuth authorization', {
        error: getErrorMessage(error),
      })
      return createCredentialGroupEnrollmentRedirect(token, { oauth: 'unavailable' })
    }
  }
)
