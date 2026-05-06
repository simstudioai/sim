import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { microsoftChannelsSelectorContract } from '@/lib/api/contracts/selectors/microsoft'
import { parseRequest } from '@/lib/api/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { validateMicrosoftGraphId } from '@/lib/core/security/input-validation'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('TeamsChannelsAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const parsed = await parseRequest(microsoftChannelsSelectorContract, request, {})
    if (!parsed.success) return parsed.response
    const { credential, teamId, workflowId } = parsed.data.body

    const teamIdValidation = validateMicrosoftGraphId(teamId, 'Team ID')
    if (!teamIdValidation.isValid) {
      logger.warn('Invalid team ID provided', { teamId, error: teamIdValidation.error })
      return NextResponse.json({ error: teamIdValidation.error }, { status: 400 })
    }

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
        'TeamsChannelsAPI'
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

      const response = await fetch(
        `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(teamId)}/channels`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      )

      if (!response.ok) {
        const errorData = await response.json()
        logger.error('Microsoft Graph API error getting channels', {
          status: response.status,
          error: errorData,
          endpoint: `https://graph.microsoft.com/v1.0/teams/${teamId}/channels`,
        })

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
      const channels = data.value

      return NextResponse.json({
        channels: channels,
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
    logger.error('Error processing Channels request:', error)
    return NextResponse.json(
      {
        error: 'Failed to retrieve Microsoft Teams channels',
        details: (error as Error).message,
      },
      { status: 500 }
    )
  }
})
