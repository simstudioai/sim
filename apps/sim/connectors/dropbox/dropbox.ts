import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import { dropboxConnectorMeta } from '@/connectors/dropbox/meta'
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

const logger = createLogger('DropboxConnector')

const SUPPORTED_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.markdown',
  '.html',
  '.htm',
  '.csv',
  '.json',
  '.xml',
  '.yaml',
  '.yml',
  '.log',
  '.rst',
  '.tsv',
])

const HTML_EXTENSIONS = new Set(['.html', '.htm'])

const MAX_FILE_SIZE = CONNECTOR_MAX_FILE_BYTES

/** Dropbox `FileMetadata` — the only `.tag` variant this connector indexes. */
interface DropboxFileMetadata {
  '.tag': 'file'
  id: string
  name: string
  path_lower: string
  path_display: string
  client_modified?: string
  server_modified?: string
  rev?: string
  size?: number
  content_hash?: string
  is_downloadable?: boolean
}

/**
 * Dropbox serializes `Metadata` as a discriminated union. `folder` entries carry
 * no size/modified fields and `deleted` entries carry no `id` at all, so they must
 * be narrowed away before a stub is built from them.
 */
interface DropboxNonFileMetadata {
  '.tag': 'folder' | 'deleted'
  id?: string
  name: string
  path_lower?: string
  path_display?: string
}

type DropboxEntry = DropboxFileMetadata | DropboxNonFileMetadata

interface DropboxListFolderResponse {
  entries: DropboxEntry[]
  cursor: string
  has_more: boolean
}

function extensionOf(name: string): string {
  const lower = name.toLowerCase()
  const dotIndex = lower.lastIndexOf('.')
  return dotIndex === -1 ? '' : lower.slice(dotIndex)
}

/** A downloadable file with a supported extension, regardless of size. */
function isDownloadableFile(entry: DropboxEntry): entry is DropboxFileMetadata {
  return (
    entry['.tag'] === 'file' &&
    entry.is_downloadable !== false &&
    SUPPORTED_EXTENSIONS.has(extensionOf(entry.name))
  )
}

/**
 * Normalizes a user-supplied folder path to the `PathROrId` format
 * `/2/files/list_folder` declares: the empty string for the Dropbox root (the
 * leading-slash branch of the pattern is optional precisely so `""` matches),
 * otherwise a leading slash. The trailing slash is stripped as defensive
 * tidying of free-form input, not because Dropbox documents rejecting it.
 * A path outside the format fails with `path/malformed_path`.
 */
function normalizeFolderPath(raw: unknown): string {
  const trimmed = typeof raw === 'string' ? raw.trim() : ''
  if (!trimmed || trimmed === '/') return ''
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  return withLeadingSlash.replace(/\/+$/, '')
}

/**
 * Serializes the `Dropbox-API-Arg` header value as HTTP-header-safe ASCII.
 * Dropbox requires DEL (0x7F) and every non-ASCII character to be sent as a JSON
 * `\uXXXX` escape; a raw `JSON.stringify` of any argument carrying non-ASCII text
 * fails with `could not decode input as JSON` or an invalid-header error.
 *
 * @see https://www.dropbox.com/developers/reference/json-encoding
 */
function toDropboxApiArg(arg: Record<string, unknown>): string {
  return JSON.stringify(arg).replace(
    /[\u007f-\uffff]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`
  )
}

async function downloadFileContent(
  accessToken: string,
  fileId: string,
  isHtml: boolean
): Promise<string> {
  const response = await fetchWithRetry('https://content.dropboxapi.com/2/files/download', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Dropbox-API-Arg': toDropboxApiArg({ path: fileId }),
    },
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(`Failed to download file ${fileId}: ${response.status} ${errorText}`.trim())
  }

  // Stream with a hard byte cap so a file whose listing metadata under-reported
  // (or omitted) its size can never be fully buffered into memory. Oversize raises
  // so getDocument can surface it as a skipped (failed) row rather than dropping it.
  const buffer = await readBodyWithLimit(response, MAX_FILE_SIZE)
  if (!buffer) {
    throw new ConnectorFileTooLargeError(MAX_FILE_SIZE)
  }

  const text = buffer.toString('utf8')

  return isHtml ? htmlToPlainText(text) : text
}

function fileToStub(entry: DropboxFileMetadata): ExternalDocument {
  return {
    externalId: entry.id,
    title: entry.name,
    content: '',
    contentDeferred: true,
    mimeType: 'text/plain',
    sourceUrl: `https://www.dropbox.com/home${encodeURI(entry.path_display)}`,
    contentHash: `dropbox:${entry.id}:${entry.content_hash ?? entry.rev ?? entry.server_modified ?? ''}`,
    metadata: {
      path: entry.path_display,
      lastModified: entry.server_modified || entry.client_modified,
      fileSize: entry.size,
    },
  }
}

