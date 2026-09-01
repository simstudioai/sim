import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import { bitbucketConnectorMeta } from '@/connectors/bitbucket/meta'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import {
  CONNECTOR_MAX_FILE_BYTES,
  markSkipped,
  parseTagDate,
  readBodyWithLimit,
  sizeLimitSkipReason,
  stubOrSkipBySize,
  takeIndexableWithinCap,
} from '@/connectors/utils'
import {
  BITBUCKET_API_BASE,
  bitbucketApiUrl,
  bitbucketRepositoryPath,
  encodeBitbucketRepositoryPath,
  encodeBitbucketSegment,
} from '@/tools/bitbucket/utils'

const logger = createLogger('BitbucketConnector')

/**
 * Scope of this connector, and the two Bitbucket surfaces it deliberately leaves out.
 *
 * Wikis: Bitbucket Cloud REST 2.0 exposes no wiki resource at all. The published
 * OpenAPI 3 description declares a `wiki` OAuth scope but not a single path under
 * it, so wiki pages are unreachable over the API rather than merely unimplemented
 * here — `has_wiki` on the repository record is the only wiki-related field there is.
 *
 * Issues: the issue tracker does have endpoints, and they require the `issue` scope.
 * Sim's Bitbucket OAuth service does not request it, and adding it would invalidate
 * every already-issued Bitbucket credential until its owner re-consented. Nothing in
 * this connector touches an issue endpoint, so no configuration of it can 403 for a
 * missing scope: every request it makes needs only `repository` or `pullrequest`.
 */

/** Bitbucket caps `pagelen` at 100 globally (REST 2.0 pagination reference). */
const PAGE_SIZE = 100
/** Pull request payloads are far heavier than tree entries, so they page smaller. */
const PULL_REQUEST_PAGE_SIZE = 50
/**
 * Partial-response selector for the pull request collection.
 *
 * Bitbucket documents that "a resource's `self` URL, as well its 'collection' URL
 * typically return the full object with all its fields, [but] there are some
 * exceptions for fields that are overly verbose or costly to generate", and only
 * enumerates `reviewers`/`participants` as such. The pull request body is exactly
 * the kind of field that carve-out covers and the reference never promises it on
 * the collection, so rather than assume, the connector asks for it explicitly:
 * `+` additive syntax keeps every default field and adds the rendered description
 * on top. `summary` is retained only as a fallback.
 */
const PULL_REQUEST_LIST_FIELDS = '+values.rendered.description'
/**
 * Sort key for the pull request collection.
 *
 * The listing feeds deletion reconciliation, so it has to page over a stable
 * order: with `-updated_on` any pull request touched between two page requests
 * moves to the front of the collection and shifts a later one past the page
 * boundary, dropping it from the listing entirely. `id` never changes once
 * assigned, so descending id is both immutable and newest-first — which is also
 * the useful half to keep when a `maxItems` cap truncates the listing.
 */
const PULL_REQUEST_SORT = '-id'
const MAX_FILE_SIZE = CONNECTOR_MAX_FILE_BYTES
/** Bytes sniffed for NUL when detecting binary files (matches git's heuristic). */
const BINARY_SNIFF_BYTES = 8000
/**
 * Recursion depth requested from the source browsing endpoint. Bitbucket documents
 * `max_depth` as a breadth-first walk that "will time out and return a 555" when the
 * value is too large, so the connector asks for a modest depth and queues the
 * directories at the frontier of each response for their own listing. A 555 on the
 * first page of a directory falls back to a single-level listing, which is lossless
 * because the frontier walk covers whatever the shallower listing did not reach; a
 * 555 that survives the fallback skips that directory and flags the listing capped.
 */
const MAX_TREE_DEPTH = 5
const BINARY_SKIP_REASON = 'Binary file was not indexed'
const NON_UTF8_SKIP_REASON = 'Non-UTF-8 file was not indexed'
/**
 * Bitbucket answers a raw read of an LFS-managed file with a 301 to Atlassian's
 * media services platform. The connector deliberately surfaces the file as
 * unsupported instead of following an unvalidated cross-origin location.
 */
const LFS_SKIP_REASON = 'Git LFS file was not indexed'

/**
 * Prefix encoded into each document's externalId so getDocument can route to the
 * correct Bitbucket resource. Repository files are addressed by their
 * repo-relative path, pull requests by their repository-scoped numeric ID.
 */
const FILE_PREFIX = 'file:'
const PULL_REQUEST_PREFIX = 'pr:'

/** Selects which Bitbucket resources to sync. */
type ContentTypeChoice = 'code' | 'pullrequests' | 'all'

/** Listing phases, walked in order: repository files ➜ pull requests. */
type SyncPhase = 'code' | 'pullrequests'

interface BitbucketCommitRef {
  hash?: string
}

interface BitbucketTreeEntry {
  type?: string
  path?: string
  size?: number
  /** `link`, `executable`, `subrepository`, or `binary` per the source API. */
  attributes?: string[] | string
  commit?: BitbucketCommitRef
}

interface BitbucketPagedResponse<T> {
  values: T[]
  /** Opaque absolute URL for the next page; absent on the last page. */
  next?: string
}

/**
 * Validates Bitbucket's guaranteed pagination envelope before reconciliation can
 * interpret it as a complete page. Treating a malformed response as an empty list
 * would make the sync engine hard-delete documents that still exist upstream.
 */
