import { createLogger } from '@sim/logger'
import { generateShortId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { authorizeTrelloContract } from '@/lib/api/contracts/oauth-connections'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { env } from '@/lib/core/config/env'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getCanonicalScopesForProvider } from '@/lib/oauth/utils'

const logger = createLogger('TrelloAuthorize')

export const dynamic = 'force-dynamic'

const TRELLO_STATE_COOKIE = 'trello_oauth_state'
const TRELLO_STATE_COOKIE_PATH = '/api/auth/trello'
const TRELLO_STATE_COOKIE_MAX_AGE_SECONDS = 60 * 10

export const GET = withRouteHandler(async (request: NextRequest) => {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(authorizeTrelloContract, request, {})
    if (!parsed.success) return parsed.response

    const apiKey = env.TRELLO_API_KEY

    if (!apiKey) {
      logger.error('TRELLO_API_KEY not configured')
      return NextResponse.json({ error: 'Trello API key not configured' }, { status: 500 })
    }

    const baseUrl = getBaseUrl()
    const state = generateShortId(32)
    const returnUrl = new URL('/api/auth/trello/callback', baseUrl)
    returnUrl.searchParams.set('state', state)
    const scope = getCanonicalScopesForProvider('trello').join(',')

    const authUrl = new URL('https://trello.com/1/authorize')
    authUrl.searchParams.set('key', apiKey)
    authUrl.searchParams.set('name', 'Sim Studio')
    authUrl.searchParams.set('expiration', 'never')
    authUrl.searchParams.set('callback_method', 'fragment')
    authUrl.searchParams.set('response_type', 'token')
    authUrl.searchParams.set('scope', scope)
    authUrl.searchParams.set('return_url', returnUrl.toString())

    const response = NextResponse.redirect(authUrl.toString())
    response.cookies.set(TRELLO_STATE_COOKIE, state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: TRELLO_STATE_COOKIE_MAX_AGE_SECONDS,
      path: TRELLO_STATE_COOKIE_PATH,
    })
    return response
  } catch (error) {
    logger.error('Error initiating Trello authorization:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
