import { db } from '@sim/db'
import { account } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { instagramCallbackContract } from '@/lib/api/contracts/oauth-connections'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { env } from '@/lib/core/config/env'
import {
  DEFAULT_MAX_ERROR_BODY_BYTES,
  readResponseJsonWithLimit,
  readResponseTextWithLimit,
} from '@/lib/core/utils/stream-limits'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { isSameOrigin } from '@/lib/core/utils/validation'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { processCredentialDraft } from '@/lib/credentials/draft-processor'
import { INSTAGRAM_GRAPH_BASE } from '@/lib/integrations/instagram/constants'
import {
  parseInstagramLongLivedToken,
  parseInstagramProfile,
  parseInstagramShortLivedToken,
} from '@/lib/oauth/instagram'
import { getCanonicalScopesForProvider } from '@/lib/oauth/utils'
import { safeAccountInsert } from '@/app/api/auth/oauth/utils'

const logger = createLogger('InstagramCallback')

export const dynamic = 'force-dynamic'

const INSTAGRAM_STATE_COOKIE = 'instagram_oauth_state'
const INSTAGRAM_RETURN_URL_COOKIE = 'instagram_return_url'
const INSTAGRAM_STATE_COOKIE_PATH = '/api/auth'

function clearOAuthCookies(response: NextResponse) {
  response.cookies.delete({ name: INSTAGRAM_STATE_COOKIE, path: INSTAGRAM_STATE_COOKIE_PATH })
  response.cookies.delete({ name: INSTAGRAM_RETURN_URL_COOKIE, path: INSTAGRAM_STATE_COOKIE_PATH })
  return response
}

