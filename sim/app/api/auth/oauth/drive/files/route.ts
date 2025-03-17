import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { refreshOAuthToken } from '@/lib/oauth'
import { db } from '@/db'
import { account } from '@/db/schema'

const logger = createLogger('GoogleDriveFilesAPI')

/**
 * Get files from Google Drive
 */
export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8) // Generate a short request ID for correlation
  logger.info(`[${requestId}] Google Drive files request received`)

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
    const mimeType = searchParams.get('mimeType')
    const query = searchParams.get('query') || ''

    if (!credentialId) {
      logger.warn(`[${requestId}] Missing credential ID`)
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

    // Check if the access token is valid
    if (!credential.accessToken) {
      logger.warn(`[${requestId}] No access token available for credential`, {
        credentialId,
      })
      return NextResponse.json({ error: 'No access token available' }, { status: 400 })
    }

    // Build the query parameters for Google Drive API
    let queryParams = 'trashed=false'

    // Add mimeType filter if provided
    if (mimeType) {
      // For Google Drive API, we need to use 'q' parameter for mimeType filtering
      // Instead of using the mimeType parameter directly, we'll add it to the query
      if (queryParams.includes('q=')) {
        queryParams += ` and mimeType='${mimeType}'`
      } else {
        queryParams += `&q=mimeType='${mimeType}'`
      }
    }

    // Add search query if provided
    if (query) {
      if (queryParams.includes('q=')) {
        queryParams += ` and name contains '${query}'`
      } else {
        queryParams += `&q=name contains '${query}'`
      }
    }

    // Function to fetch files with a given token
    const fetchFilesWithToken = async (token: string) => {
      const response = await fetch(
        `https://www.googleapis.com/drive/v3/files?${queryParams}&fields=files(id,name,mimeType,iconLink,webViewLink,thumbnailLink,createdTime,modifiedTime,size,owners)`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      )
      return response
    }

    // First attempt with current token
    let response = await fetchFilesWithToken(credential.accessToken)

    // If unauthorized, try to refresh the token
    if (response.status === 401 && credential.refreshToken) {
      logger.info(`[${requestId}] Access token expired, attempting to refresh`)

      try {
        // Refresh the token using the centralized utility
        const refreshedToken = await refreshOAuthToken(
          credential.providerId,
          credential.refreshToken
        )

        if (refreshedToken) {
          logger.info(`[${requestId}] Token refreshed successfully`)

          // Update the token in the database
          await db
            .update(account)
            .set({
              accessToken: refreshedToken,
              accessTokenExpiresAt: new Date(Date.now() + 3600 * 1000), // Default 1 hour expiry
              updatedAt: new Date(),
            })
            .where(eq(account.id, credentialId))

          // Retry the request with the new token
          response = await fetchFilesWithToken(refreshedToken)
        }
      } catch (refreshError) {
        logger.error(`[${requestId}] Error refreshing token`, refreshError)
        return NextResponse.json({ error: 'Failed to refresh access token' }, { status: 401 })
      }
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: { message: 'Unknown error' } }))
      logger.error(`[${requestId}] Google Drive API error`, {
        status: response.status,
        error: error.error?.message || 'Failed to fetch files from Google Drive',
      })
      return NextResponse.json(
        {
          error: error.error?.message || 'Failed to fetch files from Google Drive',
        },
        { status: response.status }
      )
    }

    const data = await response.json()
    let files = data.files || []

    if (mimeType === 'application/vnd.google-apps.spreadsheet') {
      files = files.filter(
        (file: any) => file.mimeType === 'application/vnd.google-apps.spreadsheet'
      )
    } else if (mimeType === 'application/vnd.google-apps.document') {
      files = files.filter((file: any) => file.mimeType === 'application/vnd.google-apps.document')
    }

    return NextResponse.json({ files }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching files from Google Drive`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
