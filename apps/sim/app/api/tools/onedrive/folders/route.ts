import { randomUUID } from 'crypto'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'
import { db } from '@/db'
import { account } from '@/db/schema'

export const dynamic = 'force-dynamic'

const logger = createLogger('OneDriveFoldersAPI')

import type { MicrosoftGraphDriveItem } from '@/tools/onedrive/types'

/**
 * Get folders from Microsoft OneDrive
 */
export async function GET(request: NextRequest) {
  const requestId = randomUUID().slice(0, 8)

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'User not authenticated' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const credentialId = searchParams.get('credentialId')
    const query = searchParams.get('query') || ''

    if (!credentialId) {
      return NextResponse.json({ error: 'Credential ID is required' }, { status: 400 })
    }

    const credentials = await db.select().from(account).where(eq(account.id, credentialId)).limit(1)
    if (!credentials.length) {
      return NextResponse.json({ error: 'Credential not found' }, { status: 404 })
    }

    const credential = credentials[0]
    if (credential.userId !== session.user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const accessToken = await refreshAccessTokenIfNeeded(credentialId, session.user.id, requestId)
    if (!accessToken) {
      return NextResponse.json({ error: 'Failed to obtain valid access token' }, { status: 401 })
    }

    // Build URL for OneDrive folders
    let url = `https://graph.microsoft.com/v1.0/me/drive/root/children?$filter=folder ne null&$select=id,name,folder,webUrl,createdDateTime,lastModifiedDateTime&$top=50`

    if (query) {
      url += `&$search="${encodeURIComponent(query)}"`
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: { message: 'Unknown error' } }))
      return NextResponse.json(
        { error: errorData.error?.message || 'Failed to fetch folders from OneDrive' },
        { status: response.status }
      )
    }

    const data = await response.json()
    const folders = (data.value || [])
      .filter((item: MicrosoftGraphDriveItem) => item.folder) // Only folders
      .map((folder: MicrosoftGraphDriveItem) => ({
        id: folder.id,
        name: folder.name,
        mimeType: 'application/vnd.microsoft.graph.folder',
        webViewLink: folder.webUrl,
        createdTime: folder.createdDateTime,
        modifiedTime: folder.lastModifiedDateTime,
      }))

    return NextResponse.json({ files: folders }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching folders from OneDrive`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
