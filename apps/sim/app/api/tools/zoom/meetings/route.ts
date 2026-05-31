import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { zoomMeetingsSelectorContract } from '@/lib/api/contracts/selectors'
import { parseRequest } from '@/lib/api/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

const logger = createLogger('ZoomMeetingsAPI')

export const dynamic = 'force-dynamic'

/**
 * Zoom `GET /v2/users/me/meetings` returns `next_page_token`, which is passed
 * back as `?next_page_token=` until it comes back as an empty string. `page_size`
 * max is 300. Bounded by `MAX_ZOOM_PAGES` so a runaway response can't loop forever.
 */
const ZOOM_PAGE_SIZE = 300
const MAX_ZOOM_PAGES = 50

interface ZoomMeeting {
  id: number
  topic: string
}

interface ZoomMeetingsPage {
  meetings?: ZoomMeeting[]
  next_page_token?: string
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()
  try {
    const parsed = await parseRequest(zoomMeetingsSelectorContract, request, {})
    if (!parsed.success) return parsed.response
    const { credential, workflowId } = parsed.data.body

    const authz = await authorizeCredentialUse(request, {
      credentialId: credential,
      workflowId,
    })
    if (!authz.ok || !authz.credentialOwnerUserId) {
      return NextResponse.json({ error: authz.error || 'Unauthorized' }, { status: 403 })
    }

    const accessToken = await refreshAccessTokenIfNeeded(
      credential,
      authz.credentialOwnerUserId,
      requestId
    )
    if (!accessToken) {
      logger.error('Failed to get access token', {
        credentialId: credential,
        userId: authz.credentialOwnerUserId,
      })
      return NextResponse.json(
        { error: 'Could not retrieve access token', authRequired: true },
        { status: 401 }
      )
    }

    const allMeetings: ZoomMeeting[] = []
    let nextPageToken = ''

    for (let page = 0; page < MAX_ZOOM_PAGES; page++) {
      const url = new URL('https://api.zoom.us/v2/users/me/meetings')
      url.searchParams.set('page_size', String(ZOOM_PAGE_SIZE))
      url.searchParams.set('type', 'scheduled')
      if (nextPageToken) {
        url.searchParams.set('next_page_token', nextPageToken)
      }

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        logger.error('Failed to fetch Zoom meetings', {
          status: response.status,
          error: errorData,
        })
        return NextResponse.json(
          { error: 'Failed to fetch Zoom meetings', details: errorData },
          { status: response.status }
        )
      }

      const data = (await response.json()) as ZoomMeetingsPage
      if (Array.isArray(data.meetings)) {
        allMeetings.push(...data.meetings)
      }

      nextPageToken = data.next_page_token?.trim() || ''
      if (!nextPageToken) {
        break
      }

      if (page === MAX_ZOOM_PAGES - 1) {
        logger.warn(
          'Zoom meetings pagination hit MAX_ZOOM_PAGES cap; meeting list may be incomplete',
          {
            maxPages: MAX_ZOOM_PAGES,
          }
        )
      }
    }

    const meetings = allMeetings.map((meeting) => ({
      id: String(meeting.id),
      name: meeting.topic,
    }))

    return NextResponse.json({ meetings })
  } catch (error) {
    logger.error('Error processing Zoom meetings request:', error)
    return NextResponse.json(
      { error: 'Failed to retrieve Zoom meetings', details: (error as Error).message },
      { status: 500 }
    )
  }
})
