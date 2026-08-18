import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import { notionConnectorMeta } from '@/connectors/notion/meta'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { joinTagArray, parseMultiValue, parseTagDate } from '@/connectors/utils'

const logger = createLogger('NotionConnector')

const NOTION_API_VERSION = '2022-06-28'
const NOTION_BASE_URL = 'https://api.notion.com/v1'

/**
 * Notion allows an average of ~3 requests/second per connection, so the one
 * place this connector fans out stays at or below that.
 */
const NOTION_CONCURRENCY = 3

/** Maximum nesting depth walked by {@link fetchBlockTree}. */
const MAX_BLOCK_DEPTH = 5

/** Upper bound on blocks pulled for a single page, to bound time and memory. */
const MAX_BLOCKS_PER_PAGE = 2000

/**
 * A Notion block with its recursively fetched children attached.
 */
interface NotionBlock extends Record<string, unknown> {
  children?: NotionBlock[]
}

/**
 * Per-page traversal state for {@link fetchBlockTree}.
 *
 * `remaining` is the block budget still available; `truncated` records that the
 * walk stopped before the page was exhausted, so the cut is logged instead of
 * silently shrinking the indexed content.
 */
interface BlockWalkState {
  remaining: number
  truncated: boolean
}

/**
 * Block types that own their own document and must not be inlined into the
 * parent page's content — they are listed and synced separately.
 */
const NON_RECURSIVE_BLOCK_TYPES = new Set(['child_page', 'child_database'])

/**
 * Container blocks whose children are rendered at the parent's indent level
 * rather than one level deeper.
 */
const TRANSPARENT_CONTAINER_TYPES = new Set(['table', 'column_list', 'column', 'synced_block'])

/**
 * Notion caps every paginated endpoint at 100 results. When a `maxPages` cap is
 * configured, the final request asks only for what is still needed.
 */
function pageSizeFor(maxPages: number, syncContext?: Record<string, unknown>): number {
  if (maxPages <= 0) return 100
  const fetched = (syncContext?.totalDocsFetched as number) ?? 0
  return Math.max(1, Math.min(100, maxPages - fetched))
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
 * Renders a single block's own text, excluding its children.
 *
 * Covers the block types that carry no `rich_text` field (`table_row` uses
 * `cells`, `child_page`/`child_database` use `title`, media blocks use
 * `caption`), which would otherwise contribute nothing to the indexed content.
 */
function renderBlockSelf(type: string, blockData: Record<string, unknown>): string {
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

  if (type === 'table_row') {
    const cells = blockData.cells as Record<string, unknown>[][] | undefined
    if (!Array.isArray(cells)) return ''
    const rendered = cells.map((cell) => (Array.isArray(cell) ? richTextToPlain(cell) : ''))
    return rendered.some(Boolean) ? rendered.join(' | ') : ''
  }

  if (type === 'child_page' || type === 'child_database') {
    return (blockData.title as string) || ''
  }

  if (type === 'divider') return '---'

  if (type === 'bookmark' || type === 'embed' || type === 'link_preview') {
    const url = (blockData.url as string) || ''
    const caption = blockData.caption as Record<string, unknown>[] | undefined
    const captionText = Array.isArray(caption) ? richTextToPlain(caption) : ''
    return [captionText, url].filter(Boolean).join(' ')
  }

  const richText = blockData.rich_text as Record<string, unknown>[] | undefined
  if (!richText) {
    // Media/file blocks carry their only text in `caption`.
    const caption = blockData.caption as Record<string, unknown>[] | undefined
    return Array.isArray(caption) ? richTextToPlain(caption) : ''
  }

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
    default:
      return text
  }
}

/**
 * Extracts plain text content from a Notion block tree, indenting nested
 * children so structure survives into the indexed text.
 */
function blocksToPlainText(blocks: NotionBlock[], depth = 0): string {
  const indent = '  '.repeat(depth)
  const parts: string[] = []

  for (const block of blocks) {
    const type = block.type as string
    const blockData = block[type] as Record<string, unknown> | undefined
    const self = blockData ? renderBlockSelf(type, blockData) : ''

    if (self) {
      parts.push(
        indent
          ? self
              .split('\n')
              .map((line) => (line ? indent + line : line))
              .join('\n')
          : self
      )
    }

    const children = block.children
    if (children?.length) {
      const childDepth = TRANSPARENT_CONTAINER_TYPES.has(type) ? depth : depth + 1
      const nested = blocksToPlainText(children, childDepth)
      if (nested) parts.push(nested)
    }
  }

  return parts.join('\n\n')
}

