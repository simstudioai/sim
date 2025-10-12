import { db } from '@sim/db'
import { account } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'
export const dynamic = 'force-dynamic'

const logger = createLogger('GmailLabelsAPI')

interface GmailLabel {
  id: string
  name: string
  type: 'system' | 'user'
  messagesTotal?: number
  messagesUnread?: number
}

export async function GET(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const session = await getSession()

    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthenticated labels request rejected`)
      return NextResponse.json({ error: 'User not authenticated' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const credentialId = searchParams.get('credentialId')
    const query = searchParams.get('query')

    if (!credentialId) {
      logger.warn(`[${requestId}] Missing credentialId parameter`)
      return NextResponse.json({ error: 'Credential ID is required' }, { status: 400 })
    }

    let credentials = await db
      .select()
      .from(account)
      .where(and(eq(account.id, credentialId), eq(account.userId, session.user.id)))
      .limit(1)

    if (!credentials.length) {
      credentials = await db.select().from(account).where(eq(account.id, credentialId)).limit(1)
      if (!credentials.length) {
        logger.warn(`[${requestId}] Credential not found`)
        return NextResponse.json({ error: 'Credential not found' }, { status: 404 })
      }
    }

    const credential = credentials[0]

    logger.info(
      `[${requestId}] Using credential: ${credential.id}, provider: ${credential.providerId}`
    )

    const accessToken = await refreshAccessTokenIfNeeded(credentialId, credential.userId, requestId)

    if (!accessToken) {
      return NextResponse.json({ error: 'Failed to obtain valid access token' }, { status: 401 })
    }

    const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/labels', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    logger.info(`[${requestId}] Gmail API response status: ${response.status}`)

    if (!response.ok) {
      const errorText = await response.text()
      logger.error(`[${requestId}] Gmail API error response: ${errorText}`)

      try {
        const error = JSON.parse(errorText)
        return NextResponse.json({ error }, { status: response.status })
      } catch (_e) {
        return NextResponse.json({ error: errorText }, { status: response.status })
      }
    }

    const data = await response.json()
    if (!Array.isArray(data.labels)) {
      logger.error(`[${requestId}] Unexpected labels response structure:`, data)
      return NextResponse.json({ error: 'Invalid labels response' }, { status: 500 })
    }

    const labels = data.labels.map((label: GmailLabel) => {
      let formattedName = label.name

      if (label.type === 'system') {
        formattedName = label.name.charAt(0).toUpperCase() + label.name.slice(1).toLowerCase()
      }

      return {
        id: label.id,
        name: formattedName,
        type: label.type,
        messagesTotal: label.messagesTotal || 0,
        messagesUnread: label.messagesUnread || 0,
      }
    })

    const filteredLabels = query
      ? labels.filter((label: GmailLabel) =>
          label.name.toLowerCase().includes((query as string).toLowerCase())
        )
      : labels

    return NextResponse.json({ labels: filteredLabels }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching Gmail labels:`, error)
    return NextResponse.json({ error: 'Failed to fetch Gmail labels' }, { status: 500 })
  }
}
