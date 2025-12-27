import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { validateAlphanumericId } from '@/lib/core/security/input-validation'
import { generateRequestId } from '@/lib/core/utils/request'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

const logger = createLogger('WebflowCollectionsAPI')

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

    const siteIdValidation = validateAlphanumericId(siteId, 'siteId')
    if (!siteIdValidation.isValid) {
      logger.error('Invalid siteId', { error: siteIdValidation.error })
      return NextResponse.json({ error: siteIdValidation.error }, { status: 400 })
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

    const data = await response.json()
    const collections = data.collections || []

    const formattedCollections = collections.map((collection: any) => ({
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
}
