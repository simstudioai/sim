import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'
import { db } from '@/db'
import { account } from '@/db/schema'

export const dynamic = 'force-dynamic'

const logger = createLogger('MicrosoftFileAPI')

/**
 * Get a single file from Microsoft OneDrive
 */
export async function GET(request: NextRequest) {
  const requestId = generateRequestId()
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

    if (!credentialId || !fileId) {
      return NextResponse.json({ error: 'Credential ID and File ID are required' }, { status: 400 })
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

    // Refresh access token if needed using the utility function
    const accessToken = await refreshAccessTokenIfNeeded(credentialId, session.user.id, requestId)

    if (!accessToken) {
      return NextResponse.json({ error: 'Failed to obtain valid access token' }, { status: 401 })
    }

    const response = await fetch(
      `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}?$select=id,name,mimeType,webUrl,thumbnails,createdDateTime,lastModifiedDateTime,size,createdBy`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    )

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: { message: 'Unknown error' } }))
      logger.error(`[${requestId}] Microsoft Graph API error`, {
        status: response.status,
        error: errorData.error?.message || 'Failed to fetch file from Microsoft OneDrive',
      })
      return NextResponse.json(
        {
          error: errorData.error?.message || 'Failed to fetch file from Microsoft OneDrive',
        },
        { status: response.status }
      )
    }

    const file = await response.json()

    // Transform the response to match expected format
    const transformedFile = {
      id: file.id,
      name: file.name,
      mimeType:
        file.mimeType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      iconLink: file.thumbnails?.[0]?.small?.url,
      webViewLink: file.webUrl,
      thumbnailLink: file.thumbnails?.[0]?.medium?.url,
      createdTime: file.createdDateTime,
      modifiedTime: file.lastModifiedDateTime,
      size: file.size?.toString(),
      owners: file.createdBy
        ? [
            {
              displayName: file.createdBy.user?.displayName || 'Unknown',
              emailAddress: file.createdBy.user?.email || '',
            },
          ]
        : [],
      downloadUrl: `https://graph.microsoft.com/v1.0/me/drive/items/${file.id}/content`,
    }

    return NextResponse.json({ file: transformedFile }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching file from Microsoft OneDrive`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
