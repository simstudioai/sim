import type { SessionPrincipal } from '@sim/auth/principal'
import { NextResponse } from 'next/server'
import { continueGitHubSearchSetupContract } from '@/lib/api/contracts/knowledge/github-setup'
import { parseRequest } from '@/lib/api/server'
import {
  InternalUnauthenticatedError,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { continueGitHubSearchSetup } from '@/lib/knowledge/application/github-setup'
import { createCredentialGroupCompletionRedirect } from '@/app/api/credential-groups/enrollment-redirect'

/** OAuth completion resumes the existing setup attempt through current session authorization. */
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
  const parsed = await parseRequest(continueGitHubSearchSetupContract, request, {})
  if (!parsed.success) return parsed.response
  try {
    const result = await continueGitHubSearchSetup.execute({
      principal,
      input: parsed.data.query,
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
    return createCredentialGroupCompletionRedirect('unavailable', parsed.data.query.setupId)
  }
})
