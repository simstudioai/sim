import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { wealthboxItemsSelectorContract } from '@/lib/api/contracts/selectors/wealthbox'
import { parseRequest } from '@/lib/api/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { validatePathSegment } from '@/lib/core/security/input-validation'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('WealthboxItemsAPI')

/**
 * Wealthbox `GET /v1/contacts` paginates with `?page=` / `?per_page=`, starting
 * at page 1. Wealthbox documents no `per_page` maximum and its contacts response
 * carries no pagination `meta`, so termination relies on the short-page check:
 * we stop once a page returns fewer items than `WEALTHBOX_PAGE_SIZE` (the
 * `meta.total_pages` / `meta.current_page` check is a defensive fallback for if
 * Wealthbox ever adds that block). Bounded by `MAX_WEALTHBOX_PAGES` so a runaway
 * response can't loop forever.
 */
const WEALTHBOX_PAGE_SIZE = 50
const MAX_WEALTHBOX_PAGES = 50

interface WealthboxItem {
  id: string
  name: string
  type: string
  content: string
  createdAt: string
  updatedAt: string
}

interface WealthboxContactsPage {
  contacts?: Array<Record<string, unknown>>
  meta?: {
    total_count?: number
    total_pages?: number
    current_page?: number
  }
}

/**
 * Get items (notes, contacts, tasks) from Wealthbox
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const parsed = await parseRequest(wealthboxItemsSelectorContract, request, {})
    if (!parsed.success) return parsed.response
    const { credentialId, type } = parsed.data.query
    const query = parsed.data.query.query ?? ''

    const credentialIdValidation = validatePathSegment(credentialId, {
      paramName: 'credentialId',
      maxLength: 100,
      allowHyphens: true,
      allowUnderscores: true,
      allowDots: false,
    })
    if (!credentialIdValidation.isValid) {
      logger.warn(`[${requestId}] Invalid credentialId format: ${credentialId}`)
      return NextResponse.json({ error: credentialIdValidation.error }, { status: 400 })
    }

    const authz = await authorizeCredentialUse(request, {
      credentialId,
      requireWorkflowIdForInternal: false,
    })
    if (!authz.ok || !authz.credentialOwnerUserId) {
      return NextResponse.json({ error: authz.error || 'Unauthorized' }, { status: 403 })
    }

    const accessToken = await refreshAccessTokenIfNeeded(
      credentialId,
      authz.credentialOwnerUserId,
      requestId
    )

    if (!accessToken) {
      logger.error(`[${requestId}] Failed to obtain valid access token`)
      return NextResponse.json({ error: 'Failed to obtain valid access token' }, { status: 401 })
    }

    const endpoints = {
      contact: 'contacts',
    }
    const endpoint = endpoints[type as keyof typeof endpoints]

    logger.info(`[${requestId}] Fetching ${type}s from Wealthbox`, {
      endpoint,
      hasQuery: !!query.trim(),
    })

    const allContacts: Array<Record<string, unknown>> = []
    let page = 1

    for (; page <= MAX_WEALTHBOX_PAGES; page++) {
      const url = new URL(`https://api.crmworkspace.com/v1/${endpoint}`)
      url.searchParams.set('per_page', String(WEALTHBOX_PAGE_SIZE))
      url.searchParams.set('page', String(page))

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        const errorText = await response.text()
        logger.error(
          `[${requestId}] Wealthbox API error: ${response.status} ${response.statusText}`,
          {
            error: errorText,
            endpoint,
            url: url.toString(),
          }
        )
        return NextResponse.json(
          { error: `Failed to fetch ${type}s from Wealthbox` },
          { status: response.status }
        )
      }

      const data = (await response.json()) as WealthboxContactsPage

      const contacts = data.contacts || []
      if (!Array.isArray(contacts)) {
        logger.warn(`[${requestId}] Contacts is not an array`, {
          contacts,
          dataType: typeof contacts,
        })
        break
      }

      allContacts.push(...contacts)

      const totalPages = data.meta?.total_pages
      const currentPage = data.meta?.current_page ?? page
      const reachedLastByMeta =
        typeof totalPages === 'number' && totalPages > 0 && currentPage >= totalPages
      const reachedLastByCount = contacts.length < WEALTHBOX_PAGE_SIZE

      if (reachedLastByMeta || reachedLastByCount) {
        break
      }

      if (page === MAX_WEALTHBOX_PAGES) {
        logger.warn(
          `[${requestId}] Wealthbox pagination hit MAX_WEALTHBOX_PAGES cap; contact list may be incomplete`,
          { endpoint, maxPages: MAX_WEALTHBOX_PAGES }
        )
      }
    }

    logger.info(`[${requestId}] Wealthbox API drained`, {
      type,
      pagesFetched: Math.min(page, MAX_WEALTHBOX_PAGES),
      totalContacts: allContacts.length,
    })

    let items: WealthboxItem[] = []

    if (type === 'contact') {
      items = allContacts.map((item) => {
        const firstName = typeof item.first_name === 'string' ? item.first_name : ''
        const lastName = typeof item.last_name === 'string' ? item.last_name : ''
        return {
          id: item.id?.toString() || '',
          name: `${firstName} ${lastName}`.trim() || `Contact ${item.id ?? ''}`,
          type: 'contact',
          content:
            typeof item.background_information === 'string' ? item.background_information : '',
          createdAt: typeof item.created_at === 'string' ? item.created_at : '',
          updatedAt: typeof item.updated_at === 'string' ? item.updated_at : '',
        }
      })
    }

    if (query.trim()) {
      const searchTerm = query.trim().toLowerCase()
      items = items.filter(
        (item) =>
          item.name.toLowerCase().includes(searchTerm) ||
          item.content.toLowerCase().includes(searchTerm)
      )
    }

    logger.info(`[${requestId}] Successfully fetched ${items.length} ${type}s from Wealthbox`, {
      totalItems: items.length,
      hasSearchQuery: !!query.trim(),
    })

    return NextResponse.json({ items }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching Wealthbox items`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
