import { createLogger } from '@sim/logger'
import { ConfluenceIcon } from '@/components/icons'
import { toError } from '@/lib/core/utils/helpers'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { htmlToPlainText, joinTagArray, parseTagDate } from '@/connectors/utils'
import { getConfluenceCloudId } from '@/tools/confluence/utils'

const logger = createLogger('ConfluenceConnector')

/**
 * Escapes a value for use inside CQL double-quoted strings.
 */
export function escapeCql(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/**
 * Fetches labels for a batch of page IDs using the v2 labels endpoint.
 */
const LABEL_FETCH_CONCURRENCY = 5

async function fetchLabelsForPages(
  cloudId: string,
  accessToken: string,
  pageIds: string[]
): Promise<Map<string, string[]>> {
  const labelsByPageId = new Map<string, string[]>()

  for (let i = 0; i < pageIds.length; i += LABEL_FETCH_CONCURRENCY) {
    const batch = pageIds.slice(i, i + LABEL_FETCH_CONCURRENCY)
    const results = await Promise.all(
      batch.map(async (pageId) => {
        try {
          let data: Record<string, unknown> | null = null
          for (const contentType of ['pages', 'blogposts']) {
            const url = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2/${contentType}/${pageId}/labels`
            const response = await fetchWithRetry(url, {
              method: 'GET',
              headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${accessToken}`,
              },
            })

            if (response.ok) {
              data = await response.json()
              break
            }
            if (response.status !== 404) {
              logger.warn(`Failed to fetch labels for ${contentType} ${pageId}`, {
                status: response.status,
              })
            }
          }

          if (!data) {
            return { pageId, labels: [] as string[] }
          }

          const labels = ((data.results as Record<string, unknown>[]) || []).map(
            (label) => label.name as string
          )
          return { pageId, labels }
        } catch (error) {
          logger.warn(`Error fetching labels for page ${pageId}`, {
            error: toError(error).message,
          })
          return { pageId, labels: [] as string[] }
        }
      })
    )

    for (const { pageId, labels } of results) {
      labelsByPageId.set(pageId, labels)
    }
  }

  return labelsByPageId
}

/**
 * Converts a v1 CQL search result item to a lightweight metadata stub.
 */
