import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { attioObjectsSelectorContract } from '@/lib/api/contracts/selectors/attio'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

const logger = createLogger('AttioObjectsAPI')

export const dynamic = 'force-dynamic'

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()
  try {
    const parsed = await parseRequest(
      attioObjectsSelectorContract,
      request,
      {},
      {
        validationErrorResponse: (error) => {
          logger.error('Missing credential in request')
          return NextResponse.json(
            { error: getValidationErrorMessage(error, 'Invalid request') },
            { status: 400 }
          )
        },
      }
    )
    if (!parsed.success) return parsed.response

    const { credential, workflowId } = parsed.data.body

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
        { error: 'Could not retrieve access token', authRequired: true },
        { status: 401 }
      )
    }

    const response = await fetch('https://api.attio.com/v2/objects', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      logger.error('Failed to fetch Attio objects', {
        status: response.status,
        error: errorData,
      })
      return NextResponse.json(
        { error: 'Failed to fetch Attio objects', details: errorData },
        { status: response.status }
      )
    }

    const data = await response.json()
    const objects = (data.data || []).map((obj: { api_slug: string; singular_noun: string }) => ({
      id: obj.api_slug,
      name: obj.singular_noun,
    }))

    return NextResponse.json({ objects })
  } catch (error) {
    logger.error('Error processing Attio objects request:', error)
    return NextResponse.json(
      { error: 'Failed to retrieve Attio objects', details: (error as Error).message },
      { status: 500 }
    )
  }
})
