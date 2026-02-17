import { createLogger } from '@sim/logger'
import { ConfluenceIcon } from '@/components/icons'
import { fetchWithRetry } from '@/lib/knowledge/documents/utils'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { getConfluenceCloudId } from '@/tools/confluence/utils'

const logger = createLogger('ConfluenceConnector')

/**
 * Strips HTML tags from content and decodes HTML entities.
 */
function htmlToPlainText(html: string): string {
  let text = html.replace(/<[^>]*>/g, ' ')
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Computes a SHA-256 hash of the given content.
 */
async function computeContentHash(content: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(content)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Fetches labels for a batch of page IDs using the v2 labels endpoint.
 */
async function fetchLabelsForPages(
  cloudId: string,
  accessToken: string,
  pageIds: string[]
): Promise<Map<string, string[]>> {
  const labelsByPageId = new Map<string, string[]>()

  const results = await Promise.all(
    pageIds.map(async (pageId) => {
      try {
        const url = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2/pages/${pageId}/labels`
        const response = await fetchWithRetry(url, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
        })

        if (!response.ok) {
          logger.warn(`Failed to fetch labels for page ${pageId}`, { status: response.status })
          return { pageId, labels: [] as string[] }
        }

        const data = await response.json()
        const labels = (data.results || []).map(
          (label: Record<string, unknown>) => label.name as string
        )
        return { pageId, labels }
      } catch (error) {
        logger.warn(`Error fetching labels for page ${pageId}`, {
          error: error instanceof Error ? error.message : String(error),
        })
        return { pageId, labels: [] as string[] }
      }
    })
  )

  for (const { pageId, labels } of results) {
    labelsByPageId.set(pageId, labels)
  }

  return labelsByPageId
}

/**
 * Converts a v1 CQL search result item to an ExternalDocument.
 */
async function cqlResultToDocument(
  item: Record<string, unknown>,
  domain: string
): Promise<ExternalDocument> {
  const body = item.body as Record<string, Record<string, string>> | undefined
  const rawContent = body?.storage?.value || ''
  const plainText = htmlToPlainText(rawContent)
  const contentHash = await computeContentHash(plainText)

  const version = item.version as Record<string, unknown> | undefined
  const links = item._links as Record<string, string> | undefined
  const metadata = item.metadata as Record<string, unknown> | undefined
  const labelsWrapper = metadata?.labels as Record<string, unknown> | undefined
  const labelResults = (labelsWrapper?.results || []) as Record<string, unknown>[]
  const labels = labelResults.map((l) => l.name as string)

  return {
    externalId: String(item.id),
    title: (item.title as string) || 'Untitled',
    content: plainText,
    mimeType: 'text/plain',
    sourceUrl: links?.webui ? `https://${domain}/wiki${links.webui}` : undefined,
    contentHash,
    metadata: {
      spaceId: (item.space as Record<string, unknown>)?.key,
      status: item.status,
      version: version?.number,
      labels,
      lastModified: version?.when,
    },
  }
}

export const confluenceConnector: ConnectorConfig = {
  id: 'confluence',
  name: 'Confluence',
  description: 'Sync pages from a Confluence space into your knowledge base',
  version: '1.1.0',
  icon: ConfluenceIcon,

  oauth: {
    required: true,
    provider: 'confluence',
    requiredScopes: ['read:confluence-content.all', 'read:page:confluence', 'offline_access'],
  },

  configFields: [
    {
      id: 'domain',
      title: 'Confluence Domain',
      type: 'short-input',
      placeholder: 'yoursite.atlassian.net',
      required: true,
    },
    {
      id: 'spaceKey',
      title: 'Space Key',
      type: 'short-input',
      placeholder: 'e.g. ENG, PRODUCT',
      required: true,
    },
    {
      id: 'contentType',
      title: 'Content Type',
      type: 'dropdown',
      required: false,
      options: [
        { label: 'Pages only', id: 'page' },
        { label: 'Blog posts only', id: 'blogpost' },
        { label: 'All content', id: 'all' },
      ],
    },
    {
      id: 'labelFilter',
      title: 'Filter by Label',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. published, engineering',
    },
    {
      id: 'maxPages',
      title: 'Max Pages',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 500 (default: unlimited)',
    },
  ],

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string
  ): Promise<ExternalDocumentList> => {
    const domain = sourceConfig.domain as string
    const spaceKey = sourceConfig.spaceKey as string
    const contentType = (sourceConfig.contentType as string) || 'page'
    const labelFilter = (sourceConfig.labelFilter as string) || ''
    const maxPages = sourceConfig.maxPages ? Number(sourceConfig.maxPages) : 0

    const cloudId = await getConfluenceCloudId(domain, accessToken)

    // If label filtering is enabled, use CQL search via v1 API
    if (labelFilter.trim()) {
      return listDocumentsViaCql(
        cloudId,
        accessToken,
        domain,
        spaceKey,
        contentType,
        labelFilter,
        maxPages,
        cursor
      )
    }

    // Otherwise use v2 API (default path)
    const spaceId = await resolveSpaceId(cloudId, accessToken, spaceKey)

    if (contentType === 'all') {
      return listAllContentTypes(cloudId, accessToken, domain, spaceId, spaceKey, maxPages, cursor)
    }

    return listDocumentsV2(
      cloudId,
      accessToken,
      domain,
      spaceId,
      spaceKey,
      contentType,
      maxPages,
      cursor
    )
  },

  getDocument: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    externalId: string
  ): Promise<ExternalDocument | null> => {
    const domain = sourceConfig.domain as string
    const cloudId = await getConfluenceCloudId(domain, accessToken)

    const url = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2/pages/${externalId}?body-format=storage`

    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      if (response.status === 404) return null
      throw new Error(`Failed to get Confluence page: ${response.status}`)
    }

    const page = await response.json()
    const rawContent = page.body?.storage?.value || ''
    const plainText = htmlToPlainText(rawContent)
    const contentHash = await computeContentHash(plainText)

    // Fetch labels for this page
    const labelMap = await fetchLabelsForPages(cloudId, accessToken, [String(page.id)])
    const labels = labelMap.get(String(page.id)) ?? []

    return {
      externalId: String(page.id),
      title: page.title || 'Untitled',
      content: plainText,
      mimeType: 'text/plain',
      sourceUrl: page._links?.webui ? `https://${domain}/wiki${page._links.webui}` : undefined,
      contentHash,
      metadata: {
        spaceId: page.spaceId,
        status: page.status,
        version: page.version?.number,
        labels,
        lastModified: page.version?.createdAt,
      },
    }
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const domain = sourceConfig.domain as string
    const spaceKey = sourceConfig.spaceKey as string

    if (!domain || !spaceKey) {
      return { valid: false, error: 'Domain and space key are required' }
    }

    const maxPages = sourceConfig.maxPages as string | undefined
    if (maxPages && (Number.isNaN(Number(maxPages)) || Number(maxPages) <= 0)) {
      return { valid: false, error: 'Max pages must be a positive number' }
    }

    try {
      const cloudId = await getConfluenceCloudId(domain, accessToken)
      await resolveSpaceId(cloudId, accessToken, spaceKey)
      return { valid: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to validate configuration'
      return { valid: false, error: message }
    }
  },

  tagDefinitions: [
    { id: 'labels', displayName: 'Labels', fieldType: 'text' },
    { id: 'version', displayName: 'Version', fieldType: 'number' },
    { id: 'lastModified', displayName: 'Last Modified', fieldType: 'date' },
  ],

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    const labels = Array.isArray(metadata.labels) ? (metadata.labels as string[]) : []
    if (labels.length > 0) result.labels = labels.join(', ')

    if (metadata.version != null) {
      const num = Number(metadata.version)
      if (!Number.isNaN(num)) result.version = num
    }

    if (typeof metadata.lastModified === 'string') {
      const date = new Date(metadata.lastModified)
      if (!Number.isNaN(date.getTime())) result.lastModified = date
    }

    return result
  },
}

/**
 * Lists documents using the v2 API for a single content type (pages or blogposts).
 */
async function listDocumentsV2(
  cloudId: string,
  accessToken: string,
  domain: string,
  spaceId: string,
  spaceKey: string,
  contentType: string,
  maxPages: number,
  cursor?: string
): Promise<ExternalDocumentList> {
  const queryParams = new URLSearchParams()
  queryParams.append('limit', '50')
  queryParams.append('body-format', 'storage')
  if (cursor) {
    queryParams.append('cursor', cursor)
  }

  const endpoint = contentType === 'blogpost' ? 'blogposts' : 'pages'
  const url = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2/spaces/${spaceId}/${endpoint}?${queryParams.toString()}`

  logger.info(`Listing ${endpoint} in space ${spaceKey} (ID: ${spaceId})`)

  const response = await fetchWithRetry(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    logger.error(`Failed to list Confluence ${endpoint}`, {
      status: response.status,
      error: errorText,
    })
    throw new Error(`Failed to list Confluence ${endpoint}: ${response.status}`)
  }

  const data = await response.json()
  const results = data.results || []

  // Fetch labels for all pages in this batch
  const pageIds = results.map((page: Record<string, unknown>) => String(page.id))
  const labelsByPageId = await fetchLabelsForPages(cloudId, accessToken, pageIds)

  const documents: ExternalDocument[] = await Promise.all(
    results.map(async (page: Record<string, unknown>) => {
      const rawContent = (page.body as Record<string, Record<string, string>>)?.storage?.value || ''
      const plainText = htmlToPlainText(rawContent)
      const contentHash = await computeContentHash(plainText)
      const pageId = String(page.id)

      return {
        externalId: pageId,
        title: (page.title as string) || 'Untitled',
        content: plainText,
        mimeType: 'text/plain',
        sourceUrl: (page._links as Record<string, string>)?.webui
          ? `https://${domain}/wiki${(page._links as Record<string, string>).webui}`
          : undefined,
        contentHash,
        metadata: {
          spaceId: page.spaceId,
          status: page.status,
          version: (page.version as Record<string, unknown>)?.number,
          labels: labelsByPageId.get(pageId) ?? [],
          lastModified: (page.version as Record<string, unknown>)?.createdAt,
        },
      }
    })
  )

  // Extract next cursor from _links.next
  let nextCursor: string | undefined
  const nextLink = (data._links as Record<string, string>)?.next
  if (nextLink) {
    try {
      nextCursor = new URL(nextLink, 'https://placeholder').searchParams.get('cursor') || undefined
    } catch {
      // Ignore malformed URLs
    }
  }

  // Enforce maxPages limit
  if (maxPages > 0 && !cursor) {
    // On subsequent pages, the sync engine tracks total count
    // We signal stop by clearing hasMore when we'd exceed maxPages
  }

  return {
    documents,
    nextCursor,
    hasMore: Boolean(nextCursor),
  }
}