function cqlResultToStub(item: Record<string, unknown>, domain: string): ExternalDocument {
  const version = item.version as Record<string, unknown> | undefined
  const links = item._links as Record<string, string> | undefined
  const metadata = item.metadata as Record<string, unknown> | undefined
  const labelsWrapper = metadata?.labels as Record<string, unknown> | undefined
  const labelResults = (labelsWrapper?.results || []) as Record<string, unknown>[]
  const labels = labelResults.map((l) => l.name as string)
  const versionNumber = version?.number

  return {
    externalId: String(item.id),
    title: (item.title as string) || 'Untitled',
    content: '',
    contentDeferred: true,
    mimeType: 'text/plain',
    sourceUrl: links?.webui ? `https://${domain}/wiki${links.webui}` : undefined,
    contentHash: `confluence:${item.id}:${versionNumber ?? ''}`,
    metadata: {
      spaceId: (item.space as Record<string, unknown>)?.key,
      status: item.status,
      version: versionNumber,
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

  auth: {
    mode: 'oauth',
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
      id: 'spaceSelector',
      title: 'Space',
      type: 'selector',
      selectorKey: 'confluence.spaces',
      canonicalParamId: 'spaceKey',
      mode: 'basic',
      dependsOn: ['domain'],
      placeholder: 'Select a space',
      required: true,
    },
    {
      id: 'spaceKey',
      title: 'Space Key',
      type: 'short-input',
      canonicalParamId: 'spaceKey',
      mode: 'advanced',
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
    cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const domain = sourceConfig.domain as string
    const spaceKey = sourceConfig.spaceKey as string
    const contentType = (sourceConfig.contentType as string) || 'page'
    const labelFilter = (sourceConfig.labelFilter as string) || ''
    const maxPages = sourceConfig.maxPages ? Number(sourceConfig.maxPages) : 0

    let cloudId = syncContext?.cloudId as string | undefined
    if (!cloudId) {
      cloudId = await getConfluenceCloudId(domain, accessToken)
      if (syncContext) syncContext.cloudId = cloudId
    }

    if (labelFilter.trim()) {
      return listDocumentsViaCql(
        cloudId,
        accessToken,
        domain,
        spaceKey,
        contentType,
        labelFilter,
        maxPages,
        cursor,
        syncContext
      )
    }

    let spaceId = syncContext?.spaceId as string | undefined
    if (!spaceId) {
      spaceId = await resolveSpaceId(cloudId, accessToken, spaceKey)
      if (syncContext) syncContext.spaceId = spaceId
    }

    if (contentType === 'all') {
      return listAllContentTypes(
        cloudId,
        accessToken,
        domain,
        spaceId,
        spaceKey,
        maxPages,
        cursor,
        syncContext
      )
    }

    return listDocumentsV2(
      cloudId,
      accessToken,
      domain,
      spaceId,
      spaceKey,
      contentType,
      maxPages,
      cursor,
      syncContext
    )
  },

  getDocument: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    externalId: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocument | null> => {
    const domain = sourceConfig.domain as string
    let cloudId = syncContext?.cloudId as string | undefined
    if (!cloudId) {
      cloudId = await getConfluenceCloudId(domain, accessToken)
      if (syncContext) syncContext.cloudId = cloudId
    }

    // Try pages first, fall back to blogposts if not found
    let page: Record<string, unknown> | null = null
    for (const endpoint of ['pages', 'blogposts']) {
      const url = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2/${endpoint}/${externalId}?body-format=storage`
      const response = await fetchWithRetry(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
      })

      if (response.ok) {
        page = await response.json()
        break
      }
      if (response.status !== 404) {
        throw new Error(`Failed to get Confluence content: ${response.status}`)
      }
    }

    if (!page) return null
    const body = page.body as Record<string, unknown> | undefined
    const storage = body?.storage as Record<string, unknown> | undefined
    const rawContent = (storage?.value as string) || ''
    const plainText = htmlToPlainText(rawContent)

    const labelMap = await fetchLabelsForPages(cloudId, accessToken, [String(page.id)])
    const labels = labelMap.get(String(page.id)) ?? []

    const links = page._links as Record<string, unknown> | undefined
    const version = page.version as Record<string, unknown> | undefined
    const versionNumber = version?.number

    return {
      externalId: String(page.id),
      title: (page.title as string) || 'Untitled',
      content: plainText,
      contentDeferred: false,
      mimeType: 'text/plain',
      sourceUrl: links?.webui ? `https://${domain}/wiki${links.webui}` : undefined,
      contentHash: `confluence:${page.id}:${versionNumber ?? ''}`,
      metadata: {
        spaceId: page.spaceId,
        status: page.status,
        version: versionNumber,
        labels,
        lastModified: version?.createdAt,
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
      const spaceUrl = `https://api.atlassian.com/ex/confluence/${cloudId}/wiki/api/v2/spaces?keys=${encodeURIComponent(spaceKey)}&limit=1`
      const response = await fetchWithRetry(
        spaceUrl,
        {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
        },
        VALIDATE_RETRY_OPTIONS
      )
      if (!response.ok) {
        return { valid: false, error: `Failed to validate space: ${response.status}` }
      }
      const data = await response.json()
      if (!data.results?.length) {
        return { valid: false, error: `Space "${spaceKey}" not found` }
      }
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

    const joined = joinTagArray(metadata.labels)
    if (joined) result.labels = joined

    if (metadata.version != null) {
      const num = Number(metadata.version)
      if (!Number.isNaN(num)) result.version = num
    }

    const lastModified = parseTagDate(metadata.lastModified)
    if (lastModified) result.lastModified = lastModified

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
  cursor?: string,
  syncContext?: Record<string, unknown>
): Promise<ExternalDocumentList> {
  const queryParams = new URLSearchParams()
  queryParams.append('limit', '250')
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

  const documents: ExternalDocument[] = results.map((page: Record<string, unknown>) => {
    const pageId = String(page.id)
    const version = page.version as Record<string, unknown> | undefined
    const versionNumber = version?.number

    return {
      externalId: pageId,
      title: (page.title as string) || 'Untitled',
      content: '',
      contentDeferred: true,
      mimeType: 'text/plain',
      sourceUrl: (page._links as Record<string, string>)?.webui
        ? `https://${domain}/wiki${(page._links as Record<string, string>).webui}`
        : undefined,
      contentHash: `confluence:${pageId}:${versionNumber ?? ''}`,
      metadata: {
        spaceId: page.spaceId,
        status: page.status,
        version: versionNumber,
        labels: [],
        lastModified: version?.createdAt,
      },
    }
  })

  let nextCursor: string | undefined
  const nextLink = (data._links as Record<string, string>)?.next
  if (nextLink) {
    try {
      nextCursor = new URL(nextLink, 'https://placeholder').searchParams.get('cursor') || undefined
    } catch {
      // Ignore malformed URLs
    }
  }

  const totalFetched = ((syncContext?.totalDocsFetched as number) ?? 0) + documents.length
  if (syncContext) syncContext.totalDocsFetched = totalFetched
  const hitLimit = maxPages > 0 && totalFetched >= maxPages
  if (hitLimit && syncContext) syncContext.listingCapped = true

  return {
    documents,
    nextCursor: hitLimit ? undefined : nextCursor,
    hasMore: hitLimit ? false : Boolean(nextCursor),
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
  cursor?: string,
  syncContext?: Record<string, unknown>
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
      pageCursor,
      syncContext
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
      blogCursor,
      syncContext
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
  cursor?: string,
  syncContext?: Record<string, unknown>
): Promise<ExternalDocumentList> {
  const labels = labelFilter
    .split(',')
    .map((l) => l.trim())
    .filter(Boolean)

  // Build CQL query
  let cql = `space="${escapeCql(spaceKey)}"`

  if (contentType === 'blogpost') {
    cql += ' AND type="blogpost"'
  } else if (contentType === 'page' || !contentType) {
    cql += ' AND type="page"'
  }
  // contentType === 'all' — no type filter

  if (labels.length === 1) {
    cql += ` AND label="${escapeCql(labels[0])}"`
  } else if (labels.length > 1) {
    const labelList = labels.map((l) => `"${escapeCql(l)}"`).join(',')
    cql += ` AND label in (${labelList})`
  }

  const limit = maxPages > 0 ? Math.min(maxPages, 50) : 50
  const start = cursor ? Number(cursor) : 0

  const queryParams = new URLSearchParams()
  queryParams.append('cql', cql)
  queryParams.append('limit', String(limit))
  queryParams.append('start', String(start))
  queryParams.append('expand', 'version,metadata.labels')

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

  const documents: ExternalDocument[] = results.map((item: Record<string, unknown>) =>
    cqlResultToStub(item, domain)
  )

  const totalFetched = ((syncContext?.totalDocsFetched as number) ?? 0) + documents.length
  if (syncContext) syncContext.totalDocsFetched = totalFetched
  const hitLimit = maxPages > 0 && totalFetched >= maxPages
  if (hitLimit && syncContext) syncContext.listingCapped = true

  const totalSize = (data.totalSize as number) ?? 0
  const nextStart = start + results.length
  const hasMore = !hitLimit && nextStart < totalSize

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
