import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { isPlainRecord } from '@sim/utils/object'
import {
  fetchWithRetry,
  readBoundedHttpErrorPayload,
  VALIDATE_RETRY_OPTIONS,
} from '@/lib/knowledge/documents/utils'
import { notionConnectorMeta } from '@/connectors/notion/meta'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import {
  CONNECTOR_MAX_FILE_BYTES,
  ConnectorFileTooLargeError,
  joinTagArray,
  markSkipped,
  parseMultiValue,
  parseOptionalUnlimitedSafeInteger,
  parseTagDate,
  readBodyWithLimit,
  sizeLimitSkipReason,
} from '@/connectors/utils'

const logger = createLogger('NotionConnector')

const NOTION_API_VERSION = '2026-03-11'
const NOTION_BASE_URL = 'https://api.notion.com/v1'
const PAGE_METADATA_CONCURRENCY = 3
const MAX_CONFIGURED_DATABASES = 100
const MAX_DATABASE_RESPONSE_BYTES = 1024 * 1024
const MAX_PAGE_METADATA_RESPONSE_BYTES = 1024 * 1024
const MAX_LIST_RESPONSE_BYTES = 16 * 1024 * 1024
const MAX_DATA_SOURCES_PER_DATABASE = 100
const MAX_TOTAL_DATA_SOURCES = 500
const MAX_NOTION_UNKNOWN_BLOCK_IDS = 100
const MAX_NOTION_MARKDOWN_RECOVERY_IDS = 200
const MAX_NOTION_MARKDOWN_RECOVERY_REQUESTS = 200
const NOTION_DATA_SOURCE_CURSOR_PREFIX = 'notion-data-sources:v1:'
const MAX_PAGES_VALIDATION_ERROR = 'Max pages must be a positive safe integer, or 0 for unlimited'

interface NotionMarkdownResponse {
  markdown?: unknown
  truncated?: unknown
  unknown_block_ids?: unknown
}

interface ParsedNotionMarkdownResponse {
  markdown: string
  truncated: boolean
  unknownBlockIds: string[]
  responseBytes: number
}

interface NotionDataSourceReference {
  id: string
}

interface ResolvedNotionDataSource {
  databaseId: string
  dataSourceId: string
}

interface NotionDataSourceCache {
  databaseIds: string[]
  dataSources: ResolvedNotionDataSource[]
}

interface NotionDataSourceCursor {
  sourceIndex: number
  cursor?: string
}

const DATA_SOURCE_CACHE_KEY = 'notionResolvedDataSources'

interface NotionApiErrorBody {
  code?: unknown
  message?: unknown
  request_id?: unknown
}

interface NotionListResponse {
  results?: Record<string, unknown>[]
  has_more?: boolean
  next_cursor?: string | null
  request_status?: {
    type?: string
    incomplete_reason?: string
  }
}

function requireNotionResults(
  data: NotionListResponse,
  description: string
): Record<string, unknown>[] {
  if (
    !Array.isArray(data.results) ||
    typeof data.has_more !== 'boolean' ||
    !data.results.every(
      (result) => isPlainRecord(result) && typeof result.id === 'string' && result.id.length > 0
    )
  ) {
    throw new Error(`Notion ${description} returned a malformed results list`)
  }
  return data.results
}

function isNotionPageMetadata(value: unknown): value is Record<string, unknown> & { id: string } {
  return (
    isPlainRecord(value) &&
    value.object === 'page' &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    isPlainRecord(value.properties) &&
    typeof value.url === 'string' &&
    typeof value.last_edited_time === 'string'
  )
}

function requireNotionPages(
  values: Record<string, unknown>[],
  description: string
): (Record<string, unknown> & { id: string })[] {
  const pages = values.filter((value) => value.object === 'page')
  if (!pages.every(isNotionPageMetadata)) {
    throw new Error(`Notion ${description} returned malformed page metadata`)
  }
  return pages
}

