import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import {
  fetchWithRetry,
  readBoundedHttpErrorBody,
  VALIDATE_RETRY_OPTIONS,
} from '@/lib/knowledge/documents/utils'
import { onedriveConnectorMeta } from '@/connectors/onedrive/meta'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import {
  appendPendingMicrosoftGraphFolders,
  assertMicrosoftGraphNextLink,
  CONNECTOR_MAX_FILE_BYTES,
  ConnectorFileTooLargeError,
  connectorFileExtension,
  decodeMicrosoftGraphTraversalCursor,
  encodeMicrosoftGraphTraversalCursor,
  extractConnectorText,
  hasIndexablePayload,
  isIndexableConnectorFile,
  isSkippedDocument,
  type MicrosoftGraphTraversalState,
  markSkipped,
  parseTagDate,
  pipelineParsedMimeType,
  readBodyWithLimit,
  sizeLimitSkipReason,
  stubOrSkipBySize,
  takeIndexableWithinCap,
} from '@/connectors/utils'

const logger = createLogger('OneDriveConnector')

const MAX_FILE_SIZE = CONNECTOR_MAX_FILE_BYTES

/** Distinct extensions named in the per-page skipped-file diagnostic. */
const MAX_LOGGED_SKIPPED_EXTENSIONS = 10

const GRAPH_API_ORIGIN = 'https://graph.microsoft.com'
const GRAPH_BASE_URL = `${GRAPH_API_ORIGIN}/v1.0`

/**
 * The exact driveItem fields the stub is built from. Graph returns the full
 * driveItem otherwise, which is an order of magnitude larger per item.
 */
const ITEM_SELECT = 'id,name,webUrl,size,file,folder,lastModifiedDateTime,createdBy,parentReference'

/**
 * Requested page size for a children collection, matching Graph's own default.
 *
 * No `$orderby` accompanies it: `/children` accepts `$orderby` on `name`, `size`,
 * and `lastModifiedDateTime`, but "in OneDrive for Business and SharePoint Server
 * 2016, the orderby query string only works with name and url" — so a
 * `lastModifiedDateTime` sort is silently ignored on exactly the drives this
 * connector is most often pointed at. The listing order is therefore whatever the
 * drive returns, which matters only for *which* files a `maxFiles` cap keeps.
 *
 * @see https://learn.microsoft.com/en-us/graph/api/driveitem-list-children — 200-item default page size, `$orderby` support
 * @see https://learn.microsoft.com/en-us/onedrive/developer/rest-api/concepts/optional-query-parameters — the name/url restriction
 */
const PAGE_SIZE = 200

/**
 * Folder pages listed within a single `listDocuments` call. The sync engine caps
 * a sync at a fixed number of `listDocuments` pages, and a depth-first walk needs
 * at least one request per folder — draining several folders per call keeps a
 * drive with thousands of folders from silently truncating its listing.
 */
const MAX_LIST_REQUESTS_PER_CALL = 25

function parseMaxFiles(value: unknown): number {
  if (value === undefined || value === null) return 0
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error('Max files must be a positive safe integer, or 0 for unlimited')
  }
  const normalized = typeof value === 'string' ? value.trim() : value
  if (normalized === '') return 0
  if (typeof normalized === 'string' && !/^\d+$/.test(normalized)) {
    throw new Error('Max files must be a positive safe integer, or 0 for unlimited')
  }
  const parsed = Number(normalized)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('Max files must be a positive safe integer, or 0 for unlimited')
  }
  return parsed
}

interface OneDriveItem {
  id: string
  name: string
  file?: { mimeType: string }
  folder?: { childCount: number }
  size?: number
  webUrl?: string
  lastModifiedDateTime?: string
  createdBy?: { user?: { displayName?: string } }
  parentReference?: { path?: string }
}

interface OneDriveListResponse {
  value: OneDriveItem[]
  '@odata.nextLink'?: string
}

/**
 * Downloads the raw bytes of a OneDrive file.
 */
