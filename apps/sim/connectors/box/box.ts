import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import { boxConnectorMeta } from '@/connectors/box/meta'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import {
  CONNECTOR_MAX_FILE_BYTES,
  ConnectorFileTooLargeError,
  ConnectorListingScopeUnavailableError,
  htmlToPlainText,
  isListingScopeUnavailableError,
  isSkippedDocument,
  markSkipped,
  parseTagDate,
  readBodyWithLimit,
  sizeLimitSkipReason,
  stubOrSkipBySize,
  takeIndexableWithinCap,
} from '@/connectors/utils'

const logger = createLogger('BoxConnector')

const BOX_API_BASE = 'https://api.box.com/2.0'
const BOX_ROOT_FOLDER_ID = '0'

/** Maximum items per `GET /folders/:id/items` page (Box hard limit is 1000). */
const FOLDER_ITEMS_PAGE_SIZE = 1000

/**
 * Fields requested on every listed item. Supplying `fields` drops Box's standard
 * field set, so every field the stub and tag mapping need must be named here.
 */
const ITEM_FIELDS = 'type,id,name,etag,size,created_at,modified_at,extension,path_collection'

const FILE_FIELDS = `${ITEM_FIELDS},item_status,trashed_at`

/**
 * Folder pages drained per `listDocuments` call. Box has no recursive listing, so
 * a naive one-folder-per-call walk would spend the sync engine's page budget
 * (`MAX_PAGES`) on folder depth rather than on documents.
 */
const FOLDER_PAGES_PER_CALL = 10

/** Soft ceiling on stubs accumulated in one call, so a wide tree still yields early. */
const MAX_FILES_PER_CALL = 2000

const MAX_FILE_SIZE = CONNECTOR_MAX_FILE_BYTES

/**
 * Extensions read straight from `GET /files/:id/content` as UTF-8. These need no
 * Box-side conversion, so they skip the representation round trip entirely.
 */
const PLAIN_TEXT_EXTENSIONS = new Set([
  'as',
  'as3',
  'asm',
  'bat',
  'c',
  'cc',
  'cmake',
  'cpp',
  'cs',
  'css',
  'csv',
  'cxx',
  'diff',
  'erb',
  'groovy',
  'h',
  'haml',
  'hh',
  'htm',
  'html',
  'java',
  'js',
  'json',
  'less',
  'log',
  'm',
  'make',
  'markdown',
  'md',
  'ml',
  'mm',
  'php',
  'pl',
  'plist',
  'properties',
  'py',
  'rb',
  'rst',
  'sass',
  'scala',
  'scm',
  'script',
  'sh',
  'sml',
  'sql',
  'tsv',
  'txt',
  'vim',
  'vtt',
  'xhtml',
  'xml',
  'xsd',
  'xsl',
  'yaml',
  'yml',
])

/**
 * Formats Box lists with `Text? = Yes` in the representation "Supported File
 * Types" table whose raw bytes are not usable as UTF-8 (binary, proprietary, or
 * markup-heavy). Content for these is pulled from the `extracted_text`
 * representation rather than from `GET /files/:id/content`.
 */
const REPRESENTATION_EXTENSIONS = new Set([
  'boxcanvas',
  'boxnote',
  'doc',
  'docx',
  'fdx',
  'gdoc',
  'gsheet',
  'gslide',
  'gslides',
  'msg',
  'odp',
  'ods',
  'odt',
  'otp',
  'pdf',
  'ppt',
  'pptx',
  'rtf',
  'vi',
  'webdoc',
  'wpd',
  'xbd',
  'xdw',
  'xls',
  'xlsm',
  'xlsx',
])

/** Extensions rendered as HTML that must be stripped before indexing. */
const HTML_EXTENSIONS = new Set(['htm', 'html', 'xhtml'])

/** Bounded wait for Box to finish generating an on-demand text representation. */
const REPRESENTATION_POLL_ATTEMPTS = 5
const REPRESENTATION_POLL_DELAY_MS = 2000