export const dropboxConnector: ConnectorConfig = {
  ...dropboxConnectorMeta,

  isListingScopeUnavailableError: isListingScopeUnavailableError,

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    let data: DropboxListFolderResponse

    if (cursor) {
      const response = await fetchWithRetry(
        'https://api.dropboxapi.com/2/files/list_folder/continue',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ cursor }),
        }
      )

      if (!response.ok) {
        const errorText = await response.text()
        logger.error('Failed to continue listing Dropbox folder', {
          status: response.status,
          error: errorText,
        })
        throw new Error(`Failed to continue listing Dropbox folder: ${response.status}`)
      }

      data = await response.json()
    } else {
      const path = normalizeFolderPath(sourceConfig.folderPath)

      logger.info('Listing Dropbox folder', { path: path || '(root)' })

      const response = await fetchWithRetry('https://api.dropboxapi.com/2/files/list_folder', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          path,
          recursive: true,
          include_deleted: false,
          include_non_downloadable_files: false,
          limit: 2000,
        }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        logger.error('Failed to list Dropbox folder', {
          status: response.status,
          error: errorText,
        })
        /** Dropbox reports a path the caller cannot reach as 409 path/not_found. */
        throw response.status === 409
          ? new ConnectorListingScopeUnavailableError(
              `Failed to list Dropbox folder: ${response.status}`,
              response.status
            )
          : new Error(`Failed to list Dropbox folder: ${response.status}`)
      }

      data = await response.json()
    }

    // Keep oversized files and surface them as skipped (failed) documents instead
    // of dropping them silently at listing time.
    const candidateFiles = data.entries.filter(isDownloadableFile)

    const parsedMaxFiles = Number(sourceConfig.maxFiles)
    const maxFiles = Number.isFinite(parsedMaxFiles) && parsedMaxFiles > 0 ? parsedMaxFiles : 0
    const previouslyFetched = (syncContext?.totalDocsFetched as number) ?? 0

    const stubs = candidateFiles.map((entry) =>
      stubOrSkipBySize(fileToStub(entry), entry.size, MAX_FILE_SIZE)
    )

    const { documents, indexableCount, capReached } = takeIndexableWithinCap(
      stubs,
      isSkippedDocument,
      maxFiles,
      previouslyFetched
    )

    const totalFetched = previouslyFetched + indexableCount
    const hitLimit = capReached
    /**
     * `listingCapped` blocks the sync engine's deletion reconciliation, so it is set
     * only when the cap actually hid documents that still exist — either entries were
     * dropped from this page, or Dropbox reported more pages we will not request.
     * A cap that lands exactly on the last entry of the final page is a complete
     * listing; flagging it would permanently block deletion reconciliation.
     */
    const cappedWithItemsLeft = hitLimit && (documents.length < stubs.length || data.has_more)
    if (syncContext) {
      syncContext.totalDocsFetched = totalFetched
      if (cappedWithItemsLeft) syncContext.listingCapped = true
    }

    return {
      documents,
      nextCursor: hitLimit ? undefined : data.has_more ? data.cursor : undefined,
      hasMore: hitLimit ? false : data.has_more,
    }
  },

  getDocument: async (
    accessToken: string,
    _sourceConfig: Record<string, unknown>,
    externalId: string
  ): Promise<ExternalDocument | null> => {
    const response = await fetchWithRetry('https://api.dropboxapi.com/2/files/get_metadata', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path: externalId }),
    })

    /**
     * Dropbox reports every endpoint-specific error as 409, so the status alone
     * does not mean the file is gone. For `get_metadata` the error union is
     * `path: LookupError`, whose variants include `restricted_content` and
     * `locked` — the file still exists in both. Only `not_found` is absence, and
     * only that returns `null`; anything else propagates so the sync engine
     * records a failed row instead of silently dropping the document.
     */
    if (!response.ok) {
      if (response.status === 409) {
        const body = (await response.json().catch(() => null)) as {
          error?: { '.tag'?: string; path?: { '.tag'?: string } }
        } | null
        if (body?.error?.['.tag'] === 'path' && body.error.path?.['.tag'] === 'not_found') {
          return null
        }
      }
      throw new Error(`Failed to get metadata: ${response.status}`)
    }

    const entry = (await response.json()) as DropboxEntry

    if (!isDownloadableFile(entry)) return null

    const stub = fileToStub(entry)
    if (entry.size && entry.size > MAX_FILE_SIZE) {
      return markSkipped(stub, sizeLimitSkipReason(MAX_FILE_SIZE))
    }

    let content: string
    try {
      /**
       * Addressed by file id rather than path: ids are stable across renames and
       * are pure ASCII, so the `Dropbox-API-Arg` header stays header-safe.
       */
      content = await downloadFileContent(
        accessToken,
        entry.id,
        HTML_EXTENSIONS.has(extensionOf(entry.name))
      )
    } catch (error) {
      if (error instanceof ConnectorFileTooLargeError) {
        return markSkipped(stub, sizeLimitSkipReason(error.limitBytes))
      }
      throw error
    }
    if (!content.trim()) return null

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

    try {
      const path = normalizeFolderPath(sourceConfig.folderPath)

      const response = await fetchWithRetry(
        'https://api.dropboxapi.com/2/files/list_folder',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            path,
            limit: 1,
            recursive: false,
          }),
        },
        VALIDATE_RETRY_OPTIONS
      )

      if (!response.ok) {
        const errorText = await response.text()
        if (errorText.includes('not_found')) {
          return { valid: false, error: 'Folder not found. Check the path and try again.' }
        }
        return { valid: false, error: `Failed to access Dropbox: ${response.status}` }
      }

      return { valid: true }
    } catch (error) {
      const message = getErrorMessage(error, 'Failed to validate configuration')
      return { valid: false, error: message }
    }
  },

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    if (typeof metadata.path === 'string') {
      result.path = metadata.path
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