async function downloadFileContent(accessToken: string, fileId: string): Promise<Buffer> {
  const url = `${GRAPH_BASE_URL}/me/drive/items/${encodeURIComponent(fileId)}/content`

  const response = await fetchWithRetry(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
    redirect: 'follow',
  })

  if (!response.ok) {
    throw new Error(`Failed to download file ${fileId}: ${response.status}`)
  }

  const buffer = await readBodyWithLimit(response, MAX_FILE_SIZE)
  if (!buffer) {
    throw new ConnectorFileTooLargeError(MAX_FILE_SIZE)
  }
  return buffer
}

/**
 * Fetches a file and extracts its indexable text — a UTF-8 decode for text
 * formats, and the shared knowledge-base parsers for Office documents and PDFs.
 */
async function fetchFilePayload(
  accessToken: string,
  fileId: string,
  fileName: string
): Promise<Pick<ExternalDocument, 'content' | 'sourceFile' | 'mimeType'>> {
  const buffer = await downloadFileContent(accessToken, fileId)

  const mimeType = pipelineParsedMimeType(fileName)
  if (mimeType) {
    return { content: '', mimeType, sourceFile: { bytes: buffer, fileName, mimeType } }
  }

  return { content: extractConnectorText(buffer, fileName), mimeType: 'text/plain' }
}

/**
 * Converts a OneDrive item to a lightweight metadata stub (no content).
 */
function fileToStub(item: OneDriveItem): ExternalDocument {
  return {
    externalId: item.id,
    title: item.name || 'Untitled',
    content: '',
    contentDeferred: true,
    mimeType: 'text/plain',
    sourceUrl: item.webUrl,
    contentHash: `onedrive:${item.id}:${item.lastModifiedDateTime ?? ''}`,
    metadata: {
      name: item.name,
      lastModifiedDateTime: item.lastModifiedDateTime,
      createdBy: item.createdBy?.user?.displayName,
      size: item.size,
      webUrl: item.webUrl,
      parentPath: item.parentReference?.path,
    },
  }
}

/**
 * Normalizes a user-supplied folder path into percent-encoded path segments,
 * or `undefined` when the drive root is targeted.
 */
function encodeFolderPath(folderPath?: string): string | undefined {
  const trimmed = folderPath?.trim()
  if (!trimmed) return undefined
  const normalized = trimmed.replace(/^\/+|\/+$/g, '')
  if (!normalized) return undefined
  return normalized.split('/').map(encodeURIComponent).join('/')
}

/**
 * Builds the children-listing URL for a subfolder id, or for the configured
 * root path when no folder id is supplied.
 */
function buildListUrl(folderPath: string | undefined, folderId: string | undefined): string {
  const query = `?$top=${PAGE_SIZE}&$select=${ITEM_SELECT}`
  if (folderId) {
    return `${GRAPH_BASE_URL}/me/drive/items/${encodeURIComponent(folderId)}/children${query}`
  }
  const encoded = encodeFolderPath(folderPath)
  return encoded
    ? `${GRAPH_BASE_URL}/me/drive/root:/${encoded}:/children${query}`
    : `${GRAPH_BASE_URL}/me/drive/root/children${query}`
}

/**
 * Asserts a paging URL points at Microsoft Graph before it is followed with the
 * bearer token in the `Authorization` header. The `@odata.nextLink` this connector
 * follows is persisted into the sync cursor, so it round-trips through storage
 * rather than arriving straight off a TLS response — a tampered cursor must never
 * be able to redirect the access token to a third-party host. Mirrors
 * `assertGraphNextPageUrl` used by the Graph tool routes.
 */
function assertGraphNextLink(nextLink: string): string {
  return assertMicrosoftGraphNextLink(nextLink)
}

/**
 * Depth-first traversal position carried across `listDocuments` calls.
 */
type OneDriveTraversalState = MicrosoftGraphTraversalState

function decodeCursor(cursor: string): OneDriveTraversalState {
  return decodeMicrosoftGraphTraversalCursor(cursor, 'OneDrive')
}