/** Hosts Box serves representation and content downloads from. */
const BOX_DOWNLOAD_HOST_SUFFIXES = ['.box.com', '.boxcloud.com']

interface BoxPathEntry {
  id?: string
  name?: string
}

interface BoxItem {
  type?: string
  id: string
  name?: string
  etag?: string | null
  size?: number
  created_at?: string
  modified_at?: string
  extension?: string
  item_status?: string
  trashed_at?: string | null
  path_collection?: { entries?: BoxPathEntry[] }
}

interface BoxFolderItemsResponse {
  entries?: BoxItem[]
  next_marker?: string | null
}

interface BoxRepresentationEntry {
  representation?: string
  content?: { url_template?: string }
  info?: { url?: string }
  status?: { state?: string }
}

interface BoxFileWithRepresentations extends BoxItem {
  representations?: { entries?: BoxRepresentationEntry[] }
}

/**
 * Traversal position across pages of a single sync run. Box has no recursive
 * listing endpoint, so the connector walks the folder tree breadth-first and
 * carries the pending-folder queue plus the current folder's marker in the cursor.
 */
interface BoxTraversalState {
  /** Folder IDs discovered but not yet listed. */
  queue: string[]
  /** Folder currently being listed. */
  folderId: string
  /** Box marker for the next page of `folderId`, if any. */
  marker?: string
}

function encodeCursor(state: BoxTraversalState): string {
  return Buffer.from(JSON.stringify(state), 'utf8').toString('base64url')
}

function decodeCursor(cursor: string): BoxTraversalState | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown
    if (typeof parsed !== 'object' || parsed === null) return null
    const candidate = parsed as Partial<BoxTraversalState>
    if (typeof candidate.folderId !== 'string' || !Array.isArray(candidate.queue)) return null
    return {
      folderId: candidate.folderId,
      queue: candidate.queue.filter((id): id is string => typeof id === 'string'),
      marker: typeof candidate.marker === 'string' ? candidate.marker : undefined,
    }
  } catch {
    return null
  }
}

function normalizeFolderId(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  return raw || BOX_ROOT_FOLDER_ID
}

function getExtension(item: BoxItem): string {
  if (item.extension) return item.extension.toLowerCase()
  const name = item.name ?? ''
  const dotIndex = name.lastIndexOf('.')
  return dotIndex === -1 ? '' : name.slice(dotIndex + 1).toLowerCase()
}

function isSupportedFile(item: BoxItem): boolean {
  if (item.type !== 'file') return false
  const extension = getExtension(item)
  return PLAIN_TEXT_EXTENSIONS.has(extension) || REPRESENTATION_EXTENSIONS.has(extension)
}

/**
 * Builds a human-readable path from Box's `path_collection` ancestry, dropping the
 * synthetic root entry (id `0`, "All Files") so paths read as `/Reports/q3.pdf`.
 */
function buildPath(item: BoxItem): string {
  const ancestors = (item.path_collection?.entries ?? [])
    .filter((entry) => entry.id !== BOX_ROOT_FOLDER_ID && typeof entry.name === 'string')
    .map((entry) => entry.name as string)
  return `/${[...ancestors, item.name ?? ''].join('/')}`
}

/**
 * Metadata-only stub. `etag` is Box's per-version entity tag and changes on every
 * new file version, so it is the change indicator; `modified_at` is the fallback
 * for the rare item where Box omits an etag.
 */
function fileToStub(item: BoxItem): ExternalDocument {
  return {
    externalId: item.id,
    title: item.name || 'Untitled',
    content: '',
    contentDeferred: true,
    mimeType: 'text/plain',
    sourceUrl: `https://app.box.com/file/${item.id}`,
    contentHash: `box:${item.id}:${item.etag ?? item.modified_at ?? ''}`,
    metadata: {
      path: buildPath(item),
      extension: getExtension(item),
      lastModified: item.modified_at,
      fileSize: item.size,
    },
  }
}

