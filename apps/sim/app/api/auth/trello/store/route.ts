import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { storeTrelloTokenContract } from '@/lib/api/contracts/oauth-connections'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { env } from '@/lib/core/config/env'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { processCredentialDraft } from '@/lib/credentials/draft-processor'
import { upsertProviderAccountTokens } from '@/lib/oauth/credential-service'
import { getCanonicalScopesForProvider } from '@/lib/oauth/utils'

const logger = createLogger('TrelloStore')

export const dynamic = 'force-dynamic'

const TRELLO_STATE_COOKIE = 'trello_oauth_state'
const TRELLO_RETURN_URL_COOKIE = 'trello_return_url'
const TRELLO_CREDENTIAL_DRAFT_COOKIE = 'trello_credential_draft_id'
const TRELLO_STATE_COOKIE_PATH = '/api/auth/trello'

function clearStateCookie(response: NextResponse) {
  response.cookies.delete({ name: TRELLO_STATE_COOKIE, path: TRELLO_STATE_COOKIE_PATH })
  response.cookies.delete({ name: TRELLO_RETURN_URL_COOKIE, path: TRELLO_STATE_COOKIE_PATH })
  response.cookies.delete({ name: TRELLO_CREDENTIAL_DRAFT_COOKIE, path: TRELLO_STATE_COOKIE_PATH })
  return response
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn('Unauthorized attempt to store Trello token')
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(storeTrelloTokenContract, request, {})
    if (!parsed.success) return parsed.response
    const { token, state } = parsed.data.body
    const draftId = request.cookies.get(TRELLO_CREDENTIAL_DRAFT_COOKIE)?.value

    const cookieState = request.cookies.get(TRELLO_STATE_COOKIE)?.value
    if (!cookieState || cookieState !== state) {
      logger.warn('Trello store rejected: state mismatch', {
        hasCookieState: Boolean(cookieState),
        userId: session.user.id,
      })
      return clearStateCookie(
        NextResponse.json(
          { success: false, error: 'Invalid or expired authorization state' },
          { status: 400 }
        )
      )
    }

    const apiKey = env.TRELLO_API_KEY
    if (!apiKey) {
      logger.error('TRELLO_API_KEY not configured')
      return NextResponse.json({ success: false, error: 'Trello not configured' }, { status: 500 })
    }

    const scope = getCanonicalScopesForProvider('trello').join(',')

    const validationUrl = `https://api.trello.com/1/members/me?key=${apiKey}&token=${token}&fields=id,username,fullName`
    const userResponse = await fetch(validationUrl, {
      headers: { Accept: 'application/json' },
    })

    if (!userResponse.ok) {
      const errorText = await userResponse.text()
      logger.error('Invalid Trello token', {
        status: userResponse.status,
        error: errorText,
      })
      return NextResponse.json(
        { success: false, error: `Invalid Trello token: ${errorText}` },
        { status: 400 }
      )
    }

    const trelloUser = (await userResponse.json().catch(() => null)) as { id?: string } | null

    if (typeof trelloUser?.id !== 'string' || trelloUser.id.trim().length === 0) {
      logger.error('Trello validation response did not include a valid member id', {
        response: trelloUser,
      })
      return NextResponse.json(
        { success: false, error: 'Invalid Trello member response' },
        { status: 502 }
      )
    }

    const { accountId } = await upsertProviderAccountTokens({
      userId: session.user.id,
      providerId: 'trello',
      externalAccountId: trelloUser.id,
      scope,
      /** Trello tokens do not expire and there is no refresh token. */
      tokens: { accessToken: token },
    })

    await processCredentialDraft({
      draftId,
      userId: session.user.id,
      providerId: 'trello',
      accountId,
    })

    return clearStateCookie(NextResponse.json({ success: true }))
  } catch (error) {
    logger.error('Error storing Trello token:', error)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
})
