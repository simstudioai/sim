import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { NotionIcon } from '@/components/icons'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { joinTagArray, parseMultiValue, parseTagDate } from '@/connectors/utils'

const logger = createLogger('NotionConnector')

const NOTION_API_VERSION = '2022-06-28'
const NOTION_BASE_URL = 'https://api.notion.com/v1'

/**
 * Extracts the title from a Notion page's properties.
 */
function extractTitle(properties: Record<string, unknown>): string {
  for (const value of Object.values(properties)) {
    const prop = value as Record<string, unknown>
    if (prop.type === 'title' && Array.isArray(prop.title) && prop.title.length > 0) {
      return prop.title.map((t: Record<string, unknown>) => (t.plain_text as string) || '').join('')
    }
  }
  return 'Untitled'
}

/**
 * Extracts plain text from a rich_text array.
 */
function richTextToPlain(richText: Record<string, unknown>[]): string {
  return richText.map((t) => (t.plain_text as string) || '').join('')
}

/**
 * Extracts plain text content from Notion blocks.
 */
function blocksToPlainText(blocks: Record<string, unknown>[]): string {
  return blocks
    .map((block) => {
      const type = block.type as string
      const blockData = block[type] as Record<string, unknown> | undefined
      if (!blockData) return ''

      if (type === 'code') {
        const richText = blockData.rich_text as Record<string, unknown>[] | undefined
        const language = (blockData.language as string) || ''
        const code = richText ? richTextToPlain(richText) : ''
        return language ? `\`\`\`${language}\n${code}\n\`\`\`` : `\`\`\`\n${code}\n\`\`\``
      }

      if (type === 'equation') {
        const expression = (blockData.expression as string) || ''
        return expression ? `$$${expression}$$` : ''
      }

      const richText = blockData.rich_text as Record<string, unknown>[] | undefined
      if (!richText) return ''

      const text = richTextToPlain(richText)

      switch (type) {
        case 'heading_1':
          return `# ${text}`
        case 'heading_2':
          return `## ${text}`
        case 'heading_3':
          return `### ${text}`
        case 'bulleted_list_item':
          return `- ${text}`
        case 'numbered_list_item':
          return `1. ${text}`
        case 'to_do': {
          const checked = (blockData.checked as boolean) ? '[x]' : '[ ]'
          return `${checked} ${text}`
        }
        case 'quote':
          return `> ${text}`
        case 'callout':
          return text
        case 'toggle':
          return text
        default:
          return text
      }
    })
    .filter(Boolean)
    .join('\n\n')
}

/**
 * Fetches all block children for a page, handling pagination.
 */
