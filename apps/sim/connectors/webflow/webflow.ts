import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { WebflowIcon } from '@/components/icons'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { htmlToPlainText, parseTagDate } from '@/connectors/utils'

const logger = createLogger('WebflowConnector')

const WEBFLOW_API = 'https://api.webflow.com/v2'
const PAGE_SIZE = 100

interface WebflowCollection {
  id: string
  displayName: string
  slug: string
}

interface WebflowItem {
  id: string
  fieldData: Record<string, unknown>
  lastPublished?: string
  lastUpdated?: string
  createdOn?: string
}

interface WebflowPagination {
  total: number
  offset: number
  limit: number
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
  id: 'webflow',
  name: 'Webflow',
  description:
    'Sync CMS collection items from a Webflow site into your knowledge base. Note: Webflow OAuth tokens do not support refresh — you may need to reconnect periodically.',
  version: '1.0.0',
  icon: WebflowIcon,

  auth: { mode: 'oauth', provider: 'webflow', requiredScopes: ['sites:read', 'cms:read'] },

  configFields: [
    {
      id: 'siteSelector',
      title: 'Site',
      type: 'selector',
      selectorKey: 'webflow.sites',
      canonicalParamId: 'siteId',
      mode: 'basic',
      placeholder: 'Select a site',
      required: true,
    },
    {
      id: 'siteId',
      title: 'Site ID',
      type: 'short-input',
      canonicalParamId: 'siteId',
      mode: 'advanced',
      placeholder: 'Your Webflow site ID',
      required: true,
    },
    {
      id: 'collectionId',
      title: 'Collection ID',
      type: 'short-input',
      placeholder: 'Specific collection ID (default: all collections)',
      required: false,
    },
    {
      id: 'maxItems',
      title: 'Max Items',
      type: 'short-input',
      placeholder: 'e.g. 500 (default: unlimited)',
      required: false,
    },
  ],

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const siteId = sourceConfig.siteId as string
    const collectionId = sourceConfig.collectionId as string | undefined
    const maxItems = sourceConfig.maxItems ? Number(sourceConfig.maxItems) : 0

    let cursorState: CursorState

    if (cursor) {
      cursorState = JSON.parse(cursor) as CursorState
    } else {
      const collections = await fetchCollectionIds(accessToken, siteId, collectionId)
      cursorState = { collectionIndex: 0, offset: 0, collections }
    }

    if (cursorState.collections.length === 0) {
      return { documents: [], hasMore: false }
    }

    if (syncContext && !syncContext.collectionNames) {
      syncContext.collectionNames = {}
    }

    const totalDocsFetched = (syncContext?.totalDocsFetched as number) ?? 0
    if (maxItems > 0 && totalDocsFetched >= maxItems) {
      return { documents: [], hasMore: false }
    }

    const currentCollectionId = cursorState.collections[cursorState.collectionIndex]
    const collectionName = await fetchCollectionName(accessToken, currentCollectionId, syncContext)

    const params = new URLSearchParams()
    params.append('limit', String(PAGE_SIZE))
    params.append('offset', String(cursorState.offset))

    const url = `${WEBFLOW_API}/collections/${currentCollectionId}/items?${params.toString()}`

