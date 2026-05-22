import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { hubspotOwnersSelectorContract } from '@/lib/api/contracts/selectors/hubspot'
import { parseRequest } from '@/lib/api/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { validateAlphanumericId } from '@/lib/core/security/input-validation'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('HubSpotOwnersAPI')

interface HubSpotOwner {
  id: string
  email?: string
  firstName?: string
  lastName?: string
  archived?: boolean
}

export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const parsed = await parseRequest(hubspotOwnersSelectorContract, request, {})
    if (!parsed.success) return parsed.response
    const { credentialId, query } = parsed.data.query

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

    const collected: HubSpotOwner[] = []
    let after: string | undefined
    let pages = 0
    do {
      const params = new URLSearchParams({ limit: '100' })
      if (after) params.set('after', after)
      const response = await fetch(`https://api.hubapi.com/crm/v3/owners?${params.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        logger.error(`[${requestId}] HubSpot owners API error ${response.status}: ${errorText}`)
        return NextResponse.json(
          { error: errorText || 'Failed to fetch HubSpot owners' },
          { status: response.status }
        )
      }

      const data = (await response.json()) as {
        results?: HubSpotOwner[]
        paging?: { next?: { after?: string } }
      }
      if (data.results?.length) collected.push(...data.results)
      after = data.paging?.next?.after
      pages++
    } while (after && pages < 10)

    const filterTerm = (query as string | undefined)?.toLowerCase()
    const owners = collected
      .filter((o) => !o.archived)
      .map((o) => ({
        id: o.id,
        name: [o.firstName, o.lastName].filter(Boolean).join(' ') || o.email || o.id,
        email: o.email,
      }))
      .filter(
        (o) =>
          !filterTerm ||
          o.name.toLowerCase().includes(filterTerm) ||
          (o.email?.toLowerCase().includes(filterTerm) ?? false)
      )
      .sort((a, b) => a.name.localeCompare(b.name))

    return NextResponse.json({ owners }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching HubSpot owners:`, error)
    return NextResponse.json({ error: 'Failed to fetch HubSpot owners' }, { status: 500 })
  }
})
