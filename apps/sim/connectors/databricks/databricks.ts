import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { truncate } from '@sim/utils/string'
import { validateDatabricksWorkspaceHost } from '@/lib/core/security/input-validation'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import {
  DATABRICKS_CONTENT_TYPES,
  type DatabricksContentType,
  DEFAULT_NOTEBOOK_ROOT_PATH,
  databricksConnectorMeta,
} from '@/connectors/databricks/meta'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import {
  CONNECTOR_MAX_FILE_BYTES,
  isSkippedDocument,
  joinTagArray,
  markSkipped,
  parseTagDate,
  sizeLimitSkipReason,
  takeIndexableWithinCap,
} from '@/connectors/utils'

const logger = createLogger('DatabricksConnector')

/** Page size for `GET /api/2.0/sql/queries`. */
const QUERY_PAGE_SIZE = 100

/**
 * Directories listed per `listDocuments` call.
 *
 * `GET /api/2.0/workspace/list` is not paginated — it returns a whole directory
 * in one response and offers no page token — so the connector walks the tree
 * breadth-first and carries the pending-directory queue in the cursor. This
 * bounds how much of the walk happens before the engine gets a batch to persist.
 */
const DIRECTORIES_PER_CALL = 50

/** Sibling directories listed in parallel while walking the tree. */
const DIRECTORY_CONCURRENCY = 5

/** Notebooks collected before a `listDocuments` call yields, even mid-walk. */
const MAX_NOTEBOOKS_PER_CALL = 500

/**
 * Workspace object types that contain other objects and are therefore walked.
 *
 * `REPO` is a Git folder. It is a container just like `DIRECTORY` — every
 * notebook inside a Git folder is only reachable by listing the repo path — so
 * omitting it would silently skip every notebook under `/Repos` and every Git
 * folder in a user's home.
 */
const TRAVERSABLE_OBJECT_TYPES = new Set(['DIRECTORY', 'REPO'])

/**
 * Maximum size of a single `workspace/export`, documented alongside the
 * `MAX_NOTEBOOK_SIZE_EXCEEDED` error. Independent of (and far below) the
 * knowledge base's own document cap, so the skip reason has to quote it rather
 * than `CONNECTOR_MAX_FILE_BYTES`.
 */
const DATABRICKS_MAX_EXPORT_BYTES = 10 * 1024 * 1024

/** `externalId` prefixes, so a document always names the API it came from. */
const NOTEBOOK_ID_PREFIX = 'notebook:'
const QUERY_ID_PREFIX = 'query:'

/**
 * `ObjectInfo` as returned by `GET /api/2.0/workspace/list` and
 * `GET /api/2.0/workspace/get-status`.
 *
 * `created_at`, `modified_at` and `size` are documented as "only applicable to
 * files", so they are all optional here — a `NOTEBOOK` entry frequently carries
 * none of them.
 */
interface DatabricksObjectInfo {
  object_type?: string
  path?: string
  object_id?: number
  language?: string
  created_at?: number
  modified_at?: number
  resource_id?: string
  size?: number
}

interface DatabricksListResponse {
  objects?: DatabricksObjectInfo[]
}

/** `GET /api/2.0/workspace/export` response (no `direct_download`, so JSON). */
interface DatabricksExportResponse {
  content?: string
  file_type?: string
}

/** A `results` entry from `GET /api/2.0/sql/queries`. */
interface DatabricksQuery {
  id?: string
  display_name?: string
  description?: string
  query_text?: string
  catalog?: string
  schema?: string
  warehouse_id?: string
  owner_user_name?: string
  last_modifier_user_name?: string
  lifecycle_state?: string
  tags?: string[]
  create_time?: string
  update_time?: string
}

interface DatabricksQueryListResponse {
  results?: DatabricksQuery[]
  next_page_token?: string
}

/** Databricks REST error envelope: `{ error_code, message }`. */
interface DatabricksErrorBody {
  error_code?: string
  message?: string
}

/**
 * Traversal position across pages of a single notebook sync run.
 *
 * Only the pending-directory queue needs carrying: each entry is listed in full
 * by a single unpaginated `workspace/list` call, so there is no intra-directory
 * marker to resume from.
 */
interface DatabricksTraversalState {
  queue: string[]
}

function encodeCursor(state: DatabricksTraversalState): string {
  return Buffer.from(JSON.stringify(state), 'utf8').toString('base64url')
}

