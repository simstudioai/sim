import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { env } from '@/lib/core/config/env'
import { getBaseUrl } from '@/lib/core/utils/urls'

const logger = createLogger('TikTokAuthorize')

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const clientKey = env.TIKTOK_CLIENT_ID

    if (!clientKey) {
      logger.error('TIKTOK_CLIENT_ID not configured')
      return NextResponse.json({ error: 'TikTok client key not configured' }, { status: 500 })
    }

    // Get the return URL from query params or use default
    const searchParams = request.nextUrl.searchParams
    const returnUrl = searchParams.get('returnUrl') || `${getBaseUrl()}/workspace`

    const baseUrl = getBaseUrl()
    const redirectUri = `${baseUrl}/api/auth/tiktok/callback`

    // Generate a random state for CSRF protection
    const state = Buffer.from(
      JSON.stringify({
        returnUrl,
        timestamp: Date.now(),
      })
    ).toString('base64url')

    // TikTok scopes
    const scopes = [
      'user.info.basic',
      'user.info.profile',
      'user.info.stats',
      'video.list',
      'video.publish',
    ]

    // Build TikTok authorization URL with client_key (not client_id)
    // Note: TikTok expects raw commas in scope parameter, not URL-encoded %2C
    // So we manually construct the URL to avoid automatic encoding
    const scopeString = scopes.join(',')
    const encodedRedirectUri = encodeURIComponent(redirectUri)
    const encodedState = encodeURIComponent(state)

    const authUrl = `https://www.tiktok.com/v2/auth/authorize/?client_key=${clientKey}&response_type=code&scope=${scopeString}&redirect_uri=${encodedRedirectUri}&state=${encodedState}`

    logger.info('Redirecting to TikTok authorization', {
      clientKey: clientKey ? `${clientKey.substring(0, 8)}...` : 'NOT SET',
      redirectUri,
      scopes: scopeString,
      fullUrl: authUrl,
    })

    return NextResponse.redirect(authUrl)
  } catch (error) {
    logger.error('Error initiating TikTok authorization:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