export const onedriveConnector: ConnectorConfig = {
  ...onedriveConnectorMeta,

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const folderPath = sourceConfig.folderPath as string | undefined

    const maxFiles = parseMaxFiles(sourceConfig.maxFiles)

    const state: OneDriveTraversalState = cursor ? decodeCursor(cursor) : { folderStack: [] }

    const documents: ExternalDocument[] = []
    let totalFetched = (syncContext?.totalDocsFetched as number) ?? 0

    /** Set when the walk finished — either the source ran out or `maxFiles` stopped it. */
    let done = false
    /** Set only when `maxFiles` actually hid still-listable items. */
    let cappedWithItemsLeft = false

    for (let request = 0; request < MAX_LIST_REQUESTS_PER_CALL; request++) {
      const pageUrl = state.nextLink
        ? assertGraphNextLink(state.nextLink)
        : buildListUrl(folderPath, state.currentFolder)

      logger.info('Listing OneDrive files', {
        folderId: state.currentFolder ?? 'root',
        pending: state.folderStack.length,
        continuation: Boolean(state.nextLink),
      })

      const response = await fetchWithRetry(pageUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      })

      if (!response.ok) {
        const errorText = await readBoundedHttpErrorBody(response)
        logger.error('Failed to list OneDrive files', {
          status: response.status,
          error: errorText,
        })
        throw new Error(`Failed to list OneDrive files: ${response.status}`)
      }

      const data = (await response.json()) as OneDriveListResponse
      const items = data.value || []

      const files: OneDriveItem[] = []
      const subfolders: string[] = []
      /**
       * Extensions this connector cannot index, tallied per page. A folder of
       * unsupported files otherwise syncs as "success, 0 documents", which reads
       * exactly like a wrong folder path — the failure mode this log exists for.
       * Unsupported files are counted rather than turned into `failed` document
       * rows, so a drive full of images does not fill the knowledge base with noise.
       */
      const skippedExtensions = new Map<string, number>()

      for (const item of items) {
        if (item.folder) {
          subfolders.push(item.id)
        } else if (item.file) {
          if (isIndexableConnectorFile(item.name)) {
            // Keep oversized files; they are surfaced as skipped (failed) docs below.
            files.push(item)
          } else {
            const extension = connectorFileExtension(item.name) ?? '(none)'
            skippedExtensions.set(extension, (skippedExtensions.get(extension) ?? 0) + 1)
          }
        }
      }

      if (skippedExtensions.size > 0) {
        let skippedCount = 0
        for (const count of skippedExtensions.values()) skippedCount += count
        logger.info('Skipped OneDrive files with unsupported extensions', {
          folderId: state.currentFolder ?? 'root',
          skippedCount,
          extensions: Array.from(skippedExtensions.keys()).slice(0, MAX_LOGGED_SKIPPED_EXTENSIONS),
        })
      }

      const stubs = files.map((item) =>
        stubOrSkipBySize(fileToStub(item), item.size, MAX_FILE_SIZE)
      )
      const take = takeIndexableWithinCap(stubs, isSkippedDocument, maxFiles, totalFetched)
      documents.push(...take.documents)
      totalFetched += take.indexableCount

      const nextLink = data['@odata.nextLink']

      if (take.capReached) {
        done = true
        /**
         * Only a cap that actually hid items makes the listing partial, and the
         * cap can bite in three places: mid-page (`takeIndexableWithinCap` breaks
         * out of the array early, so fewer stubs come back than went in), or at a
         * page boundary with another page or another folder still pending. When
         * the cap instead coincides with the last item of the last folder the
         * source *is* fully listed, and flagging it capped would permanently
         * block deletion reconciliation for a complete listing.
         */
        cappedWithItemsLeft =
          take.documents.length < stubs.length ||
          Boolean(nextLink) ||
          subfolders.length > 0 ||
          state.folderStack.length > 0
        break
      }

      appendPendingMicrosoftGraphFolders(state.folderStack, subfolders, 'OneDrive')

      if (nextLink) {
        state.nextLink = nextLink
        continue
      }

      if (state.folderStack.length > 0) {
        state.currentFolder = state.folderStack.pop()!
        state.nextLink = undefined
        continue
      }

      done = true
      break
    }

    if (syncContext) {
      syncContext.totalDocsFetched = totalFetched
      if (cappedWithItemsLeft) syncContext.listingCapped = true
    }

    if (done) {
      return { documents, hasMore: false }
    }

    /**
     * The per-call request budget ran out mid-walk. The engine keeps calling with
     * this cursor, and flags the listing itself if it stops paging first.
     */
    return {
      documents,
      nextCursor: encodeMicrosoftGraphTraversalCursor(state, 'OneDrive'),
      hasMore: true,
    }
  },

  getDocument: async (
    accessToken: string,
    _sourceConfig: Record<string, unknown>,
    externalId: string
  ): Promise<ExternalDocument | null> => {
    const url = `${GRAPH_BASE_URL}/me/drive/items/${encodeURIComponent(externalId)}?$select=${ITEM_SELECT}`

    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      if (response.status === 404) return null
      throw new Error(`Failed to get OneDrive file: ${response.status}`)
    }

    const item = (await response.json()) as OneDriveItem

    if (!item.file || !isIndexableConnectorFile(item.name)) {
      return {
        ...markSkipped(fileToStub(item), 'File is no longer an indexable document'),
        skippedExistingDisposition: 'replace',
      }
    }

    try {
      const payload = await fetchFilePayload(accessToken, item.id, item.name)
      if (!hasIndexablePayload(payload)) {
        return {
          ...markSkipped(fileToStub(item), 'Document contains no extractable text'),
          skippedExistingDisposition: 'replace',
        }
      }

      const stub = fileToStub(item)
      return { ...stub, ...payload, contentDeferred: false }
    } catch (error) {
      if (error instanceof ConnectorFileTooLargeError) {
        logger.info('Skipping oversized OneDrive file', { fileId: item.id, name: item.name })
        return markSkipped(fileToStub(item), sizeLimitSkipReason(error.limitBytes))
      }
      /**
       * A transport or Graph failure that survived `fetchWithRetry`. Returning
       * `null` would drop the file from the run with no `failed` row and no error
       * log; rethrowing lets the sync engine record it per-document.
       */
      logger.warn(`Failed to fetch content for file: ${item.name} (${item.id})`, {
        error: toError(error).message,
      })
      throw toError(error)
    }
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const folderPath = sourceConfig.folderPath as string | undefined
    try {
      parseMaxFiles(sourceConfig.maxFiles)
    } catch (error) {
      return { valid: false, error: toError(error).message }
    }

    try {
      const encodedPath = encodeFolderPath(folderPath)
      if (encodedPath) {
        // Verify the folder path exists and is accessible
        const url = `${GRAPH_BASE_URL}/me/drive/root:/${encodedPath}?$select=id,folder`

        const response = await fetchWithRetry(
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

        if (!response.ok) {
          if (response.status === 404) {
            return {
              valid: false,
              error: 'Folder not found. Check the folder path and permissions.',
            }
          }
          return { valid: false, error: `Failed to access folder: ${response.status}` }
        }

        const item = (await response.json()) as OneDriveItem
        if (!item.folder) {
          return { valid: false, error: 'The provided path is not a folder' }
        }
      } else {
        // Verify basic OneDrive access by listing root
        const url = `${GRAPH_BASE_URL}/me/drive/root/children?$top=1&$select=id`

        const response = await fetchWithRetry(
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

        if (!response.ok) {
          return { valid: false, error: `Failed to access OneDrive: ${response.status}` }
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

    if (typeof metadata.parentPath === 'string') {
      result.path = metadata.parentPath
    }

    const lastModified = parseTagDate(metadata.lastModifiedDateTime)
    if (lastModified) result.lastModified = lastModified

    if (typeof metadata.size === 'number') {
      result.fileSize = metadata.size
    }

    if (typeof metadata.createdBy === 'string') {
      result.createdBy = metadata.createdBy
    }

    return result
  },
}
