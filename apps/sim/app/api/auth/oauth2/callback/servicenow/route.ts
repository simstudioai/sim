import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { env } from '@/lib/core/config/env'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('ServiceNowCallback')

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const baseUrl = getBaseUrl()

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.redirect(`${baseUrl}/workspace?error=unauthorized`)
    }

    const { searchParams } = request.nextUrl
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const error = searchParams.get('error')
    const errorDescription = searchParams.get('error_description')

    // Handle OAuth errors from ServiceNow
    if (error) {
      logger.error('ServiceNow OAuth error:', { error, errorDescription })
      return NextResponse.redirect(
        `${baseUrl}/workspace?error=servicenow_auth_error&message=${encodeURIComponent(errorDescription || error)}`
      )
    }

    const storedState = request.cookies.get('servicenow_oauth_state')?.value
    const storedInstanceUrl = request.cookies.get('servicenow_instance_url')?.value

    const clientId = env.SERVICENOW_CLIENT_ID
    const clientSecret = env.SERVICENOW_CLIENT_SECRET

    if (!clientId || !clientSecret) {
      logger.error('ServiceNow credentials not configured')
      return NextResponse.redirect(`${baseUrl}/workspace?error=servicenow_config_error`)
    }

    // Validate state parameter
    if (!state || state !== storedState) {
      logger.error('State mismatch in ServiceNow OAuth callback')
      return NextResponse.redirect(`${baseUrl}/workspace?error=servicenow_state_mismatch`)
    }

    // Validate authorization code
    if (!code) {
      logger.error('No code received from ServiceNow')
      return NextResponse.redirect(`${baseUrl}/workspace?error=servicenow_no_code`)
    }

    // Validate instance URL
    if (!storedInstanceUrl) {
      logger.error('No instance URL stored')
      return NextResponse.redirect(`${baseUrl}/workspace?error=servicenow_no_instance`)
    }

    const redirectUri = `${baseUrl}/api/auth/oauth2/callback/servicenow`

    // Exchange authorization code for access token
    const tokenResponse = await fetch(`${storedInstanceUrl}/oauth_token.do`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    })

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text()
      logger.error('Failed to exchange code for token:', {
        status: tokenResponse.status,
        body: errorText,
      })
      return NextResponse.redirect(`${baseUrl}/workspace?error=servicenow_token_error`)
    }

    const tokenData = await tokenResponse.json()
    const accessToken = tokenData.access_token
    const refreshToken = tokenData.refresh_token
    const expiresIn = tokenData.expires_in
    // ServiceNow always grants 'useraccount' scope but returns empty string
    const scope = tokenData.scope || 'useraccount'

    logger.info('ServiceNow token exchange successful:', {
      hasAccessToken: !!accessToken,
      hasRefreshToken: !!refreshToken,
      expiresIn,
    })

    if (!accessToken) {
      logger.error('No access token in response')
      return NextResponse.redirect(`${baseUrl}/workspace?error=servicenow_no_token`)
    }

    // Redirect to store endpoint with token data in cookies
    const storeUrl = new URL(`${baseUrl}/api/auth/oauth2/servicenow/store`)

    const response = NextResponse.redirect(storeUrl)

    // Store token data in secure cookies for the store endpoint
    response.cookies.set('servicenow_pending_token', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60, // 1 minute
      path: '/',
    })

    if (refreshToken) {
      response.cookies.set('servicenow_pending_refresh_token', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60,
        path: '/',
      })
    }

    response.cookies.set('servicenow_pending_instance', storedInstanceUrl, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60,
      path: '/',
    })

    response.cookies.set('servicenow_pending_scope', scope || '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60,
      path: '/',
    })

    if (expiresIn) {
      response.cookies.set('servicenow_pending_expires_in', expiresIn.toString(), {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60,
        path: '/',
      })
    }

    // Clean up OAuth state cookies
    response.cookies.delete('servicenow_oauth_state')
    response.cookies.delete('servicenow_instance_url')

    return response
  } catch (error) {
    logger.error('Error in ServiceNow OAuth callback:', error)
    return NextResponse.redirect(`${baseUrl}/workspace?error=servicenow_callback_error`)
  }
}
