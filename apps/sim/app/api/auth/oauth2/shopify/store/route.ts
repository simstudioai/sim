import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import {
  shopifyShopDomainSchema,
  shopifyStoreCookieSchema,
} from '@/lib/api/contracts/oauth-connections'
import { getSession } from '@/lib/auth'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { isSameOrigin } from '@/lib/core/utils/validation'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { completeShopifyOAuthConnection } from '@/lib/oauth/shopify'

const logger = createLogger('ShopifyStore')

export const dynamic = 'force-dynamic'

export const GET = withRouteHandler(async (request: NextRequest) => {
  const baseUrl = getBaseUrl()

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn('Unauthorized attempt to store Shopify token')
      return NextResponse.redirect(`${baseUrl}/workspace?error=unauthorized`)
    }

    const parsedCookies = shopifyStoreCookieSchema.safeParse({
      accessToken: request.cookies.get('shopify_pending_token')?.value,
      shopDomain: request.cookies.get('shopify_pending_shop')?.value,
      scope: request.cookies.get('shopify_pending_scope')?.value || undefined,
      returnUrl: request.cookies.get('shopify_return_url')?.value || undefined,
    })

    if (!parsedCookies.success) {
      logger.error('Missing token or shop domain in cookies')
      return NextResponse.redirect(`${baseUrl}/workspace?error=shopify_missing_data`)
    }
    const { accessToken, shopDomain, scope, returnUrl } = parsedCookies.data
    const draftId = request.cookies.get('shopify_credential_draft_id')?.value

    if (!shopifyShopDomainSchema.safeParse(shopDomain).success) {
      logger.error('Invalid shop domain format in cookie', { shopDomain })
      return NextResponse.redirect(`${baseUrl}/workspace?error=shopify_invalid_domain`)
    }

    await completeShopifyOAuthConnection({
      accessToken,
      shopDomain,
      scope,
      userId: session.user.id,
      draftId,
      signal: request.signal,
    })

    const redirectUrl = returnUrl && isSameOrigin(returnUrl) ? returnUrl : `${baseUrl}/workspace`
    const finalUrl = new URL(redirectUrl)
    finalUrl.searchParams.set('shopify_connected', 'true')

    const response = NextResponse.redirect(finalUrl.toString())
    response.cookies.delete('shopify_pending_token')
    response.cookies.delete('shopify_pending_shop')
    response.cookies.delete('shopify_pending_scope')
    response.cookies.delete('shopify_return_url')
    response.cookies.delete('shopify_credential_draft_id')

    return response
  } catch (error) {
    logger.error('Error storing Shopify token:', error)
    return NextResponse.redirect(`${baseUrl}/workspace?error=shopify_store_error`)
  }
})