function decodeCursor(cursor: string): DatabricksTraversalState | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown
    if (typeof parsed !== 'object' || parsed === null) return null
    const candidate = parsed as Partial<DatabricksTraversalState>
    if (!Array.isArray(candidate.queue)) return null
    return { queue: candidate.queue.filter((path): path is string => typeof path === 'string') }
  } catch {
    return null
  }
}

/**
 * Normalizes the configured workspace host to an https origin, rejecting hosts
 * outside Databricks-owned domains.
 *
 * Validated here rather than only in `validateConfig` because `listDocuments`
 * and `getDocument` run against a stored `sourceConfig` that may have been
 * written after validation, and the host is interpolated into every request URL.
 */
function resolveWorkspaceOrigin(sourceConfig: Record<string, unknown>): string {
  const result = validateDatabricksWorkspaceHost(sourceConfig.workspaceHost as string | undefined)
  if (!result.isValid || !result.sanitized) {
    throw new Error(result.error || 'Invalid Databricks workspace host')
  }
  return result.sanitized
}

function resolveContentType(sourceConfig: Record<string, unknown>): DatabricksContentType {
  return sourceConfig.contentType === DATABRICKS_CONTENT_TYPES.queries
    ? DATABRICKS_CONTENT_TYPES.queries
    : DATABRICKS_CONTENT_TYPES.notebooks
}

/**
 * Normalizes the notebook root to an absolute workspace path.
 *
 * Every Workspace API path parameter is documented as absolute, so a relative
 * value is corrected rather than sent through as a guaranteed 404. Trailing
 * slashes are dropped (except on the root itself) so the path matches what
 * `workspace/list` echoes back in `ObjectInfo.path`.
 */
function normalizeRootPath(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return DEFAULT_NOTEBOOK_ROOT_PATH
  const absolute = raw.startsWith('/') ? raw : `/${raw}`
  const trimmed = absolute.replace(/\/+$/, '')
  return trimmed || DEFAULT_NOTEBOOK_ROOT_PATH
}

function resolveMaxDocuments(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

async function readErrorBody(response: Response): Promise<DatabricksErrorBody> {
  try {
    return (await response.json()) as DatabricksErrorBody
  } catch {
    return {}
  }
}

function describeError(status: number, body: DatabricksErrorBody): string {
  const detail = body.message?.trim() || body.error_code?.trim()
  return detail ? `${status} — ${truncate(detail, 200)}` : String(status)
}

/**
 * Issues an authenticated GET against a workspace REST endpoint.
 *
 * Databricks authenticates every workspace API with a bearer personal access
 * token, which is exactly what the sync engine hands connectors as
 * `accessToken`.
 */
async function databricksGet(
  origin: string,
  path: string,
  accessToken: string,
  params: Record<string, string>,
  retryOptions?: Parameters<typeof fetchWithRetry>[2]
): Promise<Response> {
  const url = new URL(`${origin}${path}`)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  return fetchWithRetry(
    url.toString(),
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    },
    retryOptions
  )
}

/**
 * Builds the listing stub for a workspace notebook.
 *
 * `externalId` carries the notebook's absolute path rather than its `object_id`
 * because `workspace/export` is addressed by path only — an id-keyed document
 * could never be re-hydrated. A moved notebook therefore reads as a delete plus
 * an add, which is the same behaviour every path-addressed connector has.
 *
 * The hash is metadata-only so change detection never needs an export. When
 * `modified_at` is absent (it is documented as file-only) the hash degenerates
 * to a constant and only an explicit full resync — see `rehydrateOnFullSync` on
 * the meta — will pick up later edits.
 */
function notebookToStub(origin: string, object: DatabricksObjectInfo): ExternalDocument {
  const path = object.path ?? ''
  const title = path.slice(path.lastIndexOf('/') + 1) || path || 'Untitled notebook'

  return {
    externalId: `${NOTEBOOK_ID_PREFIX}${path}`,
    title,
    content: '',
    contentDeferred: true,
    mimeType: 'text/plain',
    sourceUrl: object.object_id ? `${origin}/#notebook/${object.object_id}` : undefined,
    contentHash: `databricks:notebook:${path}:${object.modified_at ?? ''}`,
    metadata: {
      path,
      objectId: object.object_id,
      language: object.language,
      lastModified: object.modified_at ? new Date(object.modified_at).toISOString() : undefined,
    },
  }
}

/**
 * Renders a saved SQL query as indexable text.
 *
 * The description is the human-authored half (Databricks surfaces it as "usage
 * notes") and the query text is the machine half; both are indexed so a search
 * matches either.
 */
