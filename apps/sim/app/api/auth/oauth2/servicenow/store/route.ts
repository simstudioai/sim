import { db } from '@sim/db'
import { account } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { createLogger } from '@/lib/logs/console/logger'
import { safeAccountInsert } from '@/app/api/auth/oauth/utils'

const logger = createLogger('ServiceNowStore')

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const baseUrl = getBaseUrl()

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn('Unauthorized attempt to store ServiceNow token')
      return NextResponse.redirect(`${baseUrl}/workspace?error=unauthorized`)
    }

    // Retrieve token data from cookies
    const accessToken = request.cookies.get('servicenow_pending_token')?.value
    const refreshToken = request.cookies.get('servicenow_pending_refresh_token')?.value
    const instanceUrl = request.cookies.get('servicenow_pending_instance')?.value
    const scope = request.cookies.get('servicenow_pending_scope')?.value
    const expiresInStr = request.cookies.get('servicenow_pending_expires_in')?.value

    if (!accessToken || !instanceUrl) {
      logger.error('Missing token or instance URL in cookies')
      return NextResponse.redirect(`${baseUrl}/workspace?error=servicenow_missing_data`)
    }

    // Validate the token by fetching user info from ServiceNow
    const userResponse = await fetch(
      `${instanceUrl}/api/now/table/sys_user?sysparm_query=user_name=${encodeURIComponent('javascript:gs.getUserName()')}&sysparm_limit=1`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      }
    )

    // Alternative: Use the instance info endpoint instead
    let accountIdentifier = instanceUrl
    let userInfo: Record<string, unknown> | null = null

    // Try to get current user info
    try {
      const whoamiResponse = await fetch(`${instanceUrl}/api/now/ui/user/current_user`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      })

      if (whoamiResponse.ok) {
        const whoamiData = await whoamiResponse.json()
        userInfo = whoamiData.result
        if (userInfo?.user_sys_id) {
          accountIdentifier = userInfo.user_sys_id as string
        } else if (userInfo?.user_name) {
          accountIdentifier = userInfo.user_name as string
        }
        logger.info('Retrieved ServiceNow user info', { accountIdentifier })
      }
    } catch (e) {
      logger.warn('Could not retrieve ServiceNow user info, using instance URL as identifier')
    }

    // Calculate expiration time
    const now = new Date()
    const expiresIn = expiresInStr ? Number.parseInt(expiresInStr, 10) : 3600 // Default to 1 hour
    const accessTokenExpiresAt = new Date(now.getTime() + expiresIn * 1000)

    // Check for existing ServiceNow account for this user
    const existing = await db.query.account.findFirst({
      where: and(eq(account.userId, session.user.id), eq(account.providerId, 'servicenow')),
    })

    // ServiceNow always grants 'useraccount' scope but returns empty string
    const effectiveScope = scope?.trim() ? scope : 'useraccount'

    const accountData = {
      accessToken: accessToken,
      refreshToken: refreshToken || null,
      accountId: accountIdentifier,
      scope: effectiveScope,
      updatedAt: now,
      accessTokenExpiresAt: accessTokenExpiresAt,
      idToken: instanceUrl, // Store instance URL in idToken for API calls
    }

    if (existing) {
      await db.update(account).set(accountData).where(eq(account.id, existing.id))
      logger.info('Updated existing ServiceNow account', { accountId: existing.id })
    } else {
      await safeAccountInsert(
        {
          id: `servicenow_${session.user.id}_${Date.now()}`,
          userId: session.user.id,
          providerId: 'servicenow',
          accountId: accountData.accountId,
          accessToken: accountData.accessToken,
          refreshToken: accountData.refreshToken || undefined,
          accessTokenExpiresAt: accountData.accessTokenExpiresAt,
          scope: accountData.scope,
          idToken: accountData.idToken,
          createdAt: now,
          updatedAt: now,
        },
        { provider: 'ServiceNow', identifier: instanceUrl }
      )
      logger.info('Created new ServiceNow account')
    }

    // Get return URL from cookie
    const returnUrl = request.cookies.get('servicenow_return_url')?.value

    const redirectUrl = returnUrl || `${baseUrl}/workspace`
    const finalUrl = new URL(redirectUrl)
    finalUrl.searchParams.set('servicenow_connected', 'true')

    const response = NextResponse.redirect(finalUrl.toString())

    // Clean up all ServiceNow cookies
    response.cookies.delete('servicenow_pending_token')
    response.cookies.delete('servicenow_pending_refresh_token')
    response.cookies.delete('servicenow_pending_instance')
    response.cookies.delete('servicenow_pending_scope')
    response.cookies.delete('servicenow_pending_expires_in')
    response.cookies.delete('servicenow_return_url')

    return response
  } catch (error) {
    logger.error('Error storing ServiceNow token:', error)
    return NextResponse.redirect(`${baseUrl}/workspace?error=servicenow_store_error`)
  }
}