export const GET = withRouteHandler(async (request: NextRequest) => {
  const baseUrl = getBaseUrl()

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return clearOAuthCookies(NextResponse.redirect(`${baseUrl}/workspace?error=unauthorized`))
    }

    const parsed = await parseRequest(instagramCallbackContract, request, {})
    if (!parsed.success) return parsed.response

    const { code, state, error, error_reason, error_description } = parsed.data.query

    if (error) {
      logger.warn('Instagram OAuth denied by user', {
        error,
        error_reason,
        error_description,
      })
      return clearOAuthCookies(
        NextResponse.redirect(`${baseUrl}/workspace?error=instagram_access_denied`)
      )
    }

    const cookieState = request.cookies.get(INSTAGRAM_STATE_COOKIE)?.value
    if (!state || !cookieState || state !== cookieState) {
      logger.warn('Instagram callback rejected: state mismatch', {
        hasQueryState: Boolean(state),
        hasCookieState: Boolean(cookieState),
      })
      return clearOAuthCookies(
        NextResponse.redirect(`${baseUrl}/workspace?error=instagram_state_mismatch`)
      )
    }

    const clientId = env.INSTAGRAM_CLIENT_ID
    const clientSecret = env.INSTAGRAM_CLIENT_SECRET
    if (!clientId || !clientSecret) {
      logger.error('Instagram credentials not configured')
      return clearOAuthCookies(
        NextResponse.redirect(`${baseUrl}/workspace?error=instagram_config_error`)
      )
    }

    if (!code) {
      logger.error('No authorization code received from Instagram')
      return clearOAuthCookies(
        NextResponse.redirect(`${baseUrl}/workspace?error=instagram_no_code`)
      )
    }

    const authorizationCode = code.replace(/#_$/, '')
    const redirectUri = `${baseUrl}/api/auth/oauth2/callback/instagram`

    const tokenForm = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code: authorizationCode,
    })

    const shortLivedResponse = await fetch('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenForm.toString(),
      signal: request.signal,
    })

    if (!shortLivedResponse.ok) {
      const errorText = await readResponseTextWithLimit(shortLivedResponse, {
        maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
        label: 'Instagram OAuth token error response',
        signal: request.signal,
      }).catch(() => shortLivedResponse.statusText)
      logger.error('Failed to exchange Instagram authorization code', {
        status: shortLivedResponse.status,
        error: errorText,
      })
      return clearOAuthCookies(
        NextResponse.redirect(`${baseUrl}/workspace?error=instagram_token_error`)
      )
    }

    const shortLivedBody = await readResponseJsonWithLimit<unknown>(shortLivedResponse, {
      maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
      label: 'Instagram OAuth token response',
      signal: request.signal,
    })
    const shortLived = parseInstagramShortLivedToken(shortLivedBody)
    if (!shortLived) {
      logger.error('Instagram short-lived token response was invalid')
      return clearOAuthCookies(
        NextResponse.redirect(`${baseUrl}/workspace?error=instagram_no_token`)
      )
    }

    const exchangeUrl = new URL('https://graph.instagram.com/access_token')
    exchangeUrl.searchParams.set('grant_type', 'ig_exchange_token')
    exchangeUrl.searchParams.set('client_secret', clientSecret)
    exchangeUrl.searchParams.set('access_token', shortLived.access_token)

    const longLivedResponse = await fetch(exchangeUrl.toString(), {
      method: 'GET',
      signal: request.signal,
    })
    if (!longLivedResponse.ok) {
      const errorText = await readResponseTextWithLimit(longLivedResponse, {
        maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
        label: 'Instagram OAuth exchange error response',
        signal: request.signal,
      }).catch(() => longLivedResponse.statusText)
      logger.error('Failed to exchange Instagram short-lived token', {
        status: longLivedResponse.status,
        error: errorText,
      })
      return clearOAuthCookies(
        NextResponse.redirect(`${baseUrl}/workspace?error=instagram_exchange_error`)
      )
    }

    const longLivedBody = await readResponseJsonWithLimit<unknown>(longLivedResponse, {
      maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
      label: 'Instagram OAuth exchange response',
      signal: request.signal,
    })
    const longLived = parseInstagramLongLivedToken(longLivedBody)

    if (!longLived) {
      logger.error('Instagram long-lived token response was invalid')
      return clearOAuthCookies(
        NextResponse.redirect(`${baseUrl}/workspace?error=instagram_no_long_lived`)
      )
    }

    const longLivedToken = longLived.access_token
    const expiresIn = longLived.expires_in

    const profileUrl = new URL(`${INSTAGRAM_GRAPH_BASE}/me`)
    profileUrl.searchParams.set('fields', 'user_id,username,name,account_type,profile_picture_url')
    const profileResponse = await fetch(profileUrl, {
      headers: { Authorization: `Bearer ${longLivedToken}` },
      signal: request.signal,
    })

    if (!profileResponse.ok) {
      const errorText = await readResponseTextWithLimit(profileResponse, {
        maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
        label: 'Instagram OAuth profile error response',
        signal: request.signal,
      }).catch(() => profileResponse.statusText)
      logger.error('Failed to fetch Instagram profile after OAuth', {
        status: profileResponse.status,
        error: errorText,
      })
      return clearOAuthCookies(
        NextResponse.redirect(`${baseUrl}/workspace?error=instagram_profile_error`)
      )
    }

    const profileBody = await readResponseJsonWithLimit<unknown>(profileResponse, {
      maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
      label: 'Instagram OAuth profile response',
      signal: request.signal,
    })
    const profile = parseInstagramProfile(profileBody)
    if (!profile) {
      logger.error('Instagram profile response was invalid')
      return clearOAuthCookies(
        NextResponse.redirect(`${baseUrl}/workspace?error=instagram_profile_error`)
      )
    }

    const igUserId =
      profile.user_id != null && profile.user_id !== '' ? String(profile.user_id) : null

    if (!igUserId) {
      logger.error('Instagram profile response missing user_id', { profile })
      return clearOAuthCookies(
        NextResponse.redirect(`${baseUrl}/workspace?error=instagram_no_user_id`)
      )
    }

    let grantedPermissions: string[] = []
    if (Array.isArray(shortLived.permissions)) {
      grantedPermissions = shortLived.permissions.filter(
        (s): s is string => typeof s === 'string' && s.length > 0
      )
    } else if (typeof shortLived.permissions === 'string' && shortLived.permissions.length > 0) {
      grantedPermissions = shortLived.permissions
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    }
    const permissions =
      grantedPermissions.length > 0
        ? grantedPermissions
        : getCanonicalScopesForProvider('instagram')
    const scope = permissions.join(' ')

    const now = new Date()
    const accessTokenExpiresAt = new Date(now.getTime() + expiresIn * 1000)

    const existing = await db.query.account.findFirst({
      where: and(
        eq(account.userId, session.user.id),
        eq(account.providerId, 'instagram'),
        eq(account.accountId, igUserId)
      ),
    })

    if (existing) {
      await db
        .update(account)
        .set({
          accessToken: longLivedToken,
          refreshToken: longLivedToken,
          accessTokenExpiresAt,
          scope,
          updatedAt: now,
        })
        .where(eq(account.id, existing.id))
      logger.info('Updated existing Instagram account', {
        accountId: existing.id,
        igUserId,
        username: profile.username,
      })
    } else {
      await safeAccountInsert(
        {
          id: generateId(),
          userId: session.user.id,
          providerId: 'instagram',
          accountId: igUserId,
          accessToken: longLivedToken,
          refreshToken: longLivedToken,
          accessTokenExpiresAt,
          scope,
          createdAt: now,
          updatedAt: now,
        },
        { provider: 'Instagram', identifier: profile.username || igUserId }
      )
      logger.info('Created Instagram account', { igUserId, username: profile.username })
    }

    const persisted =
      existing ??
      (await db.query.account.findFirst({
        where: and(
          eq(account.userId, session.user.id),
          eq(account.providerId, 'instagram'),
          eq(account.accountId, igUserId)
        ),
      }))

    if (persisted) {
      try {
        await processCredentialDraft({
          userId: session.user.id,
          providerId: 'instagram',
          accountId: persisted.id,
        })
      } catch (draftError) {
        logger.error('Failed to process credential draft for Instagram', { error: draftError })
      }
    }

    const returnUrlCookie = request.cookies.get(INSTAGRAM_RETURN_URL_COOKIE)?.value
    const redirectUrl =
      returnUrlCookie && isSameOrigin(returnUrlCookie) ? returnUrlCookie : `${baseUrl}/workspace`
    const finalUrl = new URL(redirectUrl)
    finalUrl.searchParams.set('instagram_connected', 'true')

    return clearOAuthCookies(NextResponse.redirect(finalUrl.toString()))
  } catch (error) {
    logger.error('Error in Instagram OAuth callback', { error })
    return clearOAuthCookies(
      NextResponse.redirect(`${baseUrl}/workspace?error=instagram_callback_error`)
    )
  }
})
