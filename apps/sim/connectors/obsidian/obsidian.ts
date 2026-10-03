import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { validateExternalUrl } from '@/lib/core/security/input-validation'
import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { secureFetchWithRetry } from '@/lib/knowledge/documents/secure-fetch.server'
import { VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import { obsidianConnectorMeta } from '@/connectors/obsidian/meta'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import {
  CONNECTOR_MAX_FILE_BYTES,
  joinTagArray,
  markSkipped,
  parseTagDate,
  sizeLimitSkipReason,
} from '@/connectors/utils'

const logger = createLogger('ObsidianConnector')

const DOCS_PER_PAGE = 50
const DEFAULT_VAULT_URL = 'https://127.0.0.1:27124'
const MAX_FILE_SIZE = CONNECTOR_MAX_FILE_BYTES

interface NoteJson {
  content: string
  frontmatter?: Record<string, unknown>
  path: string
  /** Optional in practice: a vault served through a proxy may omit it. */
  stat?: {
    ctime: number
    mtime: number
    size: number
  }
  tags?: string[]
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
  let url = (rawUrl || DEFAULT_VAULT_URL).trim()
  if (url && !url.startsWith('https://') && !url.startsWith('http://')) {
    url = `https://${url}`
  }
  const validation = validateExternalUrl(url, 'vaultUrl', 'configuredEndpoint')
  if (!validation.isValid) {
    throw new Error(validation.error || 'Invalid vault URL')
  }

  /**
   * Rebuilt from the parsed URL so a pasted value carrying a query string or
   * fragment (`https://host:27124/?x=1`) cannot end up spliced into the middle
   * of every endpoint path. A reverse-proxy base path is preserved.
   */
  const parsed = new URL(url)
  return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '')
}

/**
 * Normalizes a vault-relative path and rejects traversal segments.
 *
 * `encodeURIComponent` leaves `.` and `..` untouched, and `new URL()` resolves
 * dot segments before the request is issued — so an unchecked `../..` in a
 * config value or stored externalId would silently escape the plugin's
 * `/vault/` prefix and address unrelated endpoints (`/commands/`, `/active/`).
 */
function normalizeVaultPath(rawPath: string, fieldName: string): string {
  const segments = rawPath
    .trim()
    .split('/')
    .filter((segment) => segment.length > 0)

  for (const segment of segments) {
    if (segment === '.' || segment === '..') {
      throw new Error(`${fieldName} must not contain path traversal segments`)
    }
  }

  return segments.join('/')
}

/** Percent-encodes each segment of an already-normalized vault-relative path. */
function encodeVaultPath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

