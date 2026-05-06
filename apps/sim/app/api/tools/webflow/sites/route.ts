import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { webflowSitesSelectorContract } from '@/lib/api/contracts/selectors'
import { parseRequest } from '@/lib/api/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { validateAlphanumericId } from '@/lib/core/security/input-validation'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

const logger = createLogger('WebflowSitesAPI')

export const dynamic = 'force-dynamic'

interface WebflowSite {
  id: string
  displayName?: string
  shortName?: string
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const requestId = generateRequestId()
    const parsed = await parseRequest(webflowSitesSelectorContract, request, {})
    if (!parsed.success) return parsed.response
    const { credential, workflowId, siteId } = parsed.data.body

    if (siteId) {
      const siteIdValidation = validateAlphanumericId(siteId, 'siteId')
      if (!siteIdValidation.isValid) {
        logger.error('Invalid siteId', { error: siteIdValidation.error })
        return NextResponse.json({ error: siteIdValidation.error }, { status: 400 })
      }
    }

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
      logger.error('Failed to get access token', {
        credentialId: credential,
        userId: authz.credentialOwnerUserId,
      })
      return NextResponse.json(
        {
          error: 'Could not retrieve access token',
          authRequired: true,
        },
        { status: 401 }
      )
    }

    const url = siteId
      ? `https://api.webflow.com/v2/sites/${siteId}`
      : 'https://api.webflow.com/v2/sites'

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        accept: 'application/json',
      },
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      logger.error('Failed to fetch Webflow sites', {
        status: response.status,
        error: errorData,
        siteId: siteId || 'all',
      })
      return NextResponse.json(
        { error: 'Failed to fetch Webflow sites', details: errorData },
        { status: response.status }
      )
    }

    const data = (await response.json()) as WebflowSite | { sites?: WebflowSite[] }

    let sites: WebflowSite[]
    if (siteId) {
      sites = [data as WebflowSite]
    } else {
      sites = 'sites' in data ? data.sites || [] : []
    }

    const formattedSites = sites.map((site) => ({
      id: site.id,
      name: site.displayName || site.shortName || site.id,
    }))

    return NextResponse.json({ sites: formattedSites })
  } catch (error) {
    logger.error('Error processing Webflow sites request:', error)
    return NextResponse.json(
      { error: 'Failed to retrieve Webflow sites', details: (error as Error).message },
      { status: 500 }
    )
  }
})
