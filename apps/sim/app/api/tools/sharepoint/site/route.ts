import { randomUUID } from 'crypto'
import { db } from '@sim/db'
import { account } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { validateMicrosoftGraphId } from '@/lib/security/input-validation'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('SharePointSiteAPI')

export async function GET(request: NextRequest) {
  const requestId = randomUUID().slice(0, 8)

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'User not authenticated' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const credentialId = searchParams.get('credentialId')
    const siteId = searchParams.get('siteId')

    if (!credentialId || !siteId) {
      return NextResponse.json({ error: 'Credential ID and Site ID are required' }, { status: 400 })
    }

    const siteIdValidation = validateMicrosoftGraphId(siteId, 'siteId')
    if (!siteIdValidation.isValid) {
      return NextResponse.json({ error: siteIdValidation.error }, { status: 400 })
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

    let endpoint: string
    if (siteId === 'root') {
      endpoint = 'sites/root'
    } else if (siteId.includes(':')) {
      endpoint = `sites/${siteId}`
    } else if (siteId.includes('groups/')) {
      endpoint = siteId
    } else {
      endpoint = `sites/${siteId}`
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

    const transformedSite = {
      id: site.id,
      name: site.displayName || site.name,
      mimeType: 'application/vnd.microsoft.graph.site',
      webViewLink: site.webUrl,
      createdTime: site.createdDateTime,
      modifiedTime: site.lastModifiedDateTime,
    }

    logger.info(`[${requestId}] Successfully fetched SharePoint site: ${transformedSite.name}`)
    return NextResponse.json({ site: transformedSite }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching site from SharePoint`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