function parsePagedResponse<T>(value: unknown, resource: string): BitbucketPagedResponse<T> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Bitbucket ${resource} response must be an object`)
  }

  const record = value as Record<string, unknown>
  if (!Array.isArray(record.values)) {
    throw new Error(`Bitbucket ${resource} response must include a values array`)
  }
  if (record.next !== undefined && typeof record.next !== 'string') {
    throw new Error(`Bitbucket ${resource} response next cursor must be a URL`)
  }

  return {
    values: record.values as T[],
    next: record.next as string | undefined,
  }
}

interface BitbucketRenderedText {
  raw?: string
  markup?: string
  html?: string
}

interface BitbucketAccount {
  display_name?: string
  nickname?: string
  uuid?: string
}

interface BitbucketLink {
  href?: string
}

interface BitbucketPullRequest {
  id?: number
  title?: string
  state?: string
  /** The pull request body as typed by the author. */
  summary?: BitbucketRenderedText
  rendered?: { description?: BitbucketRenderedText }
  author?: BitbucketAccount
  created_on?: string
  updated_on?: string
  links?: { html?: BitbucketLink }
}

interface BitbucketRef {
  name?: string
  target?: BitbucketCommitRef
}

interface BitbucketRepositoryRecord {
  full_name?: string
  mainbranch?: BitbucketRef
  links?: { html?: BitbucketLink }
}

/** Repository facts resolved once per sync and cached on syncContext. */
interface ResolvedRepository {
  /** Canonical `workspace/repo`, always lowercase in Bitbucket responses. */
  fullName: string
  htmlUrl: string
  mainBranch: string
  mainBranchHash: string
}

/**
 * Heuristic binary detection: a NUL byte in the first 8 KB marks the file as
 * binary, matching `git diff` / `git grep` semantics. Bitbucket already flags most
 * binaries with the `binary` source attribute; this catches the rest.
 */
function isBinaryBuffer(buf: Buffer): boolean {
  const len = Math.min(buf.length, BINARY_SNIFF_BYTES)
  for (let i = 0; i < len; i++) {
    if (buf[i] === 0) return true
  }
  return false
}

/**
 * Standard request headers carrying the OAuth bearer token.
 */
function authHeaders(accessToken: string, json = true): Record<string, string> {
  return {
    Accept: json ? 'application/json' : '*/*',
    Authorization: `Bearer ${accessToken}`,
  }
}

/**
 * Reads a required slug (or curly-brace UUID) from sourceConfig.
 */
function readSlug(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** Reads an optional positive, finite integer document cap. */
function readMaxItems(value: unknown): number {
  if (value === undefined || value === null) return 0
  if (typeof value === 'string' && !value.trim()) return 0
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error('Max items must be a positive integer')
  }
  return parsed
}

/**
 * Reads the parsed content-type choice from sourceConfig (defaults to 'code').
 */
function getContentTypeChoice(sourceConfig: Record<string, unknown>): ContentTypeChoice {
  const value = typeof sourceConfig.contentTypes === 'string' ? sourceConfig.contentTypes : 'code'
  if (value === 'code' || value === 'pullrequests' || value === 'all') return value
  return 'code'
}

/**
 * Returns the ordered list of active sync phases for a content-type choice.
 */
function activePhases(choice: ContentTypeChoice): SyncPhase[] {
  const phases: SyncPhase[] = []
  if (choice === 'code' || choice === 'all') phases.push('code')
  if (choice === 'pullrequests' || choice === 'all') phases.push('pullrequests')
  return phases
}

/**
 * Returns the phase following `current`, or undefined when `current` is last.
 */
function nextPhase(current: SyncPhase, choice: ContentTypeChoice): SyncPhase | undefined {
  const phases = activePhases(choice)
  const idx = phases.indexOf(current)
  return idx >= 0 && idx + 1 < phases.length ? phases[idx + 1] : undefined
}

/**
 * Maps the pull request state config value to the documented `state` values.
 * An empty result means "do not filter", which Bitbucket answers with OPEN only.
 */
function pullRequestStates(sourceConfig: Record<string, unknown>): string[] {
  const value =
    typeof sourceConfig.pullRequestState === 'string' ? sourceConfig.pullRequestState.trim() : ''
  switch (value) {
    case 'merged':
      return ['MERGED']
    case 'openMerged':
      return ['OPEN', 'MERGED']
    case 'all':
      return ['OPEN', 'MERGED', 'DECLINED', 'SUPERSEDED']
    default:
      return ['OPEN']
  }
}

/**
 * Renders a timestamp as a BBQL datetime literal.
 *
 * BBQL datetimes are unquoted ISO-8601 strings whose grammar the filtering
 * reference illustrates with an explicit numeric offset (`2015-03-04T14:08:59.123+02:00`);
 * the bare `Z` designator appears nowhere in it. The offset is spelled out
 * numerically so the literal matches the documented form exactly.
 */
function bbqlDateTime(value: Date): string {
  return value.toISOString().replace(/Z$/, '+00:00')
}

/**
 * Parses a comma-separated extension filter into a normalized set (leading dot,
 * lowercased). Returns null when no filter is configured (accept all files).
 */
function parseExtensions(raw: unknown): Set<string> | null {
  const trimmed = typeof raw === 'string' ? raw.trim() : ''
  if (!trimmed) return null
  const exts = trimmed
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .map((e) => (e.startsWith('.') ? e : `.${e}`))
  return exts.length > 0 ? new Set(exts) : null
}

/**
 * Returns true when the file path matches the extension filter (or no filter set).
 * The extension is read from the basename so a dot in a directory segment
 * (`docs/v1.2/CHANGELOG`) is not mistaken for the file's extension.
 */
function matchesExtension(filePath: string, extSet: Set<string> | null): boolean {
  if (!extSet) return true
  const fileName = filePath.slice(filePath.lastIndexOf('/') + 1)
  const lastDot = fileName.lastIndexOf('.')
  if (lastDot === -1) return false
  return extSet.has(fileName.slice(lastDot).toLowerCase())
}

/**
 * Normalizes the configured path filter: no leading slash, one trailing slash.
 * Returns '' when unset.
 */
function normalizePathPrefix(raw: unknown): string {
  const trimmed = typeof raw === 'string' ? raw.trim().replace(/^\/+/, '') : ''
  if (!trimmed) return ''
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`
}

