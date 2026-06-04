import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import { sharepointSiteQuerySchema } from '@/lib/api/contracts/selectors/sharepoint'
import { getValidationErrorMessage } from '@/lib/api/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { validateMicrosoftGraphId } from '@/lib/core/security/input-validation'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('SharePointSiteAPI')

export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  try {
    const { searchParams } = new URL(request.url)
    const validation = sharepointSiteQuerySchema.safeParse({
      credentialId: searchParams.get('credentialId') ?? '',
      siteId: searchParams.get('siteId') ?? '',
    })
    if (!validation.success) {
      return NextResponse.json(
        { error: getValidationErrorMessage(validation.error, 'Invalid request') },
        { status: 400 }
      )
    }
    const { credentialId, siteId } = validation.data

    const siteIdValidation = validateMicrosoftGraphId(siteId, 'siteId')
    if (!siteIdValidation.isValid) {
      return NextResponse.json({ error: siteIdValidation.error }, { status: 400 })
    }

    const authz = await authorizeCredentialUse(request, { credentialId })
    if (!authz.ok || !authz.credentialOwnerUserId || !authz.resolvedCredentialId) {
      return NextResponse.json({ error: authz.error || 'Unauthorized' }, { status: 403 })
    }

    const accessToken = await refreshAccessTokenIfNeeded(
      authz.resolvedCredentialId,
      authz.credentialOwnerUserId,
      requestId
    )
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
})