function formatQueryContent(query: DatabricksQuery): string {
  const sections: string[] = []
  const description = query.description?.trim()
  if (description) sections.push(description)
  const text = query.query_text?.trim()
  if (text) sections.push(text)
  return sections.join('\n\n')
}

/**
 * Builds a document for a saved SQL query.
 *
 * `GET /api/2.0/sql/queries` returns `query_text` inline, so there is nothing
 * left to defer — the listing already carries the full content.
 *
 * No `sourceUrl` is set: Databricks documents no stable URL for opening a saved
 * query by id, and inventing one would produce dead links on every document.
 */
function queryToDocument(query: DatabricksQuery): ExternalDocument | null {
  const id = query.id?.trim()
  if (!id) return null

  const content = formatQueryContent(query)
  if (!content) return null

  return {
    externalId: `${QUERY_ID_PREFIX}${id}`,
    title: query.display_name?.trim() || `Query ${id}`,
    content,
    contentDeferred: false,
    mimeType: 'text/plain',
    contentHash: `databricks:query:${id}:${query.update_time ?? ''}`,
    metadata: {
      queryId: id,
      catalog: query.catalog,
      schema: query.schema,
      warehouseId: query.warehouse_id,
      owner: query.owner_user_name ?? query.last_modifier_user_name,
      labels: query.tags,
      lastModified: query.update_time,
    },
  }
}

/**
 * Lists one workspace directory.
 *
 * Returns `null` when the directory is unreadable (deleted, or the token lacks
 * permission on that subtree) so the caller can decide whether that is fatal.
 */
async function listDirectory(
  origin: string,
  accessToken: string,
  accessPath: string
): Promise<DatabricksObjectInfo[] | null> {
  const response = await databricksGet(origin, '/api/2.0/workspace/list', accessToken, {
    path: accessPath,
  })

  if (!response.ok) {
    if (response.status === 403 || response.status === 404) {
      const body = await readErrorBody(response)
      logger.warn('Skipping unreadable Databricks workspace directory', {
        path: accessPath,
        error: describeError(response.status, body),
      })
      return null
    }
    const body = await readErrorBody(response)
    throw new Error(
      `Failed to list Databricks workspace path ${accessPath}: ${describeError(response.status, body)}`
    )
  }

  const data = (await response.json()) as DatabricksListResponse
  return data.objects ?? []
}

