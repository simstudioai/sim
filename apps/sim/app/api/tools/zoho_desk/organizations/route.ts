import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { zohoDeskListOrganizationsContract } from '@/lib/api/contracts/tools/zoho-desk'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { secureFetchWithValidation } from '@/lib/core/security/input-validation.server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { assertZohoUrl } from '@/tools/zoho_desk/host-allowlist'
import { getZohoDeskApiBase, getZohoDeskErrorMessage } from '@/tools/zoho_desk/utils'

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

  // apiDomain is client-supplied, so anchor the outbound host to a Zoho apex
  // before attaching the OAuth token - otherwise a caller could point the server
  // at an arbitrary origin and leak the token.
  let organizationsUrl: URL
  try {
    organizationsUrl = assertZohoUrl(
      `${getZohoDeskApiBase({ apiDomain: apiDomain ?? undefined })}/organizations`
    )
  } catch {
    return NextResponse.json({ error: 'apiDomain must be an https Zoho host' }, { status: 400 })
  }

  try {
    // The organizations endpoint is the one Desk call that does not require an
    // orgId header, so it can bootstrap the organization selector before a
    // portal has been chosen.
    // Mirrors the attachment route: the initial host is allowlisted, but a
    // Zoho-side redirect would otherwise be followed with the OAuth token
    // attached and no IP pinning. secureFetchWithValidation pins the resolved
    // IP, blocks private/reserved targets on every hop, and drops the token if
    // a redirect leaves the original origin.
    const response = await secureFetchWithValidation(organizationsUrl.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 15_000,
      stripAuthOnRedirect: true,
    })

    // secureFetchWithValidation types the body as `unknown`; Zoho wraps the list
    // in `{ data: [...] }`, which is narrowed below before use.
    const data: { data?: unknown } = await response
      .json()
      .then((body) => (body && typeof body === 'object' ? (body as { data?: unknown }) : {}))
      .catch(() => ({}))
    if (!response.ok) {
      // Surface the failure instead of returning an empty 200, which would make
      // the org dropdown silently render empty on an auth/connectivity error.
      const message = getZohoDeskErrorMessage(
        data,
        `Failed to list organizations (HTTP ${response.status})`
      )
      logger.warn('Failed to list Zoho Desk organizations', { status: response.status, message })
      return NextResponse.json(
        { error: message },
        { status: response.status >= 400 && response.status < 500 ? response.status : 502 }
      )
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
    const message = getErrorMessage(error, 'Failed to list organizations')
    logger.error('Error listing Zoho Desk organizations', { error: message })
    return NextResponse.json({ error: message }, { status: 502 })
  }
})
