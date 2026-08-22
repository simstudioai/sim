import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { htmlToPlainText, parseMultiValue, parseTagDate } from '@/connectors/utils'
import { webflowConnectorMeta } from '@/connectors/webflow/meta'

const logger = createLogger('WebflowConnector')

const WEBFLOW_API = 'https://api.webflow.com/v2'
const PAGE_SIZE = 100

interface WebflowCollection {
  id: string
  displayName?: string
  slug?: string
}

/**
 * Headers for every Webflow Data API v2 call. The API version is carried by the
 * `/v2` path segment — v2 has no `accept-version` header (that was the v1
 * convention), so only bearer auth and a JSON `accept` are sent.
 */
function webflowHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    accept: 'application/json',
  }
}

interface WebflowItem {
  id: string
  fieldData: Record<string, unknown>
  lastPublished?: string
  lastUpdated?: string
  createdOn?: string
  isArchived?: boolean
  isDraft?: boolean
}

/**
 * Keeps only CMS items that are still current in Webflow. The staged
 * `GET /collections/{id}/items` endpoint returns every item regardless of
 * state — it exposes `isArchived`/`isDraft` on each item but offers no query
 * parameter to filter by them — and archiving only unpublishes an item from the
 * live site while keeping it in the CMS. Without this guard archived items stay
 * in every full-sync listing forever and are never purged by deletion
 * reconciliation (which removes only stored documents absent from the listing).
 *
 * Only an explicit `isArchived === true` excludes an item: a missing or
 * malformed flag keeps the item, since wrongly excluding a live item would
 * hard-delete it from the knowledge base. Drafts are intentionally kept — a
 * draft is unpublished, not removed, and it still exists in the CMS.
 */
export function isCurrentItem(item: { isArchived?: boolean }): boolean {
  return item.isArchived !== true
}

interface CursorState {
  collectionIndex: number
  offset: number
  collections: string[]
}

/**
 * Formats a CMS item's field data into structured plain text.
 */
function itemToPlainText(item: WebflowItem, collectionName: string): string {
  const lines: string[] = []
  const fieldData = item.fieldData || {}

  const title = (fieldData.name as string) || (fieldData.title as string) || 'Untitled'
  lines.push(`# ${title}`)
  lines.push(`Collection: ${collectionName}`)

  for (const [key, value] of Object.entries(fieldData)) {
    if (value == null) continue
    if (key === 'name' || key === 'title') continue

    if (Array.isArray(value)) {
      const items = value.map((v) => {
        if (typeof v === 'object' && v !== null) {
          return JSON.stringify(v)
        }
        return String(v)
      })
      lines.push(`${key}: ${items.join(', ')}`)
    } else if (typeof value === 'object') {
      lines.push(`${key}: ${JSON.stringify(value)}`)
    } else if (typeof value === 'string' && /<[a-z][^>]*>/i.test(value)) {
      lines.push(`${key}: ${htmlToPlainText(value)}`)
    } else {
      lines.push(`${key}: ${String(value)}`)
    }
  }

  return lines.join('\n')
}

/**
 * Extracts a human-readable title from a Webflow CMS item.
 */
function extractItemTitle(item: WebflowItem): string {
  const fieldData = item.fieldData || {}
  return (fieldData.name as string) || (fieldData.title as string) || 'Untitled'
}

