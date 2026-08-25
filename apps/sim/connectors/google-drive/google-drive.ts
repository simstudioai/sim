import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import {
  attachRetryHeaders,
  isRetryableError,
  type RetryOptions,
  resolveRetryDelayMs,
  retryWithExponentialBackoff,
  VALIDATE_RETRY_OPTIONS,
} from '@/lib/knowledge/documents/utils'
import {
  GoogleDriveApiError,
  readGoogleDriveApiError,
} from '@/connectors/google-drive/google-drive-errors'
import { googleDriveConnectorMeta } from '@/connectors/google-drive/meta'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import {
  buildDriveParentsClause,
  CONNECTOR_MAX_FILE_BYTES,
  ConnectorFileTooLargeError,
  htmlToPlainText,
  isSkippedDocument,
  joinTagArray,
  markSkipped,
  parseMultiValue,
  parseTagDate,
  readBodyWithLimit,
  sizeLimitSkipReason,
  stubOrSkipBySize,
  takeIndexableWithinCap,
} from '@/connectors/utils'

const logger = createLogger('GoogleDriveConnector')

const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const GOOGLE_WORKSPACE_EXPORTS: Record<string, string> = {
  'application/vnd.google-apps.document': 'text/plain',
  'application/vnd.google-apps.spreadsheet': XLSX_MIME_TYPE,
  'application/vnd.google-apps.presentation': 'text/plain',
}

const SUPPORTED_TEXT_MIME_TYPES = [
  'text/plain',
  'text/csv',
  'text/html',
  'text/markdown',
  'application/json',
  'application/xml',
]

// Google Drive's `files.export` API rejects exports over 10 MB (exportSizeLimitExceeded),
// so this is a hard external limit for Google Workspace docs — not the connector cap.
const MAX_EXPORT_SIZE = 10 * 1024 * 1024
const MAX_FILES_VALIDATION_ERROR = 'Max files must be a positive safe integer, or 0 for unlimited'

function parseMaxFiles(value: unknown): number {
  if (value === undefined || value === null) return 0
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error(MAX_FILES_VALIDATION_ERROR)
  }
  const normalized = typeof value === 'string' ? value.trim() : value
  if (normalized === '') return 0
  if (typeof normalized === 'string' && !/^\d+$/.test(normalized)) {
    throw new Error(MAX_FILES_VALIDATION_ERROR)
  }
  const parsed = Number(normalized)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(MAX_FILES_VALIDATION_ERROR)
  }
  return parsed
}

function googleDriveErrorLogFields(error: unknown): Record<string, unknown> {
  if (error instanceof GoogleDriveApiError) {
    return {
      error: error.message,
      status: error.status,
      reasons: error.reasons,
      providerMessage: error.providerMessage,
    }
  }
  return { error: toError(error).message }
}

function isGoogleWorkspaceFile(mimeType: string): boolean {
  return mimeType in GOOGLE_WORKSPACE_EXPORTS
}

function isSupportedTextFile(mimeType: string): boolean {
  return SUPPORTED_TEXT_MIME_TYPES.some((t) => mimeType.startsWith(t))
}

/** Retries Google errors whose structured body identifies a transient rejection. */
async function fetchGoogleDriveWithRetry(
  url: string,
  options: RequestInit,
  retryOptions: RetryOptions = {}
): Promise<Response> {
  return retryWithExponentialBackoff(
    async () => {
      const response = await fetch(url, options)
      if (response.ok) return response

      const error = await readGoogleDriveApiError(response)
      attachRetryHeaders(error, response.headers)
      const waitMs = resolveRetryDelayMs(response.headers)
      if (waitMs !== undefined) error.retryAfterMs = waitMs
      throw error
    },
    {
      ...retryOptions,
      retryCondition: (error) =>
        error instanceof GoogleDriveApiError
          ? error.kind === 'transient' || isRetryableError(error)
          : (retryOptions.retryCondition?.(error) ?? isRetryableError(error)),
    }
  )
}

