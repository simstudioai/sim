import { createLogger } from '@sim/logger'
import { MicrosoftSharepointIcon } from '@/components/icons'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { computeContentHash, htmlToPlainText, parseTagDate } from '@/connectors/utils'

const logger = createLogger('SharePointConnector')

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'

const SUPPORTED_TEXT_EXTENSIONS = new Set([
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

const MAX_DOWNLOAD_SIZE = 10 * 1024 * 1024 // 10 MB

/** Microsoft Graph drive item shape (subset of fields we use). */
interface DriveItem {
  id: string
  name: string
  webUrl?: string
  size?: number
  file?: { mimeType?: string }
  folder?: { childCount?: number }
  lastModifiedDateTime?: string
  createdDateTime?: string
  createdBy?: { user?: { displayName?: string } }
  parentReference?: { path?: string; siteId?: string }
}

interface DriveItemListResponse {
  value: DriveItem[]
  '@odata.nextLink'?: string
}

/**
 * Returns true when the file extension is in the supported text set.
 */
function isSupportedTextFile(name: string): boolean {
  const dotIndex = name.lastIndexOf('.')
  if (dotIndex === -1) return false
  return SUPPORTED_TEXT_EXTENSIONS.has(name.slice(dotIndex).toLowerCase())
}

/**
 * Resolves a SharePoint site URL like "contoso.sharepoint.com/sites/mysite"
 * into a Microsoft Graph siteId.
 */
async function resolveSiteId(
  accessToken: string,
  siteUrl: string,
  retryOptions?: Parameters<typeof fetchWithRetry>[2]
): Promise<{ id: string; displayName: string }> {
  // Normalise: strip protocol, trailing slashes
  const cleaned = siteUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '')

  // Split into hostname and server-relative path
  const firstSlash = cleaned.indexOf('/')
  let hostname: string
  let serverRelativePath: string

  if (firstSlash === -1) {
    hostname = cleaned
    serverRelativePath = ''
  } else {
    hostname = cleaned.slice(0, firstSlash)
    serverRelativePath = cleaned.slice(firstSlash)
  }

  // Graph endpoint: GET /sites/{hostname}:/{path}
  const url = serverRelativePath
    ? `${GRAPH_BASE}/sites/${hostname}:${serverRelativePath}`
    : `${GRAPH_BASE}/sites/${hostname}`

  const response = await fetchWithRetry(
    url,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    },
    retryOptions
  )

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(
      `Failed to resolve SharePoint site "${siteUrl}": ${response.status} – ${errorText}`
    )
  }

  const site = (await response.json()) as { id: string; displayName?: string }
  logger.info('Resolved SharePoint site', {
    siteUrl,
    siteId: site.id,
    displayName: site.displayName,
  })
  return { id: site.id, displayName: site.displayName ?? '' }
}

/**
 * Downloads the text content of a drive item.
 */
async function downloadFileContent(
  accessToken: string,
  siteId: string,
  itemId: string,
  fileName: string
): Promise<string> {
  const url = `${GRAPH_BASE}/sites/${siteId}/drive/items/${itemId}/content`

  const response = await fetchWithRetry(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
    redirect: 'follow',
  })

  if (!response.ok) {
    throw new Error(`Failed to download file "${fileName}" (${itemId}): ${response.status}`)
  }

  const text = await response.text()
  if (text.length > MAX_DOWNLOAD_SIZE) {
    return text.slice(0, MAX_DOWNLOAD_SIZE)
  }
  return text
}

/**
 * Fetches file content, applying HTML-to-text conversion for .html files.
 */
async function fetchFileContent(
  accessToken: string,
  siteId: string,
  itemId: string,
  fileName: string
): Promise<string> {
  const raw = await downloadFileContent(accessToken, siteId, itemId, fileName)
  if (fileName.toLowerCase().endsWith('.html') || fileName.toLowerCase().endsWith('.htm')) {
    return htmlToPlainText(raw)
  }
  return raw
}

/**
 * Converts a DriveItem to an ExternalDocument by downloading its content.
 */
