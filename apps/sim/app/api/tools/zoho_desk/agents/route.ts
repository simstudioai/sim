import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { zohoDeskAgentsSelectorContract } from '@/lib/api/contracts/selectors'
import { parseRequest } from '@/lib/api/server'
import { secureFetchWithValidation } from '@/lib/core/security/input-validation.server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { resolveZohoDeskSelectorCredential } from '@/app/api/tools/zoho_desk/selector-credential'
import { assertZohoUrl } from '@/tools/zoho_desk/host-allowlist'
import { buildZohoDeskHeaders, getZohoDeskErrorMessage } from '@/tools/zoho_desk/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('ZohoDeskAgentsAPI')

/**
 * `GET /api/v1/agents` is index-paginated exactly like `/departments`: `from` is
 * an index offset and `limit` caps at 200 (default 10). A short page means the
 * list is exhausted. The page cap bounds the drain so a provider that keeps
 * returning full pages cannot loop forever.
 */
const AGENT_PAGE_SIZE = 200
const MAX_AGENT_PAGES = 20

/**
 * Only active agents can own a ticket, so a disabled or deleted agent in the
 * picker would only produce an assignment the API rejects.
 */
const AGENT_STATUS = 'ACTIVE'

interface ZohoAgent {
  id?: string | number
  name?: string
  firstName?: string
  lastName?: string
  emailId?: string
}

/**
 * Zoho returns `name` for most agents but leaves it (and `firstName`) empty on
 * some rows, so fall back through the name parts and finally the email before
 * showing a bare numeric id the user cannot recognize.
 */
function getAgentLabel(agent: ZohoAgent): string {
  if (agent.name?.trim()) return agent.name.trim()
  const fullName = [agent.firstName, agent.lastName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ')
  if (fullName) return fullName
  return agent.emailId?.trim() || String(agent.id)
}

/** Backs the `zoho_desk.agents` selector. */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  const parsed = await parseRequest(zohoDeskAgentsSelectorContract, request, {})
  if (!parsed.success) return parsed.response
  const { credential, workflowId, orgId } = parsed.data.body

  const resolved = await resolveZohoDeskSelectorCredential(request, {
    credentialId: credential,
    workflowId,
    requestId,
  })
  if (!resolved.ok) return resolved.response
  const { accessToken, apiBase } = resolved.credential

  const headers = buildZohoDeskHeaders({ accessToken, orgId })
  const agents: Array<{ id: string; name: string }> = []
  // Zoho's docs disagree on whether `from` is 0- or 1-based (pagination section
  // says "range 0-4999, default 0"; listing examples read as 1-based). Deduping
  // by id is correct under both, so the drain never yields a repeated agent.
  const seenIds = new Set<string>()

  try {
    for (let page = 0; page < MAX_AGENT_PAGES; page++) {
      let agentsUrl: URL
      try {
        agentsUrl = assertZohoUrl(`${apiBase}/agents`)
      } catch {
        return NextResponse.json(
          { error: 'Credential resolved to a non-Zoho host' },
          { status: 400 }
        )
      }
      agentsUrl.searchParams.set('from', String(page * AGENT_PAGE_SIZE))
      agentsUrl.searchParams.set('limit', String(AGENT_PAGE_SIZE))
      agentsUrl.searchParams.set('status', AGENT_STATUS)

      // Same rationale as the organizations/departments/attachment routes: pin
      // the resolved IP, block private/reserved hops, and drop the token if a
      // Zoho-side redirect leaves the original origin.
      const response = await secureFetchWithValidation(agentsUrl.toString(), {
        method: 'GET',
        headers,
        timeout: 15_000,
        stripAuthOnRedirect: true,
      })

      const body: { data?: unknown } = await response
        .json()
        .then((json) => (json && typeof json === 'object' ? (json as { data?: unknown }) : {}))
        .catch(() => ({}))

      // Zoho answers 204 with no body once the offset runs past the last agent,
      // which is a successful end-of-list, not an error.
      if (response.status === 204) break

      if (!response.ok) {
        const message = getZohoDeskErrorMessage(
          body,
          `Failed to list agents (HTTP ${response.status})`
        )
        logger.warn('Failed to list Zoho Desk agents', { status: response.status, message })
        return NextResponse.json(
          { error: message },
          { status: response.status >= 400 && response.status < 500 ? response.status : 502 }
        )
      }

      const pageItems = Array.isArray(body.data) ? (body.data as ZohoAgent[]) : []
      for (const agent of pageItems) {
        if (agent.id === undefined || agent.id === null) continue
        const id = String(agent.id)
        if (seenIds.has(id)) continue
        seenIds.add(id)
        agents.push({ id, name: getAgentLabel(agent) })
      }

      if (pageItems.length < AGENT_PAGE_SIZE) break
      if (page === MAX_AGENT_PAGES - 1) {
        logger.warn('Zoho Desk agents listing hit the page cap; list may be incomplete', {
          pages: MAX_AGENT_PAGES,
        })
      }
    }

    return NextResponse.json({ agents })
  } catch (error) {
    const message = getErrorMessage(error, 'Failed to list agents')
    logger.error('Error listing Zoho Desk agents', { error: message })
    return NextResponse.json({ error: message }, { status: 502 })
  }
})