async function fetchAllBlocks(
  accessToken: string,
  pageId: string
): Promise<Record<string, unknown>[]> {
  const allBlocks: Record<string, unknown>[] = []
  let cursor: string | undefined
  let hasMore = true

  while (hasMore) {
    const params = new URLSearchParams({ page_size: '100' })
    if (cursor) params.append('start_cursor', cursor)

    const response = await fetchWithRetry(
      `${NOTION_BASE_URL}/blocks/${pageId}/children?${params.toString()}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Notion-Version': NOTION_API_VERSION,
        },
      }
    )

    if (!response.ok) {
      logger.warn(`Failed to fetch blocks for page ${pageId}`, { status: response.status })
      break
    }

    const data = await response.json()
    allBlocks.push(...(data.results || []))
    cursor = data.next_cursor ?? undefined
    hasMore = data.has_more === true
  }

  return allBlocks
}

/**
 * Extracts multi_select tags from page properties.
 */
function extractTags(properties: Record<string, unknown>): string[] {
  const tags: string[] = []
  for (const value of Object.values(properties)) {
    const prop = value as Record<string, unknown>
    if (prop.type === 'multi_select' && Array.isArray(prop.multi_select)) {
      for (const item of prop.multi_select) {
        const name = (item as Record<string, unknown>).name as string
        if (name) tags.push(name)
      }
    }
    if (prop.type === 'select' && prop.select) {
      const name = (prop.select as Record<string, unknown>).name as string
      if (name) tags.push(name)
    }
  }
  return tags
}

/**
 * Converts a Notion page to a lightweight metadata stub (no content fetching).
 */
function pageToStub(page: Record<string, unknown>): ExternalDocument {
  const pageId = page.id as string
  const properties = (page.properties || {}) as Record<string, unknown>
  const title = extractTitle(properties)
  const url = page.url as string
  const lastEditedTime = (page.last_edited_time as string) ?? ''

  const tags = extractTags(properties)

  return {
    externalId: pageId,
    title: title || 'Untitled',
    content: '',
    contentDeferred: true,
    mimeType: 'text/plain',
    sourceUrl: url,
    contentHash: `notion:${pageId}:${lastEditedTime}`,
    metadata: {
      tags,
      lastModified: page.last_edited_time as string,
      createdTime: page.created_time as string,
      parentType: (page.parent as Record<string, unknown>)?.type,
    },
  }
}

export const notionConnector: ConnectorConfig = {
  id: 'notion',
  name: 'Notion',
  description: 'Sync pages from a Notion workspace',
  version: '1.0.0',
  icon: NotionIcon,

  auth: { mode: 'oauth', provider: 'notion', requiredScopes: [] },

  configFields: [
    {
      id: 'scope',
      title: 'Sync Scope',
      type: 'dropdown',
      required: false,
      options: [
        { label: 'Entire workspace', id: 'workspace' },
        { label: 'Specific database', id: 'database' },
        { label: 'Specific page (and children)', id: 'page' },
      ],
    },
    {
      id: 'databaseSelector',
      title: 'Databases',
      type: 'selector',
      selectorKey: 'notion.databases',
      canonicalParamId: 'databaseId',
      mode: 'basic',
      multi: true,
      placeholder: 'Select one or more databases',
      required: false,
    },
    {
      id: 'databaseId',
      title: 'Database IDs',
      type: 'short-input',
      canonicalParamId: 'databaseId',
      mode: 'advanced',
      multi: true,
      required: false,
      placeholder: 'e.g. 8a3b5f6e-..., 9c4d6e7f-... (comma-separated for multiple)',
    },
    {
      id: 'rootPageId',
      title: 'Page ID',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 8a3b5f6e-1234-5678-abcd-ef0123456789',
    },
    {
      id: 'searchQuery',
      title: 'Search Filter',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. meeting notes, project plan',
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
    const scope = (sourceConfig.scope as string) || 'workspace'
    const databaseIds = parseMultiValue(sourceConfig.databaseId)
    const rootPageId = (sourceConfig.rootPageId as string)?.trim()
    const maxPages = sourceConfig.maxPages ? Number(sourceConfig.maxPages) : 0

    if (scope === 'database' && databaseIds.length > 0) {
      return listFromDatabases(accessToken, databaseIds, maxPages, cursor, syncContext)
    }

    if (scope === 'page' && rootPageId) {
      return listFromParentPage(accessToken, rootPageId, maxPages, cursor, syncContext)
    }

    // Default: workspace-wide search
    const searchQuery = (sourceConfig.searchQuery as string) || ''
    return listFromWorkspace(accessToken, searchQuery, maxPages, cursor, syncContext)
  },

  getDocument: async (
    accessToken: string,
    _sourceConfig: Record<string, unknown>,
    externalId: string,
    _syncContext?: Record<string, unknown>
  ): Promise<ExternalDocument | null> => {
    const response = await fetchWithRetry(`${NOTION_BASE_URL}/pages/${externalId}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Notion-Version': NOTION_API_VERSION,
      },
    })

    if (!response.ok) {
      if (response.status === 404) return null
      throw new Error(`Failed to get Notion page: ${response.status}`)
    }

    const page = await response.json()
    if (page.archived) return null

    try {
      const blocks = await fetchAllBlocks(accessToken, externalId)
      const blockContent = blocksToPlainText(blocks)
      const stub = pageToStub(page)
      const content = blockContent.trim() || stub.title
      return { ...stub, content, contentDeferred: false }
    } catch (error) {
      logger.warn(`Failed to fetch content for Notion page: ${externalId}`, {
        error: toError(error).message,
      })
      return null
    }
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const scope = (sourceConfig.scope as string) || 'workspace'
    const databaseIds = parseMultiValue(sourceConfig.databaseId)
    const rootPageId = (sourceConfig.rootPageId as string)?.trim()
    const maxPages = sourceConfig.maxPages as string | undefined

    if (maxPages && (Number.isNaN(Number(maxPages)) || Number(maxPages) <= 0)) {
      return { valid: false, error: 'Max pages must be a positive number' }
    }

    if (scope === 'database' && databaseIds.length === 0) {
      return {
        valid: false,
        error: 'At least one database is required when scope is "Specific database"',
      }
    }

    if (scope === 'page' && !rootPageId) {
      return { valid: false, error: 'Page ID is required when scope is "Specific page"' }
    }

    try {
      // Verify the token works
      if (scope === 'database' && databaseIds.length > 0) {
        // Verify every database is accessible
        for (const databaseId of databaseIds) {
          const response = await fetchWithRetry(
            `${NOTION_BASE_URL}/databases/${databaseId}`,
            {
              method: 'GET',
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Notion-Version': NOTION_API_VERSION,
              },
            },
            VALIDATE_RETRY_OPTIONS
          )
          if (!response.ok) {
            return {
              valid: false,
              error: `Cannot access database ${databaseId}: ${response.status}`,
            }
          }
        }
      } else if (scope === 'page' && rootPageId) {
        // Verify page is accessible
        const response = await fetchWithRetry(
          `${NOTION_BASE_URL}/pages/${rootPageId}`,
          {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Notion-Version': NOTION_API_VERSION,
            },
          },
          VALIDATE_RETRY_OPTIONS
        )
        if (!response.ok) {
          return { valid: false, error: `Cannot access page: ${response.status}` }
        }
      } else {
        // Workspace scope — just verify token works
        const response = await fetchWithRetry(
          `${NOTION_BASE_URL}/search`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Notion-Version': NOTION_API_VERSION,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ page_size: 1 }),
          },
          VALIDATE_RETRY_OPTIONS
        )
        if (!response.ok) {
          const errorText = await response.text()
          return { valid: false, error: `Cannot access Notion workspace: ${errorText}` }
        }
      }

      return { valid: true }
    } catch (error) {
      const message = getErrorMessage(error, 'Failed to validate configuration')
      return { valid: false, error: message }
    }
  },

  tagDefinitions: [
    { id: 'tags', displayName: 'Tags', fieldType: 'text' },
    { id: 'lastModified', displayName: 'Last Modified', fieldType: 'date' },
    { id: 'created', displayName: 'Created', fieldType: 'date' },
  ],

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    const tags = joinTagArray(metadata.tags)
    if (tags) result.tags = tags

    const lastModified = parseTagDate(metadata.lastModified)
    if (lastModified) result.lastModified = lastModified

    const created = parseTagDate(metadata.createdTime)
    if (created) result.created = created

    return result
  },
}

