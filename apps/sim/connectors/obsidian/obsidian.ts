import { createLogger } from '@sim/logger'
import { ObsidianIcon } from '@/components/icons'
import { toError } from '@/lib/core/utils/helpers'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { joinTagArray, parseTagDate } from '@/connectors/utils'

const logger = createLogger('ObsidianConnector')

const DOCS_PER_PAGE = 50

interface NoteJson {
  content: string
  frontmatter: Record<string, unknown>
  path: string
  stat: {
    ctime: number
    mtime: number
    size: number
  }
  tags: string[]
}

/**
 * Normalizes the vault URL by removing trailing slashes.
 */
function normalizeVaultUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

/**
 * Lists entries in a single vault directory (non-recursive).
 * Returns raw entries: files as names, subdirectories with trailing slash.
 */
async function listDirectory(
  baseUrl: string,
  accessToken: string,
  dirPath: string,
  retryOptions?: Parameters<typeof fetchWithRetry>[2]
): Promise<string[]> {
  const encodedDir = dirPath ? dirPath.split('/').map(encodeURIComponent).join('/') : ''
  const endpoint = encodedDir ? `${baseUrl}/vault/${encodedDir}/` : `${baseUrl}/vault/`

  const response = await fetchWithRetry(
    endpoint,
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
    throw new Error(`Obsidian API error: ${response.status} ${response.statusText}`)
  }

  const data = (await response.json()) as { files: string[] }
  return data.files ?? []
}

/**
 * Recursively lists all markdown files in the vault or a specific folder.
 */
const MAX_RECURSION_DEPTH = 20

async function listVaultFiles(
  baseUrl: string,
  accessToken: string,
  folderPath?: string,
  retryOptions?: Parameters<typeof fetchWithRetry>[2],
  depth = 0
): Promise<string[]> {
  if (depth > MAX_RECURSION_DEPTH) {
    logger.warn('Max directory depth reached, skipping further recursion', { folderPath })
    return []
  }

  const rootPath = folderPath || ''
  const entries = await listDirectory(baseUrl, accessToken, rootPath, retryOptions)

  const mdFiles: string[] = []
  const subDirs: string[] = []

  for (const entry of entries) {
    if (entry.endsWith('/')) {
      const fullDir = rootPath ? `${rootPath}/${entry.slice(0, -1)}` : entry.slice(0, -1)
      subDirs.push(fullDir)
    } else if (entry.endsWith('.md')) {
      const fullPath = rootPath ? `${rootPath}/${entry}` : entry
      mdFiles.push(fullPath)
    }
  }

  for (const dir of subDirs) {
    try {
      const nested = await listVaultFiles(baseUrl, accessToken, dir, retryOptions, depth + 1)
      mdFiles.push(...nested)
    } catch (error) {
      logger.warn('Failed to list subdirectory', {
        dir,
        error: toError(error).message,
      })
    }
  }

  return mdFiles
}

/**
 * Fetches a single note as structured JSON with content, frontmatter, stats, and tags.
 */
