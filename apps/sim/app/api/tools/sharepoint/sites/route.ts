import { randomUUID } from 'crypto'
import { db } from '@sim/db'
import { account } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { validateAlphanumericId } from '@/lib/core/security/input-validation'
import { refreshAccessTokenIfNeeded, resolveOAuthAccountId } from '@/app/api/auth/oauth/utils'
import type { SharepointSite } from '@/tools/sharepoint/types'

export const dynamic = 'force-dynamic'

const logger = createLogger('SharePointSitesAPI')

/**
 * Get SharePoint sites from Microsoft Graph API
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

    const credentialIdValidation = validateAlphanumericId(credentialId, 'credentialId', 255)
    if (!credentialIdValidation.isValid) {
      logger.warn(`[${requestId}] Invalid credential ID`, { error: credentialIdValidation.error })
      return NextResponse.json({ error: credentialIdValidation.error }, { status: 400 })
    }

    const resolved = await resolveOAuthAccountId(credentialId)
    if (!resolved) {
      return NextResponse.json({ error: 'Credential not found' }, { status: 404 })
    }

    if (resolved.workspaceId) {
      const { getUserEntityPermissions } = await import('@/lib/workspaces/permissions/utils')
      const perm = await getUserEntityPermissions(
        session.user.id,
        'workspace',
        resolved.workspaceId
      )
      if (perm === null) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    const credentials = await db
      .select()
      .from(account)
      .where(eq(account.id, resolved.accountId))
      .limit(1)
    if (!credentials.length) {
      return NextResponse.json({ error: 'Credential not found' }, { status: 404 })
    }

    const accountRow = credentials[0]

    const accessToken = await refreshAccessTokenIfNeeded(
      resolved.accountId,
      accountRow.userId,
      requestId
    )
    if (!accessToken) {
      return NextResponse.json({ error: 'Failed to obtain valid access token' }, { status: 401 })
    }

    const searchQuery = query || '*'
    const url = `https://graph.microsoft.com/v1.0/sites?search=${encodeURIComponent(searchQuery)}&$select=id,name,displayName,webUrl,createdDateTime,lastModifiedDateTime&$top=50`

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: { message: 'Unknown error' } }))
      return NextResponse.json(
        { error: errorData.error?.message || 'Failed to fetch sites from SharePoint' },
        { status: response.status }
      )
    }

    const data = await response.json()
    const sites = (data.value || []).map((site: SharepointSite) => ({
      id: site.id,
      name: site.displayName || site.name,
      mimeType: 'application/vnd.microsoft.graph.site',
      webViewLink: site.webUrl,
      createdTime: site.createdDateTime,
      modifiedTime: site.lastModifiedDateTime,
    }))

    logger.info(`[${requestId}] Successfully fetched ${sites.length} SharePoint sites`)
    return NextResponse.json({ files: sites }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching sites from SharePoint`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