/**
 * Lists pages from the entire workspace using the search API.
 */
async function listFromWorkspace(
  accessToken: string,
  searchQuery: string,
  maxPages: number,
  cursor?: string,
  syncContext?: Record<string, unknown>
): Promise<ExternalDocumentList> {
  const body: Record<string, unknown> = {
    page_size: 100,
    filter: { value: 'page', property: 'object' },
    sort: { direction: 'descending', timestamp: 'last_edited_time' },
  }

  if (searchQuery.trim()) {
    body.query = searchQuery.trim()
  }

  if (cursor) {
    body.start_cursor = cursor
  }

  logger.info('Listing Notion pages from workspace', { searchQuery, cursor })

  const response = await fetchWithRetry(`${NOTION_BASE_URL}/search`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Notion-Version': NOTION_API_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errorText = await response.text()
    logger.error('Failed to search Notion', { status: response.status, error: errorText })
    throw new Error(`Failed to search Notion: ${response.status}`)
  }

  const data = await response.json()
  const results = (data.results || []) as Record<string, unknown>[]
  const pages = results.filter((r) => r.object === 'page' && !(r.archived as boolean))

  const documents = pages.map(pageToStub)

  const totalFetched = ((syncContext?.totalDocsFetched as number) ?? 0) + documents.length
  if (syncContext) syncContext.totalDocsFetched = totalFetched
  const hitLimit = maxPages > 0 && totalFetched >= maxPages
  if (hitLimit && syncContext) syncContext.listingCapped = true

  const nextCursor = hitLimit ? undefined : ((data.next_cursor as string) ?? undefined)

  return {
    documents,
    nextCursor,
    hasMore: hitLimit ? false : data.has_more === true,
  }
}

