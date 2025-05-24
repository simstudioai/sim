import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { account } from '@/db/schema'
import { refreshAccessTokenIfNeeded } from '../../utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('GoogleDriveFileAPI')

/**
 * Get a single file from Google Drive
 */
export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8) // Generate a short request ID for correlation
  logger.info(`[${requestId}] Google Drive file request received`)

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
      logger.warn(`[${requestId}] Missing required parameters`)
      return NextResponse.json({ error: 'Credential ID and File ID are required' }, { status: 400 })
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

    // Fetch the file from Google Drive API
    logger.info(`[${requestId}] Fetching file ${fileId} from Google Drive API`)
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,iconLink,webViewLink,thumbnailLink,createdTime,modifiedTime,size,owners,exportLinks`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    )

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: { message: 'Unknown error' } }))
      logger.error(`[${requestId}] Google Drive API error`, {
        status: response.status,
        error: errorData.error?.message || 'Failed to fetch file from Google Drive',
      })
      return NextResponse.json(
        {
          error: errorData.error?.message || 'Failed to fetch file from Google Drive',
        },
        { status: response.status }
      )
    }

    const file = await response.json()

    // In case of Google Docs, Sheets, etc., provide the export links
    const exportFormats: { [key: string]: string } = {
      'application/vnd.google-apps.document': 'application/pdf', // Google Docs to PDF
      'application/vnd.google-apps.spreadsheet':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // Google Sheets to XLSX
      'application/vnd.google-apps.presentation': 'application/pdf', // Google Slides to PDF
    }

    // If the file is a Google Docs, Sheets, or Slides file, we need to provide the export link
    if (file.mimeType.startsWith('application/vnd.google-apps.')) {
      const format = exportFormats[file.mimeType] || 'application/pdf'
      if (!file.exportLinks) {
        // If export links are not available in the response, try to construct one
        file.downloadUrl = `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=${encodeURIComponent(
          format
        )}`
      } else {
        // Use the export link from the response if available
        file.downloadUrl = file.exportLinks[format]
      }
    } else {
      // For regular files, use the download link
      file.downloadUrl = `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`
    }

    return NextResponse.json({ file }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching file from Google Drive`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
