import { type NextRequest, NextResponse } from 'next/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'
export const dynamic = 'force-dynamic'

const logger = createLogger('GoogleDriveFileAPI')

/**
 * Get a single file from Google Drive
 */
export async function GET(request: NextRequest) {
  const requestId = generateRequestId()
  logger.info(`[${requestId}] Google Drive file request received`)

  try {
    const { searchParams } = new URL(request.url)
    const credentialId = searchParams.get('credentialId')
    const fileId = searchParams.get('fileId')
    const workflowId = searchParams.get('workflowId') || undefined

    if (!credentialId || !fileId) {
      logger.warn(`[${requestId}] Missing required parameters`)
      return NextResponse.json({ error: 'Credential ID and File ID are required' }, { status: 400 })
    }

    const authz = await authorizeCredentialUse(request, { credentialId: credentialId, workflowId })
    if (!authz.ok || !authz.credentialOwnerUserId) {
      return NextResponse.json({ error: authz.error || 'Unauthorized' }, { status: 403 })
    }

    const accessToken = await refreshAccessTokenIfNeeded(
      credentialId,
      authz.credentialOwnerUserId,
      requestId
    )

    if (!accessToken) {
      return NextResponse.json({ error: 'Failed to obtain valid access token' }, { status: 401 })
    }

    logger.info(`[${requestId}] Fetching file ${fileId} from Google Drive API`)
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,iconLink,webViewLink,thumbnailLink,createdTime,modifiedTime,size,owners,exportLinks,shortcutDetails&supportsAllDrives=true`,
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

    const exportFormats: { [key: string]: string } = {
      'application/vnd.google-apps.document': 'application/pdf', // Google Docs to PDF
      'application/vnd.google-apps.spreadsheet':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // Google Sheets to XLSX
      'application/vnd.google-apps.presentation': 'application/pdf', // Google Slides to PDF
    }

    if (
      file.mimeType === 'application/vnd.google-apps.shortcut' &&
      file.shortcutDetails?.targetId
    ) {
      const targetId = file.shortcutDetails.targetId
      const shortcutResp = await fetch(
        `https://www.googleapis.com/drive/v3/files/${targetId}?fields=id,name,mimeType,iconLink,webViewLink,thumbnailLink,createdTime,modifiedTime,size,owners,exportLinks&supportsAllDrives=true`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      )
      if (shortcutResp.ok) {
        const targetFile = await shortcutResp.json()
        file.id = targetFile.id
        file.name = targetFile.name
        file.mimeType = targetFile.mimeType
        file.iconLink = targetFile.iconLink
        file.webViewLink = targetFile.webViewLink
        file.thumbnailLink = targetFile.thumbnailLink
        file.createdTime = targetFile.createdTime
        file.modifiedTime = targetFile.modifiedTime
        file.size = targetFile.size
        file.owners = targetFile.owners
        file.exportLinks = targetFile.exportLinks
      }
    }

    if (file.mimeType.startsWith('application/vnd.google-apps.')) {
      const format = exportFormats[file.mimeType] || 'application/pdf'
      if (!file.exportLinks) {
        file.downloadUrl = `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=${encodeURIComponent(
          format
        )}`
      } else {
        file.downloadUrl = file.exportLinks[format]
      }
    } else {
      file.downloadUrl = `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`
    }

    return NextResponse.json({ file }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching file from Google Drive`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