async function readNotionJsonObject<T extends object>(
  response: Response,
  maxBytes: number,
  description: string
): Promise<T> {
  const body = await readBodyWithLimit(response, maxBytes)
  if (!body) {
    throw new Error(`Notion ${description} exceeds the ${maxBytes} byte limit`)
  }

  try {
    const parsed: unknown = JSON.parse(body.toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Invalid JSON object')
    }
    return parsed as T
  } catch {
    throw new Error(`Notion ${description} returned invalid JSON`)
  }
}

function parseMaxPages(value: unknown): number {
  return parseOptionalUnlimitedSafeInteger(value, MAX_PAGES_VALIDATION_ERROR)
}

class NotionApiError extends Error {
  readonly status: number
  readonly code?: string
  readonly requestId?: string

  constructor(operation: string, status: number, code?: string, requestId?: string) {
    const fields = [String(status)]
    if (code) fields.push(`code=${code}`)
    if (requestId) fields.push(`requestId=${requestId}`)
    super(`${operation}: ${fields.join(', ')}`)
    this.name = 'NotionApiError'
    this.status = status
    this.code = code
    this.requestId = requestId
  }
}

class NotionMarkdownRecoveryLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotionMarkdownRecoveryLimitError'
  }
}

class NotionMarkdownIncompleteError extends Error {
  constructor() {
    super('Notion page contains blocks the connection cannot access and was not indexed completely')
    this.name = 'NotionMarkdownIncompleteError'
  }
}

/**
 * Builds a bounded error from Notion's documented JSON error envelope.
 *
 * Only strictly validated machine identifiers are retained. The provider's
 * free-form message is omitted because it can echo request values or secrets.
 */
async function notionApiError(response: Response, operation: string): Promise<NotionApiError> {
  let body: NotionApiErrorBody = {}

  try {
    const payload = await readBoundedHttpErrorPayload(response)
    if (payload.ok) {
      const parsed: unknown = JSON.parse(payload.body)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        body = parsed as NotionApiErrorBody
      }
    }
  } catch {
    body = {}
  }

  const rawCode = typeof body.code === 'string' ? body.code.trim() : ''
  const code = /^[a-z0-9_]{1,100}$/i.test(rawCode) ? rawCode : undefined
  const rawRequestId = typeof body.request_id === 'string' ? body.request_id.trim() : ''
  const requestId = /^[a-z0-9-]{1,100}$/i.test(rawRequestId) ? rawRequestId : undefined

  return new NotionApiError(operation, response.status, code, requestId)
}

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

function isPageTrashed(page: Record<string, unknown>): boolean {
  return page.in_trash === true || page.archived === true
}

async function fetchMarkdownResponse(
  accessToken: string,
  pageId: string,
  remainingBytes: number
): Promise<ParsedNotionMarkdownResponse> {
  const response = await fetchWithRetry(
    `${NOTION_BASE_URL}/pages/${encodeURIComponent(pageId)}/markdown?include_transcript=true`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Notion-Version': NOTION_API_VERSION,
      },
    }
  )

  if (!response.ok) {
    throw await notionApiError(response, `Failed to fetch markdown for ${pageId}`)
  }

  const body = await readBodyWithLimit(response, remainingBytes)
  if (!body) throw new ConnectorFileTooLargeError(CONNECTOR_MAX_FILE_BYTES)

  let data: NotionMarkdownResponse
  try {
    data = JSON.parse(body.toString('utf8')) as NotionMarkdownResponse
  } catch {
    throw new Error(`Notion returned invalid JSON markdown for ${pageId}`)
  }
  if (
    typeof data.markdown !== 'string' ||
    typeof data.truncated !== 'boolean' ||
    !Array.isArray(data.unknown_block_ids) ||
    !data.unknown_block_ids.every((value): value is string => typeof value === 'string')
  ) {
    throw new Error(`Notion returned an invalid markdown response for ${pageId}`)
  }
  if (data.unknown_block_ids.length > MAX_NOTION_UNKNOWN_BLOCK_IDS) {
    throw new NotionMarkdownRecoveryLimitError(
      `Notion returned more than ${MAX_NOTION_UNKNOWN_BLOCK_IDS} recovery block IDs for one markdown response and the page was not indexed`
    )
  }

  return {
    markdown: data.markdown,
    truncated: data.truncated,
    unknownBlockIds: data.unknown_block_ids,
    responseBytes: body.byteLength,
  }
}

