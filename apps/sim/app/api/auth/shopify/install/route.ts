import { createLogger } from '@sim/logger'
import { generateRandomHex } from '@sim/utils/random'
import { type NextRequest, NextResponse } from 'next/server'
import { shopifyInstallContract } from '@/lib/api/contracts/shopify-install'
import { parseRequest } from '@/lib/api/server'
import { requireConfiguredOAuthClient } from '@/lib/core/config/env-capabilities.server'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { createShopifyInstallAttempt } from '@/lib/oauth/shopify-handoff'
import {
  createShopifyInstallState,
  SHOPIFY_INSTALL_COOKIE_PREFIX,
  SHOPIFY_INSTALL_TTL_MS,
  shopifyInstallCookieName,
  validateShopifyQueryHmac,
} from '@/lib/oauth/shopify-install-protocol'
import { getScopesForService } from '@/lib/oauth/utils'

const logger = createLogger('ShopifyInstall')

/** Shopify launch protocol: initiate OAuth before rendering Sim login or workspace selection. */
export const GET = withRouteHandler(async (request: NextRequest) => {
  if (request.method !== 'GET') return new NextResponse(null, { status: 405 })
  const baseUrl = getBaseUrl()
  try {
    request.signal.throwIfAborted()
    const { values } = requireConfiguredOAuthClient('shopify')
    const query = request.nextUrl.searchParams
    if (!validateShopifyQueryHmac(query, values.SHOPIFY_CLIENT_SECRET))
      throw new Error('Invalid Shopify launch signature')
    const parsedRequest = await parseRequest(shopifyInstallContract, request, {})
    if (!parsedRequest.success) throw new Error('Invalid Shopify launch parameters')
    const parsed = parsedRequest.data.query
    if (Math.abs(Date.now() - Number(parsed.timestamp) * 1000) > 300_000)
      throw new Error('Expired Shopify launch')
    if (
      request.cookies
        .getAll()
        .filter((cookie) => cookie.name.startsWith(SHOPIFY_INSTALL_COOKIE_PREFIX)).length >= 5
    )
      throw new Error('Too many pending browser installations')
    const shopDomain = parsed.shop.toLowerCase()
    const browserProof = generateRandomHex(64)
    const attemptId = await createShopifyInstallAttempt(shopDomain, browserProof)
    const authorization = new URL(`https://${shopDomain}/admin/oauth/authorize`)
    authorization.search = new URLSearchParams({
      client_id: values.SHOPIFY_CLIENT_ID,
      scope: getScopesForService('shopify').join(','),
      redirect_uri: `${baseUrl}/api/auth/oauth2/callback/shopify`,
      state: createShopifyInstallState(attemptId, shopDomain, values.SHOPIFY_CLIENT_SECRET),
    }).toString()
    const response = NextResponse.redirect(authorization)
    response.headers.set('Cache-Control', 'no-store')
    response.cookies.set(shopifyInstallCookieName(attemptId), browserProof, {
      httpOnly: true,
      secure: new URL(baseUrl).protocol === 'https:',
      sameSite: 'lax',
      path: '/',
      maxAge: SHOPIFY_INSTALL_TTL_MS / 1000,
    })
    return response
  } catch (error) {
    if (request.signal.aborted) throw error
    logger.warn('Shopify installation launch rejected')
    return NextResponse.redirect(`${baseUrl}/oauth/shopify/connect?error=shopify_install_invalid`)
  }
})
