import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('TeamsChannelsAPI')

export async function POST(request: Request) {
  try {
    const session = await getSession()
    const body = await request.json()

    const { credential, teamId, workflowId } = body

    if (!credential) {
      logger.error('Missing credential in request')
      return NextResponse.json({ error: 'Credential is required' }, { status: 400 })
    }

    if (!teamId) {
      logger.error('Missing team ID in request')
      return NextResponse.json({ error: 'Team ID is required' }, { status: 400 })
    }

    try {
      // Get the userId either from the session or from the workflowId
      const userId = session?.user?.id || ''

      if (!userId) {
        logger.error('No user ID found in session')
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
      }

      const accessToken = await refreshAccessTokenIfNeeded(credential, userId, workflowId)

      if (!accessToken) {
        logger.error('Failed to get access token', { credentialId: credential, userId })
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
      const channels = data.value

      return NextResponse.json({
        channels: channels,
      })
    } catch (innerError) {
      logger.error('Error during API requests:', innerError)

      // Check if it's an authentication error
      const errorMessage = innerError instanceof Error ? innerError.message : String(innerError)
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
}
