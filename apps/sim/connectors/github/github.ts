import { posix } from 'node:path'
import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { z } from 'zod'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import { decodeTextBuffer } from '@/lib/file-parsers/utils'
import { type RetryOptions, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import { parseGitHubRepository } from '@/lib/oauth/github-repository'
import { githubConnectorMeta } from '@/connectors/github/meta'
import { fetchGitHubWithRetry as fetchWithRetry } from '@/connectors/github/request'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import {
  CONNECTOR_MAX_FILE_BYTES,
  ConnectorFileTooLargeError,
  isPerMemberListing,
  markSkipped,
  parseTagDate,
  pipelineParsedMimeType,
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
/** Rehydrates formats formerly skipped or decoded as plain text once through their real parser. */
const SOURCE_FILE_HASH_SUFFIX = ':source-file-v1'
const BINARY_SNIFF_BYTES = 8000
const MAX_SYMLINK_DEPTH = 40
const MAX_SYMLINK_TARGET_BYTES = 4096
/**
 * Recorded on binary blobs so they surface once as a skipped row instead of being
 * dropped silently — a dropped file stays an `add` forever and its blob is
 * re-downloaded in full on every sync.
 */
const BINARY_SKIP_REASON = 'Binary file was not indexed'
const EMPTY_SKIP_REASON = 'Empty file was not indexed'

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

const treeItemSchema = z.object({
  path: z.string().min(1),
  mode: z.string().min(1),
  type: z.enum(['blob', 'tree', 'commit']),
  sha: z.string().min(1),
  size: z.number().nonnegative().optional(),
})
const treeSchema = z.object({
  sha: z.string().min(1),
  tree: z.array(treeItemSchema).max(100_000),
  truncated: z.boolean(),
})
const cursorSchema = z.object({
  version: z.literal(1),
  treeSha: z.string().min(1).max(128),
  branch: z.string().min(1).max(1024),
  offset: z.number().int().min(0).max(100_000),
})

class GitHubListingCursorInvalidError extends Error {}

/** A restarted listing must resolve current scope rather than reuse the expired snapshot's branch. */
function clearListingContext(syncContext?: Record<string, unknown>): void {
  if (!syncContext) return
  syncContext.githubBranch = undefined
  syncContext.githubTreeSnapshot = undefined
  syncContext.filteredTree = undefined
  syncContext.listingCapped = undefined
}

function readCursor(
  cursor?: string,
  syncContext?: Record<string, unknown>
): z.output<typeof cursorSchema> | undefined {
  if (!cursor) return undefined
  try {
    return cursorSchema.parse(JSON.parse(cursor))
  } catch {
    /** Legacy numeric offsets cannot identify the tree they were paginating. */
    clearListingContext(syncContext)
    throw new GitHubListingCursorInvalidError('GitHub listing snapshot must be restarted')
  }
}

const repositorySchema = z.object({ default_branch: z.string().min(1) })
type TreeItem = z.output<typeof treeItemSchema>

interface TreeSnapshot {
  sha: string
  items: Map<string, TreeItem>
  truncated: boolean
}

class GitHubApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(`${message}: ${status}`)
    this.name = 'GitHubApiError'
  }
}

/** The shared transport separates throttles before repository access errors reach this path. */
async function repositoryRequestError(
  message: string,
  response: Response
): Promise<GitHubApiError> {
  await response.body?.cancel()
  return new GitHubApiError(message, response.status)
}

