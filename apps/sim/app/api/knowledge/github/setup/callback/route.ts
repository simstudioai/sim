import type { SessionPrincipal } from '@sim/auth/principal'
import { NextResponse } from 'next/server'
import { completeGitHubSearchSetupContract } from '@/lib/api/contracts/knowledge/github-setup'
import { parseRequest } from '@/lib/api/server'
import {
  InternalUnauthenticatedError,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { completeGitHubSearchSetup } from '@/lib/knowledge/application/github-setup'
import { createCredentialGroupCompletionRedirect } from '@/app/api/credential-groups/enrollment-redirect'

/** GitHub's Setup URL carries untrusted installation IDs; the use case verifies ownership. */
export const GET = withRouteHandler(async (request) => {
  let principal: SessionPrincipal
  try {
    principal = await internalSessionAuth.authenticate()
  } catch (error) {
    if (error instanceof InternalUnauthenticatedError)
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: { 'Cache-Control': 'no-store' } }
      )
    throw error
  }
  const limited = await internalRateLimits
    .user({ bucketName: 'github-search-setup' })
    .enforce(request, principal)
  if (limited) return limited
  const parsed = await parseRequest(completeGitHubSearchSetupContract, request, {})
  if (!parsed.success) return parsed.response
  try {
    const { state, installation_id, setup_action } = parsed.data.query
    const result = await completeGitHubSearchSetup.execute({
      principal,
      input: { state, installationId: installation_id, setupAction: setup_action },
      request,
    })
    return new NextResponse(null, {
      status: 303,
      headers: {
        Location: result.url,
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      },
    })
  } catch {
    return createCredentialGroupCompletionRedirect('unavailable')
  }
})
