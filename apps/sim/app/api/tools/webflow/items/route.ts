import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { validateAlphanumericId } from '@/lib/core/security/input-validation'
import { generateRequestId } from '@/lib/core/utils/request'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

const logger = createLogger('WebflowItemsAPI')

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const requestId = generateRequestId()
    const body = await request.json()
    const { credential, workflowId, collectionId, search } = body

    if (!credential) {
      logger.error('Missing credential in request')
      return NextResponse.json({ error: 'Credential is required' }, { status: 400 })
    }

    const collectionIdValidation = validateAlphanumericId(collectionId, 'collectionId')
    if (!collectionIdValidation.isValid) {
      logger.error('Invalid collectionId', { error: collectionIdValidation.error })
      return NextResponse.json({ error: collectionIdValidation.error }, { status: 400 })
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

    const response = await fetch(
      `https://api.webflow.com/v2/collections/${collectionId}/items?limit=100`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          accept: 'application/json',
        },
      }
    )

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      logger.error('Failed to fetch Webflow items', {
        status: response.status,
        error: errorData,
        collectionId,
      })
      return NextResponse.json(
        { error: 'Failed to fetch Webflow items', details: errorData },
        { status: response.status }
      )
    }

    const data = await response.json()
    const items = data.items || []

    let formattedItems = items.map((item: any) => {
      const fieldData = item.fieldData || {}
      const name = fieldData.name || fieldData.title || fieldData.slug || item.id
      return {
        id: item.id,
        name,
      }
    })

    if (search) {
      const searchLower = search.toLowerCase()
      formattedItems = formattedItems.filter((item: { id: string; name: string }) =>
        item.name.toLowerCase().includes(searchLower)
      )
    }

    return NextResponse.json({ items: formattedItems })
  } catch (error) {
    logger.error('Error processing Webflow items request:', error)
    return NextResponse.json(
      { error: 'Failed to retrieve Webflow items', details: (error as Error).message },
      { status: 500 }
    )
  }
}
