import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { env } from '@/lib/core/config/env'
import { getBaseUrl } from '@/lib/core/utils/urls'

const logger = createLogger('TikTokCallback')

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const baseUrl = getBaseUrl()

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.error('No session found during TikTok callback')
      return NextResponse.redirect(`${baseUrl}/workspace?error=unauthorized`)
    }

    const searchParams = request.nextUrl.searchParams
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const error = searchParams.get('error')
    const errorDescription = searchParams.get('error_description')

    // Handle errors from TikTok
    if (error) {
      logger.error('TikTok authorization error:', { error, errorDescription })
      return NextResponse.redirect(
        `${baseUrl}/workspace?error=tiktok_auth_failed&message=${encodeURIComponent(errorDescription || error)}`
      )
    }

    if (!code) {
      logger.error('No authorization code received from TikTok')
      return NextResponse.redirect(`${baseUrl}/workspace?error=no_code`)
    }

    // Parse state to get return URL
    let returnUrl = `${baseUrl}/workspace`
    if (state) {
      try {
        const stateData = JSON.parse(Buffer.from(state, 'base64url').toString())
        returnUrl = stateData.returnUrl || returnUrl
      } catch {
        logger.warn('Failed to parse state parameter')
      }
    }

    const clientKey = env.TIKTOK_CLIENT_ID
    const clientSecret = env.TIKTOK_CLIENT_SECRET

    if (!clientKey || !clientSecret) {
      logger.error('TikTok credentials not configured')
      return NextResponse.redirect(`${baseUrl}/workspace?error=config_error`)
    }

    const redirectUri = `${baseUrl}/api/auth/tiktok/callback`

    // Exchange authorization code for access token
    // TikTok uses client_key instead of client_id
    const tokenResponse = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_key: clientKey,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }).toString(),
    })

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text()
      logger.error('Failed to exchange code for token:', {
        status: tokenResponse.status,
        error: errorText,
      })
      return NextResponse.redirect(`${baseUrl}/workspace?error=token_exchange_failed`)
    }

    const tokenData = await tokenResponse.json()

    if (tokenData.error) {
      logger.error('TikTok token error:', tokenData)
      return NextResponse.redirect(
        `${baseUrl}/workspace?error=tiktok_token_error&message=${encodeURIComponent(tokenData.error_description || tokenData.error)}`
      )
    }

    const { access_token, refresh_token, expires_in, open_id, scope } = tokenData

    if (!access_token) {
      logger.error('No access token in TikTok response:', tokenData)
      return NextResponse.redirect(`${baseUrl}/workspace?error=no_access_token`)
    }

    // Store the tokens by calling the store endpoint
    const storeResponse = await fetch(`${baseUrl}/api/auth/tiktok/store`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: request.headers.get('cookie') || '',
      },
      body: JSON.stringify({
        accessToken: access_token,
        refreshToken: refresh_token,
        expiresIn: expires_in,
        openId: open_id,
        scope,
      }),
    })

    if (!storeResponse.ok) {
      const storeError = await storeResponse.text()
      logger.error('Failed to store TikTok tokens:', storeError)
      return NextResponse.redirect(`${baseUrl}/workspace?error=store_failed`)
    }

    logger.info('TikTok authorization successful')
    return NextResponse.redirect(`${returnUrl}?tiktok_connected=true`)
  } catch (error) {
    logger.error('Error in TikTok callback:', error)
    return NextResponse.redirect(`${baseUrl}/workspace?error=callback_error`)
  }
}