/**
 * Whether a directory is worth descending into given the configured path filter.
 * A directory qualifies when it is an ancestor of the prefix or lives inside it;
 * everything else can be pruned before a request is spent on it.
 */
function directoryMayContainPrefix(dirPath: string, pathPrefix: string): boolean {
  if (!pathPrefix) return true
  const dir = dirPath ? `${dirPath}/` : ''
  return dir.startsWith(pathPrefix) || pathPrefix.startsWith(dir)
}

/** Number of path segments in a repository-relative path ('' is depth 0). */
function pathDepth(path: string): number {
  return path ? path.split('/').length : 0
}

/** Normalizes the `attributes` element, which the API returns as an array. */
function entryAttributes(entry: BitbucketTreeEntry): Set<string> {
  const raw = entry.attributes
  if (Array.isArray(raw)) return new Set(raw)
  if (typeof raw === 'string') return new Set([raw])
  return new Set()
}

/**
 * Composes the document body as "Title\n\n<content>".
 */
function composeBody(title: string, content: string): string {
  const trimmedTitle = title.trim()
  const trimmedContent = content.trim()
  if (!trimmedTitle) return trimmedContent
  if (!trimmedContent) return trimmedTitle
  return `${trimmedTitle}\n\n${trimmedContent}`
}

/**
 * Builds the API URL for a repository sub-resource.
 */
function repositoryUrl(workspaceSlug: string, repoSlug: string, suffix = ''): string {
  const workspace = encodeBitbucketSegment(workspaceSlug, 'workspaceSlug')
  const repo = encodeBitbucketSegment(repoSlug, 'repoSlug')
  return `${BITBUCKET_API_BASE}/repositories/${workspace}/${repo}${suffix}`
}

/**
 * Builds the source-browsing URL for a directory at a pinned commit.
 *
 * Bitbucket requires a trailing slash when listing the repository root, so the
 * root case is built explicitly rather than by joining an empty path.
 */
function sourceListingUrl(
  workspaceSlug: string,
  repoSlug: string,
  commit: string,
  dirPath: string,
  maxDepth: number
): string {
  const encodedCommit = encodeBitbucketSegment(commit, 'commit')
  const encodedPath = dirPath ? `${encodeBitbucketRepositoryPath(dirPath)}/` : ''
  const url = new URL(
    repositoryUrl(workspaceSlug, repoSlug, `/src/${encodedCommit}/${encodedPath}`)
  )
  url.searchParams.set('pagelen', String(PAGE_SIZE))
  url.searchParams.set('max_depth', String(maxDepth))
  return url.toString()
}

/**
 * Builds the raw-content URL for a single file at a pinned commit.
 */
function sourceFileUrl(
  workspaceSlug: string,
  repoSlug: string,
  commit: string,
  path: string
): string {
  const encodedCommit = encodeBitbucketSegment(commit, 'commit')
  return repositoryUrl(
    workspaceSlug,
    repoSlug,
    `/src/${encodedCommit}/${encodeBitbucketRepositoryPath(path)}`
  )
}

/**
 * Builds the change-detection hash for a repository file.
 *
 * Bitbucket's source listing carries no per-file content identifier: the `commit`
 * embedded in each tree entry is documented as "merely the commit that was used in
 * the URL... *not* the commit that last modified the file", and the only
 * content-addressed value Bitbucket exposes is the ETag on a raw file read, which
 * costs one request per file and so cannot be used while listing.
 *
 * The hash is therefore pinned to the resolved tip commit, which means every
 * in-scope file re-hydrates when the branch advances. Path and extension filters
 * are the intended way to keep that cost bounded.
 */
function buildFileContentHash(fullName: string, commit: string, path: string): string {
  return `bitbucket:file:${fullName}:${commit}:${path}`
}

/**
 * Builds the change-detection hash for a pull request. `updated_on` advances on
 * every edit, comment, approval, and state change, so it needs no content fetch.
 */
function buildPullRequestContentHash(fullName: string, id: number, updatedOn: string): string {
  return `bitbucket:pr:${fullName}:${id}:${updatedOn}`
}

/**
 * Builds a deferred stub for a repository file. Content is empty and fetched
 * lazily via getDocument for new/changed files only.
 */
function fileToStub(
  repository: ResolvedRepository,
  ref: string,
  commit: string,
  path: string,
  size: number | undefined
): ExternalDocument {
  const title = path.slice(path.lastIndexOf('/') + 1) || path
  const encodedRef = ref.split('/').map(encodeURIComponent).join('/')
  const encodedPath = path.split('/').map(encodeURIComponent).join('/')
  return {
    externalId: `${FILE_PREFIX}${path}`,
    title,
    content: '',
    contentDeferred: true,
    mimeType: 'text/plain',
    sourceUrl: `${repository.htmlUrl}/src/${encodedRef}/${encodedPath}`,
    contentHash: buildFileContentHash(repository.fullName, commit, path),
    metadata: {
      contentType: 'file',
      title,
      repository: repository.fullName,
      path,
      size,
    },
  }
}

/**
 * Builds a pull request document from either the collection or the `self` record.
 *
 * The body is read from `rendered.description.raw`, the documented rendered-markup
 * representation of the user-provided description. `summary.raw` is a fallback
 * when the rendered description is absent.
 */