/** Search sources follow the repository default; existing workspace sources retain main. */
async function resolveBranch(
  accessToken: string,
  owner: string,
  repo: string,
  sourceConfig: Record<string, unknown>,
  syncContext?: Record<string, unknown>,
  retryOptions?: RetryOptions
): Promise<string> {
  const configuredBranch = typeof sourceConfig.branch === 'string' ? sourceConfig.branch.trim() : ''
  if (configuredBranch) return configuredBranch
  const isInstallationSource = typeof sourceConfig.githubRepositoryId === 'string'
  if (!isPerMemberListing(syncContext) && !isInstallationSource) return 'main'
  if (typeof syncContext?.githubBranch === 'string') return syncContext.githubBranch

  const response = await fetchWithRetry(
    `${GITHUB_API_URL}/repos/${owner}/${repo}`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${accessToken}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Sim',
      },
    },
    retryOptions
  )
  if (!response.ok) {
    throw await repositoryRequestError('Failed to access GitHub repository', response)
  }
  const repository = repositorySchema.parse(
    await readResponseJsonWithLimit(response, {
      maxBytes: 1024 * 1024,
      label: 'GitHub repository response',
    })
  )
  if (syncContext) syncContext.githubBranch = repository.default_branch
  return repository.default_branch
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
  branch: string,
  syncContext?: Record<string, unknown>,
  treeSha?: string
): Promise<TreeSnapshot> {
  const cached = syncContext?.githubTreeSnapshot as TreeSnapshot | undefined
  if (cached && (!treeSha || cached.sha === treeSha)) return cached
  const url = `${GITHUB_API_URL}/repos/${owner}/${repo}/git/trees/${encodeURIComponent(treeSha ?? branch)}?recursive=1`

  const response = await fetchWithRetry(url, {
    method: 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${accessToken}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Sim',
    },
  })

  if (!response.ok) {
    if (treeSha && response.status === 404) {
      await response.body?.cancel()
      clearListingContext(syncContext)
      throw new GitHubListingCursorInvalidError('GitHub listing snapshot is no longer available')
    }
    throw await repositoryRequestError('Failed to fetch repository tree', response)
  }

  const data = treeSchema.parse(
    await readResponseJsonWithLimit(response, {
      maxBytes: 8 * 1024 * 1024,
      label: 'GitHub repository tree response',
    })
  )

  const truncated = Boolean(data.truncated)
  if (truncated) {
    logger.warn('GitHub tree was truncated — some files may be missing', { owner, repo, branch })
  }

  const snapshot: TreeSnapshot = {
    sha: data.sha,
    items: new Map(data.tree.map((item) => [item.path, item])),
    truncated,
  }
  if (syncContext) syncContext.githubTreeSnapshot = snapshot
  return snapshot
}

