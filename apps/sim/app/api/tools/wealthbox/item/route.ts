import { db } from '@sim/db'
import { account } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { validateEnum, validatePathSegment } from '@/lib/security/input-validation'
import { generateRequestId } from '@/lib/utils'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('WealthboxItemAPI')

export async function GET(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const session = await getSession()

    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthenticated request rejected`)
      return NextResponse.json({ error: 'User not authenticated' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const credentialId = searchParams.get('credentialId')
    const itemId = searchParams.get('itemId')
    const type = searchParams.get('type') || 'note'

    if (!credentialId || !itemId) {
      logger.warn(`[${requestId}] Missing required parameters`, { credentialId, itemId })
      return NextResponse.json({ error: 'Credential ID and Item ID are required' }, { status: 400 })
    }

    const ALLOWED_TYPES = ['note', 'contact', 'task'] as const
    const typeValidation = validateEnum(type, ALLOWED_TYPES, 'type')
    if (!typeValidation.isValid) {
      logger.warn(`[${requestId}] Invalid item type: ${type}`)
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
      logger.warn(`[${requestId}] Invalid itemId format: ${itemId}`)
      return NextResponse.json({ error: itemIdValidation.error }, { status: 400 })
    }

    const credentialIdValidation = validatePathSegment(credentialId, {
      paramName: 'credentialId',
      maxLength: 100,
      allowHyphens: true,
      allowUnderscores: true,
      allowDots: false,
    })
    if (!credentialIdValidation.isValid) {
      logger.warn(`[${requestId}] Invalid credentialId format: ${credentialId}`)
      return NextResponse.json({ error: credentialIdValidation.error }, { status: 400 })
    }

    const credentials = await db.select().from(account).where(eq(account.id, credentialId)).limit(1)

    if (!credentials.length) {
      logger.warn(`[${requestId}] Credential not found`, { credentialId })
      return NextResponse.json({ error: 'Credential not found' }, { status: 404 })
    }

    const credential = credentials[0]

    if (credential.userId !== session.user.id) {
      logger.warn(`[${requestId}] Unauthorized credential access attempt`, {
        credentialUserId: credential.userId,
        requestUserId: session.user.id,
      })
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const accessToken = await refreshAccessTokenIfNeeded(credentialId, session.user.id, requestId)

    if (!accessToken) {
      logger.error(`[${requestId}] Failed to obtain valid access token`)
      return NextResponse.json({ error: 'Failed to obtain valid access token' }, { status: 401 })
    }

    const endpoints = {
      note: 'notes',
      contact: 'contacts',
      task: 'tasks',
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

    const data = await response.json()

    const item = {
      id: data.id?.toString() || itemId,
      name:
        data.content || data.name || `${data.first_name} ${data.last_name}` || `${type} ${data.id}`,
      type,
      content: data.content || '',
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    }

    logger.info(`[${requestId}] Successfully fetched ${type} ${itemId} from Wealthbox`)

    return NextResponse.json({ item }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching Wealthbox item`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
