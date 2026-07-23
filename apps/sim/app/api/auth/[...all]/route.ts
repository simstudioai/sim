import { withSSOProviderMutationLock } from '@sim/db'
import { toNextJsHandler } from 'better-auth/next-js'
import { type NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { createAnonymousSession, ensureAnonymousUserExists } from '@/lib/auth/anonymous'
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

function isSSOCallbackPath(path: string): boolean {
  return path.startsWith('sso/callback/') || path.startsWith('sso/saml2/callback/')
}

export const GET = withRouteHandler(async (request: NextRequest) => {
  const path = getAuthPath(request)

  if (path === 'get-session' && isAuthDisabled) {
    await ensureAnonymousUserExists()
    return NextResponse.json(createAnonymousSession())
  }

  return isSSOCallbackPath(path)
    ? withSSOProviderMutationLock(() => betterAuthGET(request))
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

  return isSSOCallbackPath(path)
    ? withSSOProviderMutationLock(() => betterAuthPOST(request))
    : betterAuthPOST(request)
})
