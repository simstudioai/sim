import { EnvCapabilityConfigurationError } from '@sim/deployment-config/env-capabilities'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import {
  shopifyCallbackQuerySchema,
  shopifyShopDomainSchema,
} from '@/lib/api/contracts/oauth-connections'
import { getSession } from '@/lib/auth'
import { requireConfiguredOAuthClient } from '@/lib/core/config/env-capabilities.server'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { isSameOrigin } from '@/lib/core/utils/validation'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { APP_ENTRY_PATH } from '@/lib/navigation/paths'
import { completeShopifyOAuthConnection } from '@/lib/oauth/shopify'
import { completeShopifyInstallHandoff } from '@/lib/oauth/shopify-handoff'
import {
  parseShopifyInstallState,
  SHOPIFY_INSTALL_TTL_MS,
  shopifyInstallCookieName,
  validateShopifyQueryHmac,
} from '@/lib/oauth/shopify-install-protocol'
import { ShopifyOAuthError } from '@/lib/oauth/shopify-installation'
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

export const GET = withRouteHandler(async (request: NextRequest) => {
  const baseUrl = getBaseUrl()
  const installationFlow =
    request.nextUrl.searchParams.get('state')?.startsWith('install.') ?? false
  const errorPath = installationFlow ? '/oauth/shopify/connect' : APP_ENTRY_PATH

  try {
    const session = installationFlow ? null : await getSession()
    if (!installationFlow && !session?.user?.id) {
      return NextResponse.redirect(`${baseUrl}${errorPath}?error=unauthorized`)
    }

    const { searchParams } = request.nextUrl
    const { code, state, shop } = shopifyCallbackQuerySchema.parse({
      code: searchParams.get('code') || undefined,
      state: searchParams.get('state') || undefined,
      shop: searchParams.get('shop') || undefined,
    })

    const {
      values: { SHOPIFY_CLIENT_SECRET: clientSecret },
    } = requireConfiguredOAuthClient('shopify')

    if (!validateShopifyQueryHmac(searchParams, clientSecret)) {
      logger.error('HMAC validation failed in Shopify OAuth callback')
      return NextResponse.redirect(`${baseUrl}${errorPath}?error=shopify_hmac_invalid`)
    }

    if (!state) {
      logger.error('Missing state in Shopify OAuth callback')
      return NextResponse.redirect(`${baseUrl}${errorPath}?error=shopify_state_mismatch`)
    }

    if (!code) {
      logger.error('No code received from Shopify')
      return NextResponse.redirect(`${baseUrl}${errorPath}?error=shopify_no_code`)
    }

    const shopDomain = installationFlow ? shop?.toLowerCase() : shop
    if (!shopDomain) {
      logger.error('No shop domain available')
      return NextResponse.redirect(`${baseUrl}${errorPath}?error=shopify_no_shop`)
    }

    if (!shopifyShopDomainSchema.safeParse(shopDomain).success) {
      logger.error('Invalid shop domain format:', { shopDomain })
      return NextResponse.redirect(`${baseUrl}${errorPath}?error=shopify_invalid_shop`)
    }

    if (installationFlow) {
      const attemptId = parseShopifyInstallState(state, shopDomain, clientSecret)
      const browserProof = request.cookies.get(shopifyInstallCookieName(attemptId))?.value ?? ''
      await completeShopifyInstallHandoff({
        attemptId,
        browserProof,
        shopDomain,
        code,
        signal: request.signal,
      })
      const destination = new URL('/oauth/shopify/connect', baseUrl)
      destination.searchParams.set('attempt', attemptId)
      const response = NextResponse.redirect(destination)
      response.headers.set('Cache-Control', 'no-store')
      response.cookies.set(shopifyInstallCookieName(attemptId), browserProof, {
        httpOnly: true,
        secure: new URL(baseUrl).protocol === 'https:',
        sameSite: 'lax',
        path: '/',
        maxAge: SHOPIFY_INSTALL_TTL_MS / 1000,
      })
      return response
    }
    if (!session?.user?.id) throw new Error('Shopify connection requires a Sim user')

    const { draftId, returnUrl } = parseShopifyOAuthState({
      state,
      userId: session.user.id,
      shopDomain,
      clientSecret,
    })

    if (returnUrl && !isSameOrigin(returnUrl)) {
      throw new Error('Shopify OAuth state contains an invalid return URL')
    }

    await completeShopifyOAuthConnection({
      code,
      shopDomain,
      userId: session.user.id,
      draftId,
      signal: request.signal,
    })

    const redirectUrl = returnUrl ?? `${baseUrl}${APP_ENTRY_PATH}`
    const finalUrl = new URL(redirectUrl)
    finalUrl.searchParams.set('shopify_connected', 'true')

    return clearShopifyOAuthCookies(NextResponse.redirect(finalUrl))
  } catch (error) {
    if (request.signal.aborted) throw error
    logger.error('Shopify OAuth callback failed')
    const errorCode =
      error instanceof EnvCapabilityConfigurationError && error.capabilityId === 'oauth'
        ? 'shopify_config_error'
        : error instanceof ShopifyOAuthError
          ? error.callbackError
          : 'shopify_callback_error'
    return clearShopifyOAuthCookies(
      NextResponse.redirect(`${baseUrl}${errorPath}?error=${errorCode}`)
    )
  }
})
