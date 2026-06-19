import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import { dropboxConnectorMeta } from '@/connectors/dropbox/meta'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import {
  CONNECTOR_MAX_FILE_BYTES,
  ConnectorFileTooLargeError,
  htmlToPlainText,
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

const MAX_FILE_SIZE = CONNECTOR_MAX_FILE_BYTES

interface DropboxFileEntry {
  '.tag': 'file' | 'folder' | 'deleted'
  id: string
  name: string
  path_lower: string
  path_display: string
  client_modified?: string
  server_modified?: string
  size?: number
  content_hash?: string
  is_downloadable?: boolean
}

interface DropboxListFolderResponse {
  entries: DropboxFileEntry[]
  cursor: string
  has_more: boolean
}

function hasSupportedExtension(name: string): boolean {
  const lower = name.toLowerCase()
  const dotIndex = lower.lastIndexOf('.')
  if (dotIndex === -1) return false
  return SUPPORTED_EXTENSIONS.has(lower.slice(dotIndex))
}

/** A downloadable file with a supported extension, regardless of size. */
function isDownloadableFile(entry: DropboxFileEntry): boolean {
  return (
    entry['.tag'] === 'file' && entry.is_downloadable !== false && hasSupportedExtension(entry.name)
  )
}

async function downloadFileContent(accessToken: string, filePath: string): Promise<string> {
  const response = await fetchWithRetry('https://content.dropboxapi.com/2/files/download', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Dropbox-API-Arg': JSON.stringify({ path: filePath }),
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to download file ${filePath}: ${response.status}`)
  }

  // Stream with a hard byte cap so a file whose listing metadata under-reported
  // (or omitted) its size can never be fully buffered into memory. Oversize raises
  // so getDocument can surface it as a skipped (failed) row rather than dropping it.
  const buffer = await readBodyWithLimit(response, MAX_FILE_SIZE)
  if (!buffer) {
    throw new ConnectorFileTooLargeError(MAX_FILE_SIZE)
  }

  const text = buffer.toString('utf8')

  if (filePath.endsWith('.html') || filePath.endsWith('.htm')) {
    return htmlToPlainText(text)
  }

  return text
}

function fileToStub(entry: DropboxFileEntry): ExternalDocument {
  return {
    externalId: entry.id,
    title: entry.name,
    content: '',
    contentDeferred: true,
    mimeType: 'text/plain',
    sourceUrl: `https://www.dropbox.com/home${entry.path_display}`,
    contentHash: `dropbox:${entry.id}:${entry.content_hash ?? entry.server_modified ?? ''}`,
    metadata: {
      path: entry.path_display,
      lastModified: entry.server_modified || entry.client_modified,
      fileSize: entry.size,
    },
  }
}

export const dropboxConnector: ConnectorConfig = {
  ...dropboxConnectorMeta,

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
      const folderPath = (sourceConfig.folderPath as string)?.trim() || ''
      const path = folderPath.startsWith('/') ? folderPath : folderPath ? `/${folderPath}` : ''

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
        throw new Error(`Failed to list Dropbox folder: ${response.status}`)
      }

      data = await response.json()
    }

    // Keep oversized files and surface them as skipped (failed) documents instead
    // of dropping them silently at listing time.
    const candidateFiles = data.entries.filter(isDownloadableFile)

    const maxFiles = sourceConfig.maxFiles ? Number(sourceConfig.maxFiles) : 0
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
    if (syncContext) syncContext.totalDocsFetched = totalFetched
    const hitLimit = capReached
    if (hitLimit && syncContext) syncContext.listingCapped = true

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
    try {
      const response = await fetchWithRetry('https://api.dropboxapi.com/2/files/get_metadata', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ path: externalId }),
      })

      if (!response.ok) {
        if (response.status === 409) return null
        throw new Error(`Failed to get metadata: ${response.status}`)
      }

      const entry = (await response.json()) as DropboxFileEntry

      if (!isDownloadableFile(entry)) return null

      const stub = fileToStub(entry)
      if (entry.size && entry.size > MAX_FILE_SIZE) {
        return markSkipped(stub, sizeLimitSkipReason(MAX_FILE_SIZE))
      }

      let content: string
      try {
        content = await downloadFileContent(accessToken, entry.path_lower)
      } catch (error) {
        if (error instanceof ConnectorFileTooLargeError) {
          return markSkipped(stub, sizeLimitSkipReason(error.limitBytes))
        }
        throw error
      }
      if (!content.trim()) return null

      return { ...stub, content, contentDeferred: false }
    } catch (error) {
      logger.warn(`Failed to fetch document ${externalId}`, {
        error: toError(error).message,
      })
      return null
    }
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
      const folderPath = (sourceConfig.folderPath as string)?.trim() || ''
      const path = folderPath.startsWith('/') ? folderPath : folderPath ? `/${folderPath}` : ''

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
