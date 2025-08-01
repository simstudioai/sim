import crypto from 'node:crypto'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'
import { db } from '@/db'
import { account } from '@/db/schema'

export const dynamic = 'force-dynamic'

const logger = createLogger('SharePointSiteAPI')

/**
 * Get a single SharePoint site from Microsoft Graph API
 */
export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'User not authenticated' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const credentialId = searchParams.get('credentialId')
    const fileId = searchParams.get('fileId') // This will be the site ID

    if (!credentialId || !fileId) {
      return NextResponse.json({ error: 'Credential ID and Site ID are required' }, { status: 400 })
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

    // Handle different ways to access SharePoint sites:
    // 1. Site ID: sites/{site-id}
    // 2. Root site: sites/root
    // 3. Hostname: sites/{hostname}
    // 4. Server-relative URL: sites/{hostname}:/{server-relative-path}
    // 5. Group team site: groups/{group-id}/sites/root

    let endpoint: string
    if (fileId === 'root') {
      endpoint = 'sites/root'
    } else if (fileId.includes(':')) {
      // Server-relative URL format
      endpoint = `sites/${fileId}`
    } else if (fileId.includes('groups/')) {
      // Group team site format
      endpoint = fileId
    } else {
      // Standard site ID or hostname
      endpoint = `sites/${fileId}`
    }

    const response = await fetch(
      `https://graph.microsoft.com/v1.0/${endpoint}?$select=id,name,displayName,webUrl,createdDateTime,lastModifiedDateTime`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    )

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: { message: 'Unknown error' } }))
      return NextResponse.json(
        { error: errorData.error?.message || 'Failed to fetch site from SharePoint' },
        { status: response.status }
      )
    }

    const site = await response.json()

    // Transform the response to match expected format
    const transformedSite = {
      id: site.id,
      name: site.displayName || site.name,
      mimeType: 'application/vnd.microsoft.graph.site',
      webViewLink: site.webUrl,
      createdTime: site.createdDateTime,
      modifiedTime: site.lastModifiedDateTime,
    }

    logger.info(`[${requestId}] Successfully fetched SharePoint site: ${transformedSite.name}`)
    return NextResponse.json({ file: transformedSite }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching site from SharePoint`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