/**
 * Lists pages from one or more Notion databases.
 *
 * Notion's `/v1/databases/{database_id}/query` endpoint is per-database — there
 * is no batch query endpoint — so multiple databases are walked sequentially.
 *
 * Cursor format:
 * - Single database: the Notion `start_cursor` string directly, or undefined.
 * - Multiple databases: JSON-encoded `{ databaseIndex, cursor }` where
 *   `databaseIndex` is the position into `databaseIds` currently being drained
 *   and `cursor` is the Notion `start_cursor` for that database (or undefined
 *   when starting a fresh database).
 *
 * Page IDs returned by Notion are globally-unique UUIDs, so each page's
 * `externalId` does not need to be namespaced by database.
 */
async function listFromDatabases(
  accessToken: string,
  databaseIds: string[],
  maxPages: number,
  cursor?: string,
  syncContext?: Record<string, unknown>
): Promise<ExternalDocumentList> {
  let databaseIndex = 0
  let startCursor: string | undefined

  if (cursor) {
    if (databaseIds.length === 1) {
      // Single-database path: cursor is always a bare Notion `next_cursor` string,
      // matching the legacy pre-multi-select format. Never JSON-decode here.
      startCursor = cursor
    } else {
      try {
        const parsed = JSON.parse(cursor) as unknown
        if (
          parsed &&
          typeof parsed === 'object' &&
          typeof (parsed as { databaseIndex?: unknown }).databaseIndex === 'number'
        ) {
          const compound = parsed as { databaseIndex: number; cursor?: string }
          databaseIndex = compound.databaseIndex
          startCursor = typeof compound.cursor === 'string' ? compound.cursor : undefined
        } else {
          // Legacy single-DB cursor carried forward into a now-multi-DB config:
          // treat it as the start cursor for the first database.
          startCursor = cursor
        }
      } catch {
        startCursor = cursor
      }
    }
  }

  const documents: ExternalDocument[] = []
  let nextCursor: string | undefined
  let hasMore = false

  while (databaseIndex < databaseIds.length) {
    const databaseId = databaseIds[databaseIndex]
    const body: Record<string, unknown> = { page_size: 100 }
    if (startCursor) body.start_cursor = startCursor

    logger.info('Querying Notion database', {
      databaseId,
      databaseIndex,
      databaseCount: databaseIds.length,
      startCursor,
    })

    const response = await fetchWithRetry(`${NOTION_BASE_URL}/databases/${databaseId}/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Notion-Version': NOTION_API_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error('Failed to query Notion database', {
        databaseId,
        status: response.status,
        error: errorText,
      })
      throw new Error(`Failed to query Notion database ${databaseId}: ${response.status}`)
    }

    const data = await response.json()
    const results = (data.results || []) as Record<string, unknown>[]
    const pages = results.filter((r) => r.object === 'page' && !(r.archived as boolean))
    documents.push(...pages.map(pageToStub))

    if (data.has_more === true && typeof data.next_cursor === 'string') {
      const nextStart = data.next_cursor as string
      nextCursor =
        databaseIds.length === 1 ? nextStart : JSON.stringify({ databaseIndex, cursor: nextStart })
      hasMore = true
      break
    }

    databaseIndex++
    startCursor = undefined

    if (databaseIndex < databaseIds.length) {
      nextCursor =
        databaseIds.length === 1 ? undefined : JSON.stringify({ databaseIndex, cursor: undefined })
      hasMore = true
      break
    }
  }

  const totalFetched = ((syncContext?.totalDocsFetched as number) ?? 0) + documents.length
  if (syncContext) syncContext.totalDocsFetched = totalFetched
  const hitLimit = maxPages > 0 && totalFetched >= maxPages
  if (hitLimit) {
    if (syncContext) syncContext.listingCapped = true
    hasMore = false
    nextCursor = undefined
  }

  return {
    documents,
    nextCursor: hasMore ? nextCursor : undefined,
    hasMore,
  }
}

/**
 * Lists child pages under a specific parent page.
 *
 * Uses the blocks children endpoint to find child_page blocks,
 * then fetches each page's metadata to build lightweight stubs.
 */
async function listFromParentPage(
  accessToken: string,
  rootPageId: string,
  maxPages: number,
  cursor?: string,
  syncContext?: Record<string, unknown>
): Promise<ExternalDocumentList> {
  const params = new URLSearchParams({ page_size: '100' })
  if (cursor) params.append('start_cursor', cursor)

  logger.info('Listing child pages under root page', { rootPageId, cursor })

  const response = await fetchWithRetry(
    `${NOTION_BASE_URL}/blocks/${rootPageId}/children?${params.toString()}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Notion-Version': NOTION_API_VERSION,
      },
    }
  )

  if (!response.ok) {
    const errorText = await response.text()
    logger.error('Failed to list child blocks', { status: response.status, error: errorText })
    throw new Error(`Failed to list child blocks: ${response.status}`)
  }

  const data = await response.json()
  const blockResults = (data.results || []) as Record<string, unknown>[]

  // Filter to child_page blocks only (child_database blocks cannot be fetched via the Pages API)
  const childPageIds = blockResults
    .filter((b) => b.type === 'child_page')
    .map((b) => b.id as string)

  // Also include the root page itself on the first call (no cursor)
  const pageIdsToFetch = !cursor ? [rootPageId, ...childPageIds] : childPageIds

  // Fetch page metadata (not content) in concurrent batches to build stubs
  const CHILD_PAGE_CONCURRENCY = 5

  const documents: ExternalDocument[] = []
  for (let i = 0; i < pageIdsToFetch.length; i += CHILD_PAGE_CONCURRENCY) {
    const cumulativeSoFar = ((syncContext?.totalDocsFetched as number) ?? 0) + documents.length
    if (maxPages > 0 && cumulativeSoFar >= maxPages) break
    const batch = pageIdsToFetch.slice(i, i + CHILD_PAGE_CONCURRENCY)
    const results = await Promise.all(
      batch.map(async (pageId) => {
        try {
          const pageResponse = await fetchWithRetry(`${NOTION_BASE_URL}/pages/${pageId}`, {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Notion-Version': NOTION_API_VERSION,
            },
          })
          if (!pageResponse.ok) {
            logger.warn(`Failed to fetch child page ${pageId}`, { status: pageResponse.status })
            return null
          }
          const page = await pageResponse.json()
          if (page.archived) return null
          return pageToStub(page)
        } catch (error) {
          logger.warn(`Failed to process child page ${pageId}`, {
            error: toError(error).message,
          })
          return null
        }
      })
    )
    documents.push(...(results.filter(Boolean) as ExternalDocument[]))
  }

  const totalFetched = ((syncContext?.totalDocsFetched as number) ?? 0) + documents.length
  if (syncContext) syncContext.totalDocsFetched = totalFetched
  const hitLimit = maxPages > 0 && totalFetched >= maxPages
  if (hitLimit && syncContext) syncContext.listingCapped = true

  const nextCursor = hitLimit ? undefined : ((data.next_cursor as string) ?? undefined)

  return {
    documents,
    nextCursor,
    hasMore: hitLimit ? false : data.has_more === true,
  }
}
