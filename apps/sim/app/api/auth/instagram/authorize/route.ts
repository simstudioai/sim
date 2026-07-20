import { createLogger } from '@sim/logger'
import { generateShortId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { authorizeInstagramContract } from '@/lib/api/contracts/oauth-connections'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { env } from '@/lib/core/config/env'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { isSameOrigin } from '@/lib/core/utils/validation'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createConnectDraft } from '@/lib/credentials/connect-draft'
import { getCanonicalScopesForProvider } from '@/lib/oauth/utils'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('InstagramAuthorize')

export const dynamic = 'force-dynamic'

const INSTAGRAM_STATE_COOKIE = 'instagram_oauth_state'
const INSTAGRAM_RETURN_URL_COOKIE = 'instagram_return_url'
const INSTAGRAM_STATE_COOKIE_PATH = '/api/auth'
const INSTAGRAM_STATE_COOKIE_MAX_AGE_SECONDS = 60 * 10

export const GET = withRouteHandler(async (request: NextRequest) => {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const clientId = env.INSTAGRAM_CLIENT_ID
    if (!clientId) {
      logger.error('INSTAGRAM_CLIENT_ID not configured')
      return NextResponse.json({ error: 'Instagram client ID not configured' }, { status: 500 })
    }

    const parsed = await parseRequest(authorizeInstagramContract, request, {})
    if (!parsed.success) return parsed.response
    const { returnUrl, workspaceId } = parsed.data.query

    if (workspaceId) {
      const access = await checkWorkspaceAccess(workspaceId, session.user.id)
      if (!access.canWrite) {
        return NextResponse.json({ error: 'Workspace write access denied' }, { status: 403 })
      }
      await createConnectDraft({
        userId: session.user.id,
        workspaceId,
        providerId: 'instagram',
      })
    }

    const baseUrl = getBaseUrl()
    const state = generateShortId(32)
    const redirectUri = `${baseUrl}/api/auth/oauth2/callback/instagram`
    const scope = getCanonicalScopesForProvider('instagram').join(',')

    const authUrl = new URL('https://www.instagram.com/oauth/authorize')
    authUrl.searchParams.set('client_id', clientId)
    authUrl.searchParams.set('redirect_uri', redirectUri)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('scope', scope)
    authUrl.searchParams.set('state', state)

    const response = NextResponse.redirect(authUrl.toString())
    response.cookies.set(INSTAGRAM_STATE_COOKIE, state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: INSTAGRAM_STATE_COOKIE_MAX_AGE_SECONDS,
      path: INSTAGRAM_STATE_COOKIE_PATH,
    })

    if (returnUrl && isSameOrigin(returnUrl)) {
      response.cookies.set(INSTAGRAM_RETURN_URL_COOKIE, returnUrl, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: INSTAGRAM_STATE_COOKIE_MAX_AGE_SECONDS,
        path: INSTAGRAM_STATE_COOKIE_PATH,
      })
    }

    return response
  } catch (error) {
    logger.error('Error starting Instagram OAuth', { error })
    return NextResponse.json({ error: 'Failed to start Instagram OAuth' }, { status: 500 })
  }
})
