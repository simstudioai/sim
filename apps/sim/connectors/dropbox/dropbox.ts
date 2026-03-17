import { createLogger } from '@sim/logger'
import { DropboxIcon } from '@/components/icons'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { computeContentHash, htmlToPlainText, parseTagDate } from '@/connectors/utils'

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

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB

interface DropboxFileEntry {
  '.tag': 'file' | 'folder' | 'deleted'
  id: string
  name: string
  path_lower: string
  path_display: string
  client_modified?: string
  server_modified?: string
  size?: number
  is_downloadable?: boolean
}

interface DropboxListFolderResponse {
  entries: DropboxFileEntry[]
  cursor: string
  has_more: boolean
}

function isSupportedFile(entry: DropboxFileEntry): boolean {
  if (entry['.tag'] !== 'file') return false
  if (entry.is_downloadable === false) return false
  if (entry.size && entry.size > MAX_FILE_SIZE) return false

  const name = entry.name.toLowerCase()
  const dotIndex = name.lastIndexOf('.')
  if (dotIndex === -1) return false

  return SUPPORTED_EXTENSIONS.has(name.slice(dotIndex))
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

  const text = await response.text()

  if (filePath.endsWith('.html') || filePath.endsWith('.htm')) {
    return htmlToPlainText(text)
  }

  return text
}

async function fileToDocument(
  accessToken: string,
  entry: DropboxFileEntry
): Promise<ExternalDocument | null> {
  try {
    const content = await downloadFileContent(accessToken, entry.path_lower)
    if (!content.trim()) {
      logger.info(`Skipping empty file: ${entry.name}`)
      return null
    }

    const contentHash = await computeContentHash(content)

    return {
      externalId: entry.id,
      title: entry.name,
      content,
      mimeType: 'text/plain',
      sourceUrl: `https://www.dropbox.com/home${entry.path_display}`,
      contentHash,
      metadata: {
        path: entry.path_display,
        lastModified: entry.server_modified || entry.client_modified,
        fileSize: entry.size,
      },
    }
  } catch (error) {
    logger.warn(`Failed to extract content from file: ${entry.name}`, {
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

export const dropboxConnector: ConnectorConfig = {
  id: 'dropbox',
  name: 'Dropbox',
  description: 'Sync text files from Dropbox into your knowledge base',
  version: '1.0.0',
  icon: DropboxIcon,

  auth: {
    mode: 'oauth',
    provider: 'dropbox',
    requiredScopes: ['files.metadata.read', 'files.content.read'],
  },

  configFields: [
    {
      id: 'folderPath',
      title: 'Folder Path',
      type: 'short-input',
      placeholder: 'e.g. /Documents (default: entire Dropbox)',
      required: false,
      description: 'Leave empty to sync all supported files',
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

    const supportedFiles = data.entries.filter(isSupportedFile)

    const maxFiles = sourceConfig.maxFiles ? Number(sourceConfig.maxFiles) : 0
    const previouslyFetched = (syncContext?.totalDocsFetched as number) ?? 0

    const CONCURRENCY = 5
    const documents: ExternalDocument[] = []
    for (let i = 0; i < supportedFiles.length; i += CONCURRENCY) {
      if (maxFiles > 0 && previouslyFetched + documents.length >= maxFiles) break
      const batch = supportedFiles.slice(i, i + CONCURRENCY)
      const results = await Promise.all(batch.map((entry) => fileToDocument(accessToken, entry)))
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

      if (!isSupportedFile(entry)) return null

      return fileToDocument(accessToken, entry)
    } catch (error) {
      logger.warn(`Failed to fetch document ${externalId}`, {
        error: error instanceof Error ? error.message : String(error),
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
      const message = error instanceof Error ? error.message : 'Failed to validate configuration'
      return { valid: false, error: message }
    }
  },

  tagDefinitions: [
    { id: 'path', displayName: 'File Path', fieldType: 'text' },
    { id: 'lastModified', displayName: 'Last Modified', fieldType: 'date' },
    { id: 'fileSize', displayName: 'File Size (bytes)', fieldType: 'number' },
  ],

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