/** Walks the workspace tree breadth-first, one bounded slice per call. */
async function listNotebooks(
  accessToken: string,
  sourceConfig: Record<string, unknown>,
  cursor?: string,
  syncContext?: Record<string, unknown>
): Promise<ExternalDocumentList> {
  const origin = resolveWorkspaceOrigin(sourceConfig)
  const rootPath = normalizeRootPath(sourceConfig.rootPath)
  const maxDocuments = resolveMaxDocuments(sourceConfig.maxDocuments)

  const state = cursor ? (decodeCursor(cursor) ?? { queue: [rootPath] }) : { queue: [rootPath] }
  const queue = [...state.queue]
  const notebooks: DatabricksObjectInfo[] = []

  logger.info('Listing Databricks notebooks', {
    rootPath,
    pending: queue.length,
    resumed: Boolean(cursor),
  })

  for (let listed = 0; listed < DIRECTORIES_PER_CALL && queue.length > 0; ) {
    const batch = queue.splice(0, Math.min(DIRECTORY_CONCURRENCY, DIRECTORIES_PER_CALL - listed))
    listed += batch.length

    const listings = await Promise.all(
      batch.map(async (path) => ({
        path,
        objects: await listDirectory(origin, accessToken, path),
      }))
    )

    for (const { path: currentPath, objects } of listings) {
      /**
       * Losing access to a *sub*directory is survivable, but losing the configured
       * root means the listing is empty. Failing loudly beats reporting a
       * successful sync that indexed nothing.
       */
      if (!objects) {
        if (currentPath === rootPath) {
          throw new Error(
            `Databricks denied access to ${rootPath}. Check the token's workspace permissions or choose another root path.`
          )
        }
        /**
         * A directory was skipped, so notebooks that still exist in the workspace
         * are absent from this listing. Without this flag the engine would
         * reconcile them as deleted.
         */
        if (syncContext) syncContext.listingCapped = true
        continue
      }

      for (const object of objects) {
        const path = object.path
        if (!path) continue
        if (object.object_type && TRAVERSABLE_OBJECT_TYPES.has(object.object_type)) {
          /**
           * `workspace/list` returns the object itself when the path is not a
           * directory; re-queueing a self-reference would loop forever.
           */
          if (path !== currentPath) queue.push(path)
        } else if (object.object_type === 'NOTEBOOK') {
          notebooks.push(object)
        }
      }
    }

    if (notebooks.length >= MAX_NOTEBOOKS_PER_CALL) break
  }

  /**
   * A notebook with no `modified_at` gets a constant `contentHash`, so an edit to
   * it will never be detected by an ordinary sync — only the "Full resync" action
   * re-exports it (see `rehydrateOnFullSync`). Surface that here so the condition
   * is diagnosable from the sync logs instead of presenting as silently stale
   * content.
   */
  const undatedCount = notebooks.reduce((count, object) => count + (object.modified_at ? 0 : 1), 0)
  if (undatedCount > 0) {
    logger.warn(
      'Databricks listed notebooks without a modification timestamp; their edits are only picked up by a full resync',
      { rootPath, undatedCount, listedNotebooks: notebooks.length }
    )
  }

  const previouslyFetched = (syncContext?.totalDocsFetched as number) ?? 0
  const stubs = notebooks.map((object) => notebookToStub(origin, object))
  const { documents, indexableCount, capReached } = takeIndexableWithinCap(
    stubs,
    isSkippedDocument,
    maxDocuments,
    previouslyFetched
  )

  if (syncContext) syncContext.totalDocsFetched = previouslyFetched + indexableCount

  /**
   * The cap truncates the listing only when it stopped the walk with directories
   * still pending, or dropped notebooks from this very page. Reaching the cap on
   * the last notebook of an exhausted walk hides nothing, so deletion
   * reconciliation stays enabled in that case.
   */
  const hitLimit = capReached && (queue.length > 0 || documents.length < stubs.length)
  if (hitLimit && syncContext) syncContext.listingCapped = true

  const hasMore = !hitLimit && queue.length > 0

  return {
    documents,
    nextCursor: hasMore ? encodeCursor({ queue }) : undefined,
    hasMore,
  }
}

/** Pages through the workspace's saved SQL queries. */
async function listQueries(
  accessToken: string,
  sourceConfig: Record<string, unknown>,
  cursor?: string,
  syncContext?: Record<string, unknown>
): Promise<ExternalDocumentList> {
  const origin = resolveWorkspaceOrigin(sourceConfig)
  const maxDocuments = resolveMaxDocuments(sourceConfig.maxDocuments)

  const previouslyFetched = (syncContext?.totalDocsFetched as number) ?? 0

  /**
   * Ask for only what the cap still allows, so the last page of a capped sync
   * does not pull a full 100 rows to discard most of them. Trashed and empty
   * rows are dropped after the fetch, so a short page can still leave the cap
   * unfilled — `next_page_token` then simply carries the sync into another page.
   */
  const remaining =
    maxDocuments > 0 ? Math.max(1, maxDocuments - previouslyFetched) : QUERY_PAGE_SIZE
  const params: Record<string, string> = {
    page_size: String(Math.min(QUERY_PAGE_SIZE, remaining)),
  }
  if (cursor) params.page_token = cursor

  logger.info('Listing Databricks SQL queries', { cursor: cursor ?? 'initial', maxDocuments })

  const response = await databricksGet(origin, '/api/2.0/sql/queries', accessToken, params)

  if (!response.ok) {
    const body = await readErrorBody(response)
    throw new Error(
      `Failed to list Databricks SQL queries: ${describeError(response.status, body)}`
    )
  }

  const data = (await response.json()) as DatabricksQueryListResponse
  const results = data.results ?? []

  /**
   * A trashed query is Databricks' delete: the row stays listable but is no
   * longer part of the workspace. Dropping it here lets deletion reconciliation
   * remove any copy already in the knowledge base, so `listingCapped` must NOT
   * be set for it.
   */
  const stubs = results
    .filter((query) => query.lifecycle_state !== 'TRASHED')
    .map(queryToDocument)
    .filter((document): document is ExternalDocument => document !== null)

  const { documents, indexableCount, capReached } = takeIndexableWithinCap(
    stubs,
    isSkippedDocument,
    maxDocuments,
    previouslyFetched
  )

  if (syncContext) syncContext.totalDocsFetched = previouslyFetched + indexableCount

  /**
   * `next_page_token` is only a usable cursor when this page actually returned
   * results — an echoed token on an empty tail would re-request the same page
   * until the engine truncates pagination, permanently disabling deletion
   * reconciliation.
   */
  const nextPageToken = data.next_page_token?.trim() || undefined
  const sourceHasMore = Boolean(nextPageToken) && results.length > 0

  const hitLimit = capReached && (sourceHasMore || documents.length < stubs.length)
  if (hitLimit && syncContext) syncContext.listingCapped = true

  const hasMore = !hitLimit && sourceHasMore

  return {
    documents,
    nextCursor: hasMore ? nextPageToken : undefined,
    hasMore,
  }
}

