import { db } from '@sim/db'
import { account } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { safeAccountInsert } from '@/app/api/auth/oauth/utils'

const logger = createLogger('ShopifyStore')

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const baseUrl = getBaseUrl()

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn('Unauthorized attempt to store Shopify token')
      return NextResponse.redirect(`${baseUrl}/workspace?error=unauthorized`)
    }

    const accessToken = request.cookies.get('shopify_pending_token')?.value
    const shopDomain = request.cookies.get('shopify_pending_shop')?.value
    const scope = request.cookies.get('shopify_pending_scope')?.value

    if (!accessToken || !shopDomain) {
      logger.error('Missing token or shop domain in cookies')
      return NextResponse.redirect(`${baseUrl}/workspace?error=shopify_missing_data`)
    }

    const shopResponse = await fetch(`https://${shopDomain}/admin/api/2024-10/shop.json`, {
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
    })

    if (!shopResponse.ok) {
      const errorText = await shopResponse.text()
      logger.error('Invalid Shopify token', {
        status: shopResponse.status,
        error: errorText,
      })
      return NextResponse.redirect(`${baseUrl}/workspace?error=shopify_invalid_token`)
    }

    const shopData = await shopResponse.json()
    const shopInfo = shopData.shop

    const existing = await db.query.account.findFirst({
      where: and(eq(account.userId, session.user.id), eq(account.providerId, 'shopify')),
    })

    const now = new Date()

    const accountData = {
      accessToken: accessToken,
      accountId: shopInfo.id?.toString() || shopDomain,
      scope: scope || '',
      updatedAt: now,
      idToken: shopDomain,
    }

    if (existing) {
      await db.update(account).set(accountData).where(eq(account.id, existing.id))
      logger.info('Updated existing Shopify account', { accountId: existing.id })
    } else {
      await safeAccountInsert(
        {
          id: `shopify_${session.user.id}_${Date.now()}`,
          userId: session.user.id,
          providerId: 'shopify',
          accountId: accountData.accountId,
          accessToken: accountData.accessToken,
          scope: accountData.scope,
          idToken: accountData.idToken,
          createdAt: now,
          updatedAt: now,
        },
        { provider: 'Shopify', identifier: shopDomain }
      )
    }

    const returnUrl = request.cookies.get('shopify_return_url')?.value

    const redirectUrl = returnUrl || `${baseUrl}/workspace`
    const finalUrl = new URL(redirectUrl)
    finalUrl.searchParams.set('shopify_connected', 'true')

    const response = NextResponse.redirect(finalUrl.toString())
    response.cookies.delete('shopify_pending_token')
    response.cookies.delete('shopify_pending_shop')
    response.cookies.delete('shopify_pending_scope')
    response.cookies.delete('shopify_return_url')

    return response
  } catch (error) {
    logger.error('Error storing Shopify token:', error)
    return NextResponse.redirect(`${baseUrl}/workspace?error=shopify_store_error`)
  }
}
