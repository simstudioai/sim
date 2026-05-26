import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { hubspotPipelinesSelectorContract } from '@/lib/api/contracts/selectors/hubspot'
import { parseRequest } from '@/lib/api/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { validateAlphanumericId } from '@/lib/core/security/input-validation'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('HubSpotPipelinesAPI')

const BUILT_IN_PATH: Record<string, string> = {
  contact: 'contacts',
  company: 'companies',
  deal: 'deals',
  ticket: 'tickets',
}

interface HubSpotPipeline {
  id: string
  label: string
  stages?: Array<{ id: string; label: string }>
  archived?: boolean
}

export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const parsed = await parseRequest(hubspotPipelinesSelectorContract, request, {})
    if (!parsed.success) return parsed.response
    const { credentialId, objectType } = parsed.data.query

    const credentialIdValidation = validateAlphanumericId(credentialId, 'credentialId', 255)
    if (!credentialIdValidation.isValid) {
      logger.warn(`[${requestId}] Invalid credential ID: ${credentialIdValidation.error}`)
      return NextResponse.json({ error: credentialIdValidation.error }, { status: 400 })
    }

    const authz = await authorizeCredentialUse(request, {
      credentialId,
      requireWorkflowIdForInternal: false,
    })
    if (!authz.ok || !authz.credentialOwnerUserId || !authz.resolvedCredentialId) {
      return NextResponse.json({ error: authz.error || 'Unauthorized' }, { status: 403 })
    }

    const accessToken = await refreshAccessTokenIfNeeded(
      credentialId,
      authz.credentialOwnerUserId,
      requestId
    )
    if (!accessToken) {
      return NextResponse.json({ error: 'Failed to obtain valid access token' }, { status: 401 })
    }

    const pathSegment = BUILT_IN_PATH[objectType] ?? objectType
    const response = await fetch(
      `https://api.hubapi.com/crm/v3/pipelines/${encodeURIComponent(pathSegment)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      logger.error(`[${requestId}] HubSpot pipelines API error ${response.status}: ${errorText}`)
      return NextResponse.json(
        { error: errorText || 'Failed to fetch HubSpot pipelines' },
        { status: response.status }
      )
    }

    const data = (await response.json()) as { results?: HubSpotPipeline[] }
    const pipelines = (data.results ?? [])
      .filter((p) => !p.archived)
      .map((p) => ({
        id: p.id,
        name: p.label,
        stages: p.stages?.map((s) => ({ id: s.id, label: s.label })),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))

    return NextResponse.json({ pipelines }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching HubSpot pipelines:`, error)
    return NextResponse.json({ error: 'Failed to fetch HubSpot pipelines' }, { status: 500 })
  }
})
