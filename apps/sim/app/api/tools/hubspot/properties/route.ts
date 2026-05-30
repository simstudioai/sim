import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { hubspotPropertiesSelectorContract } from '@/lib/api/contracts/selectors/hubspot'
import { parseRequest } from '@/lib/api/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { validateAlphanumericId } from '@/lib/core/security/input-validation'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('HubSpotPropertiesAPI')

const BUILT_IN_PATH: Record<string, string> = {
  contact: 'contacts',
  company: 'companies',
  deal: 'deals',
  ticket: 'tickets',
}

interface HubSpotProperty {
  name: string
  label: string
  type?: string
  fieldType?: string
  groupName?: string
  hidden?: boolean
  archived?: boolean
}

export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const parsed = await parseRequest(hubspotPropertiesSelectorContract, request, {})
    if (!parsed.success) return parsed.response
    const { credentialId, objectType, query } = parsed.data.query

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
      `https://api.hubapi.com/crm/v3/properties/${encodeURIComponent(pathSegment)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      logger.error(`[${requestId}] HubSpot properties API error ${response.status}: ${errorText}`)
      return NextResponse.json(
        { error: errorText || 'Failed to fetch HubSpot properties' },
        { status: response.status }
      )
    }

    const data = (await response.json()) as { results?: HubSpotProperty[] }
    if (!Array.isArray(data.results)) {
      return NextResponse.json({ error: 'Invalid HubSpot properties response' }, { status: 500 })
    }

    const filterTerm = (query as string | undefined)?.toLowerCase()
    const properties = data.results
      .filter((p) => !p.hidden && !p.archived)
      .map((p) => ({
        id: p.name,
        name: p.label || p.name,
        type: p.type,
        fieldType: p.fieldType,
        groupName: p.groupName,
      }))
      .filter(
        (p) =>
          !filterTerm ||
          p.id.toLowerCase().includes(filterTerm) ||
          p.name.toLowerCase().includes(filterTerm)
      )
      .sort((a, b) => a.name.localeCompare(b.name))

    return NextResponse.json({ properties }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching HubSpot properties:`, error)
    return NextResponse.json({ error: 'Failed to fetch HubSpot properties' }, { status: 500 })
  }
})