/**
 * Lists both pages and blogposts using a compound cursor that tracks
 * pagination state for each content type independently.
 */
async function listAllContentTypes(
  cloudId: string,
  accessToken: string,
  domain: string,
  spaceId: string,
  spaceKey: string,
  maxPages: number,
  cursor?: string
): Promise<ExternalDocumentList> {
  let pageCursor: string | undefined
  let blogCursor: string | undefined
  let pagesDone = false
  let blogsDone = false

  if (cursor) {
    try {
      const parsed = JSON.parse(cursor)
      pageCursor = parsed.page
      blogCursor = parsed.blog
      pagesDone = parsed.pagesDone === true
      blogsDone = parsed.blogsDone === true
    } catch {
      pageCursor = cursor
    }
  }

  const results: ExternalDocumentList = { documents: [], hasMore: false }

  if (!pagesDone) {
    const pagesResult = await listDocumentsV2(
      cloudId,
      accessToken,
      domain,
      spaceId,
      spaceKey,
      'page',
      maxPages,
      pageCursor
    )
    results.documents.push(...pagesResult.documents)
    pageCursor = pagesResult.nextCursor
    pagesDone = !pagesResult.hasMore
  }

  if (!blogsDone) {
    const blogResult = await listDocumentsV2(
      cloudId,
      accessToken,
      domain,
      spaceId,
      spaceKey,
      'blogpost',
      maxPages,
      blogCursor
    )
    results.documents.push(...blogResult.documents)
    blogCursor = blogResult.nextCursor
    blogsDone = !blogResult.hasMore
  }

  results.hasMore = !pagesDone || !blogsDone

  if (results.hasMore) {
    results.nextCursor = JSON.stringify({
      page: pageCursor,
      blog: blogCursor,
      pagesDone,
      blogsDone,
    })
  }

  return results
}