function richTextToPlainText(value: unknown): string {
  if (!Array.isArray(value)) return ''
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return ''
      const plainText = (item as { plain_text?: unknown }).plain_text
      return typeof plainText === 'string' ? plainText : ''
    })
    .join('')
}

function unsupportedBlockFallback(block: Record<string, unknown>): string {
  const type = typeof block.type === 'string' ? block.type : ''
  const payload = type && block[type] && typeof block[type] === 'object' ? block[type] : undefined
  if (!payload || Array.isArray(payload)) return ''

  const value = payload as Record<string, unknown>
  const expression =
    type === 'equation' && typeof value.expression === 'string' ? value.expression : ''
  const text =
    richTextToPlainText(value.rich_text) ||
    richTextToPlainText(value.caption) ||
    richTextToPlainText(value.title) ||
    expression
  const url = typeof value.url === 'string' ? value.url : ''
  return [text, url].filter(Boolean).join('\n')
}

async function fetchUnsupportedBlockFallback(
  accessToken: string,
  blockId: string,
  remainingBytes: number
): Promise<{ content: string; responseBytes: number }> {
  const response = await fetchWithRetry(
    `${NOTION_BASE_URL}/blocks/${encodeURIComponent(blockId)}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Notion-Version': NOTION_API_VERSION,
      },
    }
  )

  if (!response.ok) {
    const error = await notionApiError(response, `Failed to fetch unsupported block ${blockId}`)
    if (error.status === 404 && error.code === 'object_not_found') {
      throw new NotionMarkdownIncompleteError()
    }
    throw error
  }

  const body = await readBodyWithLimit(response, remainingBytes)
  if (!body) throw new ConnectorFileTooLargeError(CONNECTOR_MAX_FILE_BYTES)

  let block: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(body.toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Invalid block envelope')
    }
    block = parsed as Record<string, unknown>
  } catch {
    throw new Error(`Notion returned invalid JSON for unsupported block ${blockId}`)
  }

  return { content: unsupportedBlockFallback(block), responseBytes: body.byteLength }
}

type MarkdownRecoveryTarget = { id: string; mode: 'markdown' | 'block' }

/**
 * Retrieves complete enhanced markdown while following Notion's documented
 * `unknown_block_ids` recovery flow. Inaccessible blocks make the hydration
 * non-authoritative; unsupported markdown block types fall back to the structured
 * block endpoint. Aggregate bytes and follow-up requests are bounded across the
 * whole hydration, so recovery cannot become an unbounded fan-out.
 */
async function fetchPageMarkdown(accessToken: string, pageId: string): Promise<string> {
  const pending: MarkdownRecoveryTarget[] = [{ id: pageId, mode: 'markdown' }]
  const queued = new Set<string>([`markdown:${pageId}`])
  const recoveryIds = new Set<string>()
  const visited = new Set<string>()
  const markdownParts: string[] = []
  let pendingIndex = 0
  let totalResponseBytes = 0
  let recoveryRequests = 0

  const enqueue = (target: MarkdownRecoveryTarget) => {
    if (target.id !== pageId && !recoveryIds.has(target.id)) {
      recoveryIds.add(target.id)
      if (recoveryIds.size > MAX_NOTION_MARKDOWN_RECOVERY_IDS) {
        throw new NotionMarkdownRecoveryLimitError(
          `Notion page requires more than ${MAX_NOTION_MARKDOWN_RECOVERY_IDS} unique markdown recovery IDs and was not indexed`
        )
      }
    }

    const key = `${target.mode}:${target.id}`
    if (queued.has(key)) return
    queued.add(key)
    pending.push(target)
  }

  while (pendingIndex < pending.length) {
    const target = pending[pendingIndex++]
    const visitKey = `${target.mode}:${target.id}`
    if (visited.has(visitKey)) continue
    visited.add(visitKey)

    if (target.id !== pageId || target.mode !== 'markdown') {
      recoveryRequests++
      if (recoveryRequests > MAX_NOTION_MARKDOWN_RECOVERY_REQUESTS) {
        throw new NotionMarkdownRecoveryLimitError(
          `Notion page requires more than ${MAX_NOTION_MARKDOWN_RECOVERY_REQUESTS} markdown recovery requests and was not indexed`
        )
      }
    }

    const remainingBytes = CONNECTOR_MAX_FILE_BYTES - totalResponseBytes
    if (remainingBytes <= 0) throw new ConnectorFileTooLargeError(CONNECTOR_MAX_FILE_BYTES)

    if (target.mode === 'block') {
      const fallback = await fetchUnsupportedBlockFallback(accessToken, target.id, remainingBytes)
      totalResponseBytes += fallback.responseBytes
      if (fallback.content) markdownParts.push(fallback.content)
      continue
    }

    let markdownResponse: ParsedNotionMarkdownResponse
    try {
      markdownResponse = await fetchMarkdownResponse(accessToken, target.id, remainingBytes)
    } catch (error) {
      if (target.id !== pageId && error instanceof NotionApiError) {
        if (error.status === 404 && error.code === 'object_not_found') {
          throw new NotionMarkdownIncompleteError()
        }
        if (error.status === 400 && error.code === 'validation_error') {
          enqueue({ id: target.id, mode: 'block' })
          continue
        }
      }
      throw error
    }

    totalResponseBytes += markdownResponse.responseBytes
    if (markdownResponse.markdown) markdownParts.push(markdownResponse.markdown)

    if (markdownResponse.truncated && markdownResponse.unknownBlockIds.length === 0) {
      throw new NotionMarkdownRecoveryLimitError(
        'Notion returned truncated markdown without recovery block IDs and the page was not indexed'
      )
    }

    for (const unknownBlockId of markdownResponse.unknownBlockIds) {
      enqueue({
        id: unknownBlockId,
        mode: markdownResponse.truncated ? 'markdown' : 'block',
      })
    }
  }

  return markdownParts.join('\n\n')
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
     * The `v3` namespace is a one-time invalidation. The hash is metadata-only,
     * so a stored page whose `last_edited_time` has not moved is classified
     * `unchanged` and never re-hydrated — meaning it would keep the incomplete
     * single-level block rendering used before Notion's complete-page markdown
     * endpoint was adopted. The scoped bump forces one re-hydration per page,
     * after which normal hash gating resumes.
     */
    contentHash: `notion:v3:${pageId}:${lastEditedTime}`,
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
    const maxPages = parseMaxPages(sourceConfig.maxPages)

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
      throw await notionApiError(response, 'Failed to get Notion page')
    }

    const page = await readNotionJsonObject<Record<string, unknown>>(
      response,
      MAX_PAGE_METADATA_RESPONSE_BYTES,
      `page ${externalId} metadata`
    )
    if (!isNotionPageMetadata(page) || page.id !== externalId) {
      throw new Error(`Notion page ${externalId} returned malformed metadata`)
    }
    if (isPageTrashed(page)) return null

    /**
     * Incomplete markdown responses propagate rather than becoming successful
     * partial documents. The stored content hash is metadata-based, so persisting
     * a partial response would otherwise prevent recovery until the next edit.
     */
    const stub = pageToStub(page)
    let markdown: string
    try {
      markdown = await fetchPageMarkdown(accessToken, externalId)
    } catch (error) {
      if (error instanceof ConnectorFileTooLargeError) {
        return markSkipped(stub, sizeLimitSkipReason(error.limitBytes))
      }
      if (error instanceof NotionMarkdownRecoveryLimitError) {
        return markSkipped(stub, error.message)
      }
      if (error instanceof NotionMarkdownIncompleteError) {
        return {
          ...markSkipped(stub, error.message),
          /**
           * Access to a nested block can change without moving the parent page's
           * `last_edited_time`. Supply a connector-owned retry marker for the sync
           * engine to persist instead of the listing hash, so the next listing
           * classifies this document as changed and retries hydration. Existing
           * indexed content remains last-known-good.
           */
          skippedRetryContentHash: `notion:retry:v1:${stub.externalId}`,
        }
      }
      throw error
    }
    const content = markdown.trim() || stub.title
    return { ...stub, content, contentDeferred: false }
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const scope = (sourceConfig.scope as string) || 'workspace'
    const databaseIds = parseMultiValue(sourceConfig.databaseId)
    const rootPageId = (sourceConfig.rootPageId as string)?.trim()
    try {
      parseMaxPages(sourceConfig.maxPages)
    } catch (error) {
      return { valid: false, error: getErrorMessage(error, MAX_PAGES_VALIDATION_ERROR) }
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
      if (scope === 'database' && databaseIds.length > 0) {
        await resolveDatabaseDataSources(accessToken, databaseIds, VALIDATE_RETRY_OPTIONS)
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
          const error = await notionApiError(response, 'Cannot access page')
          return { valid: false, error: error.message }
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
          const error = await notionApiError(response, 'Cannot access Notion workspace')
          return { valid: false, error: error.message }
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
    const error = await notionApiError(response, 'Failed to search Notion')
    logger.error('Failed to search Notion', { error: error.message })
    throw error
  }

  const data = await readNotionJsonObject<NotionListResponse>(
    response,
    MAX_LIST_RESPONSE_BYTES,
    'workspace search response'
  )
  const results = requireNotionResults(data, 'workspace search')
  const pages = requireNotionPages(results, 'workspace search').filter(
    (result) => !isPageTrashed(result)
  )

  const documents = pages.map(pageToStub)

  const totalFetched = ((syncContext?.totalDocsFetched as number) ?? 0) + documents.length
  if (syncContext) syncContext.totalDocsFetched = totalFetched
  const hitLimit = maxPages > 0 && totalFetched >= maxPages
  const sourceHasMore = data.has_more === true
  if (hitLimit && sourceHasMore && syncContext) syncContext.listingCapped = true

  const nextCursor = hitLimit ? undefined : ((data.next_cursor as string) ?? undefined)

  return {
    documents,
    nextCursor,
    hasMore: hitLimit ? false : data.has_more === true,
    /** Notion documents that workspace search is not an exhaustive enumeration. */
    reconciliationSafe: false,
  }
}

/**
 * Resolves every current data source owned by the configured database IDs. This
 * preserves existing connector configuration while using Notion's post-2025
 * data model, where one database may contain multiple independently queried
 * data sources.
 */
async function resolveDatabaseDataSources(
  accessToken: string,
  databaseIds: string[],
  retryOptions?: typeof VALIDATE_RETRY_OPTIONS
): Promise<ResolvedNotionDataSource[]> {
  if (databaseIds.length > MAX_CONFIGURED_DATABASES) {
    throw new Error(`Notion connector supports at most ${MAX_CONFIGURED_DATABASES} databases`)
  }

  const resolved: ResolvedNotionDataSource[] = []

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
      retryOptions
    )

    if (!response.ok) {
      throw await notionApiError(response, `Cannot access database ${databaseId}`)
    }

    const database = await readNotionJsonObject<Record<string, unknown>>(
      response,
      MAX_DATABASE_RESPONSE_BYTES,
      `database ${databaseId} metadata`
    )

    const rawReferences = Array.isArray(database.data_sources) ? database.data_sources : []
    if (rawReferences.length > MAX_DATA_SOURCES_PER_DATABASE) {
      throw new Error(
        `Notion database ${databaseId} exposes more than ${MAX_DATA_SOURCES_PER_DATABASE} data sources`
      )
    }

    const references = rawReferences.flatMap((value): NotionDataSourceReference[] => {
      if (!value || typeof value !== 'object') return []
      const id = (value as { id?: unknown }).id
      return typeof id === 'string' && id ? [{ id }] : []
    })

    if (references.length === 0) {
      throw new Error(`Notion database ${databaseId} has no queryable data sources`)
    }
    if (resolved.length + references.length > MAX_TOTAL_DATA_SOURCES) {
      throw new Error(`Notion connector supports at most ${MAX_TOTAL_DATA_SOURCES} data sources`)
    }

    resolved.push(...references.map(({ id }) => ({ databaseId, dataSourceId: id })))
  }

  return resolved
}

function readCachedDataSources(
  syncContext: Record<string, unknown> | undefined,
  databaseIds: string[]
): ResolvedNotionDataSource[] | undefined {
  const cached = syncContext?.[DATA_SOURCE_CACHE_KEY]
  if (!cached || typeof cached !== 'object') return undefined

  const value = cached as Partial<NotionDataSourceCache>
  if (
    !Array.isArray(value.databaseIds) ||
    !value.databaseIds.every((id): id is string => typeof id === 'string') ||
    value.databaseIds.length !== databaseIds.length ||
    !value.databaseIds.every((id, index) => id === databaseIds[index]) ||
    !Array.isArray(value.dataSources) ||
    value.dataSources.length > MAX_TOTAL_DATA_SOURCES
  ) {
    return undefined
  }

  const dataSources = value.dataSources.flatMap((source): ResolvedNotionDataSource[] => {
    if (!source || typeof source !== 'object') return []
    const candidate = source as Partial<ResolvedNotionDataSource>
    return typeof candidate.databaseId === 'string' && typeof candidate.dataSourceId === 'string'
      ? [{ databaseId: candidate.databaseId, dataSourceId: candidate.dataSourceId }]
      : []
  })

  if (dataSources.length !== value.dataSources.length) return undefined

  const configuredDatabaseIds = new Set(databaseIds)
  const countsByDatabase = new Map<string, number>()
  for (const source of dataSources) {
    if (!configuredDatabaseIds.has(source.databaseId)) return undefined
    const count = (countsByDatabase.get(source.databaseId) ?? 0) + 1
    if (count > MAX_DATA_SOURCES_PER_DATABASE) return undefined
    countsByDatabase.set(source.databaseId, count)
  }

  return dataSources
}

async function resolveDatabaseDataSourcesForSync(
  accessToken: string,
  databaseIds: string[],
  syncContext?: Record<string, unknown>
): Promise<ResolvedNotionDataSource[]> {
  const cached = readCachedDataSources(syncContext, databaseIds)
  if (cached) return cached

  const dataSources = await resolveDatabaseDataSources(accessToken, databaseIds)
  if (syncContext) {
    syncContext[DATA_SOURCE_CACHE_KEY] = {
      databaseIds: [...databaseIds],
      dataSources: dataSources.map((source) => ({ ...source })),
    } satisfies NotionDataSourceCache
  }
  return dataSources
}

function encodeDataSourceCursor(cursor: NotionDataSourceCursor): string {
  return `${NOTION_DATA_SOURCE_CURSOR_PREFIX}${encodeURIComponent(JSON.stringify(cursor))}`
}

function decodeLegacyDatabaseCursor(
  cursor: string,
  databaseIds: string[],
  dataSources: ResolvedNotionDataSource[]
): NotionDataSourceCursor | undefined {
  if (databaseIds.length <= 1) return undefined

  let parsed: unknown
  try {
    parsed = JSON.parse(cursor) as unknown
  } catch {
    return undefined
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
  const keys = Object.keys(parsed)
  if (
    !keys.includes('databaseIndex') ||
    keys.some((key) => key !== 'databaseIndex' && key !== 'cursor')
  ) {
    return undefined
  }

  const value = parsed as { databaseIndex?: unknown; cursor?: unknown }
  if (
    !Number.isSafeInteger(value.databaseIndex) ||
    Number(value.databaseIndex) < 0 ||
    (value.cursor !== undefined && typeof value.cursor !== 'string')
  ) {
    return undefined
  }

  const databaseIndex = Number(value.databaseIndex)
  if (databaseIndex >= databaseIds.length) {
    throw new Error('Invalid Notion connector legacy database cursor')
  }
  const databaseId = databaseIds[databaseIndex]
  const sourceIndex = dataSources.findIndex((source) => source.databaseId === databaseId)
  if (sourceIndex < 0) {
    throw new Error('Invalid Notion connector legacy database cursor')
  }

  return { sourceIndex, cursor: value.cursor as string | undefined }
}

function decodeDataSourceCursor(
  cursor: string,
  databaseIds: string[],
  dataSources: ResolvedNotionDataSource[]
): NotionDataSourceCursor {
  if (!cursor.startsWith(NOTION_DATA_SOURCE_CURSOR_PREFIX)) {
    return (
      decodeLegacyDatabaseCursor(cursor, databaseIds, dataSources) ?? { sourceIndex: 0, cursor }
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(
      decodeURIComponent(cursor.slice(NOTION_DATA_SOURCE_CURSOR_PREFIX.length))
    ) as unknown
  } catch {
    throw new Error('Invalid Notion connector data-source cursor')
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid Notion connector data-source cursor')
  }
  const value = parsed as { sourceIndex?: unknown; cursor?: unknown }
  if (
    !Number.isSafeInteger(value.sourceIndex) ||
    Number(value.sourceIndex) < 0 ||
    Number(value.sourceIndex) >= dataSources.length ||
    (value.cursor !== undefined && typeof value.cursor !== 'string')
  ) {
    throw new Error('Invalid Notion connector data-source cursor')
  }

  return {
    sourceIndex: Number(value.sourceIndex),
    cursor: value.cursor as string | undefined,
  }
}

async function listFromDatabases(
  accessToken: string,
  databaseIds: string[],
  maxPages: number,
  cursor?: string,
  syncContext?: Record<string, unknown>
): Promise<ExternalDocumentList> {
  const dataSources = await resolveDatabaseDataSourcesForSync(accessToken, databaseIds, syncContext)
  let sourceIndex = 0
  let startCursor: string | undefined

  if (cursor) {
    const decoded = decodeDataSourceCursor(cursor, databaseIds, dataSources)
    sourceIndex = decoded.sourceIndex
    startCursor = decoded.cursor
  }

  if (!Number.isSafeInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= dataSources.length) {
    throw new Error('Invalid Notion connector data-source cursor')
  }

  const documents: ExternalDocument[] = []
  let nextCursor: string | undefined
  let hasMore = false
  let queryResultIncomplete = false

  if (sourceIndex < dataSources.length) {
    const { databaseId, dataSourceId } = dataSources[sourceIndex]
    const body: Record<string, unknown> = { page_size: pageSizeFor(maxPages, syncContext) }
    if (startCursor) body.start_cursor = startCursor

    logger.info('Querying Notion data source', {
      databaseId,
      dataSourceId,
      sourceIndex,
      sourceCount: dataSources.length,
      startCursor,
    })

    const response = await fetchWithRetry(
      `${NOTION_BASE_URL}/data_sources/${encodeURIComponent(dataSourceId)}/query`,
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
      const error = await notionApiError(
        response,
        `Failed to query Notion data source ${dataSourceId}`
      )
      logger.error('Failed to query Notion data source', {
        databaseId,
        dataSourceId,
        error: error.message,
      })
      throw error
    }

    const data = await readNotionJsonObject<NotionListResponse>(
      response,
      MAX_LIST_RESPONSE_BYTES,
      `data source ${dataSourceId} query response`
    )
    const results = requireNotionResults(data, `data source ${dataSourceId} query`)
    const pages = requireNotionPages(results, `data source ${dataSourceId} query`).filter(
      (result) => !isPageTrashed(result)
    )
    documents.push(...pages.map(pageToStub))

    queryResultIncomplete =
      data.request_status?.type === 'incomplete' &&
      data.request_status?.incomplete_reason === 'query_result_limit_reached'
    const providerCursor =
      typeof data.next_cursor === 'string' && data.next_cursor.trim().length > 0
        ? data.next_cursor
        : undefined
    const paginationCursorMissing = data.has_more === true && providerCursor === undefined

    if ((queryResultIncomplete || paginationCursorMissing) && syncContext) {
      syncContext.listingCapped = true
      syncContext.reconciliationUnsafe = true
    }

    if (data.has_more === true && providerCursor !== undefined) {
      nextCursor = encodeDataSourceCursor({ sourceIndex, cursor: providerCursor })
      hasMore = true
    } else if (!paginationCursorMissing && sourceIndex + 1 < dataSources.length) {
      nextCursor = encodeDataSourceCursor({ sourceIndex: sourceIndex + 1 })
      hasMore = true
    }

    if (paginationCursorMissing) queryResultIncomplete = true
  }

  const totalFetched = ((syncContext?.totalDocsFetched as number) ?? 0) + documents.length
  if (syncContext) syncContext.totalDocsFetched = totalFetched
  const hitLimit = maxPages > 0 && totalFetched >= maxPages
  if (hitLimit) {
    if (hasMore && syncContext) syncContext.listingCapped = true
    hasMore = false
    nextCursor = undefined
  }

  return {
    documents,
    nextCursor: hasMore ? nextCursor : undefined,
    hasMore,
    reconciliationSafe:
      queryResultIncomplete || syncContext?.reconciliationUnsafe === true ? false : undefined,
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
    const error = await notionApiError(response, 'Failed to list child blocks')
    logger.error('Failed to list child blocks', { error: error.message })
    throw error
  }

  const data = await readNotionJsonObject<NotionListResponse>(
    response,
    MAX_LIST_RESPONSE_BYTES,
    `page ${rootPageId} child-block response`
  )
  const blockResults = requireNotionResults(data, `page ${rootPageId} child-block listing`)

  // Filter to child_page blocks only (child_database blocks cannot be fetched via the Pages API)
  const childPageIds = blockResults
    .filter((b) => b.type === 'child_page')
    .map((b) => b.id as string)

  // Also include the root page itself on the first call (no cursor)
  const pageIdsToFetch = !cursor ? [rootPageId, ...childPageIds] : childPageIds

  const documents: ExternalDocument[] = []
  /**
   * A child metadata failure makes this listing non-authoritative. Notion uses
   * `object_not_found` for lost access too, so even a 404 cannot prove deletion.
   */
  let droppedByError = false
  let pageIdsProcessed = 0

  for (let i = 0; i < pageIdsToFetch.length; ) {
    const cumulativeSoFar = ((syncContext?.totalDocsFetched as number) ?? 0) + documents.length
    if (maxPages > 0 && cumulativeSoFar >= maxPages) break
    const remainingBudget = maxPages > 0 ? maxPages - cumulativeSoFar : PAGE_METADATA_CONCURRENCY
    const batch = pageIdsToFetch.slice(i, i + Math.min(PAGE_METADATA_CONCURRENCY, remainingBudget))
    i += batch.length
    pageIdsProcessed += batch.length
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
            droppedByError = true
            const error = await notionApiError(pageResponse, `Failed to fetch child page ${pageId}`)
            logger.warn('Failed to fetch child page', { pageId, error: error.message })
            return null
          }
          const page = await readNotionJsonObject<Record<string, unknown>>(
            pageResponse,
            MAX_PAGE_METADATA_RESPONSE_BYTES,
            `page ${pageId} metadata`
          )
          if (!isNotionPageMetadata(page) || page.id !== pageId) {
            throw new Error(`Notion page ${pageId} returned malformed or mismatched metadata`)
          }
          if (isPageTrashed(page)) return null
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

  if (droppedByError && syncContext) {
    /**
     * A provider failure omitted a page that may still exist. `listingCapped`
     * alone is insufficient because a forced full sync may override a configured
     * cap; `reconciliationUnsafe` is absolute and prevents deletion against this
     * non-authoritative listing in every sync mode.
     */
    syncContext.listingCapped = true
    syncContext.reconciliationUnsafe = true
  }

  const totalFetched = ((syncContext?.totalDocsFetched as number) ?? 0) + documents.length
  if (syncContext) syncContext.totalDocsFetched = totalFetched
  const hitLimit = maxPages > 0 && totalFetched >= maxPages
  const sourceHasMore = data.has_more === true || pageIdsProcessed < pageIdsToFetch.length
  if (hitLimit && sourceHasMore && syncContext) syncContext.listingCapped = true

  const nextCursor = hitLimit ? undefined : ((data.next_cursor as string) ?? undefined)

  return {
    documents,
    nextCursor,
    hasMore: hitLimit ? false : data.has_more === true,
  }
}
