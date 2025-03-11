import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { getSession } from '@/lib/auth'
import { refreshOAuthToken } from '@/lib/oauth'
import { db } from '@/db'
import { account } from '@/db/schema'

/**
 * Get a single file from Google Drive by ID
 */
export async function GET(request: NextRequest) {
  try {
    // Get the session
    const session = await getSession()

    // Check if the user is authenticated
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'User not authenticated' }, { status: 401 })
    }

    // Get the credential ID and file ID from the query params
    const { searchParams } = new URL(request.url)
    const credentialId = searchParams.get('credentialId')
    const fileId = searchParams.get('fileId')

    if (!credentialId) {
      return NextResponse.json({ error: 'Credential ID is required' }, { status: 400 })
    }

    if (!fileId) {
      return NextResponse.json({ error: 'File ID is required' }, { status: 400 })
    }

    // Get the credential from the database
    const credentials = await db.select().from(account).where(eq(account.id, credentialId)).limit(1)

    if (!credentials.length) {
      return NextResponse.json({ error: 'Credential not found' }, { status: 404 })
    }

    const credential = credentials[0]

    // Check if the credential belongs to the user
    if (credential.userId !== session.user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Check if the access token is valid
    if (!credential.accessToken) {
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
      console.log('Access token expired, attempting to refresh...')

      try {
        // Refresh the token using the centralized utility
        const refreshedToken = await refreshOAuthToken(
          credential.providerId,
          credential.refreshToken
        )

        if (refreshedToken) {
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
        console.error('Error refreshing token:', refreshError)
        return NextResponse.json({ error: 'Failed to refresh access token' }, { status: 401 })
      }
    }

    // Handle response
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: { message: 'Unknown error' } }))
      return NextResponse.json(
        { error: error.error?.message || 'Failed to fetch file from Google Drive' },
        { status: response.status }
      )
    }

    const file = await response.json()
    return NextResponse.json({ file }, { status: 200 })
  } catch (error) {
    console.error('Error fetching file from Google Drive:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
