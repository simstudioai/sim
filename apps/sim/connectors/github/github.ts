import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import { githubConnectorMeta } from '@/connectors/github/meta'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import {
  CONNECTOR_MAX_FILE_BYTES,
  ConnectorFileTooLargeError,
  markSkipped,
  parseTagDate,
  readBodyWithLimit,
  sizeLimitSkipReason,
  stubOrSkipBySize,
  takeIndexableWithinCap,
} from '@/connectors/utils'

const logger = createLogger('GitHubConnector')

const GITHUB_API_URL = 'https://api.github.com'
/**
 * The whole filtered tree is already resident in `syncContext`, so a listing page
 * costs zero API calls — the page size only bounds how many stubs the sync engine
 * accumulates per iteration. The engine stops after `MAX_PAGES` (500) and marks the
 * listing truncated, so the page size is what sets the connector's file ceiling:
 * 500 x 200 = 100,000, matching the Git Trees API's own 100,000-entry limit.
 */
const BATCH_SIZE = 200
const GIT_SHA_PREFIX = 'git-sha:'
const MAX_FILE_SIZE = CONNECTOR_MAX_FILE_BYTES
const BINARY_SNIFF_BYTES = 8000
/**
 * Recorded on binary blobs so they surface once as a skipped row instead of being
 * dropped silently — a dropped file stays an `add` forever and its blob is
 * re-downloaded in full on every sync.
 */
const BINARY_SKIP_REASON = 'Binary file was not indexed'

/**
 * Heuristic binary detection: Git treats files containing a NUL byte in the
 * first 8000 bytes as binary. Matches `git diff` / `git grep` semantics.
 */
function isBinaryBuffer(buf: Buffer): boolean {
  const len = Math.min(buf.length, BINARY_SNIFF_BYTES)
  for (let i = 0; i < len; i++) {
    if (buf[i] === 0) return true
  }
  return false
}

/**
 * Parses the repository string into owner and repo.
 */
function parseRepo(repository: string): { owner: string; repo: string } {
  const cleaned = repository.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '')
  const parts = cleaned.split('/')
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid repository format: "${repository}". Use "owner/repo".`)
  }
  return { owner: parts[0], repo: parts[1] }
}

/**
 * File extension filter set from user config. Returns null if no filter (accept all).
 */
function parseExtensions(extensions: string): Set<string> | null {
  const trimmed = extensions.trim()
  if (!trimmed) return null
  const exts = trimmed
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .map((e) => (e.startsWith('.') ? e : `.${e}`))
  return exts.length > 0 ? new Set(exts) : null
}

/**
 * Checks whether a file path matches the extension filter. The extension is read
 * from the basename only — a dot in a directory segment (`docs/v1.2/CHANGELOG`)
 * must not be mistaken for the file's extension.
 *
 * A leading dot still counts, so a dotfile matches its own name as the extension
 * (`.gitignore` matches the configured extension `.gitignore`). That is the
 * long-standing behavior and the only way to select dotfiles at all; narrowing it
 * would drop already-indexed files out of the listing and hard-delete them.
 */
function matchesExtension(filePath: string, extSet: Set<string> | null): boolean {
  if (!extSet) return true
  const fileName = filePath.slice(filePath.lastIndexOf('/') + 1)
  const lastDot = fileName.lastIndexOf('.')
  if (lastDot === -1) return false
  return extSet.has(fileName.slice(lastDot).toLowerCase())
}

interface TreeItem {
  path: string
  mode: string
  type: string
  sha: string
  size?: number
}

/**
 * Fetches the full recursive tree for a branch.
 *
 * Per https://docs.github.com/en/rest/git/trees the recursive form caps at 100,000
 * entries / 7 MB and sets `truncated: true` when the tree exceeds either limit. A
 * truncated tree is a partial listing, so the caller must propagate it as
 * `listingCapped`.
 */
async function fetchTree(
  accessToken: string,
  owner: string,
  repo: string,
  branch: string
): Promise<{ items: TreeItem[]; truncated: boolean }> {
  const url = `${GITHUB_API_URL}/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`

  const response = await fetchWithRetry(url, {
    method: 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${accessToken}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    logger.error('Failed to fetch GitHub tree', { status: response.status, error: errorText })
    throw new Error(`Failed to fetch repository tree: ${response.status}`)
  }

  const data = await response.json()

  const truncated = Boolean(data.truncated)
  if (truncated) {
    logger.warn('GitHub tree was truncated — some files may be missing', { owner, repo, branch })
  }

  return {
    items: (data.tree || []).filter((item: TreeItem) => item.type === 'blob'),
    truncated,
  }
}

/**
 * Fetches blob content via the Git Blobs API. Used as a fallback when the
 * `/contents/` endpoint cannot return the file body (files larger than 1 MB
 * return `content: ""` and `encoding: "none"`). Supports blobs up to 100 MB.
 */
async function fetchBlobContent(
  accessToken: string,
  owner: string,
  repo: string,
  sha: string
): Promise<string | null> {
  const url = `${GITHUB_API_URL}/repos/${owner}/${repo}/git/blobs/${encodeURIComponent(sha)}`
  const response = await fetchWithRetry(url, {
    method: 'GET',
    headers: {
      Accept: 'application/vnd.github.raw+json',
      Authorization: `Bearer ${accessToken}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch git blob ${sha}: ${response.status}`)
  }

  const buffer = await readBodyWithLimit(response, MAX_FILE_SIZE)
  if (!buffer) {
    throw new ConnectorFileTooLargeError(MAX_FILE_SIZE)
  }
  if (isBinaryBuffer(buffer)) return null
  return buffer.toString('utf8')
}

/**
 * Creates a lightweight stub ExternalDocument from a tree item.
 * Uses the Git blob SHA as contentHash for change detection, avoiding
 * the need to fetch blob content for every file during listing.
 * Content is deferred and only fetched for new/changed documents.
 */
function treeItemToStub(
  owner: string,
  repo: string,
  branch: string,
  item: { path: string; sha: string; size?: number }
): ExternalDocument {
  return {
    externalId: item.path,
    title: item.path.split('/').pop() || item.path,
    content: '',
    contentDeferred: true,
    mimeType: 'text/plain',
    sourceUrl: `https://github.com/${owner}/${repo}/blob/${branch.split('/').map(encodeURIComponent).join('/')}/${item.path.split('/').map(encodeURIComponent).join('/')}`,
    contentHash: `${GIT_SHA_PREFIX}${item.sha}`,
    metadata: {
      path: item.path,
      sha: item.sha,
      size: item.size,
      branch,
      repository: `${owner}/${repo}`,
    },
  }
}

