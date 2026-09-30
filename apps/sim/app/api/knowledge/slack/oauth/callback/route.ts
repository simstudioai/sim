import { createLogger } from '@sim/logger'
import { describeError } from '@sim/utils/errors'
import { NextResponse } from 'next/server'
import { slackSearchOAuthCallbackContract } from '@/lib/api/contracts/knowledge/slack'
import { parseRequest } from '@/lib/api/server'
import {
  InternalUnauthenticatedError,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { enforceIpRateLimit } from '@/lib/core/rate-limiter'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { completeSlackSearchSetup } from '@/lib/knowledge/application/slack-search/setup'
import { slackSearchInstallPath } from '@/lib/slack-search/install-link'
import { authenticateSlackPublicInstallation } from '@/lib/slack-search/public-install-auth'

const logger = createLogger('SlackSearchOAuthCallback')

/** OAuth is a redirect protocol; protected configuration remains in the application use case. */
export const GET = withRouteHandler(async (request) => {
  let callbackState: string | undefined
  try {
    const limited = await enforceIpRateLimit('slack-search-oauth-callback', request)
    if (limited) return limited
    const parsed = await parseRequest(
      slackSearchOAuthCallbackContract,
      request,
      {},
      {
        rejectDuplicateQueryValues: true,
      }
    )
    if (!parsed.success) return parsed.response
    const { state, code, error } = parsed.data.query
    callbackState = state
    if (!state) {
      if (error || !code)
        throw new OrchestrationError(
          'validation',
          'Slack installation was not authorized. Install the app again.'
        )
      const { teamId } = await authenticateSlackPublicInstallation(code)
      return NextResponse.redirect(new URL(slackSearchInstallPath(teamId), getBaseUrl()), {
        status: 303,
        headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
      })
    }
    const principal = await internalSessionAuth.authenticate()
    const rateResponse = await internalRateLimits
      .user({ bucketName: 'slack-search-settings' })
      .enforce(request, principal)
    if (rateResponse) return rateResponse
    const result = await completeSlackSearchSetup.execute({
      principal,
      input: { state, code, error },
      request,
    })
    const url = new URL('/credential-groups/slack-complete', getBaseUrl())
    url.searchParams.set('state', state)
    url.searchParams.set('ok', 'true')
    url.searchParams.set('organizationId', result.organizationId)
    return NextResponse.redirect(url, {
      status: 303,
      headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
    })
  } catch (error) {
    if (callbackState) {
      const projected = internalOrchestrationErrorPolicy.project(error)
      if (
        !(error instanceof InternalUnauthenticatedError) &&
        (!projected || projected.status >= 500)
      )
        logger.error('Slack authorization callback failed', { error: describeError(error) })
      const url = new URL('/credential-groups/slack-complete', getBaseUrl())
      url.searchParams.set('state', callbackState)
      url.searchParams.set('ok', 'false')
      if (error instanceof InternalUnauthenticatedError)
        url.searchParams.set('reason', 'signin_required')
      return NextResponse.redirect(url, {
        status: 303,
        headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
      })
    }
    if (error instanceof InternalUnauthenticatedError)
      return NextResponse.json(
        { error: 'Sign in to Sim and restart Slack setup.' },
        { status: 401 }
      )
    const projected = internalOrchestrationErrorPolicy.project(error)
    if (projected) return NextResponse.json(projected.body, { status: projected.status })
    throw error
  }
})

/** Link previews must not consume a single-use OAuth code. */
export const HEAD = withRouteHandler(async () => new NextResponse(null, { status: 405 }))
