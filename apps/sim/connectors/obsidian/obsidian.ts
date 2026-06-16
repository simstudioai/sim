import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { validateExternalUrl } from '@/lib/core/security/input-validation'
import { secureFetchWithRetry } from '@/lib/knowledge/documents/secure-fetch.server'
import { VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import { obsidianConnectorMeta } from '@/connectors/obsidian/meta'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { joinTagArray, parseTagDate } from '@/connectors/utils'

const logger = createLogger('ObsidianConnector')

const DOCS_PER_PAGE = 50
const DEFAULT_VAULT_URL = 'https://127.0.0.1:27124'

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
 * Normalizes the vault URL and runs an early structural SSRF check via the
 * shared `validateExternalUrl` policy (hosted Sim blocks localhost/private/HTTP;
 * self-hosted allows http://localhost only).
 *
 * The authoritative SSRF boundary is enforced at request time: every vault
 * request goes through {@link secureFetchWithRetry}, which resolves DNS,
 * re-checks the resolved IP, and pins the connection to it — closing the
 * DNS-rebinding gap a synchronous string check cannot. On hosted Sim the plugin
 * must be exposed through a public URL.
 */
function resolveVaultEndpoint(rawUrl: string | undefined): string {
  let url = (rawUrl || DEFAULT_VAULT_URL).trim().replace(/\/+$/, '')
  if (url && !url.startsWith('https://') && !url.startsWith('http://')) {
    url = `https://${url}`
  }
  const validation = validateExternalUrl(url, 'vaultUrl')
  if (!validation.isValid) {
    throw new Error(validation.error || 'Invalid vault URL')
  }
  return url
}

/**
 * Lists entries in a single vault directory (non-recursive).
 * Returns raw entries: files as names, subdirectories with trailing slash.
 */
async function listDirectory(
  baseUrl: string,
  accessToken: string,
  dirPath: string,
  retryOptions?: Parameters<typeof secureFetchWithRetry>[2]
): Promise<string[]> {
  const encodedDir = dirPath ? dirPath.split('/').map(encodeURIComponent).join('/') : ''
  const endpoint = encodedDir ? `${baseUrl}/vault/${encodedDir}/` : `${baseUrl}/vault/`

  const response = await secureFetchWithRetry(
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

const MAX_RECURSION_DEPTH = 20

async function listVaultFiles(
  baseUrl: string,
  accessToken: string,
  folderPath?: string,
  retryOptions?: Parameters<typeof secureFetchWithRetry>[2],
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
  retryOptions?: Parameters<typeof secureFetchWithRetry>[2]
): Promise<NoteJson> {
  const response = await secureFetchWithRetry(
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
  ...obsidianConnectorMeta,

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const baseUrl = resolveVaultEndpoint(sourceConfig.vaultUrl as string)
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

    /**
     * The Obsidian Local REST API directory listing returns just
     * `{ files: string[] }` — no `stat`/`mtime` and no `HEAD` support to read
     * `Last-Modified`, so the stub cannot encode change-detection state. Every
     * file is therefore re-hydrated via `getDocument` on every sync. The
     * post-hydration hash compare in the sync engine
     * (`existing.contentHash === hydratedHash`) prevents redundant DB writes
     * when `mtime` is unchanged.
     */
    const documents: ExternalDocument[] = pageFiles.map((filePath) => ({
      externalId: filePath,
      title: titleFromPath(filePath),
      content: '',
      contentDeferred: true,
      mimeType: 'text/plain' as const,
      sourceUrl: `${baseUrl}/vault/${filePath.split('/').map(encodeURIComponent).join('/')}`,
      contentHash: `obsidian:${filePath}`,
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
    const baseUrl = resolveVaultEndpoint(sourceConfig.vaultUrl as string)

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

    let baseUrl: string
    try {
      baseUrl = resolveVaultEndpoint(rawUrl)
    } catch (error) {
      return { valid: false, error: toError(error).message }
    }

    try {
      const response = await secureFetchWithRetry(
        `${baseUrl}/`,
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${accessToken}` },
        },
        VALIDATE_RETRY_OPTIONS
      )

      if (!response.ok) {
        return { valid: false, error: `Obsidian API returned status ${response.status}` }
      }

      /**
       * `GET /` is the only public endpoint and returns 200 regardless of auth;
       * the response body's `authenticated` field is the actual auth signal.
       * See https://coddingtonbear.github.io/obsidian-local-rest-api/.
       */
      const data = (await response.json()) as { authenticated?: boolean }
      if (!data?.authenticated) {
        return {
          valid: false,
          error: 'Invalid API key — check your Obsidian Local REST API settings',
        }
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
      return {
        valid: false,
        error: toError(error).message || 'Failed to connect to Obsidian vault',
      }
    }
  },

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
