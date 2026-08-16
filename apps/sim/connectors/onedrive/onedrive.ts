import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import { onedriveConnectorMeta } from '@/connectors/onedrive/meta'
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

const logger = createLogger('OneDriveConnector')

const SUPPORTED_EXTENSIONS = new Set([
  '.txt',
  '.md',
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
 * Checks whether a file has a supported text extension.
 */
function isSupportedTextFile(name: string): boolean {
  const dotIndex = name.lastIndexOf('.')
  if (dotIndex === -1) return false
  const ext = name.slice(dotIndex).toLowerCase()
  return SUPPORTED_EXTENSIONS.has(ext)
}

/**
 * Downloads the raw content of a OneDrive file.
 */
async function downloadFileContent(accessToken: string, fileId: string): Promise<string> {
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
  return buffer.toString('utf8')
}

/**
 * Fetches file content, converting HTML to plain text when applicable.
 */
async function fetchFileContent(
  accessToken: string,
  fileId: string,
  fileName: string
): Promise<string> {
  const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase()
  const raw = await downloadFileContent(accessToken, fileId)

  if (ext === '.html' || ext === '.htm') {
    return htmlToPlainText(raw)
  }

  return raw
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
  const url = new URL(nextLink.trim())
  if (url.origin !== GRAPH_API_ORIGIN) {
    throw new Error('Refusing to follow a non-Microsoft Graph @odata.nextLink')
  }
  return url.toString()
}

/**
 * Depth-first traversal position carried across `listDocuments` calls.
 */
interface OneDriveTraversalState {
  /** Absolute `@odata.nextLink` for the current folder's next page, if any. */
  nextLink?: string
  /** Item id of the folder being listed; `undefined` means the configured root. */
  currentFolder?: string
  /** Subfolder ids discovered but not yet listed. */
  folderStack: string[]
}

function decodeCursor(cursor: string): OneDriveTraversalState {
  try {
    const parsed = JSON.parse(cursor) as Partial<OneDriveTraversalState>
    return {
      nextLink: typeof parsed.nextLink === 'string' ? parsed.nextLink : undefined,
      currentFolder: typeof parsed.currentFolder === 'string' ? parsed.currentFolder : undefined,
      folderStack: Array.isArray(parsed.folderStack) ? parsed.folderStack : [],
    }
  } catch {
    return { folderStack: [] }
  }
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

    const parsedMaxFiles = Number(sourceConfig.maxFiles)
    const maxFiles = Number.isFinite(parsedMaxFiles) && parsedMaxFiles > 0 ? parsedMaxFiles : 0

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
        const errorText = await response.text()
        logger.error('Failed to list OneDrive files', {
          status: response.status,
          error: errorText,
        })
        throw new Error(`Failed to list OneDrive files: ${response.status}`)
      }

      const data = (await response.json()) as OneDriveListResponse
      const items = data.value || []

      const files: OneDriveItem[] = []
      for (const item of items) {
        if (item.folder) {
          state.folderStack.push(item.id)
        } else if (item.file && isSupportedTextFile(item.name)) {
          // Keep oversized files; they are surfaced as skipped (failed) docs below.
          files.push(item)
        }
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
          take.documents.length < stubs.length || Boolean(nextLink) || state.folderStack.length > 0
        break
      }

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
      nextCursor: JSON.stringify(state),
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

    if (!item.file || !isSupportedTextFile(item.name)) return null

    try {
      const content = await fetchFileContent(accessToken, item.id, item.name)
      if (!content.trim()) return null

      const stub = fileToStub(item)
      return { ...stub, content, contentDeferred: false }
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
    const maxFiles = sourceConfig.maxFiles as string | undefined

    if (maxFiles && (Number.isNaN(Number(maxFiles)) || Number(maxFiles) <= 0)) {
      return { valid: false, error: 'Max files must be a positive number' }
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
