import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { validateAlphanumericId } from '@/lib/core/security/input-validation'
import { generateRequestId } from '@/lib/core/utils/request'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'
export const dynamic = 'force-dynamic'

const logger = createLogger('GoogleDriveFilesAPI')

function escapeForDriveQuery(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

interface SharedDrive {
  id: string
  name: string
  kind: string
}

interface DriveFile {
  id: string
  name: string
  mimeType: string
  iconLink?: string
  webViewLink?: string
  thumbnailLink?: string
  createdTime?: string
  modifiedTime?: string
  size?: string
  owners?: any[]
  parents?: string[]
}

/**
 * Fetches shared drives the user has access to
 */
async function fetchSharedDrives(accessToken: string, requestId: string): Promise<DriveFile[]> {
  try {
    const response = await fetch(
      'https://www.googleapis.com/drive/v3/drives?pageSize=100&fields=drives(id,name)',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    )

    if (!response.ok) {
      logger.warn(`[${requestId}] Failed to fetch shared drives`, {
        status: response.status,
      })
      return []
    }

    const data = await response.json()
    const drives: SharedDrive[] = data.drives || []

    return drives.map((drive) => ({
      id: drive.id,
      name: drive.name,
      mimeType: 'application/vnd.google-apps.folder',
      iconLink: 'https://ssl.gstatic.com/docs/doclist/images/icon_11_shared_collection_list_1.png',
    }))
  } catch (error) {
    logger.error(`[${requestId}] Error fetching shared drives`, error)
    return []
  }
}

export async function GET(request: NextRequest) {
  const requestId = generateRequestId()
  logger.info(`[${requestId}] Google Drive files request received`)

  const auth = await checkSessionOrInternalAuth(request)
  if (!auth.success || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const credentialId = searchParams.get('credentialId')
    const mimeType = searchParams.get('mimeType')
    const query = searchParams.get('query') || ''
    const folderId = searchParams.get('folderId') || searchParams.get('parentId') || ''
    const workflowId = searchParams.get('workflowId') || undefined

    if (!credentialId) {
      logger.warn(`[${requestId}] Missing credential ID`)
      return NextResponse.json({ error: 'Credential ID is required' }, { status: 400 })
    }

    const authz = await authorizeCredentialUse(request, { credentialId: credentialId!, workflowId })
    if (!authz.ok || !authz.credentialOwnerUserId) {
      logger.warn(`[${requestId}] Unauthorized credential access attempt`, authz)
      return NextResponse.json({ error: authz.error || 'Unauthorized' }, { status: 403 })
    }

    const accessToken = await refreshAccessTokenIfNeeded(
      credentialId!,
      authz.credentialOwnerUserId,
      requestId
    )

    if (!accessToken) {
      return NextResponse.json({ error: 'Failed to obtain valid access token' }, { status: 401 })
    }

    if (folderId) {
      const folderIdValidation = validateAlphanumericId(folderId, 'folderId', 50)
      if (!folderIdValidation.isValid) {
        logger.warn(`[${requestId}] Invalid folderId`, { error: folderIdValidation.error })
        return NextResponse.json({ error: folderIdValidation.error }, { status: 400 })
      }
    }

    const qParts: string[] = ['trashed = false']
    if (folderId) {
      qParts.push(`'${escapeForDriveQuery(folderId)}' in parents`)
    }
    if (mimeType) {
      qParts.push(`mimeType = '${escapeForDriveQuery(mimeType)}'`)
    }
    if (query) {
      qParts.push(`name contains '${escapeForDriveQuery(query)}'`)
    }
    const q = encodeURIComponent(qParts.join(' and '))

    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${q}&corpora=allDrives&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=files(id,name,mimeType,iconLink,webViewLink,thumbnailLink,createdTime,modifiedTime,size,owners,parents)`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    )

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
    let files: DriveFile[] = data.files || []

    if (mimeType === 'application/vnd.google-apps.spreadsheet') {
      files = files.filter(
        (file: DriveFile) => file.mimeType === 'application/vnd.google-apps.spreadsheet'
      )
    } else if (mimeType === 'application/vnd.google-apps.document') {
      files = files.filter(
        (file: DriveFile) => file.mimeType === 'application/vnd.google-apps.document'
      )
    }

    const isRootFolderListing =
      !folderId && mimeType === 'application/vnd.google-apps.folder' && !query
    if (isRootFolderListing) {
      const sharedDrives = await fetchSharedDrives(accessToken, requestId)
      if (sharedDrives.length > 0) {
        logger.info(`[${requestId}] Found ${sharedDrives.length} shared drives`)
        files = [...sharedDrives, ...files]
      }
    }

    return NextResponse.json({ files }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching files from Google Drive`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
