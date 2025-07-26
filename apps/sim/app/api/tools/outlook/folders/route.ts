import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('OutlookFoldersAPI')

interface OutlookFolder {
  id: string
  displayName: string
  totalItemCount?: number
  unreadItemCount?: number
}

export async function GET(request: Request) {
  try {
    const session = await getSession()
    const { searchParams } = new URL(request.url)
    const credentialId = searchParams.get('credentialId')

    if (!credentialId) {
      logger.error('Missing credentialId in request')
      return NextResponse.json({ error: 'Credential ID is required' }, { status: 400 })
    }

    try {
      // Get the userId from the session
      const userId = session?.user?.id || ''

      if (!userId) {
        logger.error('No user ID found in session')
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
      }

      const accessToken = await refreshAccessTokenIfNeeded(
        credentialId,
        userId,
        crypto.randomUUID().slice(0, 8)
      )

      if (!accessToken) {
        logger.error('Failed to get access token', { credentialId, userId })
        return NextResponse.json(
          {
            error: 'Could not retrieve access token',
            authRequired: true,
          },
          { status: 401 }
        )
      }

      const response = await fetch('https://graph.microsoft.com/v1.0/me/mailFolders', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        const errorData = await response.json()
        logger.error('Microsoft Graph API error getting folders', {
          status: response.status,
          error: errorData,
          endpoint: 'https://graph.microsoft.com/v1.0/me/mailFolders',
        })

        // Check for auth errors specifically
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
      const folders = data.value || []

      // Transform folders to match the expected format
      const transformedFolders = folders.map((folder: OutlookFolder) => ({
        id: folder.id,
        name: folder.displayName,
        type: 'folder',
        messagesTotal: folder.totalItemCount || 0,
        messagesUnread: folder.unreadItemCount || 0,
      }))

      return NextResponse.json({
        folders: transformedFolders,
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
    logger.error('Error processing Outlook folders request:', error)
    return NextResponse.json(
      {
        error: 'Failed to retrieve Outlook folders',
        details: (error as Error).message,
      },
      { status: 500 }
    )
  }
}
