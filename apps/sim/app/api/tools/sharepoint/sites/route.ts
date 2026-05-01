import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { sharepointSitesSelectorContract } from '@/lib/api/contracts/selectors'
import { parseRequest } from '@/lib/api/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'
import type { SharepointSite } from '@/tools/sharepoint/types'

export const dynamic = 'force-dynamic'

const logger = createLogger('SharePointSitesAPI')

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const parsed = await parseRequest(sharepointSitesSelectorContract, request, {})
    if (!parsed.success) {
      logger.warn(`[${requestId}] Invalid sites request data`)
      return parsed.response
    }
    const { credential, workflowId, query } = parsed.data.body

    const authz = await authorizeCredentialUse(request, {
      credentialId: credential,
      workflowId,
    })
    if (!authz.ok || !authz.credentialOwnerUserId) {
      return NextResponse.json({ error: authz.error || 'Unauthorized' }, { status: 403 })
    }

    const accessToken = await refreshAccessTokenIfNeeded(
      credential,
      authz.credentialOwnerUserId,
      requestId
    )
    if (!accessToken) {
      logger.error(`[${requestId}] Failed to obtain valid access token`)
      return NextResponse.json(
        { error: 'Failed to obtain valid access token', authRequired: true },
        { status: 401 }
      )
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
})
