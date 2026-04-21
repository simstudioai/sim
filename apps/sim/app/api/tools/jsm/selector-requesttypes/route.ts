import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { validateAlphanumericId, validateJiraCloudId } from '@/lib/core/security/input-validation'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'
import { getJiraCloudId, parseAtlassianErrorMessage } from '@/tools/jira/utils'
import { getJsmApiBaseUrl, getJsmHeaders } from '@/tools/jsm/utils'

const logger = createLogger('JsmSelectorRequestTypesAPI')

export const dynamic = 'force-dynamic'

export const POST = withRouteHandler(async (request: Request) => {
  const requestId = generateRequestId()
  try {
    const body = await request.json()
    const { credential, workflowId, domain, serviceDeskId } = body

    if (!credential) {
      logger.error('Missing credential in request')
      return NextResponse.json({ error: 'Credential is required' }, { status: 400 })
    }

    if (!domain) {
      return NextResponse.json({ error: 'Domain is required' }, { status: 400 })
    }

    if (!serviceDeskId) {
      return NextResponse.json({ error: 'Service Desk ID is required' }, { status: 400 })
    }

    const serviceDeskIdValidation = validateAlphanumericId(serviceDeskId, 'serviceDeskId')
    if (!serviceDeskIdValidation.isValid) {
      return NextResponse.json({ error: serviceDeskIdValidation.error }, { status: 400 })
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
        { error: 'Could not retrieve access token', authRequired: true },
        { status: 401 }
      )
    }

    const cloudId = await getJiraCloudId(domain, accessToken)

    const cloudIdValidation = validateJiraCloudId(cloudId, 'cloudId')
    if (!cloudIdValidation.isValid) {
      return NextResponse.json({ error: cloudIdValidation.error }, { status: 400 })
    }

    const baseUrl = getJsmApiBaseUrl(cloudIdValidation.sanitized!)
    const url = `${baseUrl}/servicedesk/${serviceDeskIdValidation.sanitized}/requesttype?limit=100`

    const response = await fetch(url, {
      method: 'GET',
      headers: getJsmHeaders(accessToken),
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error('JSM API error:', {
        status: response.status,
        statusText: response.statusText,
        error: errorText,
      })
      return NextResponse.json(
        { error: parseAtlassianErrorMessage(response.status, response.statusText, errorText) },
        { status: response.status }
      )
    }

    const data = await response.json()
    const requestTypes = (data.values || []).map((rt: { id: string; name: string }) => ({
      id: rt.id,
      name: rt.name,
    }))

    return NextResponse.json({ requestTypes })
  } catch (error) {
    logger.error('Error listing JSM request types:', error)
    return NextResponse.json(
      { error: (error as Error).message || 'Internal server error' },
      { status: 500 }
    )
  }
})
