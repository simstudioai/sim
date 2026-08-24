import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { truncate } from '@sim/utils/string'
import { redactSensitiveValues } from '@/lib/core/security/redaction'
import {
  fetchWithRetry,
  readBoundedHttpErrorBody,
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
  parseTagDate,
  readBodyWithLimit,
  sizeLimitSkipReason,
} from '@/connectors/utils'

const logger = createLogger('NotionConnector')

const NOTION_API_VERSION = '2026-03-11'
const NOTION_BASE_URL = 'https://api.notion.com/v1'
const MAX_NOTION_ERROR_MESSAGE_LENGTH = 500
const PAGE_METADATA_CONCURRENCY = 3
const MAX_CONFIGURED_DATABASES = 100
const MAX_DATABASE_RESPONSE_BYTES = 1024 * 1024
const MAX_DATA_SOURCES_PER_DATABASE = 100
const MAX_TOTAL_DATA_SOURCES = 500
const MAX_PAGES_VALIDATION_ERROR = 'Max pages must be a positive safe integer, or 0 for unlimited'

interface NotionMarkdownResponse {
  markdown?: unknown
  truncated?: unknown
  unknown_block_ids?: unknown
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

const DATA_SOURCE_CACHE_KEY = 'notionResolvedDataSources'

interface NotionApiErrorBody {
  code?: unknown
  message?: unknown
  request_id?: unknown
}

function parseMaxPages(value: unknown): number {
  if (value === undefined || value === null) return 0
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error(MAX_PAGES_VALIDATION_ERROR)
  }
  const normalized = typeof value === 'string' ? value.trim() : value
  if (normalized === '') return 0
  if (typeof normalized === 'string' && !/^\d+$/.test(normalized)) {
    throw new Error(MAX_PAGES_VALIDATION_ERROR)
  }
  const parsed = Number(normalized)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(MAX_PAGES_VALIDATION_ERROR)
  }
  return parsed
}

class NotionApiError extends Error {
  readonly status: number
  readonly code?: string
  readonly requestId?: string

  constructor(
    operation: string,
    status: number,
    code?: string,
    detail?: string,
    requestId?: string
  ) {
    const fields = [String(status)]
    if (code) fields.push(`code=${code}`)
    if (detail) fields.push(`message=${detail}`)
    if (requestId) fields.push(`requestId=${requestId}`)
    super(`${operation}: ${fields.join(', ')}`)
    this.name = 'NotionApiError'
    this.status = status
    this.code = code
    this.requestId = requestId
  }
}

/**
 * Builds a bounded error from Notion's documented JSON error envelope.
 *
 * Only the stable error code, human-readable message, and request ID are
 * retained. Arbitrary response data and request headers are deliberately not
 * serialized into logs.
 */
