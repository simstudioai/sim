import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { zohoDeskListOrganizationsContract } from '@/lib/api/contracts/tools/zoho-desk'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getZohoDeskApiBase } from '@/tools/zoho_desk/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('ZohoDeskOrganizationsAPI')

interface ZohoOrganization {
  id?: string | number
  companyName?: string
  portalName?: string
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
  if (!authResult.success) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(zohoDeskListOrganizationsContract, request, {})
  if (!parsed.success) return parsed.response
  const { accessToken, apiDomain } = parsed.data.body

  try {
    // The organizations endpoint is the one Desk call that does not require an
    // orgId header, so it can bootstrap the organization selector before a
    // portal has been chosen.
    const response = await fetch(
      `${getZohoDeskApiBase({ apiDomain: apiDomain ?? undefined })}/organizations`,
      {
        method: 'GET',
        headers: {
          Authorization: `Zoho-oauthtoken ${accessToken}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(15_000),
      }
    )

    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      logger.warn('Failed to list Zoho Desk organizations', { status: response.status })
      return NextResponse.json({ organizations: [] })
    }

    const organizations = (Array.isArray(data.data) ? (data.data as ZohoOrganization[]) : [])
      .filter((org) => org.id !== undefined && org.id !== null)
      .map((org) => ({
        id: String(org.id),
        companyName: org.companyName ?? null,
        portalName: org.portalName ?? null,
      }))

    return NextResponse.json({ organizations })
  } catch (error) {
    logger.error('Error listing Zoho Desk organizations', { error: getErrorMessage(error) })
    return NextResponse.json({ organizations: [] })
  }
})
