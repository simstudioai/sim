import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { zohoDeskDepartmentsSelectorContract } from '@/lib/api/contracts/selectors'
import { parseRequest } from '@/lib/api/server'
import { secureFetchWithValidation } from '@/lib/core/security/input-validation.server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { resolveZohoDeskSelectorCredential } from '@/app/api/tools/zoho_desk/selector-credential'
import { assertZohoUrl } from '@/tools/zoho_desk/host-allowlist'
import { buildZohoDeskHeaders, getZohoDeskErrorMessage } from '@/tools/zoho_desk/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('ZohoDeskDepartmentsAPI')

/**
 * `GET /api/v1/departments` is index-paginated with `limit` capped at 200
 * (default 10). A short page means the list is exhausted.
 *
 * Zoho's docs contradict themselves on whether `from` is 0- or 1-based: the
 * pagination section documents "range 0-4999, default 0", while the listing
 * examples read "from=5 and limit=50 retrieves records 5 to 54" (1-based). Under
 * the 1-based reading, stepping by exactly PAGE_SIZE re-fetches the boundary
 * record. Rather than guess a base we cannot confirm without a live tenant, the
 * accumulator dedupes by id, which is correct under BOTH readings — the worst
 * case is one redundant record per page boundary, never a duplicate entry or a
 * skipped one.
 *
 * The page cap bounds the drain so a provider that keeps returning full pages
 * cannot loop forever — 20 x 200 covers any realistic Desk portal and keeps the
 * maximum `from` inside Zoho's documented 4999 ceiling.
 */
const DEPARTMENT_PAGE_SIZE = 200
const MAX_DEPARTMENT_PAGES = 20

interface ZohoDepartment {
  id?: string | number
  name?: string
  nameInCustomerPortal?: string
}

/** Backs the `zoho_desk.departments` selector. */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  const parsed = await parseRequest(zohoDeskDepartmentsSelectorContract, request, {})
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
  const departments: Array<{ id: string; name: string }> = []
  const seenIds = new Set<string>()

  try {
    for (let page = 0; page < MAX_DEPARTMENT_PAGES; page++) {
      let departmentsUrl: URL
      try {
        departmentsUrl = assertZohoUrl(`${apiBase}/departments`)
      } catch {
        return NextResponse.json(
          { error: 'Credential resolved to a non-Zoho host' },
          { status: 400 }
        )
      }
      departmentsUrl.searchParams.set('from', String(page * DEPARTMENT_PAGE_SIZE))
      departmentsUrl.searchParams.set('limit', String(DEPARTMENT_PAGE_SIZE))

      // Same rationale as the organizations/attachment routes: pin the resolved
      // IP, block private/reserved hops, and drop the token if a Zoho-side
      // redirect leaves the original origin.
      const response = await secureFetchWithValidation(departmentsUrl.toString(), {
        profile: 'configuredEndpoint',
        method: 'GET',
        headers,
        timeout: 15_000,
        stripAuthOnRedirect: true,
      })

      const body: { data?: unknown } = await response
        .json()
        .then((json) => (json && typeof json === 'object' ? (json as { data?: unknown }) : {}))
        .catch(() => ({}))

      // Zoho answers 204 with no body once the offset runs past the last
      // department, which is a successful end-of-list, not an error.
      if (response.status === 204) break

      if (!response.ok) {
        const message = getZohoDeskErrorMessage(
          body,
          `Failed to list departments (HTTP ${response.status})`
        )
        logger.warn('Failed to list Zoho Desk departments', { status: response.status, message })
        return NextResponse.json(
          { error: message },
          { status: response.status >= 400 && response.status < 500 ? response.status : 502 }
        )
      }

      const pageItems = Array.isArray(body.data) ? (body.data as ZohoDepartment[]) : []
      for (const department of pageItems) {
        if (department.id === undefined || department.id === null) continue
        const id = String(department.id)
        // Dedupe: see the pagination note above — a 1-based `from` would repeat
        // the boundary record on every page after the first.
        if (seenIds.has(id)) continue
        seenIds.add(id)
        departments.push({
          id,
          name: department.name || department.nameInCustomerPortal || String(department.id),
        })
      }

      if (pageItems.length < DEPARTMENT_PAGE_SIZE) break
      if (page === MAX_DEPARTMENT_PAGES - 1) {
        logger.warn('Zoho Desk departments listing hit the page cap; list may be incomplete', {
          pages: MAX_DEPARTMENT_PAGES,
        })
      }
    }

    return NextResponse.json({ departments })
  } catch (error) {
    const message = getErrorMessage(error, 'Failed to list departments')
    logger.error('Error listing Zoho Desk departments', { error: message })
    return NextResponse.json({ error: message }, { status: 502 })
  }
})