async function exportGoogleWorkspaceFile(
  accessToken: string,
  fileId: string,
  sourceMimeType: string
): Promise<Buffer> {
  const exportMimeType = GOOGLE_WORKSPACE_EXPORTS[sourceMimeType]
  if (!exportMimeType) {
    throw new Error(`Unsupported Google Workspace MIME type: ${sourceMimeType}`)
  }

  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(exportMimeType)}`

  let response: Response
  try {
    response = await fetchGoogleDriveWithRetry(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
  } catch (error) {
    if (error instanceof GoogleDriveApiError && error.kind === 'export_too_large') {
      throw new ConnectorFileTooLargeError(MAX_EXPORT_SIZE)
    }
    throw error
  }

  const buffer = await readBodyWithLimit(response, MAX_EXPORT_SIZE)
  if (!buffer) {
    throw new ConnectorFileTooLargeError(MAX_EXPORT_SIZE)
  }
  return buffer
}

async function downloadTextFile(accessToken: string, fileId: string): Promise<string> {
  // Listing runs with `includeItemsFromAllDrives`, so ids here can belong to a shared
  // drive; `supportsAllDrives` declares that support to `files.get` the same way the
  // metadata fetch in getDocument already does. (`files.export` takes no such param.)
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`

  const response = await fetchGoogleDriveWithRetry(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  // Stream with a hard byte cap so a file with missing/under-reported listing
  // size metadata is never fully buffered into memory. Oversized files raise
  // DriveFileTooLargeError so getDocument can surface them as skipped (failed) rows.
  const buffer = await readBodyWithLimit(response, CONNECTOR_MAX_FILE_BYTES)
  if (!buffer) {
    throw new ConnectorFileTooLargeError(CONNECTOR_MAX_FILE_BYTES)
  }
  return buffer.toString('utf8')
}

type FilePayload = Pick<ExternalDocument, 'content' | 'mimeType' | 'sourceFile'>

function xlsxFileName(name: string): string {
  return name.toLowerCase().endsWith('.xlsx') ? name : `${name}.xlsx`
}

async function fetchFilePayload(accessToken: string, file: DriveFile): Promise<FilePayload> {
  if (GOOGLE_WORKSPACE_EXPORTS[file.mimeType]) {
    const bytes = await exportGoogleWorkspaceFile(accessToken, file.id, file.mimeType)
    if (file.mimeType === 'application/vnd.google-apps.spreadsheet') {
      return {
        content: '',
        mimeType: XLSX_MIME_TYPE,
        sourceFile: {
          bytes,
          fileName: xlsxFileName(file.name || 'Untitled'),
          mimeType: XLSX_MIME_TYPE,
        },
      }
    }
    return { content: bytes.toString('utf8'), mimeType: 'text/plain' }
  }
  if (file.mimeType === 'text/html') {
    const html = await downloadTextFile(accessToken, file.id)
    return { content: htmlToPlainText(html), mimeType: 'text/plain' }
  }
  if (isSupportedTextFile(file.mimeType)) {
    return { content: await downloadTextFile(accessToken, file.id), mimeType: 'text/plain' }
  }

  throw new Error(`Unsupported MIME type for content extraction: ${file.mimeType}`)
}

interface DriveFile {
  id: string
  name: string
  mimeType: string
  modifiedTime?: string
  createdTime?: string
  webViewLink?: string
  owners?: { displayName?: string; emailAddress?: string }[]
  size?: string
  starred?: boolean
  trashed?: boolean
}

interface DriveFileListResponse {
  files?: DriveFile[]
  incompleteSearch?: boolean
  nextPageToken?: string
}

function buildQuery(sourceConfig: Record<string, unknown>): string {
  const parts: string[] = ['trashed = false']

  const parentsClause = buildDriveParentsClause(parseMultiValue(sourceConfig.folderId))
  if (parentsClause) parts.push(parentsClause)

  const fileType = (sourceConfig.fileType as string) || 'all'
  switch (fileType) {
    case 'documents':
      parts.push("mimeType = 'application/vnd.google-apps.document'")
      break
    case 'spreadsheets':
      parts.push("mimeType = 'application/vnd.google-apps.spreadsheet'")
      break
    case 'presentations':
      parts.push("mimeType = 'application/vnd.google-apps.presentation'")
      break
    case 'text':
      parts.push(`(${SUPPORTED_TEXT_MIME_TYPES.map((t) => `mimeType = '${t}'`).join(' or ')})`)
      break
    default: {
      // Include Google Workspace files + plain text files, exclude folders
      const allMimeTypes = [...Object.keys(GOOGLE_WORKSPACE_EXPORTS), ...SUPPORTED_TEXT_MIME_TYPES]
      parts.push(`(${allMimeTypes.map((t) => `mimeType = '${t}'`).join(' or ')})`)
      break
    }
  }

  return parts.join(' and ')
}

