import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { googleCalendarSelectorContract } from '@/lib/api/contracts/selectors/google'
import { parseRequest } from '@/lib/api/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { drainGooglePagedList, GooglePageError } from '@/lib/oauth/google-pagination'
import { getScopesForService } from '@/lib/oauth/utils'
import { refreshAccessTokenIfNeeded, ServiceAccountTokenError } from '@/app/api/auth/oauth/utils'
export const dynamic = 'force-dynamic'

const logger = createLogger('GoogleCalendarAPI')

const MAX_CALENDAR_PAGES = 20
const CALENDAR_PAGE_SIZE = 250

interface CalendarListItem {
  id: string
  summary: string
  description?: string
  primary?: boolean
  accessRole: string
  backgroundColor?: string
  foregroundColor?: string
}

interface CalendarListResponse {
  items?: CalendarListItem[]
  nextPageToken?: string
}

/**
 * Get calendars from Google Calendar
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()
  logger.info(`[${requestId}] Google Calendar calendars request received`)

  try {
    const parsed = await parseRequest(
      googleCalendarSelectorContract,
      request,
      {},
      {
        validationErrorResponse: () => {
          logger.warn(`[${requestId}] Missing credentialId parameter`)
          return NextResponse.json({ error: 'Credential ID is required' }, { status: 400 })
        },
      }
    )
    if (!parsed.success) return parsed.response

    const { credentialId } = parsed.data.query
    const workflowId = parsed.data.query.workflowId || undefined
    const impersonateEmail = parsed.data.query.impersonateEmail || undefined

    const authz = await authorizeCredentialUse(request, { credentialId, workflowId })
    if (!authz.ok || !authz.credentialOwnerUserId) {
      return NextResponse.json({ error: authz.error || 'Unauthorized' }, { status: 403 })
    }

    const accessToken = await refreshAccessTokenIfNeeded(
      credentialId,
      authz.credentialOwnerUserId,
      requestId,
      getScopesForService('google-calendar'),
      impersonateEmail
    )

    if (!accessToken) {
      return NextResponse.json({ error: 'Failed to obtain valid access token' }, { status: 401 })
    }

    logger.info(`[${requestId}] Fetching calendars from Google Calendar API`)

    let calendars: CalendarListItem[]
    try {
      const drained = await drainGooglePagedList<CalendarListItem, CalendarListResponse>({
        buildUrl: (pageToken) => {
          const url = new URL('https://www.googleapis.com/calendar/v3/users/me/calendarList')
          url.searchParams.set('maxResults', String(CALENDAR_PAGE_SIZE))
          if (pageToken) url.searchParams.set('pageToken', pageToken)
          return url.toString()
        },
        fetch: (url) =>
          fetch(url, {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
          }),
        parseError: (response) =>
          response
            .text()
            .then((text) => JSON.parse(text))
            .catch(() => ({ error: { message: 'Unknown error' } })),
        getItems: (body) => body.items,
        getNextPageToken: (body) => body.nextPageToken,
        maxPages: MAX_CALENDAR_PAGES,
        label: 'Google Calendar calendars',
      })
      calendars = drained.items
    } catch (error) {
      if (error instanceof GooglePageError) {
        const errorData = error.body as { error?: { message?: string } }
        logger.error(`[${requestId}] Google Calendar API error`, {
          status: error.status,
          error: errorData?.error?.message || 'Failed to fetch calendars',
        })
        return NextResponse.json(
          { error: errorData?.error?.message || 'Failed to fetch calendars' },
          { status: error.status }
        )
      }
      throw error
    }

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
    if (error instanceof ServiceAccountTokenError) {
      logger.warn(`[${requestId}] Service account token error`, { message: error.message })
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    logger.error(`[${requestId}] Error fetching Google calendars`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
