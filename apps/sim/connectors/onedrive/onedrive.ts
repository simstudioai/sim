import { createLogger } from '@sim/logger'
import { MicrosoftOneDriveIcon } from '@/components/icons'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { computeContentHash, htmlToPlainText, parseTagDate } from '@/connectors/utils'

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

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB

const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0'

interface OneDriveItem {
  id: string
  name: string
  file?: { mimeType: string }
  folder?: { childCount: number }
  size?: number
  webUrl?: string
  lastModifiedDateTime?: string
  createdDateTime?: string
  createdBy?: { user?: { displayName?: string } }
  lastModifiedBy?: { user?: { displayName?: string } }
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
  const url = `${GRAPH_BASE_URL}/me/drive/items/${fileId}/content`

  const response = await fetchWithRetry(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
    redirect: 'follow',
  })

  if (!response.ok) {
    throw new Error(`Failed to download file ${fileId}: ${response.status}`)
  }

  const text = await response.text()
  if (Buffer.byteLength(text, 'utf8') > MAX_FILE_SIZE) {
    return Buffer.from(text, 'utf8').subarray(0, MAX_FILE_SIZE).toString('utf8')
  }
  return text
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
 * Converts a OneDrive item to an ExternalDocument.
 */
async function itemToDocument(
  accessToken: string,
  item: OneDriveItem
): Promise<ExternalDocument | null> {
  try {
    const content = await fetchFileContent(accessToken, item.id, item.name)
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
        name: item.name,
        lastModifiedDateTime: item.lastModifiedDateTime,
        createdBy: item.createdBy?.user?.displayName,
        size: item.size,
        webUrl: item.webUrl,
        parentPath: item.parentReference?.path,
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
 * Builds the list URL for the configured folder path or root.
 */
function buildListUrl(folderPath?: string): string {
  const trimmed = folderPath?.trim()
  if (trimmed) {
    // Normalize path: strip leading/trailing slashes
    const normalized = trimmed.replace(/^\/+|\/+$/g, '')
    const encoded = normalized.split('/').map(encodeURIComponent).join('/')
    return `${GRAPH_BASE_URL}/me/drive/root:/${encoded}:/children`
  }
  return `${GRAPH_BASE_URL}/me/drive/root/children`
}

export const onedriveConnector: ConnectorConfig = {
  id: 'onedrive',
  name: 'OneDrive',
  description: 'Sync documents from Microsoft OneDrive into your knowledge base',
  version: '1.0.0',
  icon: MicrosoftOneDriveIcon,

  auth: { mode: 'oauth', provider: 'onedrive', requiredScopes: ['Files.Read'] },

  configFields: [
    {
      id: 'folderPath',
      title: 'Folder Path',
      type: 'short-input',
      placeholder: 'e.g. Documents/Reports (optional, default: root)',
      required: false,
    },
    {
      id: 'maxFiles',
      title: 'Max Files',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 500 (default: unlimited)',
    },
  ],

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const folderPath = sourceConfig.folderPath as string | undefined

    /**
     * Cursor state encodes the current page URL and a queue of pending folder IDs
     * for recursive traversal. On initial call, we start from the configured path.
     */
    let pageUrl: string
    let folderQueue: string[] = []

    if (cursor) {
      try {
        const parsed = JSON.parse(cursor) as { pageUrl?: string; folderQueue?: string[] }
        pageUrl = parsed.pageUrl || buildListUrl(folderPath)
        folderQueue = parsed.folderQueue || []
      } catch {
        pageUrl = cursor
      }
    } else {
      pageUrl = buildListUrl(folderPath)
    }

    logger.info('Listing OneDrive files', {
      url: pageUrl,
      cursor: cursor ? 'continuation' : 'initial',
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

    // Collect subfolder IDs for recursive traversal
    for (const item of items) {
      if (item.folder) {
        folderQueue.push(item.id)
      }
    }

    const textFiles = items.filter(
      (item) =>
        item.file && isSupportedTextFile(item.name) && (!item.size || item.size <= MAX_FILE_SIZE)
    )

    const maxFiles = sourceConfig.maxFiles ? Number(sourceConfig.maxFiles) : 0
    const previouslyFetched = (syncContext?.totalDocsFetched as number) ?? 0

    const CONCURRENCY = 5
    const documents: ExternalDocument[] = []
    for (let i = 0; i < textFiles.length; i += CONCURRENCY) {
      if (maxFiles > 0 && previouslyFetched + documents.length >= maxFiles) break
      const batch = textFiles.slice(i, i + CONCURRENCY)
      const results = await Promise.all(batch.map((item) => itemToDocument(accessToken, item)))
      documents.push(...(results.filter(Boolean) as ExternalDocument[]))
    }
    if (maxFiles > 0) {
      const remaining = maxFiles - previouslyFetched
      if (documents.length > remaining) {
        documents.splice(remaining)
      }
    }

    const totalFetched = previouslyFetched + documents.length
    if (syncContext) syncContext.totalDocsFetched = totalFetched
    const hitLimit = maxFiles > 0 && totalFetched >= maxFiles

    const nextLink = data['@odata.nextLink']

    // Determine next cursor: continue current page, or move to next queued folder
    let nextCursor: string | undefined
    let hasMore = false

    if (!hitLimit) {
      if (nextLink) {
        nextCursor = JSON.stringify({ pageUrl: nextLink, folderQueue })
        hasMore = true
      } else if (folderQueue.length > 0) {
        const nextFolderId = folderQueue.shift()!
        const nextUrl = `${GRAPH_BASE_URL}/me/drive/items/${nextFolderId}/children`
        nextCursor = JSON.stringify({ pageUrl: nextUrl, folderQueue })
        hasMore = true
      }
    }

    return {
      documents,
      nextCursor,
      hasMore,
    }
  },

  getDocument: async (
    accessToken: string,
    _sourceConfig: Record<string, unknown>,
    externalId: string
  ): Promise<ExternalDocument | null> => {
    const url = `${GRAPH_BASE_URL}/me/drive/items/${externalId}`

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

    // Only process files with supported extensions
    if (!item.file || !isSupportedTextFile(item.name)) return null

    return itemToDocument(accessToken, item)
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
      if (folderPath?.trim()) {
        // Verify the folder path exists and is accessible
        const normalized = folderPath.trim().replace(/^\/+|\/+$/g, '')
        const encoded = normalized.split('/').map(encodeURIComponent).join('/')
        const url = `${GRAPH_BASE_URL}/me/drive/root:/${encoded}`

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
      const message = error instanceof Error ? error.message : 'Failed to validate configuration'
      return { valid: false, error: message }
    }
  },

  tagDefinitions: [
    { id: 'path', displayName: 'Path', fieldType: 'text' },
    { id: 'lastModified', displayName: 'Last Modified', fieldType: 'date' },
    { id: 'fileSize', displayName: 'File Size', fieldType: 'number' },
    { id: 'createdBy', displayName: 'Created By', fieldType: 'text' },
  ],

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
