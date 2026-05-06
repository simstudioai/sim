import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { airtableBasesSelectorContract } from '@/lib/api/contracts/selectors'
import { parseRequest } from '@/lib/api/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

const logger = createLogger('AirtableBasesAPI')

export const dynamic = 'force-dynamic'

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()
  try {
    const parsed = await parseRequest(airtableBasesSelectorContract, request, {})
    if (!parsed.success) {
      logger.error('Missing credential in request')
      return parsed.response
    }
    const { credential, workflowId } = parsed.data.body

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
        { error: 'Could not retrieve access token', authRequired: true },
        { status: 401 }
      )
    }

    const response = await fetch('https://api.airtable.com/v0/meta/bases', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      logger.error('Failed to fetch Airtable bases', {
        status: response.status,
        error: errorData,
      })
      return NextResponse.json(
        { error: 'Failed to fetch Airtable bases', details: errorData },
        { status: response.status }
      )
    }

    const data = await response.json()
    const bases = (data.bases || []).map((base: { id: string; name: string }) => ({
      id: base.id,
      name: base.name,
    }))

    return NextResponse.json({ bases })
  } catch (error) {
    logger.error('Error processing Airtable bases request:', error)
    return NextResponse.json(
      { error: 'Failed to retrieve Airtable bases', details: (error as Error).message },
      { status: 500 }
    )
  }
})
