import { db } from '@sim/db'
import { account } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { refreshAccessTokenIfNeeded, resolveOAuthAccountId } from '@/app/api/auth/oauth/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('WealthboxItemsAPI')

/**
 * Get items (notes, contacts, tasks) from Wealthbox
 */
export async function GET(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    // Get the session
    const session = await getSession()

    // Check if the user is authenticated
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthenticated request rejected`)
      return NextResponse.json({ error: 'User not authenticated' }, { status: 401 })
    }

    // Get parameters from query
    const { searchParams } = new URL(request.url)
    const credentialId = searchParams.get('credentialId')
    const type = searchParams.get('type') || 'contact'
    const query = searchParams.get('query') || ''

    if (!credentialId) {
      logger.warn(`[${requestId}] Missing credential ID`)
      return NextResponse.json({ error: 'Credential ID is required' }, { status: 400 })
    }

    // Validate item type - only handle contacts now
    if (type !== 'contact') {
      logger.warn(`[${requestId}] Invalid item type: ${type}`)
      return NextResponse.json(
        { error: 'Invalid item type. Only contact is supported.' },
        { status: 400 }
      )
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

    // Use correct endpoints based on documentation - only for contacts
    const endpoints = {
      contact: 'contacts',
    }
    const endpoint = endpoints[type as keyof typeof endpoints]

    // Build URL - using correct API base URL
    const url = new URL(`https://api.crmworkspace.com/v1/${endpoint}`)

    logger.info(`[${requestId}] Fetching ${type}s from Wealthbox`, {
      endpoint,
      url: url.toString(),
      hasQuery: !!query.trim(),
    })

    // Make request to Wealthbox API
    const response = await fetch(url.toString(), {
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
          url: url.toString(),
        }
      )
      return NextResponse.json(
        { error: `Failed to fetch ${type}s from Wealthbox` },
        { status: response.status }
      )
    }

    const data = await response.json()

    logger.info(`[${requestId}] Wealthbox API response structure`, {
      type,
      status: response.status,
      dataKeys: Object.keys(data || {}),
      hasContacts: !!data.contacts,
      dataStructure: typeof data === 'object' ? Object.keys(data) : 'not an object',
    })

    // Transform the response based on type and correct response format
    let items: any[] = []

    if (type === 'contact') {
      const contacts = data.contacts || []
      if (!Array.isArray(contacts)) {
        logger.warn(`[${requestId}] Contacts is not an array`, {
          contacts,
          dataType: typeof contacts,
        })
        return NextResponse.json({ items: [] }, { status: 200 })
      }

      items = contacts.map((item: any) => ({
        id: item.id?.toString() || '',
        name: `${item.first_name || ''} ${item.last_name || ''}`.trim() || `Contact ${item.id}`,
        type: 'contact',
        content: item.background_information || '',
        createdAt: item.created_at,
        updatedAt: item.updated_at,
      }))
    }

    // Apply client-side filtering if query is provided
    if (query.trim()) {
      const searchTerm = query.trim().toLowerCase()
      items = items.filter(
        (item) =>
          item.name.toLowerCase().includes(searchTerm) ||
          item.content.toLowerCase().includes(searchTerm)
      )
    }

    logger.info(`[${requestId}] Successfully fetched ${items.length} ${type}s from Wealthbox`, {
      totalItems: items.length,
      hasSearchQuery: !!query.trim(),
    })

    return NextResponse.json({ items }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching Wealthbox items`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