export const githubConnector: ConnectorConfig = {
  ...githubConnectorMeta,

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const { owner, repo } = parseRepo(sourceConfig.repository as string)
    const branch = ((sourceConfig.branch as string) || 'main').trim()
    const pathPrefix = ((sourceConfig.pathPrefix as string) || '').trim()
    const extSet = parseExtensions((sourceConfig.extensions as string) || '')
    const maxFiles = sourceConfig.maxFiles ? Number(sourceConfig.maxFiles) : 0

    let capped: TreeItem[]
    if (syncContext?.filteredTree) {
      capped = syncContext.filteredTree as TreeItem[]
    } else {
      const { items: tree, truncated } = await fetchTree(accessToken, owner, repo, branch)

      // Filter by path prefix and extensions. Oversized files are kept here and
      // surfaced as skipped (failed) documents at stub time so they stay visible.
      const filtered = tree.filter((item) => {
        if (pathPrefix && !item.path.startsWith(pathPrefix)) return false
        if (!matchesExtension(item.path, extSet)) return false
        return true
      })

      // Apply the max-files limit to indexable files only; oversized files within
      // the capped window are kept (and surfaced as skipped) but never consume the cap.
      capped =
        maxFiles > 0
          ? takeIndexableWithinCap(
              filtered,
              (item) => Boolean(item.size && item.size > MAX_FILE_SIZE),
              maxFiles,
              0
            ).documents
          : filtered

      /**
       * The listing is partial whenever the Git Trees API truncated the response or
       * `maxFiles` dropped files that still exist in the repo. The sync engine
       * hard-deletes every stored document absent from a complete listing, so flag
       * `listingCapped` to suppress reconciliation. Path/extension filters are
       * intentional scope narrowing and deliberately do NOT set the flag — files
       * that leave that scope should reconcile away.
       */
      if (syncContext && (truncated || capped.length < filtered.length)) {
        syncContext.listingCapped = true
        logger.warn('GitHub listing is partial; skipping deletion reconciliation', {
          owner,
          repo,
          branch,
          truncated,
          matched: filtered.length,
          listed: capped.length,
        })
      }
      if (syncContext) syncContext.filteredTree = capped
    }

    // Paginate using offset cursor
    const offset = cursor ? Number(cursor) : 0
    const batch = capped.slice(offset, offset + BATCH_SIZE)

    logger.info('Listing GitHub files', {
      owner,
      repo,
      branch,
      totalFiltered: capped.length,
      offset,
      batchSize: batch.length,
    })

    const documents = batch.map((item) =>
      stubOrSkipBySize(treeItemToStub(owner, repo, branch, item), item.size, MAX_FILE_SIZE)
    )

    const nextOffset = offset + BATCH_SIZE
    const hasMore = nextOffset < capped.length

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
    const { owner, repo } = parseRepo(sourceConfig.repository as string)
    const branch = ((sourceConfig.branch as string) || 'main').trim()

    // externalId is the file path
    const path = externalId

    try {
      const encodedPath = path.split('/').map(encodeURIComponent).join('/')
      const url = `${GITHUB_API_URL}/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`
      const response = await fetchWithRetry(url, {
        method: 'GET',
        headers: {
          Accept: 'application/vnd.github.object+json',
          Authorization: `Bearer ${accessToken}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
      })

      if (!response.ok) {
        if (response.status === 404) return null
        throw new Error(`Failed to fetch file ${path}: ${response.status}`)
      }

      const lastModifiedHeader = response.headers.get('last-modified') || undefined
      const data = await response.json()

      const size = typeof data.size === 'number' ? data.size : 0
      // Shared stub keeps externalId, sourceUrl, contentHash, and metadata byte-identical
      // to what `listDocuments` produced, so hydration never looks like a content change.
      const stub = treeItemToStub(owner, repo, branch, {
        path,
        sha: data.sha as string,
        size,
      })

      if (size > MAX_FILE_SIZE) {
        logger.info('Skipping GitHub file exceeding size limit', {
          path,
          size,
          limit: MAX_FILE_SIZE,
        })
        return markSkipped(stub, sizeLimitSkipReason(MAX_FILE_SIZE))
      }

      const rawContent = (data.content as string) || ''
      const encoding = data.encoding as string | undefined
      let content: string
      if (encoding === 'base64' && rawContent.length > 0) {
        const buf = Buffer.from(rawContent, 'base64')
        if (isBinaryBuffer(buf)) {
          logger.info('Skipping binary GitHub file', { path, size })
          return markSkipped(stub, BINARY_SKIP_REASON)
        }
        content = buf.toString('utf8')
      } else if (encoding === 'none' && data.sha && size > 0) {
        /**
         * Per https://docs.github.com/en/rest/repos/contents, for files of 1-100 MB
         * "only the `raw` or `object` custom media types are supported", and it is
         * specifically "when using the `object` media type" that "the `content` field
         * will be an empty string and the `encoding` field will be `none`".
         * The Git Blobs fallback streams that same blob through GitHub's documented raw
         * media type and supports blobs up to 100 MB.
         */
        let blobContent: string | null
        try {
          blobContent = await fetchBlobContent(accessToken, owner, repo, data.sha as string)
        } catch (error) {
          if (error instanceof ConnectorFileTooLargeError) {
            return markSkipped(stub, sizeLimitSkipReason(MAX_FILE_SIZE))
          }
          throw error
        }
        if (blobContent === null) {
          logger.info('Skipping binary GitHub file', { path, size })
          return markSkipped(stub, BINARY_SKIP_REASON)
        }
        content = blobContent
      } else {
        content = ''
      }

      return {
        ...stub,
        content,
        contentDeferred: false,
        metadata: { ...stub.metadata, lastModified: lastModifiedHeader },
      }
    } catch (error) {
      /**
       * Rethrow so hydration rejects and the sync engine counts a visible `docsFailed`
       * row. Returning `null` instead reports a transient GitHub failure as success —
       * an already-indexed file is silently counted as unchanged, and a new file
       * disappears from the run entirely with nothing recorded.
       */
      logger.warn(`Failed to fetch GitHub document ${externalId}`, {
        error: toError(error).message,
      })
      throw toError(error)
    }
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const repository = (sourceConfig.repository as string)?.trim()
    if (!repository) {
      return { valid: false, error: 'Repository is required' }
    }

    let owner: string
    let repo: string
    try {
      const parsed = parseRepo(repository)
      owner = parsed.owner
      repo = parsed.repo
    } catch (error) {
      return {
        valid: false,
        error: getErrorMessage(error, 'Invalid repository format'),
      }
    }

    const maxFiles = sourceConfig.maxFiles as string | undefined
    if (maxFiles && (Number.isNaN(Number(maxFiles)) || Number(maxFiles) <= 0)) {
      return { valid: false, error: 'Max files must be a positive number' }
    }

    const branch = ((sourceConfig.branch as string) || 'main').trim()

    try {
      // Verify repo and branch are accessible
      const url = `${GITHUB_API_URL}/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`
      const response = await fetchWithRetry(
        url,
        {
          method: 'GET',
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${accessToken}`,
            'X-GitHub-Api-Version': '2022-11-28',
          },
        },
        VALIDATE_RETRY_OPTIONS
      )

      if (response.status === 404) {
        return {
          valid: false,
          error: `Repository "${owner}/${repo}" or branch "${branch}" not found`,
        }
      }

      if (!response.ok) {
        return { valid: false, error: `Cannot access repository: ${response.status}` }
      }

      return { valid: true }
    } catch (error) {
      const message = getErrorMessage(error, 'Failed to validate configuration')
      return { valid: false, error: message }
    }
  },

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    if (typeof metadata.path === 'string') result.path = metadata.path
    if (typeof metadata.repository === 'string') result.repository = metadata.repository
    if (typeof metadata.branch === 'string') result.branch = metadata.branch

    if (metadata.size != null) {
      const num = Number(metadata.size)
      if (!Number.isNaN(num)) result.size = num
    }

    const lastModified = parseTagDate(metadata.lastModified)
    if (lastModified) result.lastModified = lastModified

    return result
  },
}