async function itemToDocument(
  accessToken: string,
  siteId: string,
  item: DriveItem,
  siteName: string
): Promise<ExternalDocument | null> {
  try {
    const content = await fetchFileContent(accessToken, siteId, item.id, item.name)
    if (!content.trim()) {
      logger.info(`Skipping empty file: ${item.name} (${item.id})`)
      return null
    }

    const contentHash = await computeContentHash(content)

    return {
      externalId: item.id,
      title: item.name || 'Untitled',
      content,
      mimeType: 'text/plain',
      sourceUrl: item.webUrl,
      contentHash,
      metadata: {
        lastModifiedDateTime: item.lastModifiedDateTime,
        createdDateTime: item.createdDateTime,
        createdBy: item.createdBy?.user?.displayName,
        fileSize: item.size,
        path: item.parentReference?.path,
        siteName,
      },
    }
  } catch (error) {
    logger.warn(`Failed to extract content from file: ${item.name} (${item.id})`, {
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/**
 * Lists items in a folder. When folderId is omitted the root of the default
 * document library is listed.
 */
async function listFolderItems(
  accessToken: string,
  siteId: string,
  folderId?: string,
  nextLink?: string
): Promise<DriveItemListResponse> {
  const url =
    nextLink ??
    (folderId
      ? `${GRAPH_BASE}/sites/${siteId}/drive/items/${folderId}/children?$top=200`
      : `${GRAPH_BASE}/sites/${siteId}/drive/root/children?$top=200`)

  const response = await fetchWithRetry(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Failed to list folder items: ${response.status} – ${errorText}`)
  }

  return response.json() as Promise<DriveItemListResponse>
}

/**
 * Resolves a slash-separated folder path (e.g. "Documents/Reports") to a
 * DriveItem ID by walking the path segments from root.
 */
async function resolveFolderPath(
  accessToken: string,
  siteId: string,
  folderPath: string
): Promise<string> {
  const cleaned = folderPath.replace(/^\/+|\/+$/g, '')
  if (!cleaned) {
    throw new Error('Folder path is empty after normalisation')
  }

  const encoded = cleaned.split('/').map(encodeURIComponent).join('/')
  const url = `${GRAPH_BASE}/sites/${siteId}/drive/root:/${encoded}`

  const response = await fetchWithRetry(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Folder not found: "${folderPath}"`)
    }
    throw new Error(`Failed to resolve folder path "${folderPath}": ${response.status}`)
  }

  const item = (await response.json()) as DriveItem
  if (!item.folder) {
    throw new Error(`Path "${folderPath}" is not a folder`)
  }

  return item.id
}

/**
 * Pagination state encoded as the cursor string.
 * We track a stack of folder IDs to traverse plus an optional @odata.nextLink.
 */
interface PaginationState {
  /** Folders still to be listed (depth-first) */
  folderStack: string[]
  /** Current folder being listed (undefined = root) */
  currentFolder?: string
  /** @odata.nextLink for the current folder page */
  nextLink?: string
}

function encodeCursor(state: PaginationState): string {
  return Buffer.from(JSON.stringify(state)).toString('base64')
}

function decodeCursor(cursor: string): PaginationState {
  return JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8')) as PaginationState
}

export const sharepointConnector: ConnectorConfig = {
  id: 'sharepoint',
  name: 'SharePoint',
  description: 'Sync documents from a SharePoint site into your knowledge base',
  version: '1.0.0',
  icon: MicrosoftSharepointIcon,

  auth: { mode: 'oauth', provider: 'sharepoint', requiredScopes: ['Sites.Read.All'] },

  configFields: [
    {
      id: 'siteUrl',
      title: 'Site URL',
      type: 'short-input',
      placeholder: 'e.g. contoso.sharepoint.com/sites/mysite',
      required: true,
    },
    {
      id: 'folderPath',
      title: 'Folder Path',
      type: 'short-input',
      placeholder: 'e.g. Documents/Reports (optional, defaults to root)',
      required: false,
    },
    {
      id: 'maxFiles',
      title: 'Max Files',
      type: 'short-input',
      placeholder: 'e.g. 500 (default: unlimited)',
      required: false,
    },
  ],

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const siteUrl = sourceConfig.siteUrl as string

    // Resolve and cache siteId in syncContext
    let siteId: string
    let siteName: string
    if (syncContext?.siteId) {
      siteId = syncContext.siteId as string
      siteName = (syncContext.siteName as string) ?? ''
    } else {
      const site = await resolveSiteId(accessToken, siteUrl)
      siteId = site.id
      siteName = site.displayName || siteUrl

      if (syncContext) {
        syncContext.siteId = siteId
        syncContext.siteName = siteName
      }
    }

    // Resolve starting folder if configured (cache in syncContext)
    let rootFolderId: string | undefined
    const folderPath = (sourceConfig.folderPath as string)?.trim()
    if (folderPath) {
      if (syncContext?.rootFolderId) {
        rootFolderId = syncContext.rootFolderId as string
      } else {
        rootFolderId = await resolveFolderPath(accessToken, siteId, folderPath)
        if (syncContext) syncContext.rootFolderId = rootFolderId
      }
    }

    // Decode or initialise pagination state
    let state: PaginationState
    if (cursor) {
      state = decodeCursor(cursor)
    } else {
      state = {
        folderStack: [],
        currentFolder: rootFolderId,
      }
    }

    const documents: ExternalDocument[] = []
    const maxFiles = sourceConfig.maxFiles ? Number(sourceConfig.maxFiles) : 0
    let totalFetched = (syncContext?.totalDocsFetched as number) ?? 0

    // Process one page of items from the current folder
    const data = await listFolderItems(accessToken, siteId, state.currentFolder, state.nextLink)

    // Separate files and subfolders
    const subfolders: string[] = []
    const files: DriveItem[] = []

    for (const item of data.value) {
      if (item.folder) {
        subfolders.push(item.id)
      } else if (
        item.file &&
        isSupportedTextFile(item.name) &&
        (!item.size || item.size <= MAX_DOWNLOAD_SIZE)
      ) {
        files.push(item)
      }
    }

    // Push subfolders onto the stack for depth-first traversal
    state.folderStack.push(...subfolders)

    // Convert files to documents in batches
    const CONCURRENCY = 5
    const previouslyFetched = totalFetched
    for (let i = 0; i < files.length; i += CONCURRENCY) {
      if (maxFiles > 0 && previouslyFetched + documents.length >= maxFiles) break
      const batch = files.slice(i, i + CONCURRENCY)
      const results = await Promise.all(
        batch.map((file) => itemToDocument(accessToken, siteId, file, siteName))
      )
      documents.push(...(results.filter(Boolean) as ExternalDocument[]))
    }

    totalFetched += documents.length
    if (maxFiles > 0) {
      const remaining = maxFiles - previouslyFetched
      if (documents.length > remaining) {
        documents.splice(remaining)
        totalFetched = maxFiles
      }
    }

    if (syncContext) syncContext.totalDocsFetched = totalFetched
    const hitLimit = maxFiles > 0 && totalFetched >= maxFiles

    // Determine next cursor
    if (hitLimit) {
      return { documents, hasMore: false }
    }

    if (data['@odata.nextLink']) {
      // More pages in the current folder
      state.nextLink = data['@odata.nextLink']
      return {
        documents,
        nextCursor: encodeCursor(state),
        hasMore: true,
      }
    }

    // Current folder exhausted — move to next folder on the stack
    if (state.folderStack.length > 0) {
      const nextFolder = state.folderStack.pop()!
      state.currentFolder = nextFolder
      state.nextLink = undefined
      return {
        documents,
        nextCursor: encodeCursor(state),
        hasMore: true,
      }
    }

    // Nothing left
    return { documents, hasMore: false }
  },

  getDocument: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    externalId: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocument | null> => {
    const siteUrl = sourceConfig.siteUrl as string

    let siteId = syncContext?.siteId as string | undefined
    let siteName = syncContext?.siteName as string | undefined
    if (!siteId) {
      const site = await resolveSiteId(accessToken, siteUrl)
      siteId = site.id
      siteName = site.displayName ?? siteUrl
      if (syncContext) {
        syncContext.siteId = siteId
        syncContext.siteName = siteName
      }
    }

    const url = `${GRAPH_BASE}/sites/${siteId}/drive/items/${externalId}`
    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      if (response.status === 404) return null
      throw new Error(`Failed to get SharePoint file: ${response.status}`)
    }

    const item = (await response.json()) as DriveItem

    if (!item.file || !isSupportedTextFile(item.name)) {
      return null
    }

    return itemToDocument(accessToken, siteId, item, siteName ?? siteUrl)
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const siteUrl = (sourceConfig.siteUrl as string)?.trim()
    if (!siteUrl) {
      return { valid: false, error: 'Site URL is required' }
    }

    const maxFiles = sourceConfig.maxFiles as string | undefined
    if (maxFiles && (Number.isNaN(Number(maxFiles)) || Number(maxFiles) <= 0)) {
      return { valid: false, error: 'Max files must be a positive number' }
    }

    try {
      const site = await resolveSiteId(accessToken, siteUrl, VALIDATE_RETRY_OPTIONS)
      const siteId = site.id

      // If a folder path is configured, verify it exists
      const folderPath = (sourceConfig.folderPath as string)?.trim()
      if (folderPath) {
        const encodedPath = folderPath
          .replace(/^\/+|\/+$/g, '')
          .split('/')
          .map(encodeURIComponent)
          .join('/')
        const folderUrl = `${GRAPH_BASE}/sites/${siteId}/drive/root:/${encodedPath}`
        const response = await fetchWithRetry(
          folderUrl,
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
            return { valid: false, error: `Folder not found: "${folderPath}"` }
          }
          return { valid: false, error: `Failed to access folder: ${response.status}` }
        }

        const item = (await response.json()) as DriveItem
        if (!item.folder) {
          return { valid: false, error: `Path "${folderPath}" is not a folder` }
        }
      }

      return { valid: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to validate configuration'
      return { valid: false, error: message }
    }
  },

  tagDefinitions: [
    { id: 'path', displayName: 'Path', fieldType: 'text' },
    { id: 'lastModified', displayName: 'Last Modified', fieldType: 'date' },
    { id: 'fileSize', displayName: 'File Size', fieldType: 'number' },
    { id: 'createdBy', displayName: 'Created By', fieldType: 'text' },
    { id: 'siteName', displayName: 'Site Name', fieldType: 'text' },
  ],

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    if (typeof metadata.path === 'string') {
      result.path = metadata.path
    }

    const lastModified = parseTagDate(metadata.lastModifiedDateTime)
    if (lastModified) result.lastModified = lastModified

    if (typeof metadata.fileSize === 'number') {
      result.fileSize = metadata.fileSize
    }

    if (typeof metadata.createdBy === 'string') {
      result.createdBy = metadata.createdBy
    }

    if (typeof metadata.siteName === 'string') {
      result.siteName = metadata.siteName
    }

    return result
  },
}
