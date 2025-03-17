import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { refreshOAuthToken } from '@/lib/oauth'
import { db } from '@/db'
import { account } from '@/db/schema'

const logger = createLogger('GoogleDriveFileAPI')

/**
 * Get a single file from Google Drive by ID
 */
export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8) // Short request ID for correlation

  try {
    // Get the session
    const session = await getSession()

    // Check if the user is authenticated
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthenticated request rejected`)
      return NextResponse.json({ error: 'User not authenticated' }, { status: 401 })
    }

    // Get the credential ID and file ID from the query params
    const { searchParams } = new URL(request.url)
    const credentialId = searchParams.get('credentialId')
    const fileId = searchParams.get('fileId')

    if (!credentialId || !fileId) {
      logger.warn(`[${requestId}] Missing required parameters`, {
        credentialId: !!credentialId,
        fileId: !!fileId,
      })
      return NextResponse.json(
        {
          error: !credentialId ? 'Credential ID is required' : 'File ID is required',
        },
        { status: 400 }
      )
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
      logger.warn(`[${requestId}] Unauthorized credential access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Check if the access token is valid
    if (!credential.accessToken) {
      logger.warn(`[${requestId}] No access token available for credential`)
      return NextResponse.json({ error: 'No access token available' }, { status: 400 })
    }

    // Function to fetch file with a given token
    const fetchFileWithToken = async (token: string) => {
      const response = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,iconLink,webViewLink,thumbnailLink,createdTime,modifiedTime,size,owners`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      )
      return response
    }

    // First attempt with current token
    let response = await fetchFileWithToken(credential.accessToken)

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
          response = await fetchFileWithToken(refreshedToken)
        }
      } catch (refreshError) {
        logger.error(`[${requestId}] Error refreshing token`, refreshError)
        return NextResponse.json({ error: 'Failed to refresh access token' }, { status: 401 })
      }
    }

    // Handle response
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: { message: 'Unknown error' } }))
      logger.error(`[${requestId}] Google Drive API error`, {
        status: response.status,
        fileId,
      })
      return NextResponse.json(
        {
          error: error.error?.message || 'Failed to fetch file from Google Drive',
        },
        { status: response.status }
      )
    }

    const file = await response.json()
    logger.info(`[${requestId}] Successfully retrieved file from Google Drive`, { fileId })
    return NextResponse.json({ file }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching file from Google Drive`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
