import { randomUUID } from 'crypto'
import { db } from '@sim/db'
import { account } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('OneDriveFilesAPI')

import type { MicrosoftGraphDriveItem } from '@/tools/onedrive/types'

/**
 * Get files (not folders) from Microsoft OneDrive
 */
export async function GET(request: NextRequest) {
  const requestId = randomUUID().slice(0, 8)
  logger.info(`[${requestId}] OneDrive files request received`)

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthenticated request rejected`)
      return NextResponse.json({ error: 'User not authenticated' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const credentialId = searchParams.get('credentialId')
    const query = searchParams.get('query') || ''

    if (!credentialId) {
      logger.warn(`[${requestId}] Missing credential ID`)
      return NextResponse.json({ error: 'Credential ID is required' }, { status: 400 })
    }

    logger.info(`[${requestId}] Fetching credential`, { credentialId })

    const credentials = await db.select().from(account).where(eq(account.id, credentialId)).limit(1)
    if (!credentials.length) {
      logger.warn(`[${requestId}] Credential not found`, { credentialId })
      return NextResponse.json({ error: 'Credential not found' }, { status: 404 })
    }

    const credential = credentials[0]
    if (credential.userId !== session.user.id) {
      logger.warn(`[${requestId}] Unauthorized credential access attempt`, {
        credentialUserId: credential.userId,
        requestUserId: session.user.id,
      })
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const accessToken = await refreshAccessTokenIfNeeded(credentialId, session.user.id, requestId)
    if (!accessToken) {
      logger.error(`[${requestId}] Failed to obtain valid access token`)
      return NextResponse.json({ error: 'Failed to obtain valid access token' }, { status: 401 })
    }

    // Use search endpoint if query provided, otherwise list root children
    // Microsoft Graph API doesn't support $filter on file/folder properties for /children endpoint
    let url: string
    if (query) {
      // Use search endpoint with query
      const searchParams_new = new URLSearchParams()
      searchParams_new.append(
        '$select',
        'id,name,file,webUrl,size,createdDateTime,lastModifiedDateTime,createdBy,thumbnails'
      )
      searchParams_new.append('$top', '50')
      url = `https://graph.microsoft.com/v1.0/me/drive/root/search(q='${encodeURIComponent(query)}')?${searchParams_new.toString()}`
    } else {
      // List all children (files and folders) from root
      const searchParams_new = new URLSearchParams()
      searchParams_new.append(
        '$select',
        'id,name,file,folder,webUrl,size,createdDateTime,lastModifiedDateTime,createdBy,thumbnails'
      )
      searchParams_new.append('$top', '50')
      url = `https://graph.microsoft.com/v1.0/me/drive/root/children?${searchParams_new.toString()}`
    }

    logger.info(`[${requestId}] Fetching files from Microsoft Graph`, { url })

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: { message: 'Unknown error' } }))
      logger.error(`[${requestId}] Microsoft Graph API error`, {
        status: response.status,
        error: errorData.error?.message || 'Failed to fetch files from OneDrive',
      })
      return NextResponse.json(
        { error: errorData.error?.message || 'Failed to fetch files from OneDrive' },
        { status: response.status }
      )
    }

    const data = await response.json()
    logger.info(`[${requestId}] Received ${data.value?.length || 0} items from Microsoft Graph`)

    // Log what we received to debug filtering
    const itemBreakdown = (data.value || []).reduce(
      (acc: any, item: MicrosoftGraphDriveItem) => {
        if (item.file) acc.files++
        if (item.folder) acc.folders++
        return acc
      },
      { files: 0, folders: 0 }
    )
    logger.info(`[${requestId}] Item breakdown`, itemBreakdown)

    const files = (data.value || [])
      .filter((item: MicrosoftGraphDriveItem) => {
        const isFile = !!item.file && !item.folder
        if (!isFile) {
          logger.debug(
            `[${requestId}] Filtering out item: ${item.name} (isFolder: ${!!item.folder})`
          )
        }
        return isFile
      })
      .map((file: MicrosoftGraphDriveItem) => ({
        id: file.id,
        name: file.name,
        mimeType: file.file?.mimeType || 'application/octet-stream',
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

    logger.info(
      `[${requestId}] Returning ${files.length} files (filtered from ${data.value?.length || 0} items)`
    )

    // Log the file IDs we're returning
    if (files.length > 0) {
      logger.info(`[${requestId}] File IDs being returned:`, {
        fileIds: files.slice(0, 5).map((f: any) => ({ id: f.id, name: f.name })),
      })
    }

    return NextResponse.json({ files }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching files from OneDrive`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
