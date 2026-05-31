import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { microsoftTeamsSelectorContract } from '@/lib/api/contracts/selectors/microsoft'
import { parseRequest } from '@/lib/api/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'
import { assertGraphNextPageUrl, getGraphNextPageUrl } from '@/tools/sharepoint/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('TeamsTeamsAPI')

/**
 * Upper bound on Microsoft Graph pages drained when listing the user's joined
 * teams. The `me/joinedTeams` endpoint does not support `$top`, so paging is
 * driven entirely by the server via `@odata.nextLink`. The cap prevents an
 * unbounded loop; hitting it is logged as a warning.
 */
const MAX_TEAMS_PAGES = 20

interface GraphTeam {
  id: string
  displayName?: string
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const parsed = await parseRequest(microsoftTeamsSelectorContract, request, {})
    if (!parsed.success) return parsed.response
    const { credential, workflowId } = parsed.data.body

    try {
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
        'TeamsTeamsAPI'
      )

      if (!accessToken) {
        logger.error('Failed to get access token', {
          credentialId: credential,
          userId: authz.credentialOwnerUserId,
        })
        return NextResponse.json(
          {
            error: 'Could not retrieve access token',
            authRequired: true,
          },
          { status: 401 }
        )
      }

      const teams: GraphTeam[] = []
      let nextPageUrl: string | undefined = 'https://graph.microsoft.com/v1.0/me/joinedTeams'

      for (let page = 0; page < MAX_TEAMS_PAGES; page++) {
        const response = await fetch(nextPageUrl, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        })

        if (!response.ok) {
          const errorData = await response.json()
          logger.error('Microsoft Graph API error getting teams', {
            status: response.status,
            error: errorData,
            endpoint: nextPageUrl,
          })

          // Check for auth errors specifically
          if (response.status === 401) {
            return NextResponse.json(
              {
                error: 'Authentication failed. Please reconnect your Microsoft Teams account.',
                authRequired: true,
              },
              { status: 401 }
            )
          }

          throw new Error(`Microsoft Graph API error: ${JSON.stringify(errorData)}`)
        }

        const data = await response.json()
        if (Array.isArray(data.value)) {
          teams.push(...(data.value as GraphTeam[]))
        }

        const rawNextLink = getGraphNextPageUrl(data)
        if (!rawNextLink) {
          nextPageUrl = undefined
          break
        }
        nextPageUrl = assertGraphNextPageUrl(rawNextLink)

        if (page === MAX_TEAMS_PAGES - 1) {
          logger.warn('Hit Microsoft Graph teams pagination cap; team list may be incomplete', {
            maxPages: MAX_TEAMS_PAGES,
            collected: teams.length,
          })
        }
      }

      return NextResponse.json({
        teams: teams,
      })
    } catch (innerError) {
      logger.error('Error during API requests:', innerError)

      // Check if it's an authentication error
      const errorMessage = toError(innerError).message
      if (
        errorMessage.includes('auth') ||
        errorMessage.includes('token') ||
        errorMessage.includes('unauthorized') ||
        errorMessage.includes('unauthenticated')
      ) {
        return NextResponse.json(
          {
            error: 'Authentication failed. Please reconnect your Microsoft Teams account.',
            authRequired: true,
            details: errorMessage,
          },
          { status: 401 }
        )
      }

      throw innerError
    }
  } catch (error) {
    logger.error('Error processing Teams request:', error)
    return NextResponse.json(
      {
        error: 'Failed to retrieve Microsoft Teams teams',
        details: (error as Error).message,
      },
      { status: 500 }
    )
  }
})
