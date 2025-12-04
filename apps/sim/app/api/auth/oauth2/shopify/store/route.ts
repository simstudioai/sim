import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { createLogger } from '@/lib/logs/console/logger'
import { db } from '@/../../packages/db'
import { account } from '@/../../packages/db/schema'

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

    // Get token data from cookies (set by callback)
    const accessToken = request.cookies.get('shopify_pending_token')?.value
    const shopDomain = request.cookies.get('shopify_pending_shop')?.value
    const scope = request.cookies.get('shopify_pending_scope')?.value

    if (!accessToken || !shopDomain) {
      logger.error('Missing token or shop domain in cookies')
      return NextResponse.redirect(`${baseUrl}/workspace?error=shopify_missing_data`)
    }

    // Validate the token by making a simple API call
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

    // Check if account already exists for this user and provider
    const existing = await db.query.account.findFirst({
      where: and(eq(account.userId, session.user.id), eq(account.providerId, 'shopify')),
    })

    const now = new Date()

    // Store the shop domain in the accessTokenExpiresAt field as metadata
    // Since Shopify tokens don't expire, we use this field to store the shop domain
    // The actual shop domain is needed for API calls
    const accountData = {
      accessToken: accessToken,
      accountId: shopInfo.id?.toString() || shopDomain,
      scope: scope || '',
      updatedAt: now,
      // Store shop domain in idToken field (repurposed for shop domain since Shopify doesn't use idToken)
      idToken: shopDomain,
    }

    if (existing) {
      await db.update(account).set(accountData).where(eq(account.id, existing.id))
      logger.info('Updated existing Shopify account', { accountId: existing.id })
    } else {
      await db.insert(account).values({
        id: `shopify_${session.user.id}_${Date.now()}`,
        userId: session.user.id,
        providerId: 'shopify',
        ...accountData,
        createdAt: now,
      })
      logger.info('Created new Shopify account for user', { userId: session.user.id })
    }

    // Clear the pending cookies
    const response = NextResponse.redirect(`${baseUrl}/workspace?shopify_connected=true`)
    response.cookies.delete('shopify_pending_token')
    response.cookies.delete('shopify_pending_shop')
    response.cookies.delete('shopify_pending_scope')

    return response
  } catch (error) {
    logger.error('Error storing Shopify token:', error)
    return NextResponse.redirect(`${baseUrl}/workspace?error=shopify_store_error`)
  }
}
