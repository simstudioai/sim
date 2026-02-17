import { createLogger } from '@sim/logger'
import { NotionIcon } from '@/components/icons'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'

const logger = createLogger('NotionConnector')

const NOTION_API_VERSION = '2022-06-28'
const NOTION_BASE_URL = 'https://api.notion.com/v1'

/**
 * Computes a SHA-256 hash of the given content.
 */
async function computeContentHash(content: string): Promise<string> {
  const data = new TextEncoder().encode(content)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

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

    const response = await fetch(
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
 * Converts a Notion page to an ExternalDocument by fetching its block content.
 */
async function pageToExternalDocument(
  accessToken: string,
  page: Record<string, unknown>
): Promise<ExternalDocument> {
  const pageId = page.id as string
  const properties = (page.properties || {}) as Record<string, unknown>
  const title = extractTitle(properties)
  const url = page.url as string

  // Fetch page content
  const blocks = await fetchAllBlocks(accessToken, pageId)
  const plainText = blocksToPlainText(blocks)
  const contentHash = await computeContentHash(plainText)

  // Extract tags from multi_select/select properties
  const tags = extractTags(properties)

  return {
    externalId: pageId,
    title: title || 'Untitled',
    content: plainText,
    mimeType: 'text/plain',
    sourceUrl: url,
    contentHash,
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
  description: 'Sync pages from a Notion workspace into your knowledge base',
  version: '1.0.0',
  icon: NotionIcon,

  oauth: {
    required: true,
    provider: 'notion',
    requiredScopes: [],
  },

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
      id: 'databaseId',
      title: 'Database ID',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 8a3b5f6e-1234-5678-abcd-ef0123456789',
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
    cursor?: string
  ): Promise<ExternalDocumentList> => {
    const scope = (sourceConfig.scope as string) || 'workspace'
    const databaseId = (sourceConfig.databaseId as string)?.trim()
    const rootPageId = (sourceConfig.rootPageId as string)?.trim()
    const maxPages = sourceConfig.maxPages ? Number(sourceConfig.maxPages) : 0

    if (scope === 'database' && databaseId) {
      return listFromDatabase(accessToken, databaseId, maxPages, cursor)
    }

    if (scope === 'page' && rootPageId) {
      return listFromParentPage(accessToken, rootPageId, maxPages, cursor)
    }

    // Default: workspace-wide search
    const searchQuery = (sourceConfig.searchQuery as string) || ''
    return listFromWorkspace(accessToken, searchQuery, maxPages, cursor)
  },

  getDocument: async (
    accessToken: string,
    _sourceConfig: Record<string, unknown>,
    externalId: string
  ): Promise<ExternalDocument | null> => {
    const response = await fetch(`${NOTION_BASE_URL}/pages/${externalId}`, {
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
    return pageToExternalDocument(accessToken, page)
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const scope = (sourceConfig.scope as string) || 'workspace'
    const databaseId = (sourceConfig.databaseId as string)?.trim()
    const rootPageId = (sourceConfig.rootPageId as string)?.trim()
    const maxPages = sourceConfig.maxPages as string | undefined

    if (maxPages && (Number.isNaN(Number(maxPages)) || Number(maxPages) <= 0)) {
      return { valid: false, error: 'Max pages must be a positive number' }
    }

    if (scope === 'database' && !databaseId) {
      return { valid: false, error: 'Database ID is required when scope is "Specific database"' }
    }

    if (scope === 'page' && !rootPageId) {
      return { valid: false, error: 'Page ID is required when scope is "Specific page"' }
    }

    try {
      // Verify the token works
      if (scope === 'database' && databaseId) {
        // Verify database is accessible
        const response = await fetch(`${NOTION_BASE_URL}/databases/${databaseId}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Notion-Version': NOTION_API_VERSION,
          },
        })
        if (!response.ok) {
          return { valid: false, error: `Cannot access database: ${response.status}` }
        }
      } else if (scope === 'page' && rootPageId) {
        // Verify page is accessible
        const response = await fetch(`${NOTION_BASE_URL}/pages/${rootPageId}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Notion-Version': NOTION_API_VERSION,
          },
        })
        if (!response.ok) {
          return { valid: false, error: `Cannot access page: ${response.status}` }
        }
      } else {
        // Workspace scope — just verify token works
        const response = await fetch(`${NOTION_BASE_URL}/search`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Notion-Version': NOTION_API_VERSION,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ page_size: 1 }),
        })
        if (!response.ok) {
          const errorText = await response.text()
          return { valid: false, error: `Cannot access Notion workspace: ${errorText}` }
        }
      }

      return { valid: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to validate configuration'
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

    const tags = Array.isArray(metadata.tags) ? (metadata.tags as string[]) : []
    if (tags.length > 0) result.tags = tags.join(', ')

    if (typeof metadata.lastModified === 'string') {
      const date = new Date(metadata.lastModified)
      if (!Number.isNaN(date.getTime())) result.lastModified = date
    }

    if (typeof metadata.createdTime === 'string') {
      const date = new Date(metadata.createdTime)
      if (!Number.isNaN(date.getTime())) result.created = date
    }

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
  cursor?: string
): Promise<ExternalDocumentList> {
  const body: Record<string, unknown> = {
    page_size: 20,
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

  const response = await fetch(`${NOTION_BASE_URL}/search`, {
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

  const documents = await processPages(accessToken, pages)
  const nextCursor = (data.next_cursor as string) ?? undefined

  return {
    documents,
    nextCursor,
    hasMore: data.has_more === true && (maxPages <= 0 || documents.length < maxPages),
  }
}

/**
 * Lists pages from a specific Notion database.
 */
async function listFromDatabase(
  accessToken: string,
  databaseId: string,
  maxPages: number,
  cursor?: string
): Promise<ExternalDocumentList> {
  const body: Record<string, unknown> = {
    page_size: 20,
  }

  if (cursor) {
    body.start_cursor = cursor
  }

  logger.info('Querying Notion database', { databaseId, cursor })

  const response = await fetch(`${NOTION_BASE_URL}/databases/${databaseId}/query`, {
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
    logger.error('Failed to query Notion database', { status: response.status, error: errorText })
    throw new Error(`Failed to query Notion database: ${response.status}`)
  }

  const data = await response.json()
  const results = (data.results || []) as Record<string, unknown>[]
  const pages = results.filter((r) => r.object === 'page' && !(r.archived as boolean))

  const documents = await processPages(accessToken, pages)
  const nextCursor = (data.next_cursor as string) ?? undefined

  return {
    documents,
    nextCursor,
    hasMore: data.has_more === true && (maxPages <= 0 || documents.length < maxPages),
  }
}

/**
 * Lists child pages under a specific parent page.
 *
 * Uses the blocks children endpoint to find child_page blocks,
 * then fetches each page's content.
 */
async function listFromParentPage(
  accessToken: string,
  rootPageId: string,
  maxPages: number,
  cursor?: string
): Promise<ExternalDocumentList> {
  const params = new URLSearchParams({ page_size: '100' })
  if (cursor) params.append('start_cursor', cursor)

  logger.info('Listing child pages under root page', { rootPageId, cursor })

  const response = await fetch(
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
  const blocks = (data.results || []) as Record<string, unknown>[]

  // Filter to child_page and child_database blocks
  const childPageIds = blocks
    .filter((b) => b.type === 'child_page' || b.type === 'child_database')
    .map((b) => b.id as string)

  // Also include the root page itself on the first call (no cursor)
  const pageIdsToFetch = !cursor ? [rootPageId, ...childPageIds] : childPageIds

  // Fetch each child page
  const documents: ExternalDocument[] = []
  for (const pageId of pageIdsToFetch) {
    if (maxPages > 0 && documents.length >= maxPages) break

    try {
      const pageResponse = await fetch(`${NOTION_BASE_URL}/pages/${pageId}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Notion-Version': NOTION_API_VERSION,
        },
      })

      if (!pageResponse.ok) {
        logger.warn(`Failed to fetch child page ${pageId}`, { status: pageResponse.status })
        continue
      }

      const page = await pageResponse.json()
      if (page.archived) continue

      const doc = await pageToExternalDocument(accessToken, page)
      documents.push(doc)
    } catch (error) {
      logger.warn(`Failed to process child page ${pageId}`, {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const nextCursor = (data.next_cursor as string) ?? undefined

  return {
    documents,
    nextCursor,
    hasMore: data.has_more === true && (maxPages <= 0 || documents.length < maxPages),
  }
}

/**
 * Converts an array of Notion page objects to ExternalDocuments.
 */
async function processPages(
  accessToken: string,
  pages: Record<string, unknown>[]
): Promise<ExternalDocument[]> {
  const documents: ExternalDocument[] = []
  for (const page of pages) {
    try {
      const doc = await pageToExternalDocument(accessToken, page)
      documents.push(doc)
    } catch (error) {
      logger.warn(`Failed to process Notion page ${page.id}`, {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return documents
}