function fileToStub(file: DriveFile): ExternalDocument {
  /**
   * Sheets moved from a first-sheet-only CSV export to the complete XLSX source.
   * The namespace forces one rehydration for existing rows whose old hash would
   * otherwise preserve embeddings that omit every sheet after the first.
   */
  const hashNamespace =
    file.mimeType === 'application/vnd.google-apps.spreadsheet' ? 'gdrive:v2' : 'gdrive'

  return {
    externalId: file.id,
    title: file.name || 'Untitled',
    content: '',
    contentDeferred: true,
    mimeType: 'text/plain',
    sourceUrl: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`,
    contentHash: `${hashNamespace}:${file.id}:${file.modifiedTime ?? ''}`,
    metadata: {
      originalMimeType: file.mimeType,
      modifiedTime: file.modifiedTime,
      createdTime: file.createdTime,
      owners: file.owners?.map((o) => o.displayName || o.emailAddress).filter(Boolean),
      starred: file.starred,
      fileSize: file.size ? Number(file.size) : undefined,
    },
  }
}

export const googleDriveConnector: ConnectorConfig = {
  ...googleDriveConnectorMeta,

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const query = buildQuery(sourceConfig)
    const pageSize = 100

    const maxFiles = parseMaxFiles(sourceConfig.maxFiles)
    const previouslyFetched = (syncContext?.totalDocsFetched as number) ?? 0

    if (maxFiles > 0 && previouslyFetched >= maxFiles) {
      return { documents: [], hasMore: false }
    }

    const remaining = maxFiles > 0 ? maxFiles - previouslyFetched : 0
    const effectivePageSize = maxFiles > 0 ? Math.min(pageSize, remaining) : pageSize

    const queryParams = new URLSearchParams({
      q: query,
      pageSize: String(effectivePageSize),
      orderBy: 'modifiedTime desc',
      fields:
        'nextPageToken,incompleteSearch,files(id,name,mimeType,modifiedTime,createdTime,webViewLink,owners,size,starred)',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    })

    if (cursor) {
      queryParams.set('pageToken', cursor)
    }

    const url = `https://www.googleapis.com/drive/v3/files?${queryParams.toString()}`

    logger.info('Listing Google Drive files', { query, cursor: cursor ?? 'initial' })

    let response: Response
    try {
      response = await fetchGoogleDriveWithRetry(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      })
    } catch (error) {
      logger.error('Failed to list Google Drive files', googleDriveErrorLogFields(error))
      throw error
    }

    const data = (await response.json()) as DriveFileListResponse
    const files = data.files ?? []

    /**
     * Drive sets `incompleteSearch` when it could not search every corpus (it
     * arises with the `allDrives` scope enabled by `includeItemsFromAllDrives`).
     * A partial listing drops still-existing files, so reconciliation must be
     * suppressed to avoid hard-deleting valid documents.
     */
    const incompleteSearch = data.incompleteSearch === true

    const pageDocuments = files
      .filter((f) => isGoogleWorkspaceFile(f.mimeType) || isSupportedTextFile(f.mimeType))
      .map((f) =>
        stubOrSkipBySize(fileToStub(f), Number(f.size) || undefined, CONNECTOR_MAX_FILE_BYTES)
      )

    const page = takeIndexableWithinCap(
      pageDocuments,
      isSkippedDocument,
      maxFiles,
      previouslyFetched
    )

    const totalFetched = previouslyFetched + page.indexableCount
    if (syncContext) syncContext.totalDocsFetched = totalFetched
    const hitLimit = page.capReached

    const nextPageToken = data.nextPageToken

    /**
     * Suppress deletion reconciliation only when the listing really is partial.
     * Drive omits `nextPageToken` once the end of the list is reached, so hitting
     * `maxFiles` on the final page still represents the full source set and must
     * stay reconcilable — otherwise a capped source can never drop deleted files.
     */
    if (syncContext && ((hitLimit && Boolean(nextPageToken)) || incompleteSearch)) {
      syncContext.listingCapped = true
    }

    return {
      documents: page.documents,
      nextCursor: hitLimit ? undefined : nextPageToken,
      hasMore: hitLimit ? false : Boolean(nextPageToken),
      reconciliationSafe: incompleteSearch ? false : undefined,
    }
  },

  getDocument: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    externalId: string
  ): Promise<ExternalDocument | null> => {
    const fields =
      'id,name,mimeType,modifiedTime,createdTime,webViewLink,owners,size,starred,trashed'
    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(externalId)}?fields=${encodeURIComponent(fields)}&supportsAllDrives=true`

    let response: Response
    try {
      response = await fetchGoogleDriveWithRetry(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      })
    } catch (error) {
      if (!(error instanceof GoogleDriveApiError)) throw error
      if (error.kind === 'not_found') return null
      throw error
    }

    const file = (await response.json()) as DriveFile

    if (file.trashed) return null

    /**
     * Mirrors the listing filter. The marker distinguishes a successfully
     * verified unindexable file from an ambiguous null hydration.
     */
    if (!isGoogleWorkspaceFile(file.mimeType) && !isSupportedTextFile(file.mimeType)) {
      logger.info('Google Drive file has no extractable text type', {
        fileId: file.id,
        mimeType: file.mimeType,
      })
      return {
        ...markSkipped(fileToStub(file), 'File is no longer an indexable document'),
        skippedExistingDisposition: 'replace',
      }
    }

    try {
      const payload = await fetchFilePayload(accessToken, file)
      if (!payload.content.trim() && !payload.sourceFile?.bytes.length) {
        return {
          ...markSkipped(
            { ...fileToStub(file), ...payload },
            'Document contains no extractable text'
          ),
          skippedExistingDisposition: 'replace',
        }
      }

      const stub = fileToStub(file)
      return { ...stub, ...payload, contentDeferred: false }
    } catch (error) {
      if (error instanceof ConnectorFileTooLargeError) {
        logger.info('Skipping oversized Google Drive file', { fileId: file.id, name: file.name })
        return markSkipped(fileToStub(file), sizeLimitSkipReason(error.limitBytes))
      }
      /**
       * The file exists but its content could not be read. Propagate so the engine
       * records a visible failed hydration instead of silently leaving a listed file
       * unindexed (or, on an update, counting a stale copy as unchanged).
       */
      const err = toError(error)
      logger.warn(`Failed to fetch content for file: ${file.name} (${file.id})`, {
        ...googleDriveErrorLogFields(err),
      })
      throw err
    }
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const folderIds = parseMultiValue(sourceConfig.folderId)

    // Verify access to Drive API
    try {
      parseMaxFiles(sourceConfig.maxFiles)

      if (folderIds.length > 0) {
        // Verify each folder exists, is accessible, and is actually a folder
        for (const folderId of folderIds) {
          const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?fields=id,name,mimeType&supportsAllDrives=true`
          let response: Response
          try {
            response = await fetchGoogleDriveWithRetry(
              url,
              {
                method: 'GET',
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                  Accept: 'application/json',
                },
              },
              VALIDATE_RETRY_OPTIONS
            )
          } catch (error) {
            if (error instanceof GoogleDriveApiError) {
              if (error.kind === 'not_found') {
                return {
                  valid: false,
                  error: `Folder "${folderId}" not found. Check the folder ID and permissions.`,
                }
              }
              return {
                valid: false,
                error: `Failed to access folder "${folderId}": ${error.message}`,
              }
            }
            throw error
          }

          const folder = await response.json()
          if (folder.mimeType !== 'application/vnd.google-apps.folder') {
            return { valid: false, error: `"${folderId}" is not a folder` }
          }
        }
      } else {
        // Verify basic Drive access by listing one file
        const url =
          'https://www.googleapis.com/drive/v3/files?pageSize=1&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true'
        try {
          await fetchGoogleDriveWithRetry(
            url,
            {
              method: 'GET',
              headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: 'application/json',
              },
            },
            VALIDATE_RETRY_OPTIONS
          )
        } catch (error) {
          if (error instanceof GoogleDriveApiError) {
            return { valid: false, error: `Failed to access Google Drive: ${error.message}` }
          }
          throw error
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

    const owners = joinTagArray(metadata.owners)
    if (owners) result.owners = owners

    if (typeof metadata.originalMimeType === 'string') {
      const mimeType = metadata.originalMimeType
      if (mimeType.includes('document')) result.fileType = 'Google Doc'
      else if (mimeType.includes('spreadsheet')) result.fileType = 'Google Sheet'
      else if (mimeType.includes('presentation')) result.fileType = 'Google Slides'
      else if (mimeType.startsWith('text/')) result.fileType = 'Text File'
      else result.fileType = mimeType
    }

    const lastModified = parseTagDate(metadata.modifiedTime)
    if (lastModified) result.lastModified = lastModified

    if (typeof metadata.starred === 'boolean') {
      result.starred = metadata.starred
    }

    return result
  },
}
