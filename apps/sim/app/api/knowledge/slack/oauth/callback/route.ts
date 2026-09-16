import { NextResponse } from 'next/server'
import { slackSearchOAuthCallbackContract } from '@/lib/api/contracts/knowledge/slack'
import { parseRequest } from '@/lib/api/server'
import {
  InternalUnauthenticatedError,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { completeSlackSearchSetup } from '@/lib/knowledge/application/slack-search/setup'
import { organizationRoutes } from '@/lib/navigation/paths'

/** OAuth is a redirect protocol; protected configuration remains in the application use case. */
export const GET = withRouteHandler(async (request) => {
  try {
    const principal = await internalSessionAuth.authenticate()
    const rateResponse = await internalRateLimits
      .user({ bucketName: 'slack-search-settings' })
      .enforce(request, principal)
    if (rateResponse) return rateResponse
    const parsed = await parseRequest(slackSearchOAuthCallbackContract, request, {})
    if (!parsed.success) return parsed.response
    const result = await completeSlackSearchSetup.execute({
      principal,
      input: parsed.data.query,
      request,
    })
    const url = new URL(
      organizationRoutes(result.organizationId).settingsSection('search-slack'),
      getBaseUrl()
    )
    url.searchParams.set('slackSetup', 'complete')
    return NextResponse.redirect(url, 303)
  } catch (error) {
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
