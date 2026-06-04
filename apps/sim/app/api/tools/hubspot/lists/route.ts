import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { hubspotListsSelectorContract } from '@/lib/api/contracts/selectors/hubspot'
import { parseRequest } from '@/lib/api/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { validateAlphanumericId } from '@/lib/core/security/input-validation'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('HubSpotListsAPI')

interface HubSpotList {
  listId: string
  name: string
  objectTypeId?: string
  processingType?: string
  deletedAt?: string | null
}

export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const parsed = await parseRequest(hubspotListsSelectorContract, request, {})
    if (!parsed.success) return parsed.response
    const { credentialId, objectTypeId, query } = parsed.data.query

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

    const params = new URLSearchParams()
    if (objectTypeId) params.set('objectTypeId', objectTypeId as string)
    params.set('count', '500')

    const response = await fetch(
      `https://api.hubapi.com/crm/v3/lists/search?${params.toString()}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: '',
          processingTypes: ['MANUAL', 'DYNAMIC', 'SNAPSHOT'],
          ...(objectTypeId ? { additionalProperties: ['hs_object_id'] } : {}),
        }),
      }
    )

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      logger.error(`[${requestId}] HubSpot lists API error ${response.status}: ${errorText}`)
      return NextResponse.json(
        { error: errorText || 'Failed to fetch HubSpot lists' },
        { status: response.status }
      )
    }

    const data = (await response.json()) as { lists?: HubSpotList[] }
    const filterTerm = (query as string | undefined)?.toLowerCase()
    const lists = (data.lists ?? [])
      .filter((l) => !l.deletedAt)
      .map((l) => ({
        id: l.listId,
        name: l.name,
        objectType: l.objectTypeId,
        processingType: l.processingType,
      }))
      .filter(
        (l) =>
          !filterTerm ||
          l.id.toLowerCase().includes(filterTerm) ||
          l.name.toLowerCase().includes(filterTerm)
      )
      .sort((a, b) => a.name.localeCompare(b.name))

    return NextResponse.json({ lists }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching HubSpot lists:`, error)
    return NextResponse.json({ error: 'Failed to fetch HubSpot lists' }, { status: 500 })
  }
})
