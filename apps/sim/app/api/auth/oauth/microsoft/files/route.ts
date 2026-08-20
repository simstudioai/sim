import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { account } from '@/db/schema'
import { refreshAccessTokenIfNeeded } from '../../utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('MicrosoftFilesAPI')

/**
 * Get Excel files from Microsoft OneDrive
 */
export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8) // Generate a short request ID for correlation

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

    // Refresh access token if needed using the utility function
    const accessToken = await refreshAccessTokenIfNeeded(credentialId, session.user.id, requestId)

    if (!accessToken) {
      return NextResponse.json({ error: 'Failed to obtain valid access token' }, { status: 401 })
    }

    // Build search query for Excel files
    let searchQuery = '.xlsx'
    if (query) {
      searchQuery = `${query} .xlsx`
    }

    // Build the query parameters for Microsoft Graph API
    const searchParams_new = new URLSearchParams()
    searchParams_new.append(
      '$select',
      'id,name,mimeType,webUrl,thumbnails,createdDateTime,lastModifiedDateTime,size,createdBy'
    )
    searchParams_new.append('$top', '50')

    const response = await fetch(
      `https://graph.microsoft.com/v1.0/me/drive/root/search(q='${encodeURIComponent(searchQuery)}')?${searchParams_new.toString()}`,
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
        error: errorData.error?.message || 'Failed to fetch Excel files from Microsoft OneDrive',
      })
      return NextResponse.json(
        {
          error: errorData.error?.message || 'Failed to fetch Excel files from Microsoft OneDrive',
        },
        { status: response.status }
      )
    }

    const data = await response.json()
    let files = data.value || []

    // Transform Microsoft Graph response to match expected format and filter for Excel files
    files = files
      .filter(
        (file: any) =>
          file.name?.toLowerCase().endsWith('.xlsx') ||
          file.mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      )
      .map((file: any) => ({
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
      }))

    return NextResponse.json({ files }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching Excel files from Microsoft OneDrive`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
