import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { startCredentialGroupOAuthContract } from '@/lib/api/contracts/credential-groups'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { authenticateCredentialGroupEnrollment } from '@/lib/credential-groups/application/enrollment-auth'
import { startPublicCredentialGroupOAuth } from '@/lib/credential-groups/application/public-enrollment'
import { CredentialGroupOAuthError } from '@/lib/credential-groups/provider-adapter'
import {
  enforceCredentialGroupEnrollmentOAuthRateLimit,
  enforcePublicCredentialGroupOAuthStartIpRateLimit,
} from '@/lib/credential-groups/rate-limit'
import { createCredentialGroupEnrollmentRedirect } from '@/app/api/credential-groups/enrollment-redirect'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const logger = createLogger('CredentialGroupOAuthStartAPI')

export const GET = withRouteHandler(
  async (
    request: NextRequest,
    context: { params: Promise<{ token: string; optionId: string }> }
  ) => {
    const limited = await enforcePublicCredentialGroupOAuthStartIpRateLimit(request)

    const parsed = await parseRequest(startCredentialGroupOAuthContract, request, context)
    if (!parsed.success) return limited ?? parsed.response
    const { token, optionId } = parsed.data.params
    const { returnTo } = parsed.data.query
    const focus: Record<string, string> = returnTo ? { optionId, returnTo } : {}
    if (limited) {
      return createCredentialGroupEnrollmentRedirect(token, { ...focus, oauth: 'rate_limited' })
    }
    const principal = await authenticateCredentialGroupEnrollment(token)
    if (!principal) {
      return createCredentialGroupEnrollmentRedirect(token, { ...focus, oauth: 'unavailable' })
    }

    const enrollmentLimited = await enforceCredentialGroupEnrollmentOAuthRateLimit(
      principal.enrollmentId
    )
    if (enrollmentLimited) {
      return createCredentialGroupEnrollmentRedirect(token, { ...focus, oauth: 'rate_limited' })
    }

    try {
      const { authorizationUrl } = await startPublicCredentialGroupOAuth.execute({
        principal,
        input: { invitationToken: token, optionId, ...(returnTo ? { returnTo } : {}) },
        request,
      })
      const response = NextResponse.redirect(authorizationUrl)
      response.headers.set('Cache-Control', 'no-store')
      response.headers.set('Referrer-Policy', 'no-referrer')
      return response
    } catch (error) {
      logger.error('Failed to start managed OAuth authorization', {
        error: getErrorMessage(error),
      })
      return createCredentialGroupEnrollmentRedirect(token, {
        ...focus,
        oauth:
          error instanceof CredentialGroupOAuthError && error.statusCode === 409
            ? 'configuration_changed'
            : 'unavailable',
      })
    }
  }
)
