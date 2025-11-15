import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { getBaseUrl } from '@/lib/urls/utils'
import { db } from '@/../../packages/db'
import { account } from '@/../../packages/db/schema'

const logger = createLogger('SnowflakeCallback')

export const dynamic = 'force-dynamic'

/**
 * Handles Snowflake OAuth callback
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn('Unauthorized Snowflake OAuth callback')
      return NextResponse.redirect(`${getBaseUrl()}/workspace?error=unauthorized`)
    }

    const { searchParams } = new URL(request.url)
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const error = searchParams.get('error')
    const errorDescription = searchParams.get('error_description')

    // Handle OAuth errors
    if (error) {
      logger.error('Snowflake OAuth error', { error, errorDescription })
      return NextResponse.redirect(
        `${getBaseUrl()}/workspace?error=snowflake_${error}&description=${encodeURIComponent(errorDescription || '')}`
      )
    }

    if (!code || !state) {
      logger.error('Missing code or state in callback')
      return NextResponse.redirect(`${getBaseUrl()}/workspace?error=snowflake_invalid_callback`)
    }

    // Decode state to get account URL and code verifier
    let stateData: {
      userId: string
      accountUrl: string
      timestamp: number
      codeVerifier: string
    }

    try {
      stateData = JSON.parse(Buffer.from(state, 'base64url').toString())
      logger.info('Decoded state successfully', {
        userId: stateData.userId,
        accountUrl: stateData.accountUrl,
        age: Date.now() - stateData.timestamp,
        hasCodeVerifier: !!stateData.codeVerifier,
      })
    } catch (e) {
      logger.error('Invalid state parameter', { error: e, state })
      return NextResponse.redirect(`${getBaseUrl()}/workspace?error=snowflake_invalid_state`)
    }

    // Verify the user matches
    if (stateData.userId !== session.user.id) {
      logger.error('User ID mismatch in state', {
        stateUserId: stateData.userId,
        sessionUserId: session.user.id,
      })
      return NextResponse.redirect(`${getBaseUrl()}/workspace?error=snowflake_user_mismatch`)
    }

    // Verify state is not too old (15 minutes)
    if (Date.now() - stateData.timestamp > 15 * 60 * 1000) {
      logger.error('State expired', {
        age: Date.now() - stateData.timestamp,
      })
      return NextResponse.redirect(`${getBaseUrl()}/workspace?error=snowflake_state_expired`)
    }

    const clientId = env.SNOWFLAKE_CLIENT_ID
    const clientSecret = env.SNOWFLAKE_CLIENT_SECRET

    if (!clientId || !clientSecret) {
      logger.error('Snowflake OAuth credentials not configured')
      return NextResponse.redirect(`${getBaseUrl()}/workspace?error=snowflake_not_configured`)
    }

    // Exchange authorization code for tokens
    const tokenUrl = `https://${stateData.accountUrl}/oauth/token-request`
    const redirectUri = `${getBaseUrl()}/api/auth/snowflake/callback`

    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
      code_verifier: stateData.codeVerifier,
    })

    logger.info('Exchanging authorization code for tokens (with PKCE)', {
      tokenUrl,
      redirectUri,
      clientId,
      hasCode: !!code,
      hasClientSecret: !!clientSecret,
      hasCodeVerifier: !!stateData.codeVerifier,
      paramsLength: tokenParams.toString().length,
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
      logger.error('Failed to exchange code for token', {
        status: tokenResponse.status,
        statusText: tokenResponse.statusText,
        error: errorText,
        tokenUrl,
        redirectUri,
      })
      
      // Try to parse error as JSON for better diagnostics
      try {
        const errorJson = JSON.parse(errorText)
        logger.error('Snowflake error details:', errorJson)
      } catch (e) {
        logger.error('Error text (not JSON):', errorText)
      }
      
      return NextResponse.redirect(
        `${getBaseUrl()}/workspace?error=snowflake_token_exchange_failed&details=${encodeURIComponent(errorText)}`
      )
    }

    const tokens = await tokenResponse.json()

    logger.info('Token exchange for Snowflake successful', {
      hasAccessToken: !!tokens.access_token,
      hasRefreshToken: !!tokens.refresh_token,
      expiresIn: tokens.expires_in,
      scope: tokens.scope,
    })

    if (!tokens.access_token) {
      logger.error('No access token in response', { tokens })
      return NextResponse.redirect(`${getBaseUrl()}/workspace?error=snowflake_no_access_token`)
    }

    // Store the account and tokens in the database
    const existing = await db.query.account.findFirst({
      where: and(
        eq(account.userId, session.user.id),
        eq(account.providerId, 'snowflake')
      ),
    })

    const now = new Date()
    const expiresAt = tokens.expires_in
      ? new Date(now.getTime() + tokens.expires_in * 1000)
      : new Date(now.getTime() + 10 * 60 * 1000) // Default 10 minutes

    const accountData = {
      userId: session.user.id,
      providerId: 'snowflake',
      accountId: stateData.accountUrl, // Store the Snowflake account URL here
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || null,
      accessTokenExpiresAt: expiresAt,
      scope: tokens.scope || null,
      updatedAt: now,
    }

    if (existing) {
      await db
        .update(account)
        .set(accountData)
        .where(eq(account.id, existing.id))

      logger.info('Updated existing Snowflake account', {
        userId: session.user.id,
        accountUrl: stateData.accountUrl,
      })
    } else {
      await db.insert(account).values({
        ...accountData,
        id: `snowflake_${session.user.id}_${Date.now()}`,
        createdAt: now,
      })

      logger.info('Created new Snowflake account', {
        userId: session.user.id,
        accountUrl: stateData.accountUrl,
      })
    }

    return NextResponse.redirect(`${getBaseUrl()}/workspace?snowflake_connected=true`)
  } catch (error) {
    logger.error('Error in Snowflake callback:', error)
    return NextResponse.redirect(`${getBaseUrl()}/workspace?error=snowflake_callback_failed`)
  }
}