/** Keeps original bytes available to the shared parsers while bounding every blob read. */
async function fetchBlobBytes(
  accessToken: string,
  owner: string,
  repo: string,
  sha: string,
  maxBytes = MAX_FILE_SIZE
): Promise<Buffer> {
  const url = `${GITHUB_API_URL}/repos/${owner}/${repo}/git/blobs/${encodeURIComponent(sha)}`
  const label = `git blob ${sha}`
  const response = await fetchWithRetry(url, {
    method: 'GET',
    headers: {
      Accept: 'application/vnd.github.raw+json',
      Authorization: `Bearer ${accessToken}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Sim',
    },
  })

  if (!response.ok) {
    throw await repositoryRequestError(`Failed to fetch ${label}`, response)
  }

  if (!response.body) {
    const contentLength = Number.parseInt(response.headers.get('content-length') ?? '', 10)
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new ConnectorFileTooLargeError(maxBytes)
    }
    throw new Error(`GitHub ${label} returned no body`)
  }

  const buffer = await readBodyWithLimit(response, maxBytes)
  if (!buffer) {
    throw new ConnectorFileTooLargeError(maxBytes)
  }
  return buffer
}

/** Resolves links within one snapshot; Contents can truncate dereferenced targets at 1 MiB. */
async function resolveSymlinkTarget(
  accessToken: string,
  owner: string,
  repo: string,
  link: TreeItem,
  snapshot: TreeSnapshot
): Promise<TreeItem | null> {
  const visited = new Set<string>()
  let item = link
  for (let depth = 0; depth < MAX_SYMLINK_DEPTH; depth++) {
    if (item.mode !== '120000') return item.type === 'blob' ? item : null
    if (visited.has(item.path) || (item.size ?? 0) > MAX_SYMLINK_TARGET_BYTES) return null
    visited.add(item.path)
    let targetBytes: Buffer
    try {
      targetBytes = await fetchBlobBytes(
        accessToken,
        owner,
        repo,
        item.sha,
        MAX_SYMLINK_TARGET_BYTES
      )
    } catch (error) {
      if (error instanceof ConnectorFileTooLargeError) return null
      throw error
    }
    if (isBinaryBuffer(targetBytes)) return null
    const target = decodeTextBuffer(targetBytes).text
    if (!target || posix.isAbsolute(target)) return null
    const targetPath = posix.normalize(posix.join(posix.dirname(item.path), target))
    if (targetPath === '..' || targetPath.startsWith('../')) return null
    const next = snapshot.items.get(targetPath)
    if (!next) {
      if (snapshot.truncated) {
        throw new Error(
          'GitHub tree was truncated before the symbolic link target could be resolved'
        )
      }
      return null
    }
    item = next
  }
  return item.mode !== '120000' && item.type === 'blob' ? item : null
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
  item: { path: string; sha: string; size?: number; mode?: string },
  treeSha: string
): ExternalDocument {
  return {
    externalId: item.path,
    title: item.path.split('/').pop() || item.path,
    content: '',
    contentDeferred: true,
    skippedRetryPolicy: 'source-change',
    /** Verified immutable omissions replace older content; fetch failures still throw. */
    skippedExistingDisposition: 'replace',
    mimeType: 'text/plain',
    sourceUrl: `https://github.com/${owner}/${repo}/blob/${branch.split('/').map(encodeURIComponent).join('/')}/${item.path.split('/').map(encodeURIComponent).join('/')}`,
    /** Contents dereferences symlinks but retains their SHA even when the target changes. */
    contentHash: `${GIT_SHA_PREFIX}${item.sha}${item.mode === '120000' ? `:${treeSha}` : ''}${pipelineParsedMimeType(item.path) ? SOURCE_FILE_HASH_SUFFIX : ''}`,
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
  contentConcurrency: 1,
  isListingCursorInvalidError: (error) => error instanceof GitHubListingCursorInvalidError,

  isCredentialInvalidError: (error) => error instanceof GitHubApiError && error.status === 401,
  /** Provider throttles preserve membership; a genuine scope denial withdraws it. */
  isListingScopeUnavailableError: (error) =>
    error instanceof GitHubApiError && (error.status === 403 || error.status === 404),

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const { owner, repo } = parseGitHubRepository(sourceConfig.repository as string)
    const position = readCursor(cursor, syncContext)
    const branch =
      position?.branch ?? (await resolveBranch(accessToken, owner, repo, sourceConfig, syncContext))
    if (syncContext) syncContext.githubBranch = branch
    const pathPrefix = ((sourceConfig.pathPrefix as string) || '').trim()
    const extSet = parseExtensions((sourceConfig.extensions as string) || '')
    const maxFiles = sourceConfig.maxFiles ? Number(sourceConfig.maxFiles) : 0
    const snapshot = await fetchTree(
      accessToken,
      owner,
      repo,
      branch,
      syncContext,
      position?.treeSha
    )

    let capped: TreeItem[]
    if (syncContext?.filteredTree) {
      capped = syncContext.filteredTree as TreeItem[]
    } else {
      const { items: tree, truncated } = snapshot

      /** Oversized files remain visible as skipped documents and never consume the file cap. */
      const filtered = [...tree.values()].filter((item) => {
        if (item.type !== 'blob') return false
        if (pathPrefix && !item.path.startsWith(pathPrefix)) return false
        if (!matchesExtension(item.path, extSet)) return false
        return true
      })

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

    const offset = position?.offset ?? 0
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new Error('Invalid GitHub listing cursor')
    }
    const batch = capped.slice(offset, offset + BATCH_SIZE)

    logger.info('Listing GitHub files', {
      owner,
      repo,
      branch,
      totalFiltered: capped.length,
      offset,
      batchSize: batch.length,
    })

    const documents = batch.map((item) => {
      const stub = stubOrSkipBySize(
        treeItemToStub(owner, repo, branch, item, snapshot.sha),
        item.size,
        MAX_FILE_SIZE
      )
      return item.size === 0 ? markSkipped(stub, EMPTY_SKIP_REASON) : stub
    })

    const nextOffset = offset + BATCH_SIZE
    const hasMore = nextOffset < capped.length

    return {
      documents,
      currentCursor: JSON.stringify({ version: 1, treeSha: snapshot.sha, branch, offset }),
      nextCursor: hasMore
        ? JSON.stringify({ version: 1, treeSha: snapshot.sha, branch, offset: nextOffset })
        : undefined,
      hasMore,
    }
  },

  getDocument: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    externalId: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocument | null> => {
    const { owner, repo } = parseGitHubRepository(sourceConfig.repository as string)
    const path = externalId

    try {
      const branch = await resolveBranch(accessToken, owner, repo, sourceConfig, syncContext)
      const snapshot = await fetchTree(accessToken, owner, repo, branch, syncContext)
      const treeItem = snapshot.items.get(path)
      if (!treeItem && snapshot.truncated) {
        throw new Error('GitHub tree was truncated before the file could be resolved')
      }
      if (!treeItem || treeItem.type !== 'blob') return null
      const symlink = treeItem.mode === '120000' ? treeItem : undefined
      const target = symlink
        ? await resolveSymlinkTarget(accessToken, owner, repo, symlink, snapshot)
        : treeItem
      const size = target?.size ?? 0
      const stub = treeItemToStub(owner, repo, branch, { ...treeItem, size }, snapshot.sha)
      if (!target) {
        return markSkipped(stub, 'Symbolic link target is not a repository file')
      }
      if (size > MAX_FILE_SIZE) return markSkipped(stub, sizeLimitSkipReason(MAX_FILE_SIZE))
      if (target.size === 0) return markSkipped(stub, EMPTY_SKIP_REASON)
      /** The immutable listed blob avoids ref drift and a redundant Contents API request. */
      let bytes: Buffer
      try {
        bytes = await fetchBlobBytes(accessToken, owner, repo, target.sha)
      } catch (error) {
        if (error instanceof ConnectorFileTooLargeError)
          return markSkipped(stub, sizeLimitSkipReason(MAX_FILE_SIZE))
        throw error
      }
      if (bytes.length === 0) return markSkipped(stub, EMPTY_SKIP_REASON)
      const mimeType = pipelineParsedMimeType(stub.title)
      if (mimeType) {
        return {
          ...stub,
          contentDeferred: false,
          mimeType,
          sourceFile: { bytes, fileName: stub.title, mimeType },
        }
      }
      if (isBinaryBuffer(bytes)) return markSkipped(stub, BINARY_SKIP_REASON)
      const content = decodeTextBuffer(bytes).text
      if (!content.trim()) return markSkipped(stub, EMPTY_SKIP_REASON)

      return {
        ...stub,
        content,
        contentDeferred: false,
      }
    } catch (error) {
      if (error instanceof GitHubApiError && error.status === 404) return null
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
    sourceConfig: Record<string, unknown>,
    syncContext?: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const repository = (sourceConfig.repository as string)?.trim()
    if (!repository) {
      return { valid: false, error: 'Repository is required' }
    }

    let owner: string
    let repo: string
    try {
      const parsed = parseGitHubRepository(repository)
      owner = parsed.owner
      repo = parsed.repo
    } catch (error) {
      return {
        valid: false,
        error: getErrorMessage(error, 'Invalid repository format'),
      }
    }

    const maxFiles = sourceConfig.maxFiles as string | undefined
    if (maxFiles && (!Number.isSafeInteger(Number(maxFiles)) || Number(maxFiles) <= 0)) {
      return { valid: false, error: 'Max files must be a positive whole number' }
    }

    try {
      const branch = await resolveBranch(
        accessToken,
        owner,
        repo,
        sourceConfig,
        syncContext,
        VALIDATE_RETRY_OPTIONS
      )
      const url = `${GITHUB_API_URL}/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`
      const response = await fetchWithRetry(
        url,
        {
          method: 'GET',
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${accessToken}`,
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'Sim',
          },
        },
        VALIDATE_RETRY_OPTIONS
      )

      await response.body?.cancel()

      if (response.status === 404) {
        return {
          valid: false,
          error: `Repository "${owner}/${repo}" or branch "${branch}" is unavailable. Check repository access and the GitHub App installation.`,
        }
      }

      if (!response.ok) {
        return {
          valid: false,
          error:
            response.status === 403
              ? 'GitHub denied access. Check repository permissions and authorize your organization’s SSO session before reconnecting.'
              : `Cannot access repository: ${response.status}`,
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
