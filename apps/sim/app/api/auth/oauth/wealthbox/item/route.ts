import { db } from '@sim/db'
import { account } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { wealthboxOAuthItemContract } from '@/lib/api/contracts/selectors/wealthbox'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { validateEnum, validatePathSegment } from '@/lib/core/security/input-validation'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { refreshAccessTokenIfNeeded, resolveOAuthAccountId } from '@/app/api/auth/oauth/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('WealthboxItemAPI')

interface WealthboxItem {
  id: string
  name: string
  type: string
  content: string
  createdAt: string
  updatedAt: string
}

/**
 * Get a single item (note, contact, task) from Wealthbox
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const session = await getSession()

    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthenticated request rejected`)
      return NextResponse.json({ error: 'User not authenticated' }, { status: 401 })
    }

    const parsed = await parseRequest(wealthboxOAuthItemContract, request, {})
    if (!parsed.success) return parsed.response
    const { credentialId, itemId, type } = parsed.data.query

    const typeValidation = validateEnum(type, ['contact'] as const, 'type')
    if (!typeValidation.isValid) {
      logger.warn(`[${requestId}] Invalid item type: ${typeValidation.error}`)
      return NextResponse.json({ error: typeValidation.error }, { status: 400 })
    }

    const itemIdValidation = validatePathSegment(itemId, {
      paramName: 'itemId',
      maxLength: 100,
      allowHyphens: true,
      allowUnderscores: true,
      allowDots: false,
    })
    if (!itemIdValidation.isValid) {
      logger.warn(`[${requestId}] Invalid item ID: ${itemIdValidation.error}`)
      return NextResponse.json({ error: itemIdValidation.error }, { status: 400 })
    }

    const resolved = await resolveOAuthAccountId(credentialId)
    if (!resolved) {
      return NextResponse.json({ error: 'Credential not found' }, { status: 404 })
    }

    if (resolved.workspaceId) {
      const { getUserEntityPermissions } = await import('@/lib/workspaces/permissions/utils')
      const perm = await getUserEntityPermissions(
        session.user.id,
        'workspace',
        resolved.workspaceId
      )
      if (perm === null) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    const credentials = await db
      .select()
      .from(account)
      .where(eq(account.id, resolved.accountId))
      .limit(1)

    if (!credentials.length) {
      logger.warn(`[${requestId}] Credential not found`, { credentialId })
      return NextResponse.json({ error: 'Credential not found' }, { status: 404 })
    }

    const accountRow = credentials[0]

    const accessToken = await refreshAccessTokenIfNeeded(
      resolved.accountId,
      accountRow.userId,
      requestId
    )

    if (!accessToken) {
      logger.error(`[${requestId}] Failed to obtain valid access token`)
      return NextResponse.json({ error: 'Failed to obtain valid access token' }, { status: 401 })
    }

    const endpoints = {
      contact: 'contacts',
    }
    const endpoint = endpoints[type as keyof typeof endpoints]

    logger.info(`[${requestId}] Fetching ${type} ${itemId} from Wealthbox`)

    const response = await fetch(`https://api.crmworkspace.com/v1/${endpoint}/${itemId}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error(
        `[${requestId}] Wealthbox API error: ${response.status} ${response.statusText}`,
        {
          error: errorText,
          endpoint,
          itemId,
        }
      )

      if (response.status === 404) {
        return NextResponse.json({ error: 'Item not found' }, { status: 404 })
      }

      return NextResponse.json(
        { error: `Failed to fetch ${type} from Wealthbox` },
        { status: response.status }
      )
    }

    const data = (await response.json()) as Record<string, unknown>
    const meta =
      data.meta && typeof data.meta === 'object' ? (data.meta as Record<string, unknown>) : null
    const totalCount = meta?.total_count ?? 'unknown'

    logger.info(`[${requestId}] Wealthbox API response structure`, {
      type,
      dataKeys: Object.keys(data || {}),
      hasContacts: !!data.contacts,
      totalCount,
    })

    let items: WealthboxItem[] = []

    if (type === 'contact') {
      if (data?.id) {
        const firstName = typeof data.first_name === 'string' ? data.first_name : ''
        const lastName = typeof data.last_name === 'string' ? data.last_name : ''
        const item = {
          id: data.id?.toString() || '',
          name: `${firstName} ${lastName}`.trim() || `Contact ${data.id}`,
          type: 'contact',
          content: typeof data.background_info === 'string' ? data.background_info : '',
          createdAt: typeof data.created_at === 'string' ? data.created_at : '',
          updatedAt: typeof data.updated_at === 'string' ? data.updated_at : '',
        }
        items = [item]
      } else {
        logger.warn(`[${requestId}] Unexpected contact response format`, { data })
        items = []
      }
    }

    logger.info(
      `[${requestId}] Successfully fetched ${items.length} ${type}s from Wealthbox (total: ${totalCount})`
    )

    return NextResponse.json({ item: items[0] }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching Wealthbox item`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
