import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { hmacSha256Hex } from '@sim/security/hmac'
import { type NextRequest, NextResponse } from 'next/server'
import {
  shopifyCallbackQuerySchema,
  shopifyShopDomainSchema,
} from '@/lib/api/contracts/oauth-connections'
import { getSession } from '@/lib/auth'
import { EnvCapabilityConfigurationError } from '@/lib/core/config/env-capabilities'
import { requireConfiguredOAuthClient } from '@/lib/core/config/env-capabilities.server'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { isSameOrigin } from '@/lib/core/utils/validation'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { APP_ENTRY_PATH } from '@/lib/navigation/paths'
import { completeShopifyOAuthConnection } from '@/lib/oauth/shopify'
import { parseShopifyOAuthState } from '@/lib/oauth/shopify-state'

const logger = createLogger('ShopifyCallback')

export const dynamic = 'force-dynamic'

function clearShopifyOAuthCookies(response: NextResponse): NextResponse {
  response.cookies.delete('shopify_oauth_state')
  response.cookies.delete('shopify_shop_domain')
  response.cookies.delete('shopify_credential_draft_id')
  response.cookies.delete('shopify_pending_token')
  response.cookies.delete('shopify_pending_shop')
  response.cookies.delete('shopify_pending_scope')
  response.cookies.delete('shopify_return_url')
  return response
}

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

  const generatedHmac = hmacSha256Hex(message, clientSecret)

  return safeCompare(hmac, generatedHmac)
}

export const GET = withRouteHandler(async (request: NextRequest) => {
  const baseUrl = getBaseUrl()

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.redirect(`${baseUrl}${APP_ENTRY_PATH}?error=unauthorized`)
    }

    const { searchParams } = request.nextUrl
    const { code, state, shop } = shopifyCallbackQuerySchema.parse({
      code: searchParams.get('code') || undefined,
      state: searchParams.get('state') || undefined,
      shop: searchParams.get('shop') || undefined,
    })

    const {
      values: { SHOPIFY_CLIENT_ID: clientId, SHOPIFY_CLIENT_SECRET: clientSecret },
    } = requireConfiguredOAuthClient('shopify')

    if (!validateHmac(searchParams, clientSecret)) {
      logger.error('HMAC validation failed in Shopify OAuth callback')
      return NextResponse.redirect(`${baseUrl}${APP_ENTRY_PATH}?error=shopify_hmac_invalid`)
    }

    if (!state) {
      logger.error('Missing state in Shopify OAuth callback')
      return NextResponse.redirect(`${baseUrl}${APP_ENTRY_PATH}?error=shopify_state_mismatch`)
    }

    if (!code) {
      logger.error('No code received from Shopify')
      return NextResponse.redirect(`${baseUrl}${APP_ENTRY_PATH}?error=shopify_no_code`)
    }

    const shopDomain = shop
    if (!shopDomain) {
      logger.error('No shop domain available')
      return NextResponse.redirect(`${baseUrl}${APP_ENTRY_PATH}?error=shopify_no_shop`)
    }

    if (!shopifyShopDomainSchema.safeParse(shopDomain).success) {
      logger.error('Invalid shop domain format:', { shopDomain })
      return NextResponse.redirect(`${baseUrl}${APP_ENTRY_PATH}?error=shopify_invalid_shop`)
    }

    const { draftId, returnUrl } = parseShopifyOAuthState({
      state,
      userId: session.user.id,
      shopDomain,
      clientSecret,
    })

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
      return NextResponse.redirect(`${baseUrl}${APP_ENTRY_PATH}?error=shopify_token_error`)
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
      return NextResponse.redirect(`${baseUrl}${APP_ENTRY_PATH}?error=shopify_no_token`)
    }

    await completeShopifyOAuthConnection({
      accessToken,
      shopDomain,
      scope,
      userId: session.user.id,
      draftId,
      signal: request.signal,
    })

    if (returnUrl && !isSameOrigin(returnUrl)) {
      throw new Error('Shopify OAuth state contains an invalid return URL')
    }
    const redirectUrl = returnUrl ?? `${baseUrl}${APP_ENTRY_PATH}`
    const finalUrl = new URL(redirectUrl)
    finalUrl.searchParams.set('shopify_connected', 'true')

    return clearShopifyOAuthCookies(NextResponse.redirect(finalUrl))
  } catch (error) {
    logger.error('Error in Shopify OAuth callback:', error)
    const errorCode =
      error instanceof EnvCapabilityConfigurationError && error.capabilityId === 'oauth'
        ? 'shopify_config_error'
        : 'shopify_callback_error'
    return clearShopifyOAuthCookies(
      NextResponse.redirect(`${baseUrl}${APP_ENTRY_PATH}?error=${errorCode}`)
    )
  }
})
