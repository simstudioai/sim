import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import { getBaseUrl } from '@/lib/urls/utils'
import { generateCodeChallenge, generateCodeVerifier } from '@/lib/oauth/pkce'

const logger = createLogger('SnowflakeAuthorize')

export const dynamic = 'force-dynamic'

/**
 * Initiates Snowflake OAuth flow
 * Requires accountUrl as query parameter
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn('Unauthorized Snowflake OAuth attempt')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const accountUrl = searchParams.get('accountUrl')

    if (!accountUrl) {
      logger.error('Missing accountUrl parameter')
      return NextResponse.json(
        { error: 'accountUrl parameter is required' },
        { status: 400 }
      )
    }

    const clientId = env.SNOWFLAKE_CLIENT_ID
    const clientSecret = env.SNOWFLAKE_CLIENT_SECRET

    if (!clientId || !clientSecret) {
      logger.error('Snowflake OAuth credentials not configured')
      return NextResponse.json(
        { error: 'Snowflake OAuth not configured' },
        { status: 500 }
      )
    }

    // Parse and clean the account URL
    let cleanAccountUrl = accountUrl.replace(/^https?:\/\//, '')
    cleanAccountUrl = cleanAccountUrl.replace(/\/$/, '')
    if (!cleanAccountUrl.includes('snowflakecomputing.com')) {
      cleanAccountUrl = `${cleanAccountUrl}.snowflakecomputing.com`
    }

    const baseUrl = getBaseUrl()
    const redirectUri = `${baseUrl}/api/auth/snowflake/callback`

    // Generate PKCE values
    const codeVerifier = generateCodeVerifier()
    const codeChallenge = await generateCodeChallenge(codeVerifier)


    const state = Buffer.from(
      JSON.stringify({
        userId: session.user.id,
        accountUrl: cleanAccountUrl,
        timestamp: Date.now(),
        codeVerifier,
      })
    ).toString('base64url')

    // Construct Snowflake-specific authorization URL
    const authUrl = new URL(`https://${cleanAccountUrl}/oauth/authorize`)
    authUrl.searchParams.set('client_id', clientId)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('redirect_uri', redirectUri)
    // Add scope parameter to specify a safe role (not ACCOUNTADMIN or SECURITYADMIN)
    authUrl.searchParams.set('scope', 'refresh_token session:role:PUBLIC')
    authUrl.searchParams.set('state', state)
    // Add PKCE parameters for security and compatibility with OAUTH_ENFORCE_PKCE
    authUrl.searchParams.set('code_challenge', codeChallenge)
    authUrl.searchParams.set('code_challenge_method', 'S256')
    
    logger.info('Initiating Snowflake OAuth flow (CONFIDENTIAL client with PKCE)', {
      userId: session.user.id,
      accountUrl: cleanAccountUrl,
      authUrl: authUrl.toString(),
      redirectUri,
      clientId,
      hasClientSecret: !!clientSecret,
      hasPkce: true,
      parametersCount: authUrl.searchParams.toString().length,
    })

    logger.info('Authorization URL parameters:', {
      client_id: authUrl.searchParams.get('client_id'),
      response_type: authUrl.searchParams.get('response_type'),
      redirect_uri: authUrl.searchParams.get('redirect_uri'),
      state_length: authUrl.searchParams.get('state')?.length,
      scope: authUrl.searchParams.get('scope'),
      has_pkce: authUrl.searchParams.has('code_challenge'),
      code_challenge_method: authUrl.searchParams.get('code_challenge_method'),
    })

    return NextResponse.redirect(authUrl.toString())
  } catch (error) {
    logger.error('Error initiating Snowflake authorization:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

