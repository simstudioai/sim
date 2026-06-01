import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { webflowItemsSelectorContract } from '@/lib/api/contracts/selectors'
import { parseRequest } from '@/lib/api/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { validateAlphanumericId } from '@/lib/core/security/input-validation'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'

const logger = createLogger('WebflowItemsAPI')

export const dynamic = 'force-dynamic'

const WEBFLOW_PAGE_LIMIT = 100
const WEBFLOW_MAX_ITEMS_PAGES = 50

interface WebflowItem {
  id: string
  fieldData?: {
    name?: string
    title?: string
    slug?: string
  }
}

interface WebflowItemsPage {
  items?: WebflowItem[]
  pagination?: {
    total?: number
    limit?: number
    offset?: number
  }
}

/**
 * Lists all items in a Webflow collection using `offset`/`limit` pagination
 * (limit capped at 100), advancing the numeric `offset` until the accumulated
 * count reaches `pagination.total` so the full set is returned. Bounded by
 * `WEBFLOW_MAX_ITEMS_PAGES`; logs a warning rather than silently dropping items
 * when the cap is hit.
 */
async function fetchAllItems(accessToken: string, collectionId: string): Promise<WebflowItem[]> {
  const items: WebflowItem[] = []
  let offset = 0

  for (let page = 0; page < WEBFLOW_MAX_ITEMS_PAGES; page++) {
    const url = new URL(`https://api.webflow.com/v2/collections/${collectionId}/items`)
    url.searchParams.set('limit', String(WEBFLOW_PAGE_LIMIT))
    url.searchParams.set('offset', String(offset))

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        accept: 'application/json',
      },
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new WebflowFetchError(response.status, errorData)
    }

    const data = (await response.json()) as WebflowItemsPage
    const pageItems = data.items || []
    items.push(...pageItems)

    const total = data.pagination?.total
    offset += pageItems.length
    if (pageItems.length === 0 || (typeof total === 'number' && items.length >= total)) {
      return items
    }

    if (page === WEBFLOW_MAX_ITEMS_PAGES - 1) {
      logger.warn('Webflow items listing hit pagination cap; item list may be incomplete', {
        collectionId,
        pages: WEBFLOW_MAX_ITEMS_PAGES,
      })
    }
  }

  return items
}

class WebflowFetchError extends Error {
  constructor(
    readonly status: number,
    readonly details: unknown
  ) {
    super('Failed to fetch Webflow items')
    this.name = 'WebflowFetchError'
  }
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const requestId = generateRequestId()
    const parsed = await parseRequest(webflowItemsSelectorContract, request, {})
    if (!parsed.success) return parsed.response
    const { credential, workflowId, collectionId, search } = parsed.data.body

    const collectionIdValidation = validateAlphanumericId(collectionId, 'collectionId')
    if (!collectionIdValidation.isValid) {
      logger.error('Invalid collectionId', { error: collectionIdValidation.error })
      return NextResponse.json({ error: collectionIdValidation.error }, { status: 400 })
    }

    const authz = await authorizeCredentialUse(request, {
      credentialId: credential,
      workflowId,
    })
    if (!authz.ok || !authz.credentialOwnerUserId) {
      return NextResponse.json({ error: authz.error || 'Unauthorized' }, { status: 403 })
    }

    const accessToken = await refreshAccessTokenIfNeeded(
      credential,
      authz.credentialOwnerUserId,
      requestId
    )
    if (!accessToken) {
      logger.error('Failed to get access token', {
        credentialId: credential,
        userId: authz.credentialOwnerUserId,
      })
      return NextResponse.json(
        {
          error: 'Could not retrieve access token',
          authRequired: true,
        },
        { status: 401 }
      )
    }

    let items: WebflowItem[]
    try {
      items = await fetchAllItems(accessToken, collectionId)
    } catch (error) {
      if (error instanceof WebflowFetchError) {
        logger.error('Failed to fetch Webflow items', {
          status: error.status,
          error: error.details,
          collectionId,
        })
        return NextResponse.json(
          { error: 'Failed to fetch Webflow items', details: error.details },
          { status: error.status }
        )
      }
      throw error
    }

    let formattedItems = items.map((item) => {
      const fieldData = item.fieldData || {}
      const name = fieldData.name || fieldData.title || fieldData.slug || item.id
      return {
        id: item.id,
        name,
      }
    })

    if (search) {
      const searchLower = search.toLowerCase()
      formattedItems = formattedItems.filter((item: { id: string; name: string }) =>
        item.name.toLowerCase().includes(searchLower)
      )
    }

    return NextResponse.json({ items: formattedItems })
  } catch (error) {
    logger.error('Error processing Webflow items request:', error)
    return NextResponse.json(
      { error: 'Failed to retrieve Webflow items', details: (error as Error).message },
      { status: 500 }
    )
  }
})
