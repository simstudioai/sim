import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { account } from '@/db/schema'
import { refreshAccessTokenIfNeeded } from '../../utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('WealthboxItemAPI')

/**
 * Get a single item (note, contact, task) from Wealthbox
 */
export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)

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
    const itemId = searchParams.get('itemId')
    const type = searchParams.get('type') || 'contact'

    if (!credentialId || !itemId) {
      logger.warn(`[${requestId}] Missing required parameters`, { credentialId, itemId })
      return NextResponse.json({ error: 'Credential ID and Item ID are required' }, { status: 400 })
    }

    // Validate item type - only handle contacts now
    if (type !== 'contact') {
      logger.warn(`[${requestId}] Invalid item type: ${type}`)
      return NextResponse.json(
        { error: 'Invalid item type. Only contact is supported.' },
        { status: 400 }
      )
    }

    // Get the credential from the database
    const credentials = await db.select().from(account).where(eq(account.id, credentialId)).limit(1)

    if (!credentials.length) {
      logger.warn(`[${requestId}] Credential not found`, { credentialId })
      return NextResponse.json({ error: 'Credential not found' }, { status: 404 })
    }

    const credential = credentials[0]

    // Check if the credential belongs to the user
    if (credential.userId !== session.user.id) {
      logger.warn(`[${requestId}] Unauthorized credential access attempt`, {
        credentialUserId: credential.userId,
        requestUserId: session.user.id,
      })
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Refresh access token if needed
    const accessToken = await refreshAccessTokenIfNeeded(credentialId, session.user.id, requestId)

    if (!accessToken) {
      logger.error(`[${requestId}] Failed to obtain valid access token`)
      return NextResponse.json({ error: 'Failed to obtain valid access token' }, { status: 401 })
    }

    // Determine the endpoint based on item type - only contacts
    const endpoints = {
      contact: 'contacts',
    }
    const endpoint = endpoints[type as keyof typeof endpoints]

    logger.info(`[${requestId}] Fetching ${type} ${itemId} from Wealthbox`)

    // Make request to Wealthbox API
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

    const data = await response.json()

    logger.info(`[${requestId}] Wealthbox API response structure`, {
      type,
      dataKeys: Object.keys(data || {}),
      hasContacts: !!data.contacts,
      totalCount: data.meta?.total_count,
    })

    // Transform the response to match our expected format
    let items: any[] = []

    if (type === 'contact') {
      // Handle single contact response - API returns contact data directly when fetching by ID
      if (data?.id) {
        // Single contact response
        const item = {
          id: data.id?.toString() || '',
          name: `${data.first_name || ''} ${data.last_name || ''}`.trim() || `Contact ${data.id}`,
          type: 'contact',
          content: data.background_info || '',
          createdAt: data.created_at,
          updatedAt: data.updated_at,
        }
        items = [item]
      } else {
        logger.warn(`[${requestId}] Unexpected contact response format`, { data })
        items = []
      }
    }

    logger.info(
      `[${requestId}] Successfully fetched ${items.length} ${type}s from Wealthbox (total: ${data.meta?.total_count || 'unknown'})`
    )

    return NextResponse.json({ item: items[0] }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching Wealthbox item`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
