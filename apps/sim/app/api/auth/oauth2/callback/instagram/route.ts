import { db } from '@sim/db'
import { account } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { instagramCallbackContract } from '@/lib/api/contracts/oauth-connections'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { env } from '@/lib/core/config/env'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { isSameOrigin } from '@/lib/core/utils/validation'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { processCredentialDraft } from '@/lib/credentials/draft-processor'
import { INSTAGRAM_GRAPH_BASE } from '@/lib/integrations/instagram'
import { getCanonicalScopesForProvider } from '@/lib/oauth/utils'
import { safeAccountInsert } from '@/app/api/auth/oauth/utils'

const logger = createLogger('InstagramCallback')

export const dynamic = 'force-dynamic'

const INSTAGRAM_STATE_COOKIE = 'instagram_oauth_state'
const INSTAGRAM_RETURN_URL_COOKIE = 'instagram_return_url'
const INSTAGRAM_STATE_COOKIE_PATH = '/api/auth'
interface ShortLivedTokenPayload {
  access_token?: string
  user_id?: string | number
  // Meta returns granted permissions as a comma-separated string or an array
  // depending on the response shape.
  permissions?: string | string[]
}

function unwrapShortLivedToken(body: unknown): ShortLivedTokenPayload | null {
  if (!body || typeof body !== 'object') return null

  const record = body as Record<string, unknown>

  // Nested shape from Instagram Login: { data: [{ access_token, user_id, permissions }] }
  if (Array.isArray(record.data) && record.data.length > 0) {
    const first = record.data[0]
    if (first && typeof first === 'object') {
      return first as ShortLivedTokenPayload
    }
  }

  // Flat shape fallback
  if (typeof record.access_token === 'string') {
    return record as ShortLivedTokenPayload
  }

  return null
}

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

    // Instagram appends `#_` to the redirect; strip it from the code if present.
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
    })

    if (!shortLivedResponse.ok) {
      const errorText = await shortLivedResponse.text()
      logger.error('Failed to exchange Instagram authorization code', {
        status: shortLivedResponse.status,
        body: errorText,
      })
      return clearOAuthCookies(
        NextResponse.redirect(`${baseUrl}/workspace?error=instagram_token_error`)
      )
    }

    const shortLivedBody = await shortLivedResponse.json()
    const shortLived = unwrapShortLivedToken(shortLivedBody)
    if (!shortLived?.access_token) {
      logger.error('Instagram short-lived token response missing access_token', {
        body: shortLivedBody,
      })
      return clearOAuthCookies(
        NextResponse.redirect(`${baseUrl}/workspace?error=instagram_no_token`)
      )
    }

    const exchangeUrl = new URL('https://graph.instagram.com/access_token')
    exchangeUrl.searchParams.set('grant_type', 'ig_exchange_token')
    exchangeUrl.searchParams.set('client_secret', clientSecret)
    exchangeUrl.searchParams.set('access_token', shortLived.access_token)

    const longLivedResponse = await fetch(exchangeUrl.toString(), { method: 'GET' })
    if (!longLivedResponse.ok) {
      const errorText = await longLivedResponse.text()
      logger.error('Failed to exchange Instagram short-lived token', {
        status: longLivedResponse.status,
        body: errorText,
      })
      return clearOAuthCookies(
        NextResponse.redirect(`${baseUrl}/workspace?error=instagram_exchange_error`)
      )
    }

    const longLivedBody = (await longLivedResponse.json()) as {
      access_token?: string
      token_type?: string
      expires_in?: number
    }

    if (!longLivedBody.access_token) {
      logger.error('Instagram long-lived token response missing access_token', {
        body: longLivedBody,
      })
      return clearOAuthCookies(
        NextResponse.redirect(`${baseUrl}/workspace?error=instagram_no_long_lived`)
      )
    }

    const longLivedToken = longLivedBody.access_token
    const expiresIn = longLivedBody.expires_in ?? 5184000

    const profileResponse = await fetch(
      `${INSTAGRAM_GRAPH_BASE}/me?fields=user_id,username,name,account_type,profile_picture_url&access_token=${encodeURIComponent(longLivedToken)}`
    )

    if (!profileResponse.ok) {
      const errorText = await profileResponse.text()
      logger.error('Failed to fetch Instagram profile after OAuth', {
        status: profileResponse.status,
        body: errorText,
      })
      return clearOAuthCookies(
        NextResponse.redirect(`${baseUrl}/workspace?error=instagram_profile_error`)
      )
    }

    const profile = (await profileResponse.json()) as {
      user_id?: string
      id?: string
      username?: string
      name?: string
    }

    // account.accountId must always be the Instagram professional account ID
    // (/me user_id). The token exchange's user_id and /me's id are app-scoped
    // IDs — a different ID space — so falling back to them would break
    // reconnect dedupe by storing the same account under two identifiers.
    const igUserId = typeof profile.user_id === 'string' && profile.user_id ? profile.user_id : null

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
    // Space-joined: the standard OAuth format both credential routes parse
    // (`/api/auth/oauth/connections` splits on whitespace only).
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
          id: `instagram_${session.user.id}_${Date.now()}`,
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