/** Absolute URL of a note in the Local REST API vault namespace. */
function noteUrl(baseUrl: string, filePath: string): string {
  return `${baseUrl}/vault/${encodeVaultPath(filePath)}`
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
  const encodedDir = dirPath ? encodeVaultPath(dirPath) : ''
  const endpoint = encodedDir ? `${baseUrl}/vault/${encodedDir}/` : `${baseUrl}/vault/`

  const response = await secureFetchWithRetry(
    endpoint,
    {
      profile: 'configuredEndpoint',
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
      stripAuthOnRedirect: true,
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

/**
 * Tracks whether the recursive walk returned less than the vault actually holds.
 * The sync engine hard-deletes every stored document absent from a listing, so a
 * depth cut-off or a failed subdirectory read must surface as `listingCapped`
 * rather than being read as evidence those notes were deleted.
 */
interface WalkState {
  capped: boolean
}

async function listVaultFiles(
  baseUrl: string,
  accessToken: string,
  state: WalkState,
  folderPath?: string,
  retryOptions?: Parameters<typeof secureFetchWithRetry>[2],
  depth = 0
): Promise<string[]> {
  if (depth > MAX_RECURSION_DEPTH) {
    logger.warn('Max directory depth reached, skipping further recursion', { folderPath })
    state.capped = true
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
      const nested = await listVaultFiles(baseUrl, accessToken, state, dir, retryOptions, depth + 1)
      mdFiles.push(...nested)
    } catch (error) {
      /**
       * A transient read failure drops every note under `dir` from this listing
       * while they still exist in the vault — partial evidence, not deletion.
       */
      state.capped = true
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
  filePath: string
): Promise<NoteJson | null> {
  const response = await secureFetchWithRetry(noteUrl(baseUrl, filePath), {
    profile: 'configuredEndpoint',
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.olrapi.note+json',
    },
    stripAuthOnRedirect: true,
    /**
     * Bounds the buffered JSON envelope. The authoritative per-note gate is the
     * `content` byte check in `getDocument`; this only stops a pathological
     * body from being materialized in the sync worker's heap.
     */
    maxResponseBytes: MAX_FILE_SIZE,
  })

  /** A note deleted between listing and hydration is an absence, not a failure. */
  if (response.status === 404) return null

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

/**
 * Listing-time stub shared by `listDocuments` and `getDocument` so externalId,
 * title, sourceUrl, and folder metadata are produced in exactly one place.
 *
 * `contentHash` is deliberately NOT part of the stub: the directory listing
 * returns only `{ files: string[] }` (no `stat`, no `Last-Modified`/`ETag`, no
 * `HEAD` route), so the stub hash cannot encode change-detection state and
 * never matches the stored, mtime-bearing hash — every note is re-hydrated each
 * sync. The engine's post-hydration compare
 * (`priorByExternalId.get(id)?.contentHash === hydratedHash`) then skips the
 * re-index, so this costs one GET per note but never re-embeds unchanged notes.
 */
function noteStub(baseUrl: string, filePath: string): ExternalDocument {
  return {
    externalId: filePath,
    title: titleFromPath(filePath),
    content: '',
    contentDeferred: true,
    mimeType: 'text/plain',
    sourceUrl: noteUrl(baseUrl, filePath),
    contentHash: `obsidian:${filePath}`,
    metadata: {
      folder: filePath.includes('/') ? filePath.substring(0, filePath.lastIndexOf('/')) : '',
    },
  }
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
    const folderPath = normalizeVaultPath((sourceConfig.folderPath as string) || '', 'folderPath')

    let allFiles = syncContext?.allFiles as string[] | undefined
    if (!allFiles) {
      logger.info('Listing all vault files', { baseUrl, folderPath })
      const state: WalkState = { capped: false }
      allFiles = await listVaultFiles(baseUrl, accessToken, state, folderPath || undefined)
      if (syncContext) {
        syncContext.allFiles = allFiles
        /**
         * Only ever set, never cleared: a walk that reached its depth limit or
         * lost a subdirectory to a transient error returned fewer notes than the
         * vault holds, and the engine must not read those absences as deletions.
         * A clean, exhausted walk leaves the flag untouched so genuinely deleted
         * notes still reconcile.
         */
        if (state.capped) {
          syncContext.listingCapped = true
        }
      }
    }
    const offset = cursor ? Number(cursor) : 0
    const pageFiles = allFiles.slice(offset, offset + DOCS_PER_PAGE)

    const documents: ExternalDocument[] = pageFiles.map((filePath) => noteStub(baseUrl, filePath))

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

    /**
     * Throws rather than returning `null`: a traversal segment in a stored
     * externalId is a rejection, not an absence, and `null` would drop the note
     * from the run with no counter and no error row.
     */
    const filePath = normalizeVaultPath(externalId, 'externalId')
    const stub = noteStub(baseUrl, filePath)

    let note: NoteJson | null
    try {
      note = await fetchNote(baseUrl, accessToken, filePath)
    } catch (error) {
      /**
       * A note only proves oversized while its body streams, so that case becomes
       * a visible skipped row. Every other failure is a transport or vault-API
       * fault and is rethrown, letting the sync engine record a failed document
       * instead of dropping the note from the run with no counter and no error.
       */
      if (error instanceof PayloadSizeLimitError) {
        return markSkipped(stub, sizeLimitSkipReason(MAX_FILE_SIZE))
      }
      logger.warn('Failed to get Obsidian note', { externalId, error: toError(error).message })
      throw toError(error)
    }
    if (!note) return null

    const content = note.content || ''
    const hydrated: ExternalDocument = {
      ...stub,
      content,
      contentDeferred: false,
      contentHash: `obsidian:${filePath}:${note.stat?.mtime ?? ''}`,
      metadata: {
        ...stub.metadata,
        tags: note.tags,
        frontmatter: note.frontmatter,
        createdAt: note.stat?.ctime ? new Date(note.stat.ctime).toISOString() : undefined,
        modifiedAt: note.stat?.mtime ? new Date(note.stat.mtime).toISOString() : undefined,
        size: note.stat?.size,
      },
    }

    const contentBytes = Buffer.byteLength(content, 'utf8')
    if (contentBytes > MAX_FILE_SIZE) {
      logger.warn('Obsidian note exceeds size limit', { externalId, contentBytes })
      return markSkipped(hydrated, sizeLimitSkipReason(MAX_FILE_SIZE))
    }

    return hydrated
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
          profile: 'configuredEndpoint',
          method: 'GET',
          headers: { Authorization: `Bearer ${accessToken}` },
          stripAuthOnRedirect: true,
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

      /**
       * Proves the configured folder exists: the Local REST API answers 404 for
       * an unknown directory, which `listDirectory` turns into a throw caught
       * below. An empty-but-present folder is legitimate, so the entries
       * themselves are not inspected.
       */
      const folderPath = normalizeVaultPath((sourceConfig.folderPath as string) || '', 'folderPath')
      if (folderPath) {
        await listDirectory(baseUrl, accessToken, folderPath, VALIDATE_RETRY_OPTIONS)
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