async function notionApiError(response: Response, operation: string): Promise<NotionApiError> {
  let body: NotionApiErrorBody = {}

  try {
    body = JSON.parse(await readBoundedHttpErrorBody(response)) as NotionApiErrorBody
  } catch {
    body = {}
  }

  const code = typeof body.code === 'string' ? truncate(body.code.trim(), 100) : undefined
  const detail =
    typeof body.message === 'string'
      ? truncate(
          redactSensitiveValues(body.message).replace(/\s+/g, ' ').trim(),
          MAX_NOTION_ERROR_MESSAGE_LENGTH
        )
      : undefined
  const requestId =
    typeof body.request_id === 'string' ? truncate(body.request_id.trim(), 100) : undefined

  return new NotionApiError(operation, response.status, code, detail, requestId)
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

/** Returns true for either legacy or current Notion trash markers. */
function isPageTrashed(page: Record<string, unknown>): boolean {
  return page.in_trash === true || page.archived === true
}

/**
 * Retrieves Notion's server-rendered markdown for a page. The endpoint expands
 * nested blocks in one request and reports when its output is incomplete. An
 * incomplete response is rejected so the metadata hash cannot freeze partial
 * page content as a successful hydration.
 */
async function fetchPageMarkdown(accessToken: string, pageId: string): Promise<string> {
  const response = await fetchWithRetry(
    `${NOTION_BASE_URL}/pages/${encodeURIComponent(pageId)}/markdown`,
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

  const body = await readBodyWithLimit(response, CONNECTOR_MAX_FILE_BYTES)
  if (!body) throw new ConnectorFileTooLargeError(CONNECTOR_MAX_FILE_BYTES)

  let data: NotionMarkdownResponse
  try {
    data = JSON.parse(body.toString('utf8')) as NotionMarkdownResponse
  } catch {
    throw new Error(`Notion returned invalid JSON markdown for ${pageId}`)
  }
  const unknownBlockIds = Array.isArray(data.unknown_block_ids)
    ? data.unknown_block_ids.filter((value): value is string => typeof value === 'string')
    : []

  if (data.truncated === true || unknownBlockIds.length > 0) {
    throw new Error(
      `Notion returned incomplete markdown for ${pageId}: truncated=${data.truncated === true}, unknownBlocks=${unknownBlockIds.length}`
    )
  }

  if (typeof data.markdown !== 'string') {
    throw new Error(`Notion returned an invalid markdown response for ${pageId}`)
  }

  return data.markdown
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
     * `unchanged` and never re-hydrated — meaning it would keep the incomplete
     * single-level block rendering used before Notion's complete-page markdown
     * endpoint was adopted. The scoped bump forces one re-hydration per page,
     * after which normal hash gating resumes.
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

    const page = (await response.json()) as Record<string, unknown>
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

  const data = await response.json()
  const results = (data.results || []) as Record<string, unknown>[]
  const pages = results.filter((result) => result.object === 'page' && !isPageTrashed(result))

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

    const body = await readBodyWithLimit(response, MAX_DATABASE_RESPONSE_BYTES)
    if (!body) {
      throw new Error(
        `Notion database ${databaseId} metadata exceeds the ${MAX_DATABASE_RESPONSE_BYTES} byte limit`
      )
    }

    let database: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(body.toString('utf8'))
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Invalid metadata envelope')
      }
      database = parsed as Record<string, unknown>
    } catch {
      throw new Error(`Notion database ${databaseId} returned invalid JSON metadata`)
    }

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

/** Lists pages from the configured databases through the current data-source API. */
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
    let parsed: unknown
    try {
      parsed = JSON.parse(cursor) as unknown
    } catch {
      startCursor = cursor
    }

    if (parsed && typeof parsed === 'object') {
      const compound = parsed as {
        cursor?: unknown
        databaseIndex?: unknown
        sourceIndex?: unknown
      }
      if (Number.isSafeInteger(compound.sourceIndex) && Number(compound.sourceIndex) >= 0) {
        sourceIndex = Number(compound.sourceIndex)
      } else if (
        Number.isSafeInteger(compound.databaseIndex) &&
        Number(compound.databaseIndex) >= 0
      ) {
        const legacyDatabaseIndex = Number(compound.databaseIndex)
        if (legacyDatabaseIndex >= databaseIds.length) {
          throw new Error('Invalid Notion connector database cursor')
        }
        const legacyDatabaseId = databaseIds[legacyDatabaseIndex]
        const legacySourceIndex = dataSources.findIndex(
          (source) => source.databaseId === legacyDatabaseId
        )
        sourceIndex = legacySourceIndex >= 0 ? legacySourceIndex : 0
      } else {
        throw new Error('Invalid Notion connector data-source cursor')
      }
      if (compound.cursor !== undefined && typeof compound.cursor !== 'string') {
        throw new Error('Invalid Notion connector cursor')
      }
      startCursor = compound.cursor
    } else if (parsed !== undefined) {
      startCursor = cursor
    }
  }

  if (!Number.isSafeInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= dataSources.length) {
    throw new Error('Invalid Notion connector data-source cursor')
  }

  const documents: ExternalDocument[] = []
  let nextCursor: string | undefined
  let hasMore = false

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

    const data = await response.json()
    const results = (data.results || []) as Record<string, unknown>[]
    const pages = results.filter((result) => result.object === 'page' && !isPageTrashed(result))
    documents.push(...pages.map(pageToStub))

    if (data.has_more === true && typeof data.next_cursor === 'string') {
      const nextStart = data.next_cursor as string
      nextCursor =
        dataSources.length === 1 ? nextStart : JSON.stringify({ sourceIndex, cursor: nextStart })
      hasMore = true
    } else if (sourceIndex + 1 < dataSources.length) {
      nextCursor = JSON.stringify({ sourceIndex: sourceIndex + 1 })
      hasMore = true
    }
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

  const data = await response.json()
  const blockResults = (data.results || []) as Record<string, unknown>[]

  // Filter to child_page blocks only (child_database blocks cannot be fetched via the Pages API)
  const childPageIds = blockResults
    .filter((b) => b.type === 'child_page')
    .map((b) => b.id as string)

  // Also include the root page itself on the first call (no cursor)
  const pageIdsToFetch = !cursor ? [rootPageId, ...childPageIds] : childPageIds

  // Fetch page metadata (not content) in concurrent batches to build stubs.
  // Every metadata failure makes the result non-authoritative: the child ID came
  // from this parent listing, and Notion's object_not_found also represents lost
  // access, so even a 404 cannot prove the child was deleted.
  const documents: ExternalDocument[] = []
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
          const page = (await pageResponse.json()) as Record<string, unknown>
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