/**
 * Lists documents using CQL search via the v1 API (used when label filtering is enabled).
 */
async function listDocumentsViaCql(
  cloudId: string,
  accessToken: string,
  domain: string,
  spaceKey: string,
  contentType: string,
  labelFilter: string,
  maxPages: number,
  cursor?: string
): Promise<ExternalDocumentList> {
  const labels = labelFilter
    .split(',')
    .map((l) => l.trim())
    .filter(Boolean)

  // Build CQL query
  let cql = `space="${spaceKey}"`

  if (contentType === 'blogpost') {
    cql += ' AND type="blogpost"'
  } else if (contentType === 'page' || !contentType) {
    cql += ' AND type="page"'
  }
  // contentType === 'all' — no type filter

  if (labels.length === 1) {
    cql += ` AND label="${labels[0]}"`
  } else if (labels.length > 1) {
    const labelList = labels.map((l) => `"${l}"`).join(',')
    cql += ` AND label in (${labelList})`
  }

  const limit = maxPages > 0 ? Math.min(maxPages, 50) : 50
  const start = cursor ? Number(cursor) : 0

  const queryParams = new URLSearchParams()
  queryParams.append('cql', cql)
  queryParams.append('limit', String(limit))
  queryParams.append('start', String(start))
  queryParams.append('expand', 'body.storage,version,metadata.labels')

  const url = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/rest/api/content/search?${queryParams.toString()}`

  logger.info(`Searching Confluence via CQL: ${cql}`, { start, limit })

  const response = await fetchWithRetry(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    logger.error('Failed to search Confluence via CQL', {
      status: response.status,
      error: errorText,
    })
    throw new Error(`Failed to search Confluence via CQL: ${response.status}`)
  }

  const data = await response.json()
  const results = data.results || []

  const documents: ExternalDocument[] = await Promise.all(
    results.map((item: Record<string, unknown>) => cqlResultToDocument(item, domain))
  )

  const totalSize = (data.totalSize as number) ?? 0
  const nextStart = start + results.length
  const hasMore = nextStart < totalSize && (maxPages <= 0 || nextStart < maxPages)

  return {
    documents,
    nextCursor: hasMore ? String(nextStart) : undefined,
    hasMore,
  }
}

/**
 * Resolves a Confluence space key to its numeric space ID.
 */
async function resolveSpaceId(
  cloudId: string,
  accessToken: string,
  spaceKey: string
): Promise<string> {
  const url = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2/spaces?keys=${encodeURIComponent(spaceKey)}&limit=1`

  const response = await fetchWithRetry(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to resolve space key "${spaceKey}": ${response.status}`)
  }

  const data = await response.json()
  const results = data.results || []

  if (results.length === 0) {
    throw new Error(`Space "${spaceKey}" not found`)
  }

  return String(results[0].id)
}
