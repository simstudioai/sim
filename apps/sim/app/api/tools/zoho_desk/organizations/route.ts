import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { zohoDeskOrganizationsSelectorContract } from '@/lib/api/contracts/selectors'
import { parseRequest } from '@/lib/api/server'
import { secureFetchWithValidation } from '@/lib/core/security/input-validation.server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { resolveZohoDeskSelectorCredential } from '@/app/api/tools/zoho_desk/selector-credential'
import { assertZohoUrl } from '@/tools/zoho_desk/host-allowlist'
import { getZohoDeskErrorMessage } from '@/tools/zoho_desk/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('ZohoDeskOrganizationsAPI')

interface ZohoOrganization {
  id?: string | number
  companyName?: string
  portalName?: string
}

/** Backs the `zoho_desk.organizations` selector. */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  const parsed = await parseRequest(zohoDeskOrganizationsSelectorContract, request, {})
  if (!parsed.success) return parsed.response
  const { credential, workflowId } = parsed.data.body

  const resolved = await resolveZohoDeskSelectorCredential(request, {
    credentialId: credential,
    workflowId,
    requestId,
  })
  if (!resolved.ok) return resolved.response
  const { accessToken, apiBase } = resolved.credential

  // apiBase is already anchored by getZohoDeskApiBase; assert again so the URL
  // that finally receives the OAuth token is validated at the point of use.
  let organizationsUrl: URL
  try {
    organizationsUrl = assertZohoUrl(`${apiBase}/organizations`)
    // Deliberately sends NO query parameters. Zoho's `/organizations` doc block
    // lists none at all - not `from`, not `limit` - and its own sample is a bare
    // GET. An earlier revision passed `limit=200` by extrapolating from
    // /departments and /agents, but the other siblings (/tickets, /contacts,
    // /comments) cap at 100 and Zoho answers an out-of-range value with 422
    // INVALID_DATA. Since `orgId` gates every tool and both other selectors, a
    // 422 here would make the whole integration unreachable except through the
    // manual field - a far worse failure than the known downside of sending
    // nothing, which is Zoho's default page size (10 portals).
  } catch {
    return NextResponse.json({ error: 'Credential resolved to a non-Zoho host' }, { status: 400 })
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
        name: org.companyName || org.portalName || String(org.id),
      }))

    return NextResponse.json({ organizations })
  } catch (error) {
    const message = getErrorMessage(error, 'Failed to list organizations')
    logger.error('Error listing Zoho Desk organizations', { error: message })
    return NextResponse.json({ error: message }, { status: 502 })
  }
})