    logger.info('Listing Webflow CMS items', {
      siteId,
      collectionId: currentCollectionId,
      offset: cursorState.offset,
    })

    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'accept-version': '2.0.0',
      },
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
      items: WebflowItem[]
      pagination: WebflowPagination
    }

    const items = data.items || []
    let documents: ExternalDocument[] = items.map((item) =>
      itemToDocument(item, currentCollectionId, collectionName)
    )

    if (maxItems > 0) {
      const remaining = maxItems - totalDocsFetched
      if (documents.length > remaining) {
        documents = documents.slice(0, remaining)
      }
    }

    if (syncContext) {
      syncContext.totalDocsFetched = totalDocsFetched + documents.length
    }

    const { pagination } = data
    const hasMoreInCollection = cursorState.offset + pagination.limit < pagination.total
    const hasMoreCollections = cursorState.collectionIndex < cursorState.collections.length - 1
    const hitMaxItems = maxItems > 0 && totalDocsFetched + documents.length >= maxItems

    let nextCursor: string | undefined
    if (hitMaxItems) {
      nextCursor = undefined
    } else if (hasMoreInCollection) {
      nextCursor = JSON.stringify({
        collectionIndex: cursorState.collectionIndex,
        offset: cursorState.offset + pagination.limit,
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
    externalId: string
  ): Promise<ExternalDocument | null> => {
    const separatorIndex = externalId.indexOf(':')
    if (separatorIndex === -1) {
      logger.error('Invalid externalId format, expected collectionId:itemId', { externalId })
      return null
    }

    const docCollectionId = externalId.slice(0, separatorIndex)
    const itemId = externalId.slice(separatorIndex + 1)

    const url = `${WEBFLOW_API}/collections/${docCollectionId}/items/${itemId}`

    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'accept-version': '2.0.0',
      },
    })

    if (!response.ok) {
      if (response.status === 404) return null
      throw new Error(`Failed to get Webflow item: ${response.status}`)
    }

    const item = (await response.json()) as WebflowItem

    const collectionName = await fetchCollectionNameDirect(accessToken, docCollectionId)
    return itemToDocument(item, docCollectionId, collectionName)
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const siteId = sourceConfig.siteId as string
    const collectionId = sourceConfig.collectionId as string | undefined
    const maxItems = sourceConfig.maxItems as string | undefined

    if (!siteId) {
      return { valid: false, error: 'Site ID is required' }
    }

    if (maxItems && (Number.isNaN(Number(maxItems)) || Number(maxItems) <= 0)) {
      return { valid: false, error: 'Max items must be a positive number' }
    }

    try {
      const siteUrl = `${WEBFLOW_API}/sites/${siteId}`
      const siteResponse = await fetchWithRetry(
        siteUrl,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'accept-version': '2.0.0',
          },
        },
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

      if (collectionId) {
        const collectionUrl = `${WEBFLOW_API}/collections/${collectionId}`
        const collectionResponse = await fetchWithRetry(
          collectionUrl,
          {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'accept-version': '2.0.0',
            },
          },
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
      const message = error instanceof Error ? error.message : 'Failed to validate configuration'
      return { valid: false, error: message }
    }
  },

  tagDefinitions: [
    { id: 'collectionName', displayName: 'Collection Name', fieldType: 'text' },
    { id: 'lastModified', displayName: 'Last Modified', fieldType: 'date' },
    { id: 'slug', displayName: 'Slug', fieldType: 'text' },
  ],

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    if (typeof metadata.collectionName === 'string') {
      result.collectionName = metadata.collectionName
    }

    const lastModified = parseTagDate(metadata.lastModified)
    if (lastModified) result.lastModified = lastModified

    if (typeof metadata.slug === 'string') {
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
 * Fetches collection IDs for a site. If a specific collectionId is provided,
 * returns only that ID. Otherwise fetches all collections from the site.
 */
async function fetchCollectionIds(
  accessToken: string,
  siteId: string,
  collectionId?: string
): Promise<string[]> {
  if (collectionId) {
    return [collectionId]
  }

  const url = `${WEBFLOW_API}/sites/${siteId}/collections`
  const response = await fetchWithRetry(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'accept-version': '2.0.0',
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to list Webflow collections: ${response.status}`)
  }

  const data = (await response.json()) as { collections: WebflowCollection[] }
  return (data.collections || []).map((c) => c.id)
}

/**
 * Fetches a collection's display name, caching in syncContext.
 */
async function fetchCollectionName(
  accessToken: string,
  collectionId: string,
  syncContext?: Record<string, unknown>
): Promise<string> {
  const names = (syncContext?.collectionNames ?? {}) as Record<string, string>
  if (names[collectionId]) return names[collectionId]

  const name = await fetchCollectionNameDirect(accessToken, collectionId)

  if (syncContext) {
    const cached = (syncContext.collectionNames ?? {}) as Record<string, string>
    cached[collectionId] = name
    syncContext.collectionNames = cached
  }

  return name
}

/**
 * Fetches a collection's display name directly from the API.
 */
async function fetchCollectionNameDirect(
  accessToken: string,
  collectionId: string
): Promise<string> {
  try {
    const url = `${WEBFLOW_API}/collections/${collectionId}`
    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'accept-version': '2.0.0',
      },
    })

    if (!response.ok) {
      logger.warn('Failed to fetch collection name', {
        collectionId,
        status: response.status,
      })
      return collectionId
    }

    const data = (await response.json()) as WebflowCollection
    return data.displayName || data.slug || collectionId
  } catch (error) {
    logger.warn('Error fetching collection name', {
      collectionId,
      error: toError(error).message,
    })
    return collectionId
  }
}