/**
 * Exports a notebook and returns its decoded source.
 *
 * `workspace/export` answers with base64 in `content` (no `direct_download`, so
 * the JSON form) and caps a single export at `DATABRICKS_MAX_EXPORT_BYTES`, past
 * which it fails with `MAX_NOTEBOOK_SIZE_EXCEEDED`. That case is reported as an
 * oversize skip rather than an error so the notebook stays visible in the
 * knowledge base.
 */
async function exportNotebook(
  origin: string,
  accessToken: string,
  path: string
): Promise<{ content: string } | { skippedReason: string } | null> {
  const response = await databricksGet(origin, '/api/2.0/workspace/export', accessToken, {
    path,
    format: 'SOURCE',
  })

  if (!response.ok) {
    const body = await readErrorBody(response)
    if (response.status === 404 || body.error_code === 'RESOURCE_DOES_NOT_EXIST') return null
    if (body.error_code === 'MAX_NOTEBOOK_SIZE_EXCEEDED') {
      return { skippedReason: sizeLimitSkipReason(DATABRICKS_MAX_EXPORT_BYTES) }
    }
    throw new Error(
      `Failed to export Databricks notebook ${path}: ${describeError(response.status, body)}`
    )
  }

  const data = (await response.json()) as DatabricksExportResponse
  if (!data.content) return null

  const decoded = Buffer.from(data.content, 'base64')
  if (decoded.byteLength > CONNECTOR_MAX_FILE_BYTES) {
    return { skippedReason: sizeLimitSkipReason(CONNECTOR_MAX_FILE_BYTES) }
  }

  return { content: decoded.toString('utf8') }
}

/**
 * Re-hydrates one notebook.
 *
 * The stub is rebuilt from `workspace/get-status` — the same `ObjectInfo` shape
 * `workspace/list` returns — rather than assembled by hand, so the hash produced
 * here is identical to the listing's by construction.
 */
async function getNotebook(
  accessToken: string,
  sourceConfig: Record<string, unknown>,
  path: string
): Promise<ExternalDocument | null> {
  const origin = resolveWorkspaceOrigin(sourceConfig)

  const statusResponse = await databricksGet(origin, '/api/2.0/workspace/get-status', accessToken, {
    path,
  })

  if (!statusResponse.ok) {
    const body = await readErrorBody(statusResponse)
    if (statusResponse.status === 404 || body.error_code === 'RESOURCE_DOES_NOT_EXIST') return null
    throw new Error(
      `Failed to read Databricks notebook status for ${path}: ${describeError(statusResponse.status, body)}`
    )
  }

  const object = (await statusResponse.json()) as DatabricksObjectInfo
  if (object.object_type !== 'NOTEBOOK') return null

  const stub = notebookToStub(origin, { ...object, path: object.path ?? path })

  const exported = await exportNotebook(origin, accessToken, path)
  if (exported === null) return null
  if ('skippedReason' in exported) return markSkipped(stub, exported.skippedReason)
  if (!exported.content.trim()) return null

  return { ...stub, content: exported.content, contentDeferred: false }
}

/** Re-fetches one saved SQL query by id. */
async function getQuery(
  accessToken: string,
  sourceConfig: Record<string, unknown>,
  queryId: string
): Promise<ExternalDocument | null> {
  const origin = resolveWorkspaceOrigin(sourceConfig)

  const response = await databricksGet(
    origin,
    `/api/2.0/sql/queries/${encodeURIComponent(queryId)}`,
    accessToken,
    {}
  )

  if (!response.ok) {
    const body = await readErrorBody(response)
    if (response.status === 404 || body.error_code === 'RESOURCE_DOES_NOT_EXIST') return null
    throw new Error(
      `Failed to fetch Databricks SQL query ${queryId}: ${describeError(response.status, body)}`
    )
  }

  const query = (await response.json()) as DatabricksQuery
  if (query.lifecycle_state === 'TRASHED') return null

  return queryToDocument({ ...query, id: query.id ?? queryId })
}

