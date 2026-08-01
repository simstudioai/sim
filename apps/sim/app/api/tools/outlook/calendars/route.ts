import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { outlookCalendarsSelectorContract } from '@/lib/api/contracts/selectors/microsoft'
import { parseRequest } from '@/lib/api/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { validateAlphanumericId } from '@/lib/core/security/input-validation'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'
import { assertGraphNextPageUrl, getGraphNextPageUrl } from '@/tools/sharepoint/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('OutlookCalendarsAPI')

/**
 * Microsoft Graph paginates `calendars` via the `@odata.nextLink` absolute URL in the
 * response body. Bound the drain so a pathological account can't loop unbounded.
 * @see https://learn.microsoft.com/en-us/graph/api/user-list-calendars
 */
const OUTLOOK_CALENDARS_PAGE_SIZE = 100
const MAX_OUTLOOK_CALENDARS_PAGES = 10

interface OutlookCalendar {
  id: string
  name: string
  canEdit?: boolean
  owner?: { name?: string; address?: string }
}

export const GET = withRouteHandler(async (request: NextRequest) => {
  try {
    const parsed = await parseRequest(outlookCalendarsSelectorContract, request, {})
    if (!parsed.success) return parsed.response
    const { credentialId } = parsed.data.query

    const credentialIdValidation = validateAlphanumericId(credentialId, 'credentialId')
    if (!credentialIdValidation.isValid) {
      logger.warn('Invalid credentialId format', { error: credentialIdValidation.error })
      return NextResponse.json({ error: credentialIdValidation.error }, { status: 400 })
    }

    try {
      const credAccess = await authorizeCredentialUse(request, {
        credentialId,
        requireWorkflowIdForInternal: false,
      })
      if (!credAccess.ok || !credAccess.credentialOwnerUserId) {
        logger.warn('Credential access denied', { error: credAccess.error })
        return NextResponse.json(
          { error: credAccess.error || 'Authentication required' },
          { status: 401 }
        )
      }

      const accessToken = await refreshAccessTokenIfNeeded(
        credentialId,
        credAccess.credentialOwnerUserId,
        generateRequestId()
      )

      if (!accessToken) {
        logger.error('Failed to get access token', {
          credentialId,
          userId: credAccess.credentialOwnerUserId,
        })
        return NextResponse.json(
          { error: 'Could not retrieve access token', authRequired: true },
          { status: 401 }
        )
      }

      const calendars: OutlookCalendar[] = []
      let nextUrl: string | undefined =
        `https://graph.microsoft.com/v1.0/me/calendars?$top=${OUTLOOK_CALENDARS_PAGE_SIZE}`

      for (let page = 0; page < MAX_OUTLOOK_CALENDARS_PAGES && nextUrl; page++) {
        const response = await fetch(nextUrl, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        })

        if (!response.ok) {
          const errorData = await response.json()
          logger.error('Microsoft Graph API error getting calendars', {
            status: response.status,
            error: errorData,
            endpoint: nextUrl,
          })

          if (response.status === 401) {
            return NextResponse.json(
              {
                error: 'Authentication failed. Please reconnect your Outlook account.',
                authRequired: true,
              },
              { status: 401 }
            )
          }

          throw new Error(`Microsoft Graph API error: ${JSON.stringify(errorData)}`)
        }

        const data = await response.json()
        calendars.push(...((data.value as OutlookCalendar[]) || []))

        const nextLink = getGraphNextPageUrl(data)
        nextUrl = nextLink ? assertGraphNextPageUrl(nextLink) : undefined

        if (nextUrl && page === MAX_OUTLOOK_CALENDARS_PAGES - 1) {
          logger.warn('Outlook calendars hit pagination cap; calendar list may be incomplete', {
            pages: MAX_OUTLOOK_CALENDARS_PAGES,
            collected: calendars.length,
          })
        }
      }

      return NextResponse.json({
        calendars: calendars.map((calendar) => ({
          id: calendar.id,
          name: calendar.name,
          type: 'calendar',
          canEdit: calendar.canEdit ?? false,
          ownerAddress: calendar.owner?.address ?? null,
        })),
      })
    } catch (innerError) {
      logger.error('Error during API requests:', innerError)

      const errorMessage = toError(innerError).message
      if (
        errorMessage.includes('auth') ||
        errorMessage.includes('token') ||
        errorMessage.includes('unauthorized') ||
        errorMessage.includes('unauthenticated')
      ) {
        return NextResponse.json(
          {
            error: 'Authentication failed. Please reconnect your Outlook account.',
            authRequired: true,
            details: errorMessage,
          },
          { status: 401 }
        )
      }

      throw innerError
    }
  } catch (error) {
    logger.error('Error processing Outlook calendars request:', error)
    return NextResponse.json(
      {
        error: 'Failed to retrieve Outlook calendars',
        details: toError(error).message,
      },
      { status: 500 }
    )
  }
})
