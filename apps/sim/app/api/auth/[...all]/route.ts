import { toNextJsHandler } from 'better-auth/next-js'
import { type NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { createAnonymousSession, ensureAnonymousUserExists } from '@/lib/auth/anonymous'
import { withSSOCallbackIntent } from '@/lib/auth/sso/callback-intent'
import { isAuthDisabled } from '@/lib/core/config/env-flags'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const dynamic = 'force-dynamic'

const { GET: betterAuthGET, POST: betterAuthPOST } = toNextJsHandler(auth.handler)
const SAFE_ORGANIZATION_POST_PATHS = new Set(['organization/check-slug', 'organization/set-active'])
const BLOCKED_SSO_MUTATION_PATHS = new Set([
  'sso/register',
  'sso/update-provider',
  'sso/delete-provider',
  'sso/request-domain-verification',
  'sso/verify-domain',
])

function getAuthPath(request: NextRequest): string {
  const pathname = request.nextUrl?.pathname ?? new URL(request.url).pathname
  return pathname.replace('/api/auth/', '')
}

function isBlockedOrganizationMutationPath(path: string): boolean {
  return path.startsWith('organization/') && !SAFE_ORGANIZATION_POST_PATHS.has(path)
}

function getSSOCallbackProviderId(path: string): string | null {
  const prefix = path.startsWith('sso/callback/')
    ? 'sso/callback/'
    : path.startsWith('sso/saml2/callback/')
      ? 'sso/saml2/callback/'
      : null
  if (!prefix) return null

  const encodedProviderId = path.slice(prefix.length).split('/')[0]
  if (!encodedProviderId) return null
  try {
    return decodeURIComponent(encodedProviderId)
  } catch {
    return null
  }
}

export const GET = withRouteHandler(async (request: NextRequest) => {
  const path = getAuthPath(request)

  if (path === 'get-session' && isAuthDisabled) {
    await ensureAnonymousUserExists()
    return NextResponse.json(createAnonymousSession())
  }

  const callbackProviderId = getSSOCallbackProviderId(path)
  return callbackProviderId
    ? withSSOCallbackIntent(callbackProviderId, () => betterAuthGET(request))
    : betterAuthGET(request)
})

export const POST = withRouteHandler(async (request: NextRequest) => {
  const path = getAuthPath(request)

  if (isBlockedOrganizationMutationPath(path)) {
    return NextResponse.json(
      { error: 'Organization mutations are handled by application API routes.' },
      { status: 404 }
    )
  }

  if (BLOCKED_SSO_MUTATION_PATHS.has(path)) {
    return NextResponse.json(
      { error: 'SSO mutations are handled by application API routes.' },
      { status: 404 }
    )
  }

  const callbackProviderId = getSSOCallbackProviderId(path)
  return callbackProviderId
    ? withSSOCallbackIntent(callbackProviderId, () => betterAuthPOST(request))
    : betterAuthPOST(request)
})
