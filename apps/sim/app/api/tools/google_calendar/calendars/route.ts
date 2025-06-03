import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'
import { db } from '@/db'
import { account } from '@/db/schema'

export const dynamic = 'force-dynamic'

const logger = createLogger('GoogleCalendarAPI')

interface CalendarListItem {
  id: string
  summary: string
  description?: string
  primary?: boolean
  accessRole: string
  backgroundColor?: string
  foregroundColor?: string
}

/**
 * Get calendars from Google Calendar
 */
export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8) // Generate a short request ID for correlation
  logger.info(`[${requestId}] Google Calendar calendars request received`)

  try {
    // Get the session
    const session = await getSession()

    // Check if the user is authenticated
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthenticated request rejected`)
      return NextResponse.json({ error: 'User not authenticated' }, { status: 401 })
    }

    // Get the credential ID from the query params
    const { searchParams } = new URL(request.url)
    const credentialId = searchParams.get('credentialId')

    if (!credentialId) {
      logger.warn(`[${requestId}] Missing credentialId parameter`)
      return NextResponse.json({ error: 'Credential ID is required' }, { status: 400 })
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

    // Refresh access token if needed using the utility function
    const accessToken = await refreshAccessTokenIfNeeded(credentialId, session.user.id, requestId)

    if (!accessToken) {
      return NextResponse.json({ error: 'Failed to obtain valid access token' }, { status: 401 })
    }

    // Fetch calendars from Google Calendar API
    logger.info(`[${requestId}] Fetching calendars from Google Calendar API`)
    const calendarResponse = await fetch(
      'https://www.googleapis.com/calendar/v3/users/me/calendarList',
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    )

    if (!calendarResponse.ok) {
      const errorData = await calendarResponse
        .text()
        .then((text) => JSON.parse(text))
        .catch(() => ({ error: { message: 'Unknown error' } }))
      logger.error(`[${requestId}] Google Calendar API error`, {
        status: calendarResponse.status,
        error: errorData.error?.message || 'Failed to fetch calendars',
      })
      return NextResponse.json(
        { error: errorData.error?.message || 'Failed to fetch calendars' },
        { status: calendarResponse.status }
      )
    }

    const data = await calendarResponse.json()
    const calendars: CalendarListItem[] = data.items || []

    // Sort calendars with primary first, then alphabetically
    calendars.sort((a, b) => {
      if (a.primary && !b.primary) return -1
      if (!a.primary && b.primary) return 1
      return a.summary.localeCompare(b.summary)
    })

    logger.info(`[${requestId}] Successfully fetched ${calendars.length} calendars`)

    return NextResponse.json({
      calendars: calendars.map((calendar) => ({
        id: calendar.id,
        summary: calendar.summary,
        description: calendar.description,
        primary: calendar.primary || false,
        accessRole: calendar.accessRole,
        backgroundColor: calendar.backgroundColor,
        foregroundColor: calendar.foregroundColor,
      })),
    })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching Google calendars`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