export const webflowConnector: ConnectorConfig = {
  ...webflowConnectorMeta,

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const siteId = sourceConfig.siteId as string
    const collectionIds = parseMultiValue(sourceConfig.collectionId)
    const maxItems = sourceConfig.maxItems ? Number(sourceConfig.maxItems) : 0

    let cursorState: CursorState

    if (cursor) {
      cursorState = JSON.parse(cursor) as CursorState
    } else {
      const collections = await fetchCollections(accessToken, siteId, collectionIds, syncContext)
      cursorState = { collectionIndex: 0, offset: 0, collections }
    }

    if (cursorState.collections.length === 0) {
      return { documents: [], hasMore: false }
    }

    const totalDocsFetched = (syncContext?.totalDocsFetched as number) ?? 0
    if (maxItems > 0 && totalDocsFetched >= maxItems) {
      return { documents: [], hasMore: false }
    }

    const currentCollectionId = cursorState.collections[cursorState.collectionIndex]
    const collectionName = await fetchCollectionName(accessToken, currentCollectionId, syncContext)

    /**
     * Never request more rows than the remaining `maxItems` budget — the API caps
     * `limit` at 100, and rows fetched past the cap would only be discarded, at
     * the cost of quota against Webflow's 60 requests/minute floor on Starter and
     * Basic plans. The early return above guarantees the remainder is at least 1.
     */
    const pageSize = maxItems > 0 ? Math.min(PAGE_SIZE, maxItems - totalDocsFetched) : PAGE_SIZE

    const params = new URLSearchParams()
    params.append('limit', String(pageSize))
    params.append('offset', String(cursorState.offset))

    const url = `${WEBFLOW_API}/collections/${encodeURIComponent(currentCollectionId)}/items?${params.toString()}`

    logger.info('Listing Webflow CMS items', {
      siteId,
      collectionId: currentCollectionId,
      offset: cursorState.offset,
    })

    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: webflowHeaders(accessToken),
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error('Failed to list Webflow items', {
        status: response.status,
        error: errorText,
      })
      throw new Error(`Failed to list Webflow items: ${response.status}`)
    }

    const data = (await response.json()) as {
      items?: WebflowItem[]
      pagination?: { total?: unknown }
    }

    const rawItems = data.items || []

    /**
     * Archived items are filtered out before mapping so they leave the listing
     * and get purged by deletion reconciliation. Pagination advances by the raw
     * row count, never the filtered count, so cursor math is unaffected.
     */
    const documents: ExternalDocument[] = rawItems
      .filter(isCurrentItem)
      .map((item) => itemToDocument(item, currentCollectionId, collectionName))

    if (syncContext) {
      syncContext.totalDocsFetched = totalDocsFetched + documents.length
    }

    /**
     * `pagination.total` is the collection size per the Data API v2 list-items
     * reference, read defensively so a malformed envelope cannot turn the offset
     * math into `NaN` (which would silently end the collection mid-listing). The
     * offset advances by the rows actually returned rather than the echoed
     * `pagination.limit`, so a short page can never skip rows.
     *
     * The value is type-checked rather than coerced: `Number(null)`,
     * `Number('')`, `Number([])`, and `Number(false)` all yield a finite `0`, so
     * coercion would read a `null` total as "this collection holds zero rows"
     * and hand every unread row to deletion reconciliation. A negative or
     * fractional total is malformed for the same purpose, so only a
     * non-negative integer counts as known.
     */
    const reportedTotal = data.pagination?.total
    const totalKnown = Number.isInteger(reportedTotal) && (reportedTotal as number) >= 0
    const total = totalKnown ? (reportedTotal as number) : rawItems.length
    const advance = rawItems.length

    const hasMoreInCollection = advance > 0 && cursorState.offset + advance < total
    const hasMoreCollections = cursorState.collectionIndex < cursorState.collections.length - 1
    const hitMaxItems = maxItems > 0 && totalDocsFetched + documents.length >= maxItems

    /**
     * The page came back empty while the collection still reports unread rows —
     * the listing is truncated by a transport or shape fault rather than
     * exhausted, so reconciliation must not hard-delete the unlisted rows.
     */
    const stalledMidCollection = advance === 0 && cursorState.offset < total

    /**
     * No usable `pagination.total` to page against, on a page of any size. The
     * fallback total collapses to the rows in hand, which ends the collection
     * right here and makes `stalledMidCollection` (`offset < 0`) unreachable, so
     * a short or empty page looks exactly like exhaustion. The Data API v2
     * schema marks `pagination` required but `total` optional, so its absence is
     * not proof of anything either way — and between "the collection is drained"
     * and "we stopped for a reason we cannot rule out", only the latter is
     * fail-safe: guessing "exhausted" would hand every unread row to deletion
     * reconciliation.
     */
    const unknownTotal = !totalKnown

    /**
     * A truncated listing must skip deletion reconciliation, or still-existing
     * documents that were never listed get hard-deleted. The cap truncates only
     * when rows remain beyond it: more pages in this collection, or more
     * collections still to visit. The request already clamps `limit` to the
     * remaining budget, so the cap never drops rows from within a page.
     */
    if (
      syncContext &&
      (stalledMidCollection ||
        unknownTotal ||
        (hitMaxItems && (hasMoreInCollection || hasMoreCollections)))
    ) {
      syncContext.listingCapped = true
    }

    let nextCursor: string | undefined
    if (hitMaxItems) {
      nextCursor = undefined
    } else if (hasMoreInCollection) {
      nextCursor = JSON.stringify({
        collectionIndex: cursorState.collectionIndex,
        offset: cursorState.offset + advance,
        collections: cursorState.collections,
      })
    } else if (hasMoreCollections) {
      nextCursor = JSON.stringify({
        collectionIndex: cursorState.collectionIndex + 1,
        offset: 0,
        collections: cursorState.collections,
      })
    }

    return {
      documents,
      nextCursor,
      hasMore: Boolean(nextCursor),
    }
  },

  getDocument: async (
    accessToken: string,
    _sourceConfig: Record<string, unknown>,
    externalId: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocument | null> => {
    const separatorIndex = externalId.indexOf(':')
    if (separatorIndex === -1) {
      logger.error('Invalid externalId format, expected collectionId:itemId', { externalId })
      return null
    }

    const docCollectionId = externalId.slice(0, separatorIndex)
    const itemId = externalId.slice(separatorIndex + 1)

    const url = `${WEBFLOW_API}/collections/${encodeURIComponent(docCollectionId)}/items/${encodeURIComponent(itemId)}`

    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: webflowHeaders(accessToken),
    })

    if (!response.ok) {
      if (response.status === 404) return null
      throw new Error(`Failed to get Webflow item: ${response.status}`)
    }

    const item = (await response.json()) as WebflowItem

    /**
     * Mirrors the listing filter: an archived item must not be resurrected by an
     * incremental refresh after reconciliation removed it.
     */
    if (!isCurrentItem(item)) return null

    const collectionName = await fetchCollectionName(accessToken, docCollectionId, syncContext)
    return itemToDocument(item, docCollectionId, collectionName)
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const siteId = sourceConfig.siteId as string
    const collectionIds = parseMultiValue(sourceConfig.collectionId)
    const maxItems = sourceConfig.maxItems as string | undefined

    if (!siteId) {
      return { valid: false, error: 'Site ID is required' }
    }

    if (maxItems && (Number.isNaN(Number(maxItems)) || Number(maxItems) <= 0)) {
      return { valid: false, error: 'Max items must be a positive number' }
    }

    try {
      const siteUrl = `${WEBFLOW_API}/sites/${encodeURIComponent(siteId)}`
      const siteResponse = await fetchWithRetry(
        siteUrl,
        { method: 'GET', headers: webflowHeaders(accessToken) },
        VALIDATE_RETRY_OPTIONS
      )

      if (!siteResponse.ok) {
        if (siteResponse.status === 404) {
          return { valid: false, error: `Site "${siteId}" not found` }
        }
        if (siteResponse.status === 403 || siteResponse.status === 401) {
          return { valid: false, error: 'Access denied. Check your Webflow permissions.' }
        }
        const errorText = await siteResponse.text()
        return { valid: false, error: `Webflow API error: ${siteResponse.status} - ${errorText}` }
      }

      for (const collectionId of collectionIds) {
        const collectionUrl = `${WEBFLOW_API}/collections/${encodeURIComponent(collectionId)}`
        const collectionResponse = await fetchWithRetry(
          collectionUrl,
          { method: 'GET', headers: webflowHeaders(accessToken) },
          VALIDATE_RETRY_OPTIONS
        )

        if (!collectionResponse.ok) {
          if (collectionResponse.status === 404) {
            return { valid: false, error: `Collection "${collectionId}" not found` }
          }
          return {
            valid: false,
            error: `Failed to verify collection: ${collectionResponse.status}`,
          }
        }
      }

      return { valid: true }
    } catch (error) {
      const message = getErrorMessage(error, 'Failed to validate configuration')
      return { valid: false, error: message }
    }
  },

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    if (typeof metadata.collectionName === 'string') {
      result.collectionName = metadata.collectionName
    }

    const lastModified = parseTagDate(metadata.lastModified)
    if (lastModified) result.lastModified = lastModified

    if (typeof metadata.slug === 'string' && metadata.slug.length > 0) {
      result.slug = metadata.slug
    }

    return result
  },
}