function assertBoxDownloadHost(url: string): void {
  const host = new URL(url).hostname.toLowerCase()
  const allowed = BOX_DOWNLOAD_HOST_SUFFIXES.some(
    (suffix) => host === suffix.slice(1) || host.endsWith(suffix)
  )
  if (!allowed) {
    throw new Error(`Refusing to download Box content from unexpected host: ${host}`)
  }
}

/**
 * Streams a Box download against the connector size cap, raising
 * {@link ConnectorFileTooLargeError} when the body exceeds it so an oversized file
 * surfaces as a skipped row instead of being buffered whole.
 */
async function downloadWithinLimit(url: string, accessToken: string): Promise<Buffer> {
  assertBoxDownloadHost(url)

  const response = await fetchWithRetry(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (response.status === 202) {
    throw new Error('Box content is not yet ready for download')
  }
  if (!response.ok) {
    throw new Error(`Failed to download Box content: ${response.status}`)
  }

  const buffer = await readBodyWithLimit(response, MAX_FILE_SIZE)
  if (!buffer) {
    throw new ConnectorFileTooLargeError(MAX_FILE_SIZE)
  }
  return buffer
}

async function fetchPlainTextContent(
  accessToken: string,
  fileId: string,
  extension: string
): Promise<string> {
  const buffer = await downloadWithinLimit(`${BOX_API_BASE}/files/${fileId}/content`, accessToken)
  const text = buffer.toString('utf8')
  return HTML_EXTENSIONS.has(extension) ? htmlToPlainText(text) : text
}

/**
 * Resolves the `extracted_text` representation for a file.
 *
 * Box generates text representations on demand: the first request reports state
 * `none`, and calling the representation's `info.url` starts generation. The state
 * is then polled a bounded number of times. When generation has not finished in
 * time the caller returns `null` so the document is retried on the next sync rather
 * than being stored with empty content.
 */
async function fetchExtractedText(
  accessToken: string,
  entry: BoxRepresentationEntry
): Promise<string | null> {
  const infoUrl = entry.info?.url
  let urlTemplate = entry.content?.url_template
  let state = entry.status?.state
  if (!urlTemplate && !infoUrl) return null

  for (let attempt = 0; attempt <= REPRESENTATION_POLL_ATTEMPTS; attempt++) {
    if ((state === 'success' || state === 'viewable') && urlTemplate) {
      const buffer = await downloadWithinLimit(
        urlTemplate.replace('{+asset_path}', ''),
        accessToken
      )
      return buffer.toString('utf8')
    }
    if (state === 'error' || !infoUrl) return null
    if (attempt === REPRESENTATION_POLL_ATTEMPTS) break

    assertBoxDownloadHost(infoUrl)
    const response = await fetchWithRetry(infoUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    /**
     * A 404 means the representation is genuinely gone; 202 means still generating.
     * Anything else (429, 5xx) is transient and must surface as a failed hydration rather
     * than being folded into "this file has no extractable text".
     */
    if (response.status === 404) return null
    if (!response.ok && response.status !== 202) {
      throw new Error(`Failed to poll Box representation status: ${response.status}`)
    }

    if (response.status === 202) {
      state = 'pending'
    } else {
      const info = (await response.json()) as BoxRepresentationEntry
      state = info.status?.state ?? 'pending'
      urlTemplate = info.content?.url_template ?? urlTemplate
    }

    if (state !== 'success' && state !== 'viewable') {
      await sleep(REPRESENTATION_POLL_DELAY_MS)
    }
  }

  return null
}

/**
 * Lists one page of a folder. A folder the credential can no longer read is
 * reported rather than thrown, so one inaccessible subtree does not abort the
 * whole listing — the caller flags the listing as capped instead.
 */
async function listFolderPage(
  accessToken: string,
  folderId: string,
  marker: string | undefined
): Promise<BoxFolderItemsResponse | null> {
  const params = new URLSearchParams({
    fields: ITEM_FIELDS,
    limit: String(FOLDER_ITEMS_PAGE_SIZE),
    usemarker: 'true',
  })
  if (marker) params.set('marker', marker)

  const response = await fetchWithRetry(
    `${BOX_API_BASE}/folders/${encodeURIComponent(folderId)}/items?${params.toString()}`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  )

  if (response.status === 403 || response.status === 404) {
    logger.warn('Skipping inaccessible Box folder', { folderId, status: response.status })
    return null
  }

  if (!response.ok) {
    const errorText = await response.text()
    logger.error('Failed to list Box folder items', {
      folderId,
      status: response.status,
      error: errorText,
    })
    throw new Error(`Failed to list Box folder items: ${response.status}`)
  }

  return (await response.json()) as BoxFolderItemsResponse
}

export const boxConnector: ConnectorConfig = {
  ...boxConnectorMeta,

  isListingScopeUnavailableError,

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const rootFolderId = normalizeFolderId(sourceConfig.folderId)
    const state: BoxTraversalState = cursor
      ? (decodeCursor(cursor) ?? { queue: [], folderId: rootFolderId })
      : { queue: [], folderId: rootFolderId }

    const queue = [...state.queue]
    const files: BoxItem[] = []
    let position: { folderId: string; marker?: string } | null = {
      folderId: state.folderId,
      marker: state.marker,
    }

    for (let fetched = 0; fetched < FOLDER_PAGES_PER_CALL && position; fetched++) {
      const page = await listFolderPage(accessToken, position.folderId, position.marker)

      /**
       * Losing access to a *sub*folder is survivable, but losing access to the
       * configured root means the whole listing is empty. Failing loudly beats
       * reporting a successful sync that indexed nothing.
       */
      if (!page && position.folderId === rootFolderId) {
        throw new ConnectorListingScopeUnavailableError(
          `Box denied access to folder ${rootFolderId}. Reconnect the Box account or choose another folder.`,
          403
        )
      }

      if (page) {
        for (const item of page.entries ?? []) {
          if (item.type === 'folder') {
            queue.push(item.id)
          } else if (isSupportedFile(item)) {
            files.push(item)
          }
        }
      } else if (syncContext) {
        /**
         * A folder was skipped, so documents that still exist in Box are absent from
         * this listing. Without this flag the engine would reconcile them as deleted.
         */
        syncContext.listingCapped = true
      }

      const nextMarker = page?.next_marker || undefined
      if (nextMarker) {
        position = { folderId: position.folderId, marker: nextMarker }
      } else {
        const nextFolderId = queue.shift()
        position = nextFolderId ? { folderId: nextFolderId } : null
      }

      if (files.length >= MAX_FILES_PER_CALL) break
    }

    const nextState: BoxTraversalState | null = position
      ? { queue, folderId: position.folderId, marker: position.marker }
      : null

    const parsedMaxFiles = Number(sourceConfig.maxFiles)
    const maxFiles = Number.isFinite(parsedMaxFiles) && parsedMaxFiles > 0 ? parsedMaxFiles : 0
    const previouslyFetched = (syncContext?.totalDocsFetched as number) ?? 0

    const stubs = files.map((item) => stubOrSkipBySize(fileToStub(item), item.size, MAX_FILE_SIZE))

    const { documents, indexableCount, capReached } = takeIndexableWithinCap(
      stubs,
      isSkippedDocument,
      maxFiles,
      previouslyFetched
    )

    if (syncContext) syncContext.totalDocsFetched = previouslyFetched + indexableCount

    /**
     * The cap truncates the listing when it stopped traversal with folders still
     * pending, or when it dropped items from this very page. Reaching the cap on
     * the final item of the final page hides nothing, so deletion reconciliation
     * stays enabled in that case.
     */
    const droppedInPage = documents.length < stubs.length
    const hitLimit = capReached && (nextState !== null || droppedInPage)
    if (hitLimit && syncContext) syncContext.listingCapped = true

    return {
      documents,
      nextCursor: hitLimit || !nextState ? undefined : encodeCursor(nextState),
      hasMore: !hitLimit && nextState !== null,
    }
  },

  getDocument: async (
    accessToken: string,
    _sourceConfig: Record<string, unknown>,
    externalId: string
  ): Promise<ExternalDocument | null> => {
    const response = await fetchWithRetry(
      `${BOX_API_BASE}/files/${encodeURIComponent(externalId)}?fields=${FILE_FIELDS},representations`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'x-rep-hints': '[extracted_text]',
        },
      }
    )

    /**
     * 404/403 are the only statuses that mean the file is genuinely unavailable.
     * Every other failure (429, 5xx, network faults) propagates so the sync engine
     * records a failed row and excludes the file from deletion reconciliation.
     */
    if (response.status === 404 || response.status === 403) return null
    if (!response.ok) {
      throw new Error(`Failed to get Box file metadata: ${response.status}`)
    }

    const file = (await response.json()) as BoxFileWithRepresentations
    if (file.trashed_at || (file.item_status && file.item_status !== 'active')) return null
    if (!isSupportedFile({ ...file, type: file.type ?? 'file' })) return null

    const stub = fileToStub(file)
    if (file.size && file.size > MAX_FILE_SIZE) {
      return markSkipped(stub, sizeLimitSkipReason(MAX_FILE_SIZE))
    }

    const extension = getExtension(file)

    let content: string | null
    try {
      if (PLAIN_TEXT_EXTENSIONS.has(extension)) {
        content = await fetchPlainTextContent(accessToken, file.id, extension)
      } else {
        const entry = (file.representations?.entries ?? []).find(
          (candidate) => candidate.representation === 'extracted_text'
        )
        content = entry ? await fetchExtractedText(accessToken, entry) : null
      }
    } catch (error) {
      if (error instanceof ConnectorFileTooLargeError) {
        return markSkipped(stub, sizeLimitSkipReason(error.limitBytes))
      }
      throw error
    }

    if (!content?.trim()) return null

    return { ...stub, content, contentDeferred: false }
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const maxFiles = sourceConfig.maxFiles as string | undefined
    if (maxFiles && (Number.isNaN(Number(maxFiles)) || Number(maxFiles) <= 0)) {
      return { valid: false, error: 'Max files must be a positive number' }
    }

    const folderId = normalizeFolderId(sourceConfig.folderId)
    if (!/^\d+$/.test(folderId)) {
      return {
        valid: false,
        error: 'Folder ID must be a numeric Box folder ID (use 0 for the root)',
      }
    }

    try {
      const response = await fetchWithRetry(
        `${BOX_API_BASE}/folders/${folderId}?fields=id,name`,
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${accessToken}` },
        },
        VALIDATE_RETRY_OPTIONS
      )

      if (response.status === 404) {
        return { valid: false, error: 'Folder not found. Check the folder ID and try again.' }
      }
      if (response.status === 401 || response.status === 403) {
        return {
          valid: false,
          error: 'Box denied access to this folder. Reconnect or pick another folder.',
        }
      }
      if (!response.ok) {
        return { valid: false, error: `Failed to access Box: ${response.status}` }
      }

      return { valid: true }
    } catch (error) {
      return { valid: false, error: getErrorMessage(error, 'Failed to validate configuration') }
    }
  },

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    if (typeof metadata.path === 'string' && metadata.path) {
      result.path = metadata.path
    }

    if (typeof metadata.extension === 'string' && metadata.extension) {
      result.extension = metadata.extension
    }

    const lastModified = parseTagDate(metadata.lastModified)
    if (lastModified) result.lastModified = lastModified

    if (metadata.fileSize != null) {
      const num = Number(metadata.fileSize)
      if (!Number.isNaN(num)) result.fileSize = num
    }

    return result
  },
}
