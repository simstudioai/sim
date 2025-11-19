import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { generateCodeChallenge, generateCodeVerifier } from '@/lib/oauth/pkce'
import { getBaseUrl } from '@/lib/urls/utils'

const logger = createLogger('SnowflakeAuthorize')

export const dynamic = 'force-dynamic'

/**
 * Initiates Snowflake OAuth flow
 * Expects credentials to be posted in the request body (accountUrl, clientId, clientSecret)
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn('Unauthorized Snowflake OAuth attempt')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { accountUrl, clientId, clientSecret } = body

    if (!accountUrl || !clientId || !clientSecret) {
      logger.error('Missing required Snowflake OAuth parameters', {
        hasAccountUrl: !!accountUrl,
        hasClientId: !!clientId,
        hasClientSecret: !!clientSecret,
      })
      return NextResponse.json(
        { error: 'accountUrl, clientId, and clientSecret are required' },
        { status: 400 }
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

    // Store user-provided credentials in the state (will be used in callback)
    const state = Buffer.from(
      JSON.stringify({
        userId: session.user.id,
        accountUrl: cleanAccountUrl,
        clientId,
        clientSecret,
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

    logger.info('Initiating Snowflake OAuth flow with user-provided credentials (PKCE)', {
      userId: session.user.id,
      accountUrl: cleanAccountUrl,
      hasClientId: !!clientId,
      hasClientSecret: !!clientSecret,
      redirectUri,
      hasPkce: true,
    })

    return NextResponse.json({
      authUrl: authUrl.toString(),
    })
  } catch (error) {
    logger.error('Error initiating Snowflake authorization:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