function pullRequestToDocument(
  repository: ResolvedRepository,
  pullRequest: BitbucketPullRequest
): ExternalDocument | null {
  const id = pullRequest.id
  if (typeof id !== 'number') return null

  const title = pullRequest.title?.trim() || `Pull request #${id}`
  const description =
    pullRequest.rendered?.description?.raw?.trim() || pullRequest.summary?.raw?.trim() || ''
  const body = composeBody(title, description)
  if (!body.trim()) return null

  const updatedOn = pullRequest.updated_on ?? pullRequest.created_on ?? ''
  const author =
    pullRequest.author?.display_name?.trim() || pullRequest.author?.nickname?.trim() || ''

  return {
    externalId: `${PULL_REQUEST_PREFIX}${id}`,
    title,
    content: body,
    contentDeferred: false,
    mimeType: 'text/plain',
    sourceUrl: pullRequest.links?.html?.href || `${repository.htmlUrl}/pull-requests/${id}`,
    contentHash: buildPullRequestContentHash(repository.fullName, id, updatedOn),
    metadata: {
      contentType: 'pull_request',
      title,
      repository: repository.fullName,
      state: pullRequest.state,
      author,
      createdAt: pullRequest.created_on ?? '',
      updatedAt: updatedOn,
    },
  }
}

/**
 * Fetches the repository record, used to resolve the canonical full name, the web
 * UI base URL, and the default branch — and to confirm access during validation.
 */
async function fetchRepository(
  workspaceSlug: string,
  repoSlug: string,
  accessToken: string,
  retryOptions?: typeof VALIDATE_RETRY_OPTIONS
): Promise<Response> {
  return fetchWithRetry(
    repositoryUrl(workspaceSlug, repoSlug),
    { method: 'GET', headers: authHeaders(accessToken) },
    retryOptions
  )
}

/**
 * Resolves the repository facts once per sync run and caches them on syncContext.
 *
 * Throws when the repository cannot be read. That is not cosmetic: a token that
 * lost access would otherwise produce an empty but apparently successful listing
 * and let deletion reconciliation hard-delete every previously synced document.
 * Proving the repository is readable here is also what lets the per-phase 404
 * handling below be read as "this ref or resource is genuinely absent".
 */
async function resolveRepository(
  syncContext: Record<string, unknown> | undefined,
  workspaceSlug: string,
  repoSlug: string,
  accessToken: string
): Promise<ResolvedRepository> {
  const cached = syncContext?.repository as ResolvedRepository | undefined
  if (cached?.fullName) return cached

  const response = await fetchRepository(workspaceSlug, repoSlug, accessToken)
  if (!response.ok) {
    throw new Error(
      `Cannot access Bitbucket repository ${workspaceSlug}/${repoSlug}: ${response.status}`
    )
  }

  const record = (await response.json()) as BitbucketRepositoryRecord
  /**
   * Bitbucket accepts workspace and repository slugs case-insensitively but echoes
   * the canonical lowercase form, so the resolved `full_name` — not the user's
   * input — is what identifies the repository in hashes and URLs.
   */
  const fullName = record.full_name?.trim() || `${workspaceSlug}/${repoSlug}`.toLowerCase()
  const repository: ResolvedRepository = {
    fullName,
    htmlUrl: record.links?.html?.href?.replace(/\/+$/, '') || `https://bitbucket.org/${fullName}`,
    mainBranch: record.mainbranch?.name?.trim() ?? '',
    mainBranchHash: record.mainbranch?.target?.hash?.trim() ?? '',
  }
  if (syncContext) syncContext.repository = repository
  return repository
}

/**
 * Resolves a branch or tag name to its tip commit SHA. Returns null when neither a
 * branch nor a tag by that name exists.
 */
async function resolveRefHash(
  workspaceSlug: string,
  repoSlug: string,
  ref: string,
  accessToken: string,
  retryOptions?: typeof VALIDATE_RETRY_OPTIONS
): Promise<string | null> {
  const encodedRef = encodeBitbucketRepositoryPath(ref)
  for (const kind of ['branches', 'tags'] as const) {
    const response = await fetchWithRetry(
      repositoryUrl(workspaceSlug, repoSlug, `/refs/${kind}/${encodedRef}`),
      { method: 'GET', headers: authHeaders(accessToken) },
      retryOptions
    )
    if (response.status === 404) continue
    if (!response.ok) {
      throw new Error(`Failed to resolve Bitbucket ref "${ref}": ${response.status}`)
    }
    const record = (await response.json()) as BitbucketRef
    const hash = record.target?.hash?.trim()
    if (hash) return hash
  }
  return null
}

/**
 * Resolves the commit the code phase is pinned to, caching it on syncContext so
 * every listing page and every deferred hydration in one run reads the same tree.
 *
 * Pinning matters twice over: the source endpoint's `next` links embed the commit,
 * and the file content hash is derived from it, so a branch that advances mid-sync
 * must not split the run across two trees.
 */
async function resolveCommit(
  sourceConfig: Record<string, unknown>,
  syncContext: Record<string, unknown> | undefined,
  repository: ResolvedRepository,
  workspaceSlug: string,
  repoSlug: string,
  accessToken: string
): Promise<{ commit: string; ref: string }> {
  const cachedCommit = syncContext?.commit
  const cachedRef = syncContext?.ref
  if (typeof cachedCommit === 'string' && cachedCommit && typeof cachedRef === 'string') {
    return { commit: cachedCommit, ref: cachedRef }
  }

  const configuredRef = typeof sourceConfig.ref === 'string' ? sourceConfig.ref.trim() : ''
  const ref = configuredRef || repository.mainBranch
  if (!ref) {
    throw new Error('Repository has no default branch; set a branch or tag explicitly')
  }

  let commit = !configuredRef && repository.mainBranchHash ? repository.mainBranchHash : ''
  if (!commit) {
    const resolved = await resolveRefHash(workspaceSlug, repoSlug, ref, accessToken)
    if (!resolved) {
      throw new Error(`Branch or tag "${ref}" not found in ${repository.fullName}`)
    }
    commit = resolved
  }

  if (syncContext) {
    syncContext.commit = commit
    syncContext.ref = ref
  }
  return { commit, ref }
}