export const databricksConnector: ConnectorConfig = {
  ...databricksConnectorMeta,

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    return resolveContentType(sourceConfig) === DATABRICKS_CONTENT_TYPES.queries
      ? listQueries(accessToken, sourceConfig, cursor, syncContext)
      : listNotebooks(accessToken, sourceConfig, cursor, syncContext)
  },

  getDocument: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    externalId: string
  ): Promise<ExternalDocument | null> => {
    try {
      if (externalId.startsWith(QUERY_ID_PREFIX)) {
        return await getQuery(accessToken, sourceConfig, externalId.slice(QUERY_ID_PREFIX.length))
      }
      if (externalId.startsWith(NOTEBOOK_ID_PREFIX)) {
        return await getNotebook(
          accessToken,
          sourceConfig,
          externalId.slice(NOTEBOOK_ID_PREFIX.length)
        )
      }
      return null
    } catch (error) {
      /**
       * Only an explicit "gone" above returns null. Everything else — 429, 5xx,
       * network faults — is rethrown so the sync engine records a failed row and
       * keeps the already-indexed document out of deletion reconciliation.
       */
      logger.warn('Failed to get Databricks document', {
        externalId,
        error: toError(error).message,
      })
      throw toError(error)
    }
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const hostResult = validateDatabricksWorkspaceHost(
      sourceConfig.workspaceHost as string | undefined
    )
    if (!hostResult.isValid || !hostResult.sanitized) {
      return { valid: false, error: hostResult.error || 'Invalid Databricks workspace host' }
    }
    const origin = hostResult.sanitized

    const maxDocuments = sourceConfig.maxDocuments
    if (maxDocuments !== undefined && maxDocuments !== null && String(maxDocuments).trim()) {
      const parsed = Number(maxDocuments)
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return { valid: false, error: 'Max documents must be a positive number' }
      }
    }

    const contentType = resolveContentType(sourceConfig)

    try {
      if (contentType === DATABRICKS_CONTENT_TYPES.queries) {
        const response = await databricksGet(
          origin,
          '/api/2.0/sql/queries',
          accessToken,
          { page_size: '1' },
          VALIDATE_RETRY_OPTIONS
        )
        if (!response.ok) {
          const body = await readErrorBody(response)
          return {
            valid: false,
            error: `Databricks SQL queries access failed: ${describeError(response.status, body)}`,
          }
        }
        return { valid: true }
      }

      const rootPath = normalizeRootPath(sourceConfig.rootPath)
      const response = await databricksGet(
        origin,
        '/api/2.0/workspace/get-status',
        accessToken,
        { path: rootPath },
        VALIDATE_RETRY_OPTIONS
      )

      if (!response.ok) {
        const body = await readErrorBody(response)
        return {
          valid: false,
          error: `Databricks workspace access failed for ${rootPath}: ${describeError(response.status, body)}`,
        }
      }

      const object = (await response.json()) as DatabricksObjectInfo
      if (
        object.object_type &&
        object.object_type !== 'DIRECTORY' &&
        object.object_type !== 'REPO'
      ) {
        return {
          valid: false,
          error: `${rootPath} is a ${object.object_type.toLowerCase()}, not a folder. Enter the folder that contains the notebooks.`,
        }
      }

      return { valid: true }
    } catch (error) {
      return { valid: false, error: getErrorMessage(error, 'Failed to validate configuration') }
    }
  },

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    if (typeof metadata.language === 'string' && metadata.language.trim()) {
      result.language = metadata.language
    }

    if (typeof metadata.owner === 'string' && metadata.owner.trim()) {
      result.owner = metadata.owner
    }

    if (typeof metadata.catalog === 'string' && metadata.catalog.trim()) {
      result.catalog = metadata.catalog
    }

    if (typeof metadata.schema === 'string' && metadata.schema.trim()) {
      result.schema = metadata.schema
    }

    const labels = joinTagArray(metadata.labels)
    if (labels) result.labels = labels

    /**
     * Both stubs normalize their source timestamp to an ISO string — notebooks
     * from `modified_at` (epoch milliseconds), queries from `update_time` — so
     * `parseTagDate`, which only accepts strings, resolves both. Notebooks that
     * carry no timestamp simply produce no tag.
     */
    const lastModified = parseTagDate(metadata.lastModified)
    if (lastModified) result.lastModified = lastModified

    return result
  },
}