/**
 * Fetches one level of block children, handling pagination.
 *
 * Throws on a non-ok response rather than returning a partial level: the caller
 * stores a metadata-based `contentHash`, so silently persisting truncated
 * content would make the truncation permanent (the hash matches on every later
 * sync and the page is never re-fetched).
 */
async function fetchBlockChildren(
  accessToken: string,
  blockId: string,
  state: BlockWalkState
): Promise<NotionBlock[]> {
  const level: NotionBlock[] = []
  let cursor: string | undefined
  let hasMore = true

  while (hasMore && state.remaining > 0) {
    const params = new URLSearchParams({
      page_size: String(Math.min(100, state.remaining)),
    })
    if (cursor) params.append('start_cursor', cursor)

    const response = await fetchWithRetry(
      `${NOTION_BASE_URL}/blocks/${encodeURIComponent(blockId)}/children?${params.toString()}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Notion-Version': NOTION_API_VERSION,
        },
      }
    )

    if (!response.ok) {
      throw new Error(`Failed to fetch blocks for ${blockId}: ${response.status}`)
    }

    const data = await response.json()
    const results = (data.results || []) as NotionBlock[]
    level.push(...results)
    state.remaining -= results.length
    cursor = data.next_cursor ?? undefined
    hasMore = data.has_more === true
  }

  if (hasMore) state.truncated = true

  return level
}

/**
 * Recursively fetches a page's block tree.
 *
 * `/v1/blocks/{id}/children` returns only the first level of children, so any
 * block with `has_children: true` (toggles, callouts, columns, tables, nested
 * lists) must be expanded with a further request or its content is lost.
 * Recursion is bounded by {@link MAX_BLOCK_DEPTH} and {@link MAX_BLOCKS_PER_PAGE}.
 *
 * The walk is sequential. Notion allows an average of ~3 requests/second per
 * connection, so parallelising the expansion only converts into 429s and
 * backoff — and a per-level fan-out would compound to `n^depth` requests
 * in flight, which is far past that limit.
 */
async function fetchBlockTree(
  accessToken: string,
  blockId: string,
  depth: number,
  state: BlockWalkState
): Promise<NotionBlock[]> {
  if (depth > MAX_BLOCK_DEPTH || state.remaining <= 0) {
    state.truncated = true
    return []
  }

  const level = await fetchBlockChildren(accessToken, blockId, state)

  for (const block of level) {
    if (block.has_children !== true) continue
    if (NON_RECURSIVE_BLOCK_TYPES.has(block.type as string)) continue
    if (state.remaining <= 0) {
      state.truncated = true
      break
    }
    block.children = await fetchBlockTree(accessToken, block.id as string, depth + 1, state)
  }

  return level
}

/**
 * Fetches the complete block tree for a page, logging when the traversal is cut
 * short by the depth or block bounds so truncation is never silent.
 */
async function fetchAllBlocks(accessToken: string, pageId: string): Promise<NotionBlock[]> {
  const state: BlockWalkState = { remaining: MAX_BLOCKS_PER_PAGE, truncated: false }
  const blocks = await fetchBlockTree(accessToken, pageId, 0, state)

  if (state.truncated) {
    logger.warn('Notion page content truncated during block walk', {
      pageId,
      maxBlocks: MAX_BLOCKS_PER_PAGE,
      maxDepth: MAX_BLOCK_DEPTH,
      blocksFetched: MAX_BLOCKS_PER_PAGE - state.remaining,
    })
  }

  return blocks
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
    /**
     * The `v2` namespace is a one-time invalidation. The hash is metadata-only,
     * so a stored page whose `last_edited_time` has not moved is classified
     * `unchanged` and never re-hydrated — meaning it would keep the truncated
     * single-level block content indexed before recursive block fetching landed
     * (tables in particular were indexed empty). Bumping the namespace forces
     * one re-hydration per page, after which normal hash gating resumes.
     */
    contentHash: `notion:v2:${pageId}:${lastEditedTime}`,
    metadata: {
      tags,
      lastModified: page.last_edited_time as string,
      createdTime: page.created_time as string,
      parentType: (page.parent as Record<string, unknown>)?.type,
    },
  }
}

export const notionConnector: ConnectorConfig = {
  ...notionConnectorMeta,

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
    const response = await fetchWithRetry(
      `${NOTION_BASE_URL}/pages/${encodeURIComponent(externalId)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Notion-Version': NOTION_API_VERSION,
        },
      }
    )

    if (!response.ok) {
      if (response.status === 404) return null
      throw new Error(`Failed to get Notion page: ${response.status}`)
    }

    const page = await response.json()
    if (page.archived) return null

    /**
     * A block-fetch failure propagates rather than degrading to `null`. The
     * stored `contentHash` is metadata-based, so persisting a partial page
     * would freeze the truncation in place; a thrown error is instead recorded
     * by the sync engine as a document failure and retried on the next sync.
     */
    const blocks = await fetchAllBlocks(accessToken, externalId)
    const blockContent = blocksToPlainText(blocks)
    const stub = pageToStub(page)
    const content = blockContent.trim() || stub.title
    return { ...stub, content, contentDeferred: false }
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
            `${NOTION_BASE_URL}/databases/${encodeURIComponent(databaseId)}`,
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
          `${NOTION_BASE_URL}/pages/${encodeURIComponent(rootPageId)}`,
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
    page_size: pageSizeFor(maxPages, syncContext),
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
    const body: Record<string, unknown> = { page_size: pageSizeFor(maxPages, syncContext) }
    if (startCursor) body.start_cursor = startCursor

    logger.info('Querying Notion database', {
      databaseId,
      databaseIndex,
      databaseCount: databaseIds.length,
      startCursor,
    })

    const response = await fetchWithRetry(
      `${NOTION_BASE_URL}/databases/${encodeURIComponent(databaseId)}/query`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Notion-Version': NOTION_API_VERSION,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    )

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
  // Always a full page of blocks: this endpoint pages over the root page's
  // blocks, not over documents, and only the `child_page` ones become documents.
  // Sizing the request by the remaining `maxPages` budget would shrink it to a
  // handful of blocks per request and walk a long page in dozens of round-trips.
  const params = new URLSearchParams({ page_size: '100' })
  if (cursor) params.append('start_cursor', cursor)

  logger.info('Listing child pages under root page', { rootPageId, cursor })

  const response = await fetchWithRetry(
    `${NOTION_BASE_URL}/blocks/${encodeURIComponent(rootPageId)}/children?${params.toString()}`,
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

  // Fetch page metadata (not content) in concurrent batches to build stubs.
  // A page dropped by a transient error still exists in Notion, so the listing
  // is incomplete and deletion reconciliation must be suppressed — otherwise the
  // sync engine hard-deletes the stored document. A 404 is genuine absence and
  // does not cap the listing.
  const documents: ExternalDocument[] = []
  let droppedByError = false

  for (let i = 0; i < pageIdsToFetch.length; i += NOTION_CONCURRENCY) {
    const cumulativeSoFar = ((syncContext?.totalDocsFetched as number) ?? 0) + documents.length
    if (maxPages > 0 && cumulativeSoFar >= maxPages) break
    const batch = pageIdsToFetch.slice(i, i + NOTION_CONCURRENCY)
    const results = await Promise.all(
      batch.map(async (pageId) => {
        try {
          const pageResponse = await fetchWithRetry(
            `${NOTION_BASE_URL}/pages/${encodeURIComponent(pageId)}`,
            {
              method: 'GET',
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Notion-Version': NOTION_API_VERSION,
              },
            }
          )
          if (!pageResponse.ok) {
            if (pageResponse.status !== 404) droppedByError = true
            logger.warn(`Failed to fetch child page ${pageId}`, { status: pageResponse.status })
            return null
          }
          const page = await pageResponse.json()
          if (page.archived) return null
          return pageToStub(page)
        } catch (error) {
          droppedByError = true
          logger.warn(`Failed to process child page ${pageId}`, {
            error: toError(error).message,
          })
          return null
        }
      })
    )
    documents.push(...(results.filter(Boolean) as ExternalDocument[]))
  }

  if (droppedByError && syncContext) syncContext.listingCapped = true

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
