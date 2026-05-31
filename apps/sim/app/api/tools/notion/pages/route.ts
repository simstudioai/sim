import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { notionPagesSelectorContract } from '@/lib/api/contracts/selectors'
import { parseRequest } from '@/lib/api/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { refreshAccessTokenIfNeeded } from '@/app/api/auth/oauth/utils'
import { extractTitleFromItem } from '@/tools/notion/utils'

const logger = createLogger('NotionPagesAPI')

export const dynamic = 'force-dynamic'

const NOTION_PAGE_SIZE = 100

/**
 * Notion's `POST /v1/search` returns at most `page_size` results per call and
 * exposes `has_more`/`next_cursor` for pagination. This caps the number of
 * pages drained so a tenant with a very large workspace cannot make this route
 * loop unbounded. With `NOTION_PAGE_SIZE` of 100 this covers up to 2,000 items.
 */
const MAX_NOTION_PAGES = 20

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()
  try {
    const parsed = await parseRequest(notionPagesSelectorContract, request, {})
    if (!parsed.success) return parsed.response
    const { credential, workflowId } = parsed.data.body

    const authz = await authorizeCredentialUse(request, {
      credentialId: credential,
      workflowId: workflowId || undefined,
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
        { error: 'Could not retrieve access token', authRequired: true },
        { status: 401 }
      )
    }

    const results: Record<string, unknown>[] = []
    let startCursor: string | undefined

    for (let page = 0; page < MAX_NOTION_PAGES; page++) {
      const response = await fetch('https://api.notion.com/v1/search', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Notion-Version': '2022-06-28',
        },
        body: JSON.stringify({
          filter: { value: 'page', property: 'object' },
          page_size: NOTION_PAGE_SIZE,
          ...(startCursor ? { start_cursor: startCursor } : {}),
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        logger.error('Failed to fetch Notion pages', {
          status: response.status,
          error: errorData,
        })
        return NextResponse.json(
          { error: 'Failed to fetch Notion pages', details: errorData },
          { status: response.status }
        )
      }

      const data = await response.json()
      if (Array.isArray(data.results)) {
        results.push(...(data.results as Record<string, unknown>[]))
      }

      if (!data.has_more || !data.next_cursor) {
        break
      }
      startCursor = data.next_cursor as string

      if (page === MAX_NOTION_PAGES - 1) {
        logger.warn('Notion pages search hit pagination cap; results may be incomplete', {
          maxPages: MAX_NOTION_PAGES,
          fetched: results.length,
        })
      }
    }

    const pages = results.map((page) => ({
      id: page.id as string,
      name: extractTitleFromItem(page),
    }))

    return NextResponse.json({ pages })
  } catch (error) {
    logger.error('Error processing Notion pages request:', error)
    return NextResponse.json(
      { error: 'Failed to retrieve Notion pages', details: getErrorMessage(error) },
      { status: 500 }
    )
  }
})