async function fetchNote(
  baseUrl: string,
  accessToken: string,
  filePath: string,
  retryOptions?: Parameters<typeof fetchWithRetry>[2]
): Promise<NoteJson> {
  const response = await fetchWithRetry(
    `${baseUrl}/vault/${filePath.split('/').map(encodeURIComponent).join('/')}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.olrapi.note+json',
      },
    },
    retryOptions
  )

  if (!response.ok) {
    throw new Error(`Obsidian API error fetching ${filePath}: ${response.status}`)
  }

  return (await response.json()) as NoteJson
}

/**
 * Extracts a display title from a file path.
 */
function titleFromPath(filePath: string): string {
  const filename = filePath.split('/').pop() || filePath
  return filename.replace(/\.md$/, '')
}

export const obsidianConnector: ConnectorConfig = {
  id: 'obsidian',
  name: 'Obsidian',
  description: 'Sync notes from an Obsidian vault via the Local REST API plugin',
  version: '1.0.0',
  icon: ObsidianIcon,

  auth: {
    mode: 'apiKey',
    label: 'API Key',
    placeholder: 'Enter your Obsidian Local REST API key',
  },

  configFields: [
    {
      id: 'vaultUrl',
      title: 'Vault URL',
      type: 'short-input',
      placeholder: 'https://127.0.0.1:27124',
      required: true,
      description: 'Base URL of your Obsidian Local REST API (default port: 27124 for HTTPS)',
    },
    {
      id: 'folderPath',
      title: 'Folder Path',
      type: 'short-input',
      placeholder: 'e.g. Projects/Notes',
      required: false,
      description: 'Only sync notes from this folder (leave empty for entire vault)',
    },
  ],

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const baseUrl = normalizeVaultUrl(
      (sourceConfig.vaultUrl as string) || 'https://127.0.0.1:27124'
    )
    const folderPath = (sourceConfig.folderPath as string) || ''

    let allFiles = syncContext?.allFiles as string[] | undefined
    if (!allFiles) {
      logger.info('Listing all vault files', { baseUrl, folderPath })
      allFiles = await listVaultFiles(baseUrl, accessToken, folderPath || undefined)
      if (syncContext) {
        syncContext.allFiles = allFiles
      }
    }
    const offset = cursor ? Number(cursor) : 0
    const pageFiles = allFiles.slice(offset, offset + DOCS_PER_PAGE)

    const syncRunId = (syncContext?.syncRunId as string) ?? ''

    const documents: ExternalDocument[] = pageFiles.map((filePath) => ({
      externalId: filePath,
      title: titleFromPath(filePath),
      content: '',
      contentDeferred: true,
      mimeType: 'text/plain' as const,
      sourceUrl: `${baseUrl}/vault/${filePath.split('/').map(encodeURIComponent).join('/')}`,
      contentHash: `obsidian:stub:${filePath}:${syncRunId}`,
      metadata: {
        folder: filePath.includes('/') ? filePath.substring(0, filePath.lastIndexOf('/')) : '',
      },
    }))

    const nextOffset = offset + pageFiles.length
    const hasMore = nextOffset < allFiles.length

    return {
      documents,
      nextCursor: hasMore ? String(nextOffset) : undefined,
      hasMore,
    }
  },

  getDocument: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    externalId: string,
    _syncContext?: Record<string, unknown>
  ): Promise<ExternalDocument | null> => {
    const baseUrl = normalizeVaultUrl(
      (sourceConfig.vaultUrl as string) || 'https://127.0.0.1:27124'
    )

    try {
      const note = await fetchNote(baseUrl, accessToken, externalId)
      const content = note.content || ''

      return {
        externalId,
        title: titleFromPath(externalId),
        content,
        contentDeferred: false,
        mimeType: 'text/plain',
        sourceUrl: `${baseUrl}/vault/${externalId.split('/').map(encodeURIComponent).join('/')}`,
        contentHash: `obsidian:${externalId}:${note.stat?.mtime ?? ''}`,
        metadata: {
          tags: note.tags,
          frontmatter: note.frontmatter,
          createdAt: note.stat?.ctime ? new Date(note.stat.ctime).toISOString() : undefined,
          modifiedAt: note.stat?.mtime ? new Date(note.stat.mtime).toISOString() : undefined,
          size: note.stat?.size,
          folder: externalId.includes('/')
            ? externalId.substring(0, externalId.lastIndexOf('/'))
            : '',
        },
      }
    } catch (error) {
      logger.warn('Failed to get Obsidian note', {
        externalId,
        error: toError(error).message,
      })
      return null
    }
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const rawUrl = (sourceConfig.vaultUrl as string) || ''
    if (!rawUrl.trim()) {
      return { valid: false, error: 'Vault URL is required' }
    }

    const baseUrl = normalizeVaultUrl(rawUrl)

    try {
      const response = await fetchWithRetry(
        `${baseUrl}/`,
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${accessToken}` },
        },
        VALIDATE_RETRY_OPTIONS
      )

      if (response.status === 401 || response.status === 403) {
        return {
          valid: false,
          error: 'Invalid API key — check your Obsidian Local REST API settings',
        }
      }

      if (!response.ok) {
        return { valid: false, error: `Obsidian API returned status ${response.status}` }
      }

      const folderPath = (sourceConfig.folderPath as string) || ''
      if (folderPath.trim()) {
        const entries = await listDirectory(
          baseUrl,
          accessToken,
          folderPath.trim(),
          VALIDATE_RETRY_OPTIONS
        )
        if (entries.length === 0) {
          logger.info('Folder path returned no entries', { folderPath })
        }
      }

      return { valid: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to connect to Obsidian vault'
      return { valid: false, error: message }
    }
  },

  tagDefinitions: [
    { id: 'tags', displayName: 'Tags', fieldType: 'text' },
    { id: 'folder', displayName: 'Folder', fieldType: 'text' },
    { id: 'modifiedAt', displayName: 'Last Modified', fieldType: 'date' },
    { id: 'createdAt', displayName: 'Created', fieldType: 'date' },
  ],

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    const tags = joinTagArray(metadata.tags)
    if (tags) result.tags = tags

    if (typeof metadata.folder === 'string' && metadata.folder) {
      result.folder = metadata.folder
    }

    const modifiedAt = parseTagDate(metadata.modifiedAt)
    if (modifiedAt) result.modifiedAt = modifiedAt

    const createdAt = parseTagDate(metadata.createdAt)
    if (createdAt) result.createdAt = createdAt

    return result
  },
}
