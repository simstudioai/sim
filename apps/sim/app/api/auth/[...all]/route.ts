import { toNextJsHandler } from 'better-auth/next-js'
import { type NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { createAnonymousSession, ensureAnonymousUserExists } from '@/lib/auth/anonymous'
import { isAuthDisabled } from '@/lib/core/config/env-flags'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { normalizeQuickBooksRealmId, withQuickBooksCallbackRealm } from '@/lib/oauth/quickbooks'

export const dynamic = 'force-dynamic'

const { GET: betterAuthGET, POST: betterAuthPOST } = toNextJsHandler(auth.handler)
const SAFE_ORGANIZATION_POST_PATHS = new Set(['organization/check-slug', 'organization/set-active'])

function getAuthPath(request: NextRequest): string {
  const pathname = request.nextUrl?.pathname ?? new URL(request.url).pathname
  return pathname.replace('/api/auth/', '')
}

function isBlockedOrganizationMutationPath(path: string): boolean {
  return path.startsWith('organization/') && !SAFE_ORGANIZATION_POST_PATHS.has(path)
}

export const GET = withRouteHandler(async (request: NextRequest) => {
  const path = getAuthPath(request)

  if (path === 'get-session' && isAuthDisabled) {
    await ensureAnonymousUserExists()
    return NextResponse.json(createAnonymousSession())
  }

  if (path === 'oauth2/callback/quickbooks') {
    const authorizationCode = request.nextUrl.searchParams.get('code')
    if (!authorizationCode) {
      return betterAuthGET(request)
    }

    const realmId = request.nextUrl.searchParams.get('realmId')
    if (!realmId) {
      return NextResponse.json(
        { error: 'QuickBooks callback did not include a company identity.' },
        { status: 400 }
      )
    }

    try {
      normalizeQuickBooksRealmId(realmId)
    } catch {
      return NextResponse.json(
        { error: 'QuickBooks callback included an invalid company identity.' },
        { status: 400 }
      )
    }

    return withQuickBooksCallbackRealm(realmId, () => betterAuthGET(request))
  }

  return betterAuthGET(request)
})

export const POST = withRouteHandler(async (request: NextRequest) => {
  const path = getAuthPath(request)

  if (isBlockedOrganizationMutationPath(path)) {
    return NextResponse.json(
      { error: 'Organization mutations are handled by application API routes.' },
      { status: 404 }
    )
  }

  return betterAuthPOST(request)
})
