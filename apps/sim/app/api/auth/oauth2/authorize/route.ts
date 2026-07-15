import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { authorizeOAuth2Contract } from '@/lib/api/contracts/oauth-connections'
import { parseRequest } from '@/lib/api/server'
import { auth, getSession } from '@/lib/auth/auth'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createConnectDraft } from '@/lib/credentials/connect-draft'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('OAuth2Authorize')

export const dynamic = 'force-dynamic'

/**
 * Browser-initiated entrypoint for linking a generic OAuth2 account.
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const baseUrl = getBaseUrl()

  const session = await getSession()
  if (!session?.user?.id) {
    const loginUrl = new URL('/login', baseUrl)
    loginUrl.searchParams.set('callbackUrl', request.nextUrl.pathname + request.nextUrl.search)
    return NextResponse.redirect(loginUrl.toString())
  }
  const userId = session.user.id

  const parsed = await parseRequest(authorizeOAuth2Contract, request, {})
  if (!parsed.success) return parsed.response
  const { providerId, workspaceId, callbackURL: requestedCallback } = parsed.data.query

  const callbackURL = requestedCallback?.startsWith(`${baseUrl}/`)
    ? requestedCallback
    : `${baseUrl}/workspace`

  try {
    const access = await checkWorkspaceAccess(workspaceId, userId)
    if (!access.canWrite) {
      logger.warn('Workspace write access denied for OAuth2 authorize', {
        userId,
        workspaceId,
        providerId,
      })
      return NextResponse.redirect(`${baseUrl}/workspace?error=workspace_access_denied`)
    }

    // Create the draft before initiating the link so it is guaranteed to exist
    // (and freshly clocked) when the OAuth callback's `account.create.after`
    // hook runs. If this throws, we never start the OAuth flow.
    await createConnectDraft({ userId, workspaceId, providerId })

    const linkResponse = await auth.api.oAuth2LinkAccount({
      body: { providerId, callbackURL },
      headers: request.headers,
      asResponse: true,
    })

    const payload = (await linkResponse.json().catch(() => null)) as { url?: string } | null
    if (!linkResponse.ok || !payload?.url) {
      logger.error('oAuth2LinkAccount did not return an authorization URL', {
        providerId,
        status: linkResponse.status,
      })
      return NextResponse.redirect(`${baseUrl}/workspace?error=oauth_link_failed`)
    }

    const response = NextResponse.redirect(payload.url)
    // Forward the signed `state` cookie Better Auth set so it lands in the user's
    // browser and is present when the provider redirects back to the callback.
    const linkHeaders = linkResponse.headers as Headers & {
      getSetCookie?: () => string[]
    }
    for (const cookie of linkHeaders.getSetCookie?.() ?? []) {
      response.headers.append('set-cookie', cookie)
    }
    return response
  } catch (error) {
    logger.error('Failed to initiate OAuth2 authorization', { providerId, error })
    return NextResponse.redirect(`${baseUrl}/workspace?error=oauth_link_failed`)
  }
})
