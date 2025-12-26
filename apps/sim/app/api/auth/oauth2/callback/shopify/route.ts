import crypto from 'crypto'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { env } from '@/lib/core/config/env'
import { getBaseUrl } from '@/lib/core/utils/urls'

const logger = createLogger('ShopifyCallback')

export const dynamic = 'force-dynamic'

const SHOP_DOMAIN_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/

/**
 * Validates the HMAC signature from Shopify to ensure the request is authentic
 * @see https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/offline-access-tokens
 */
function validateHmac(searchParams: URLSearchParams, clientSecret: string): boolean {
  const hmac = searchParams.get('hmac')
  if (!hmac) {
    return false
  }

  const params: Record<string, string> = {}
  searchParams.forEach((value, key) => {
    if (key !== 'hmac') {
      params[key] = value
    }
  })

  const message = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&')

  const generatedHmac = crypto.createHmac('sha256', clientSecret).update(message).digest('hex')

  try {
    return crypto.timingSafeEqual(Buffer.from(hmac, 'hex'), Buffer.from(generatedHmac, 'hex'))
  } catch {
    return false
  }
}

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
    const shop = searchParams.get('shop')

    const storedState = request.cookies.get('shopify_oauth_state')?.value
    const storedShop = request.cookies.get('shopify_shop_domain')?.value

    const clientId = env.SHOPIFY_CLIENT_ID
    const clientSecret = env.SHOPIFY_CLIENT_SECRET

    if (!clientId || !clientSecret) {
      logger.error('Shopify credentials not configured')
      return NextResponse.redirect(`${baseUrl}/workspace?error=shopify_config_error`)
    }

    if (!validateHmac(searchParams, clientSecret)) {
      logger.error('HMAC validation failed in Shopify OAuth callback')
      return NextResponse.redirect(`${baseUrl}/workspace?error=shopify_hmac_invalid`)
    }

    if (!state || state !== storedState) {
      logger.error('State mismatch in Shopify OAuth callback')
      return NextResponse.redirect(`${baseUrl}/workspace?error=shopify_state_mismatch`)
    }

    if (!code) {
      logger.error('No code received from Shopify')
      return NextResponse.redirect(`${baseUrl}/workspace?error=shopify_no_code`)
    }

    const shopDomain = shop || storedShop
    if (!shopDomain) {
      logger.error('No shop domain available')
      return NextResponse.redirect(`${baseUrl}/workspace?error=shopify_no_shop`)
    }

    if (!SHOP_DOMAIN_REGEX.test(shopDomain)) {
      logger.error('Invalid shop domain format:', { shopDomain })
      return NextResponse.redirect(`${baseUrl}/workspace?error=shopify_invalid_shop`)
    }

    const tokenResponse = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code: code,
      }),
    })

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text()
      logger.error('Failed to exchange code for token:', {
        status: tokenResponse.status,
        body: errorText,
      })
      return NextResponse.redirect(`${baseUrl}/workspace?error=shopify_token_error`)
    }

    const tokenData = await tokenResponse.json()
    const accessToken = tokenData.access_token
    const scope = tokenData.scope

    logger.info('Shopify token exchange successful:', {
      hasAccessToken: !!accessToken,
      scope: scope,
    })

    if (!accessToken) {
      logger.error('No access token in response')
      return NextResponse.redirect(`${baseUrl}/workspace?error=shopify_no_token`)
    }

    const storeUrl = new URL(`${baseUrl}/api/auth/oauth2/shopify/store`)

    const response = NextResponse.redirect(storeUrl)

    response.cookies.set('shopify_pending_token', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60,
      path: '/',
    })

    response.cookies.set('shopify_pending_shop', shopDomain, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60,
      path: '/',
    })

    response.cookies.set('shopify_pending_scope', scope || '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60,
      path: '/',
    })

    response.cookies.delete('shopify_oauth_state')
    response.cookies.delete('shopify_shop_domain')

    return response
  } catch (error) {
    logger.error('Error in Shopify OAuth callback:', error)
    return NextResponse.redirect(`${baseUrl}/workspace?error=shopify_callback_error`)
  }
}
