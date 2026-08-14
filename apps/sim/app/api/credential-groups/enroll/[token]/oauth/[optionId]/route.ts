import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { startCredentialGroupOAuthContract } from '@/lib/api/contracts/credential-groups'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getCredentialGroupOAuthContext } from '@/lib/credential-groups/enrollments'
import { startCredentialGroupOAuth } from '@/lib/credential-groups/oauth'
import { CredentialGroupOAuthError } from '@/lib/credential-groups/provider-adapter'
import {
  enforceCredentialGroupEnrollmentOAuthRateLimit,
  enforcePublicCredentialGroupIpRateLimit,
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
    const limited = await enforcePublicCredentialGroupIpRateLimit(request, 'oauth-start')
    if (limited) return limited

    const parsed = await parseRequest(startCredentialGroupOAuthContract, request, context)
    if (!parsed.success) return parsed.response
    const { token, optionId } = parsed.data.params
    const enrollment = await getCredentialGroupOAuthContext(token, optionId)
    if (!enrollment) {
      return NextResponse.json(
        { error: 'Not found' },
        { status: 404, headers: { 'Cache-Control': 'no-store' } }
      )
    }

    const enrollmentLimited = await enforceCredentialGroupEnrollmentOAuthRateLimit(
      enrollment.enrollmentId
    )
    if (enrollmentLimited) return enrollmentLimited

    try {
      const authorizationUrl = await startCredentialGroupOAuth(enrollment, token)
      const response = NextResponse.redirect(authorizationUrl)
      response.headers.set('Cache-Control', 'no-store')
      response.headers.set('Referrer-Policy', 'no-referrer')
      return response
    } catch (error) {
      logger.error('Failed to start managed OAuth authorization', {
        error: getErrorMessage(error),
      })
      return createCredentialGroupEnrollmentRedirect(token, {
        oauth:
          error instanceof CredentialGroupOAuthError && error.statusCode === 409
            ? 'configuration_changed'
            : 'unavailable',
      })
    }
  }
)
