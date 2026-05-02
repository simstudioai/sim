import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { webflowCollectionsSelectorContract } from '@/lib/api/contracts/selectors'
import { parseRequest } from '@/lib/api/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { validateAlphanumericId } from '@/lib/core/security/input-validation'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

const logger = createLogger('WebflowCollectionsAPI')

export const dynamic = 'force-dynamic'

interface WebflowCollection {
  id: string
  displayName?: string
  slug?: string
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const requestId = generateRequestId()
    const parsed = await parseRequest(webflowCollectionsSelectorContract, request, {})
    if (!parsed.success) return parsed.response
    const { credential, workflowId, siteId } = parsed.data.body

    const siteIdValidation = validateAlphanumericId(siteId, 'siteId')
    if (!siteIdValidation.isValid) {
      logger.error('Invalid siteId', { error: siteIdValidation.error })
      return NextResponse.json({ error: siteIdValidation.error }, { status: 400 })
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

    const response = await fetch(`https://api.webflow.com/v2/sites/${siteId}/collections`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        accept: 'application/json',
      },
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      logger.error('Failed to fetch Webflow collections', {
        status: response.status,
        error: errorData,
        siteId,
      })
      return NextResponse.json(
        { error: 'Failed to fetch Webflow collections', details: errorData },
        { status: response.status }
      )
    }

    const data = (await response.json()) as { collections?: WebflowCollection[] }
    const collections = data.collections || []

    const formattedCollections = collections.map((collection) => ({
      id: collection.id,
      name: collection.displayName || collection.slug || collection.id,
    }))

    return NextResponse.json({ collections: formattedCollections })
  } catch (error) {
    logger.error('Error processing Webflow collections request:', error)
    return NextResponse.json(
      { error: 'Failed to retrieve Webflow collections', details: (error as Error).message },
      { status: 500 }
    )
  }
})
