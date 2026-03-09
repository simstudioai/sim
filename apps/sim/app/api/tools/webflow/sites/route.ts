import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { validateAlphanumericId } from '@/lib/core/security/input-validation'
import { generateRequestId } from '@/lib/core/utils/request'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

const logger = createLogger('WebflowSitesAPI')

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const requestId = generateRequestId()
    const body = await request.json()
    const { credential, workflowId, siteId } = body

    if (!credential) {
      logger.error('Missing credential in request')
      return NextResponse.json({ error: 'Credential is required' }, { status: 400 })
    }

    if (siteId) {
      const siteIdValidation = validateAlphanumericId(siteId, 'siteId')
      if (!siteIdValidation.isValid) {
        logger.error('Invalid siteId', { error: siteIdValidation.error })
        return NextResponse.json({ error: siteIdValidation.error }, { status: 400 })
      }
    }

    const authz = await authorizeCredentialUse(request as any, {
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

    const data = await response.json()

    let sites: any[]
    if (siteId) {
      sites = [data]
    } else {
      sites = data.sites || []
    }

    const formattedSites = sites.map((site: any) => ({
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
}