/**
 * Issues a source listing GET, retrying at depth 1 when Bitbucket answers the
 * documented `555` timeout for a `max_depth` it considers too large. Falling back
 * is lossless because unexplored directories are queued and walked separately.
 *
 * The fallback is only offered for the first page of a directory, where `shallowUrl`
 * is a URL this connector built itself. A `555` on a replayed `next` link cannot be
 * retried the same way: `next` is documented as an opaque location "not to be
 * constructed by clients", and rewriting its `max_depth` would pair a cursor cut
 * from one tree walk with the results of a different one. The caller treats that
 * case as an unlistable directory instead.
 *
 * The effective depth travels back with the response because the caller derives the
 * frontier from it: after a fallback the listing only reached one level, so
 * directories one level down are unexplored even though the requested depth was
 * deeper. Reusing the requested depth there would silently drop every file below
 * them — and, worse, let deletion reconciliation remove the ones already indexed.
 */
async function fetchSourceListing(
  url: string,
  requestedDepth: number,
  accessToken: string,
  shallowUrl?: string
): Promise<{ response: Response; depth: number }> {
  const response = await fetchWithRetry(url, {
    method: 'GET',
    headers: authHeaders(accessToken),
  })
  if (response.status !== 555 || !shallowUrl) {
    return { response, depth: requestedDepth }
  }

  logger.warn('Bitbucket source listing timed out; retrying at depth 1', {
    url,
  })
  const shallow = await fetchWithRetry(shallowUrl, {
    method: 'GET',
    headers: authHeaders(accessToken),
  })
  return { response: shallow, depth: 1 }
}

/**
 * Cursor state. The cursor packs the resource phase and, within a phase, the
 * opaque Bitbucket `next` URL to fetch. Bitbucket documents `next` as a location
 * "not to be constructed by clients", so it is stored and replayed verbatim after
 * being re-validated as an api.bitbucket.org 2.0 URL.
 *
 * The code phase's frontier of not-yet-walked directories lives on syncContext
 * rather than in the cursor: it is per-run state that can grow unboundedly, and
 * every page of a run shares one syncContext.
 */
interface CursorState {
  phase: SyncPhase
  nextUrl?: string
  /** Directory the in-flight code listing is rooted at, for frontier depth math. */
  dir?: string
  /** Effective `max_depth` the in-flight code listing was served at. */
  depth?: number
}

function encodeCursor(state: CursorState): string {
  return Buffer.from(JSON.stringify(state), 'utf8').toString('base64url')
}

function decodeCursor(cursor: string | undefined, initialPhase: SyncPhase): CursorState {
  if (!cursor) return { phase: initialPhase }
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Partial<{
      phase: SyncPhase
      nextUrl: string
      dir: string
      depth: number
    }>
    return {
      phase:
        parsed.phase === 'code' || parsed.phase === 'pullrequests' ? parsed.phase : initialPhase,
      nextUrl: typeof parsed.nextUrl === 'string' ? parsed.nextUrl : undefined,
      dir: typeof parsed.dir === 'string' ? parsed.dir : undefined,
      depth:
        Number.isSafeInteger(parsed.depth) && Number(parsed.depth) > 0 ? parsed.depth : undefined,
    }
  } catch {
    return { phase: initialPhase }
  }
}

/**
 * Reads the frontier of directories the code phase has not walked yet, seeding it
 * with the repository root on the first page of a run.
 *
 * The frontier is per-run state that only a syncContext can carry between pages.
 * Without one the caller must not hand back a "there is more of the tree" cursor:
 * the array it just filled is discarded, the next call re-seeds the root, and the
 * walk would loop over the root listing until the engine's page ceiling stops it.
 */
function pendingDirectories(syncContext: Record<string, unknown> | undefined): string[] {
  if (!syncContext) return ['']
  if (!Array.isArray(syncContext.pendingDirs)) syncContext.pendingDirs = ['']
  return syncContext.pendingDirs as string[]
}

/**
 * Marks a provider-truncated listing as unsafe for deletion reconciliation, even
 * during a forced full sync. Configured max-item caps use only `listingCapped`;
 * transient provider omissions must additionally use the engine's absolute gate.
 */
function markListingIncomplete(syncContext: Record<string, unknown> | undefined): void {
  if (!syncContext) return
  syncContext.listingCapped = true
  syncContext.listingTruncated = true
}

/**
 * Applies the optional maxItems cap to a page, tracking the running total in
 * syncContext and flagging `listingCapped` when the cap truncates the listing.
 * Skipped (oversized) documents ride along without consuming the cap.
 *
 * `moreToEnumerate` is whether anything the connector was configured to list
 * remains unlisted beyond this page: a `next` link, directories still queued on
 * the frontier, or a later phase that the cap is about to stop us reaching.
 *
 * It is required because `takeIndexableWithinCap` reports `capReached` as soon as
 * the running total *equals* maxItems, which is also true of a listing that ended
 * at exactly that count. Setting `listingCapped` unconditionally there suppresses
 * deletion reconciliation for a complete listing; not setting it when a later
 * phase is skipped is worse still, because the engine would treat the run as a
 * complete enumeration and hard-delete that phase's previously indexed documents.
 * `maxItems` is shared across phases, so the code walk ending exactly on the cap
 * is precisely when the pull-request phase never runs.
 */
function applyMaxItemsCap(
  documents: ExternalDocument[],
  maxItems: number,
  syncContext: Record<string, unknown> | undefined,
  moreToEnumerate: boolean
): { documents: ExternalDocument[]; capped: boolean } {
  if (maxItems <= 0) return { documents, capped: false }
  const alreadyIndexed = (syncContext?.totalDocsFetched as number) ?? 0
  const {
    documents: taken,
    indexableCount,
    capReached,
  } = takeIndexableWithinCap(
    documents,
    (doc) => doc.skippedReason !== undefined,
    maxItems,
    alreadyIndexed
  )
  if (syncContext) {
    syncContext.totalDocsFetched = alreadyIndexed + indexableCount
    const withheld = taken.length < documents.length || moreToEnumerate
    if (capReached && withheld) syncContext.listingCapped = true
  }
  return { documents: taken, capped: capReached }
}

