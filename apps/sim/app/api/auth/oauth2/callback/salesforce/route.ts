import { db } from '@sim/db'
import { account } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { env } from '@/lib/core/config/env'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { createLogger } from '@/lib/logs/console/logger'
import { safeAccountInsert } from '@/app/api/auth/oauth/utils'

const logger = createLogger('SalesforceCallback')

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const baseUrl = getBaseUrl()

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn('Unauthorized attempt to complete Salesforce OAuth')
      return NextResponse.redirect(`${baseUrl}/workspace?error=unauthorized`)
    }

    const { searchParams } = request.nextUrl
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const error = searchParams.get('error')
    const errorDescription = searchParams.get('error_description')

    if (error) {
      logger.error('Salesforce OAuth error:', { error, errorDescription })
      return NextResponse.redirect(
        `${baseUrl}/workspace?error=salesforce_oauth_error&message=${encodeURIComponent(errorDescription || error)}`
      )
    }

    const storedState = request.cookies.get('salesforce_oauth_state')?.value
    const storedVerifier = request.cookies.get('salesforce_pkce_verifier')?.value
    const storedBaseUrl = request.cookies.get('salesforce_base_url')?.value
    const returnUrl = request.cookies.get('salesforce_return_url')?.value

    const clientId = env.SALESFORCE_CLIENT_ID
    const clientSecret = env.SALESFORCE_CLIENT_SECRET

    if (!clientId || !clientSecret) {
      logger.error('Salesforce credentials not configured')
      return NextResponse.redirect(`${baseUrl}/workspace?error=salesforce_config_error`)
    }

    if (!state || state !== storedState) {
      logger.error('State mismatch in Salesforce OAuth callback', {
        receivedState: state,
        storedState: storedState ? 'present' : 'missing',
      })
      return NextResponse.redirect(`${baseUrl}/workspace?error=salesforce_state_mismatch`)
    }

    if (!code) {
      logger.error('No authorization code received from Salesforce')
      return NextResponse.redirect(`${baseUrl}/workspace?error=salesforce_no_code`)
    }

    if (!storedVerifier || !storedBaseUrl) {
      logger.error('Missing PKCE verifier or base URL')
      return NextResponse.redirect(`${baseUrl}/workspace?error=salesforce_missing_data`)
    }

    const tokenUrl = `${storedBaseUrl}/services/oauth2/token`
    const redirectUri = `${baseUrl}/api/auth/oauth2/callback/salesforce`

    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code_verifier: storedVerifier,
    })

    const tokenResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: tokenParams.toString(),
    })

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text()
      logger.error('Failed to exchange code for token:', {
        status: tokenResponse.status,
        body: errorText,
        tokenUrl,
      })
      return NextResponse.redirect(`${baseUrl}/workspace?error=salesforce_token_error`)
    }

    const tokenData = await tokenResponse.json()
    const accessToken = tokenData.access_token
    const refreshToken = tokenData.refresh_token
    const instanceUrl = tokenData.instance_url
    const scope = tokenData.scope
    // Salesforce returns expires_in in seconds, default to 7200 (2 hours) if not provided
    const expiresIn = tokenData.expires_in ? Number(tokenData.expires_in) : 7200

    logger.info('Salesforce token exchange successful:', {
      hasAccessToken: !!accessToken,
      hasRefreshToken: !!refreshToken,
      instanceUrl,
      scope,
      expiresIn,
    })

    if (!accessToken) {
      logger.error('No access token in Salesforce response')
      return NextResponse.redirect(`${baseUrl}/workspace?error=salesforce_no_token`)
    }

    if (!instanceUrl) {
      logger.error('No instance URL in Salesforce response')
      return NextResponse.redirect(`${baseUrl}/workspace?error=salesforce_no_instance`)
    }

    let userId = 'unknown'
    let userEmail = ''
    try {
      const userInfoUrl = `${instanceUrl}/services/oauth2/userinfo`
      const userInfoResponse = await fetch(userInfoUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      })
      if (userInfoResponse.ok) {
        const userInfo = await userInfoResponse.json()
        userId = userInfo.user_id || userInfo.sub || 'unknown'
        userEmail = userInfo.email || ''
      }
    } catch (userInfoError) {
      logger.warn('Failed to fetch Salesforce user info:', userInfoError)
    }

    const existing = await db.query.account.findFirst({
      where: and(eq(account.userId, session.user.id), eq(account.providerId, 'salesforce')),
    })

    const now = new Date()
    const expiresAt = new Date(now.getTime() + expiresIn * 1000)

    /**
     * Store both instanceUrl (API endpoint) and authBaseUrl (OAuth endpoint) in idToken field.
     * - instanceUrl: Used for API calls (e.g., https://na1.salesforce.com)
     * - authBaseUrl: Used for token refresh (e.g., https://login.salesforce.com or custom domain)
     * This is a non-standard use of the idToken field, but necessary for Salesforce's
     * multi-endpoint OAuth architecture.
     */
    const salesforceMetadata = JSON.stringify({
      instanceUrl: instanceUrl,
      authBaseUrl: storedBaseUrl,
    })

    const accountData = {
      accessToken: accessToken,
      refreshToken: refreshToken || null,
      accountId: userId,
      scope: scope || '',
      updatedAt: now,
      accessTokenExpiresAt: expiresAt,
      idToken: salesforceMetadata,
    }

    if (existing) {
      await db.update(account).set(accountData).where(eq(account.id, existing.id))
      logger.info('Updated existing Salesforce account', { accountId: existing.id })
    } else {
      await safeAccountInsert(
        {
          id: `salesforce_${session.user.id}_${Date.now()}`,
          userId: session.user.id,
          providerId: 'salesforce',
          accountId: accountData.accountId,
          accessToken: accountData.accessToken,
          refreshToken: accountData.refreshToken || undefined,
          scope: accountData.scope,
          idToken: accountData.idToken,
          accessTokenExpiresAt: accountData.accessTokenExpiresAt,
          createdAt: now,
          updatedAt: now,
        },
        { provider: 'Salesforce', identifier: userEmail || userId }
      )
    }

    const redirectUrl = returnUrl || `${baseUrl}/workspace`
    const finalUrl = new URL(redirectUrl)
    finalUrl.searchParams.set('salesforce_connected', 'true')

    const response = NextResponse.redirect(finalUrl.toString())
    response.cookies.delete('salesforce_oauth_state')
    response.cookies.delete('salesforce_pkce_verifier')
    response.cookies.delete('salesforce_base_url')
    response.cookies.delete('salesforce_return_url')

    return response
  } catch (error) {
    logger.error('Error in Salesforce OAuth callback:', error)
    return NextResponse.redirect(`${baseUrl}/workspace?error=salesforce_callback_error`)
  }
}