/**
 * Converts a Webflow CMS item to an ExternalDocument.
 */
function itemToDocument(
  item: WebflowItem,
  collectionId: string,
  collectionName: string
): ExternalDocument {
  const plainText = itemToPlainText(item, collectionName)
  const lastModified = item.lastUpdated || item.lastPublished || item.createdOn || ''
  const contentHash = `webflow:${item.id}:${lastModified}`
  const title = extractItemTitle(item)
  const slug = (item.fieldData?.slug as string) || ''

  return {
    externalId: `${collectionId}:${item.id}`,
    title,
    content: plainText,
    mimeType: 'text/plain',
    contentHash,
    metadata: {
      collectionName,
      lastModified: item.lastUpdated || item.lastPublished || item.createdOn,
      slug,
    },
  }
}

/**
 * Resolves the collection IDs to sync for a site. Explicitly configured IDs are
 * an intentional scope filter and are used as-is; otherwise every collection on
 * the site is listed via `GET /sites/{site_id}/collections`.
 *
 * That listing already carries each collection's `displayName`, so it seeds the
 * `syncContext` name cache — otherwise every collection would cost an extra
 * `GET /collections/{id}` against Webflow's 60 requests/minute floor.
 */
async function fetchCollections(
  accessToken: string,
  siteId: string,
  collectionIds: string[],
  syncContext?: Record<string, unknown>
): Promise<string[]> {
  if (collectionIds.length > 0) {
    return collectionIds
  }

  const url = `${WEBFLOW_API}/sites/${encodeURIComponent(siteId)}/collections`
  const response = await fetchWithRetry(url, {
    method: 'GET',
    headers: webflowHeaders(accessToken),
  })

  if (!response.ok) {
    throw new Error(`Failed to list Webflow collections: ${response.status}`)
  }

  const data = (await response.json()) as { collections?: WebflowCollection[] }
  const collections = data.collections || []

  if (syncContext) {
    const cached = (syncContext.collectionNames ?? {}) as Record<string, string>
    for (const collection of collections) {
      cached[collection.id] = collection.displayName || collection.slug || collection.id
    }
    syncContext.collectionNames = cached
  }

  return collections.map((c) => c.id)
}

/**
 * Resolves a collection's display name, memoized in syncContext for the run.
 *
 * The name is presentational (it prefixes each item's plain text and populates
 * the `collectionName` tag), so a lookup failure degrades to the collection id
 * rather than aborting the page — an item is never dropped over a missing label.
 */
async function fetchCollectionName(
  accessToken: string,
  collectionId: string,
  syncContext?: Record<string, unknown>
): Promise<string> {
  const cached = (syncContext?.collectionNames ?? {}) as Record<string, string>
  if (cached[collectionId]) return cached[collectionId]

  let name = collectionId
  try {
    const url = `${WEBFLOW_API}/collections/${encodeURIComponent(collectionId)}`
    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: webflowHeaders(accessToken),
    })

    if (response.ok) {
      const data = (await response.json()) as WebflowCollection
      name = data.displayName || data.slug || collectionId
    } else {
      logger.warn('Failed to fetch collection name', { collectionId, status: response.status })
    }
  } catch (error) {
    logger.warn('Error fetching collection name', {
      collectionId,
      error: toError(error).message,
    })
  }

  if (syncContext) {
    cached[collectionId] = name
    syncContext.collectionNames = cached
  }

  return name
}