export const bitbucketConnector: ConnectorConfig = {
  ...bitbucketConnectorMeta,

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>,
    lastSyncAt?: Date
  ): Promise<ExternalDocumentList> => {
    const workspaceSlug = readSlug(sourceConfig.workspaceSlug)
    const repoSlug = readSlug(sourceConfig.repoSlug)
    if (!workspaceSlug || !repoSlug) {
      throw new Error('Workspace and repository are required')
    }

    const choice = getContentTypeChoice(sourceConfig)
    const phases = activePhases(choice)
    if (phases.length === 0) return { documents: [], hasMore: false }

    const maxItems = readMaxItems(sourceConfig.maxItems)
    const repository = await resolveRepository(syncContext, workspaceSlug, repoSlug, accessToken)

    let state = decodeCursor(cursor, phases[0])
    if (!phases.includes(state.phase)) state = { phase: phases[0] }

    /** Cursor that advances to the first page of the phase after `current`, if any. */
    const advance = (current: SyncPhase): { nextCursor?: string; hasMore: boolean } => {
      const next = nextPhase(current, choice)
      if (!next) return { hasMore: false }
      return { nextCursor: encodeCursor({ phase: next }), hasMore: true }
    }

    /**
     * Cursor that stays in the code phase to walk the next frontier directory.
     * Falls through to the following phase when the frontier is empty, or when
     * there is no syncContext to carry it — see {@link pendingDirectories}.
     * Checking the frontier here matters on the skip paths (a timed-out or absent
     * directory): claiming `hasMore` with nothing left to walk costs the sync
     * engine a whole extra listing round-trip that can only return zero documents.
     */
    const continueCode = (frontier: string[]): { nextCursor?: string; hasMore: boolean } =>
      syncContext && frontier.length > 0
        ? { nextCursor: encodeCursor({ phase: 'code' }), hasMore: true }
        : advance('code')

    if (state.phase === 'code') {
      const { commit, ref } = await resolveCommit(
        sourceConfig,
        syncContext,
        repository,
        workspaceSlug,
        repoSlug,
        accessToken
      )
      const pathPrefix = normalizePathPrefix(sourceConfig.pathPrefix)
      const extSet = parseExtensions(sourceConfig.fileExtensions)
      const frontier = pendingDirectories(syncContext)

      let url: string
      let dir: string
      let requestedDepth: number
      /** Depth-1 retry target, offered only for URLs this connector built itself. */
      let shallowUrl: string | undefined
      if (state.nextUrl) {
        dir = state.dir ?? ''
        requestedDepth = state.depth ?? MAX_TREE_DEPTH
        const encodedDir = encodeBitbucketRepositoryPath(dir, true)
        const repositoryPath = bitbucketRepositoryPath(workspaceSlug, repoSlug)
        url = bitbucketApiUrl(
          `${repositoryPath}/src/${encodeBitbucketSegment(commit, 'commit')}/${encodedDir}`,
          {
            nextUrl: state.nextUrl,
            nextPathPrefix: `${repositoryPath}/src`,
            nextPathSuffix: encodedDir,
            nextRevision: commit,
          }
        )
      } else {
        const nextDir = frontier.shift()
        if (nextDir === undefined) {
          const adv = advance('code')
          return {
            documents: [],
            nextCursor: adv.nextCursor,
            hasMore: adv.hasMore,
          }
        }
        dir = nextDir
        requestedDepth = MAX_TREE_DEPTH
        url = sourceListingUrl(workspaceSlug, repoSlug, commit, dir, requestedDepth)
        shallowUrl = sourceListingUrl(workspaceSlug, repoSlug, commit, dir, 1)
      }

      logger.info('Listing Bitbucket repository files', {
        repository: repository.fullName,
        ref,
        dir,
        continued: Boolean(state.nextUrl),
      })

      const { response, depth } = await fetchSourceListing(
        url,
        requestedDepth,
        accessToken,
        shallowUrl
      )
      if (!response.ok) {
        if (response.status === 555) {
          /**
           * The walk still timed out after the depth-1 fallback, or timed out on a
           * `next` link that cannot be re-cut at a shallower depth. Either way this
           * directory is unlistable on this run: its subtree is skipped and the
           * listing is flagged incomplete so reconciliation cannot read the missing
           * files as deletions. The rest of the frontier is still walked.
           */
          logger.warn('Bitbucket source listing timed out; skipping directory', {
            repository: repository.fullName,
            dir,
          })
          markListingIncomplete(syncContext)
          const skipped = continueCode(frontier)
          return {
            documents: [],
            nextCursor: skipped.nextCursor,
            hasMore: skipped.hasMore,
          }
        }
        if (response.status === 404) {
          /**
           * Every directory was discovered at the same pinned commit, so a later 404
           * is an inconsistent partial listing rather than evidence that documents
           * were deleted. Keep walking, but block deletion reconciliation.
           */
          logger.warn('Bitbucket source path not found; skipping', {
            repository: repository.fullName,
            dir,
          })
          markListingIncomplete(syncContext)
          const skipped = continueCode(frontier)
          return {
            documents: [],
            nextCursor: skipped.nextCursor,
            hasMore: skipped.hasMore,
          }
        }
        if (response.status === 401 || response.status === 403) {
          throw new Error(
            `Bitbucket authorization failed while listing repository files: ${response.status}`
          )
        }
        const errorText = await response.text().catch(() => '')
        logger.error('Failed to list Bitbucket repository files', {
          status: response.status,
          error: errorText.slice(0, 500),
        })
        throw new Error(`Failed to list Bitbucket repository files: ${response.status}`)
      }

      const page = parsePagedResponse<BitbucketTreeEntry>(await response.json(), 'source listing')
      const entries = page.values
      const dirDepth = pathDepth(dir)
      const documents: ExternalDocument[] = []

      for (const entry of entries) {
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
          logger.warn('Skipping malformed Bitbucket source entry', {
            repository: repository.fullName,
            dir,
          })
          markListingIncomplete(syncContext)
          continue
        }
        const path = typeof entry.path === 'string' ? entry.path : ''
        if (!path) {
          logger.warn('Skipping Bitbucket source entry without a path', {
            repository: repository.fullName,
            dir,
          })
          markListingIncomplete(syncContext)
          continue
        }

        if (entry.type === 'commit_directory') {
          /**
           * A `max_depth` walk returns intermediate directories as well as the ones
           * it stopped at, so only the frontier — directories at the depth this
           * response actually reached — is queued. Anything shallower was already
           * expanded in this same response.
           */
          if (pathDepth(path) - dirDepth < depth) continue
          if (!directoryMayContainPrefix(path, pathPrefix)) continue
          frontier.push(path)
          continue
        }

        if (entry.type !== 'commit_file') {
          logger.warn('Skipping Bitbucket source entry with an unknown type', {
            repository: repository.fullName,
            dir,
            type: entry.type,
          })
          markListingIncomplete(syncContext)
          continue
        }

        const attributes = entryAttributes(entry)
        if (attributes.has('binary') || attributes.has('link') || attributes.has('subrepository')) {
          continue
        }
        if (pathPrefix && !path.startsWith(pathPrefix)) continue
        if (!matchesExtension(path, extSet)) continue

        documents.push(
          stubOrSkipBySize(
            fileToStub(repository, ref, commit, path, entry.size),
            entry.size,
            MAX_FILE_SIZE
          )
        )
      }

      const { documents: capped, capped: hitLimit } = applyMaxItemsCap(
        documents,
        maxItems,
        syncContext,
        Boolean(page.next) || frontier.length > 0 || Boolean(nextPhase('code', choice))
      )
      if (hitLimit) return { documents: capped, hasMore: false }

      if (page.next) {
        return {
          documents: capped,
          nextCursor: encodeCursor({
            phase: 'code',
            nextUrl: page.next,
            dir,
            depth,
          }),
          hasMore: true,
        }
      }
      const cont = continueCode(frontier)
      return {
        documents: capped,
        nextCursor: cont.nextCursor,
        hasMore: cont.hasMore,
      }
    }

    let url: string
    if (state.nextUrl) {
      url = bitbucketApiUrl(`${bitbucketRepositoryPath(workspaceSlug, repoSlug)}/pullrequests`, {
        nextUrl: state.nextUrl,
      })
    } else {
      const prUrl = new URL(repositoryUrl(workspaceSlug, repoSlug, '/pullrequests'))
      prUrl.searchParams.set('pagelen', String(PULL_REQUEST_PAGE_SIZE))
      prUrl.searchParams.set('fields', PULL_REQUEST_LIST_FIELDS)
      prUrl.searchParams.set('sort', PULL_REQUEST_SORT)
      for (const prState of pullRequestStates(sourceConfig)) {
        prUrl.searchParams.append('state', prState)
      }
      if (lastSyncAt) {
        /**
         * The filtering reference is explicit that the paginated envelope's
         * `values.` prefix must not appear in a query field, so the field is
         * named bare even though the partial response above addresses nested
         * fields under `values`.
         */
        prUrl.searchParams.set('q', `updated_on > ${bbqlDateTime(lastSyncAt)}`)
      }
      url = prUrl.toString()
    }

    logger.info('Listing Bitbucket pull requests', {
      repository: repository.fullName,
      continued: Boolean(state.nextUrl),
      incremental: Boolean(lastSyncAt),
    })

    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: authHeaders(accessToken),
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      logger.error('Failed to list Bitbucket pull requests', {
        status: response.status,
        error: errorText.slice(0, 500),
      })
      throw new Error(`Failed to list Bitbucket pull requests: ${response.status}`)
    }

    const page = parsePagedResponse<BitbucketPullRequest>(
      await response.json(),
      'pull request listing'
    )
    const documents: ExternalDocument[] = []
    for (const pullRequest of page.values) {
      const doc = pullRequestToDocument(repository, pullRequest)
      if (doc) {
        documents.push(doc)
      } else {
        logger.warn('Skipping malformed Bitbucket pull request', {
          repository: repository.fullName,
        })
        markListingIncomplete(syncContext)
      }
    }

    const { documents: capped, capped: hitLimit } = applyMaxItemsCap(
      documents,
      maxItems,
      syncContext,
      Boolean(page.next)
    )
    if (hitLimit) return { documents: capped, hasMore: false }

    if (page.next) {
      return {
        documents: capped,
        nextCursor: encodeCursor({ phase: 'pullrequests', nextUrl: page.next }),
        hasMore: true,
      }
    }
    return { documents: capped, hasMore: false }
  },

  getDocument: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    externalId: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocument | null> => {
    const workspaceSlug = readSlug(sourceConfig.workspaceSlug)
    const repoSlug = readSlug(sourceConfig.repoSlug)
    if (!workspaceSlug || !repoSlug || !externalId) return null

    try {
      const repository = await resolveRepository(syncContext, workspaceSlug, repoSlug, accessToken)

      if (externalId.startsWith(PULL_REQUEST_PREFIX)) {
        const rawId = externalId.slice(PULL_REQUEST_PREFIX.length)
        const id = Number(rawId)
        if (!rawId || !Number.isSafeInteger(id) || id < 1) return null

        const response = await fetchWithRetry(
          repositoryUrl(workspaceSlug, repoSlug, `/pullrequests/${id}`),
          { method: 'GET', headers: authHeaders(accessToken) }
        )
        if (!response.ok) {
          if (response.status === 404) return null
          throw new Error(`Failed to fetch Bitbucket pull request: ${response.status}`)
        }
        const document = pullRequestToDocument(
          repository,
          (await response.json()) as BitbucketPullRequest
        )
        if (!document) {
          throw new Error(`Bitbucket pull request ${id} response was malformed`)
        }
        return document
      }

      if (!externalId.startsWith(FILE_PREFIX)) return null

      const path = externalId.slice(FILE_PREFIX.length)
      if (!path) return null

      const { commit, ref } = await resolveCommit(
        sourceConfig,
        syncContext,
        repository,
        workspaceSlug,
        repoSlug,
        accessToken
      )
      const response = await fetchWithRetry(sourceFileUrl(workspaceSlug, repoSlug, commit, path), {
        method: 'GET',
        headers: authHeaders(accessToken, false),
        /**
         * LFS files answer with a 301 to Atlassian media services. Following it
         * would drop the bearer token (cross-origin) and, on success, would store
         * an opaquely redirected body, so the redirect is surfaced instead.
         */
        redirect: 'manual',
      })

      if (response.status === 404) return null

      const stub = fileToStub(repository, ref, commit, path, undefined)

      if (response.status === 301) {
        logger.info('Skipping Bitbucket LFS-managed file', { path })
        return markSkipped(stub, LFS_SKIP_REASON)
      }
      if (!response.ok) {
        throw new Error(`Failed to fetch Bitbucket file ${path}: ${response.status}`)
      }

      const buffer = await readBodyWithLimit(response, MAX_FILE_SIZE)
      if (buffer === null) {
        logger.info('Skipping oversized Bitbucket file', {
          path,
          limit: MAX_FILE_SIZE,
        })
        return markSkipped(stub, sizeLimitSkipReason(MAX_FILE_SIZE))
      }
      if (isBinaryBuffer(buffer)) {
        logger.info('Skipping binary Bitbucket file', { path })
        return markSkipped(stub, BINARY_SKIP_REASON)
      }

      let text: string
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
      } catch {
        logger.info('Skipping non-UTF-8 Bitbucket file', { path })
        return markSkipped(stub, NON_UTF8_SKIP_REASON)
      }

      const body = composeBody(stub.title, text)
      if (!body.trim()) return null

      return {
        ...stub,
        content: body,
        contentDeferred: false,
        metadata: { ...stub.metadata, size: buffer.byteLength },
      }
    } catch (error) {
      /**
       * Only the 404 checks above (and an unrecognized externalId prefix) mean the
       * object is genuinely gone. Every other failure is rethrown so the sync engine
       * records a visible `docsFailed` row — returning `null` would report a
       * transient Bitbucket fault as success, silently counting an already-indexed
       * document as unchanged and dropping a new one from the run entirely.
       */
      logger.warn(`Failed to fetch Bitbucket document ${externalId}`, {
        error: toError(error).message,
      })
      throw toError(error)
    }
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const workspaceSlug = readSlug(sourceConfig.workspaceSlug)
    if (!workspaceSlug) return { valid: false, error: 'Workspace is required' }

    const repoSlug = readSlug(sourceConfig.repoSlug)
    if (!repoSlug) return { valid: false, error: 'Repository is required' }

    try {
      readMaxItems(sourceConfig.maxItems)
    } catch (error) {
      return {
        valid: false,
        error: getErrorMessage(error, 'Max items must be a positive integer'),
      }
    }

    const choice = getContentTypeChoice(sourceConfig)

    try {
      const response = await fetchRepository(
        workspaceSlug,
        repoSlug,
        accessToken,
        VALIDATE_RETRY_OPTIONS
      )

      if (response.status === 404) {
        return {
          valid: false,
          error: `Repository "${workspaceSlug}/${repoSlug}" not found`,
        }
      }
      if (response.status === 401 || response.status === 403) {
        return {
          valid: false,
          error: 'Invalid credential or insufficient permissions',
        }
      }
      if (!response.ok) {
        return {
          valid: false,
          error: `Cannot access repository: ${response.status}`,
        }
      }

      const record = (await response.json()) as BitbucketRepositoryRecord
      const configuredRef = typeof sourceConfig.ref === 'string' ? sourceConfig.ref.trim() : ''

      if (activePhases(choice).includes('code')) {
        if (!configuredRef && !record.mainbranch?.name?.trim()) {
          return {
            valid: false,
            error: 'Repository has no default branch; set a branch or tag explicitly',
          }
        }
        if (configuredRef) {
          const hash = await resolveRefHash(
            workspaceSlug,
            repoSlug,
            configuredRef,
            accessToken,
            VALIDATE_RETRY_OPTIONS
          )
          if (!hash) {
            return {
              valid: false,
              error: `Branch or tag "${configuredRef}" not found in "${workspaceSlug}/${repoSlug}"`,
            }
          }
        }
      }

      return { valid: true }
    } catch (error) {
      return {
        valid: false,
        error: getErrorMessage(error, 'Failed to validate configuration'),
      }
    }
  },

  /**
   * Maps document metadata to tag slots. `contentType`, `title`, and `repository`
   * apply to every document type. `path`/`size` are repository-file-only and
   * `state`/`author`/`createdAt`/`updatedAt` are pull-request-only; each document
   * type leaves the others' fields empty and the guards below skip them.
   */
  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    for (const key of ['contentType', 'title', 'repository', 'path', 'state', 'author'] as const) {
      const value = metadata[key]
      if (typeof value === 'string' && value.trim()) result[key] = value
    }

    if (metadata.size != null) {
      const size = Number(metadata.size)
      if (!Number.isNaN(size)) result.size = size
    }

    const createdAt = parseTagDate(metadata.createdAt)
    if (createdAt) result.createdAt = createdAt

    const updatedAt = parseTagDate(metadata.updatedAt)
    if (updatedAt) result.updatedAt = updatedAt

    return result
  },
}
