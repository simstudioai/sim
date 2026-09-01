import { createLogger } from '@sim/logger'
import { generateShortId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { authorizeInstagramContract } from '@/lib/api/contracts/oauth-connections'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { requireConfiguredOAuthClient } from '@/lib/core/config/env-capabilities.server'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { isSameOrigin } from '@/lib/core/utils/validation'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createCredentialConnection } from '@/lib/credentials/application/create-credential-connection'
import { CREDENTIAL_DRAFT_TTL_SECONDS } from '@/lib/credentials/draft-constants'
import { getCanonicalScopesForProvider } from '@/lib/oauth/utils'

const logger = createLogger('InstagramAuthorize')

export const dynamic = 'force-dynamic'

const INSTAGRAM_STATE_COOKIE = 'instagram_oauth_state'
const INSTAGRAM_RETURN_URL_COOKIE = 'instagram_return_url'
const INSTAGRAM_CREDENTIAL_DRAFT_COOKIE = 'instagram_credential_draft_id'
const INSTAGRAM_STATE_COOKIE_PATH = '/api/auth'

export const GET = withRouteHandler(async (request: NextRequest) => {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const sessionId = session.session?.id
    if (!sessionId) throw new Error('Authenticated session is missing its session ID')

    const {
      values: { INSTAGRAM_CLIENT_ID: clientId },
    } = requireConfiguredOAuthClient('instagram')

    const parsed = await parseRequest(authorizeInstagramContract, request, {})
    if (!parsed.success) return parsed.response
    const { returnUrl, workspaceId, draftId } = parsed.data.query
    let credentialDraftId = draftId

    if (workspaceId && !draftId) {
      try {
        const connection = await createCredentialConnection.execute({
          principal: { kind: 'session', userId: session.user.id, sessionId },
          input: { workspaceId, providerId: 'instagram' },
          request,
        })
        credentialDraftId = connection.draftId
      } catch (error) {
        const classified = asOrchestrationError(error)
        if (classified?.code === 'conflict') {
          logger.warn('Rejected conflicting Instagram OAuth connection intent', {
            userId: session.user.id,
            workspaceId,
          })
          return NextResponse.json({ error: classified.message }, { status: 409 })
        }
        if (classified?.code === 'forbidden' || classified?.code === 'not_found') {
          return NextResponse.json({ error: 'Workspace write access denied' }, { status: 403 })
        }
        throw error
      }
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
      maxAge: CREDENTIAL_DRAFT_TTL_SECONDS,
      path: INSTAGRAM_STATE_COOKIE_PATH,
    })
    if (credentialDraftId) {
      response.cookies.set(INSTAGRAM_CREDENTIAL_DRAFT_COOKIE, credentialDraftId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: CREDENTIAL_DRAFT_TTL_SECONDS,
        path: INSTAGRAM_STATE_COOKIE_PATH,
      })
    } else {
      response.cookies.delete({
        name: INSTAGRAM_CREDENTIAL_DRAFT_COOKIE,
        path: INSTAGRAM_STATE_COOKIE_PATH,
      })
    }

    if (returnUrl && isSameOrigin(returnUrl)) {
      response.cookies.set(INSTAGRAM_RETURN_URL_COOKIE, returnUrl, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: CREDENTIAL_DRAFT_TTL_SECONDS,
        path: INSTAGRAM_STATE_COOKIE_PATH,
      })
    }

    return response
  } catch (error) {
    logger.error('Error starting Instagram OAuth', { error })
    return NextResponse.json({ error: 'Failed to start Instagram OAuth' }, { status: 500 })
  }
})
