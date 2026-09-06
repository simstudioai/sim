import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { isPlainRecord } from '@sim/utils/object'
import type { SecureFetchResponse } from '@/lib/core/security/input-validation.server'
import { secureFetchWithRetry } from '@/lib/knowledge/documents/secure-fetch.server'
import { VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import { gitlabConnectorMeta } from '@/connectors/gitlab/meta'
import {
  getGitLabDocumentAcls,
  openGitLabDirectory,
  validateGitLabPermissionToken,
} from '@/connectors/gitlab/permissions'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import {
  BoundedLines,
  CONNECTOR_MAX_FILE_BYTES,
  CONNECTOR_TEXT_DOCUMENT_MAX_BYTES,
  ConnectorFileTooLargeError,
  computeContentHash,
  joinTagArray,
  markSkipped,
  parseTagDate,
  sizeLimitSkipReason,
} from '@/connectors/utils'
import { normalizeGitLabHost, UnsafeGitLabHostError } from '@/tools/gitlab/utils'

const logger = createLogger('GitLabConnector')

const PAGE_SIZE = 100
/** Max repository file size to index. Larger blobs are skipped. */
const MAX_FILE_SIZE = CONNECTOR_MAX_FILE_BYTES
/** Bytes sniffed for NUL when detecting binary files (matches git's heuristic). */
const BINARY_SNIFF_BYTES = 8000

/**
 * Prefix encoded into each document's externalId so getDocument can route to the
 * correct GitLab resource. Wiki pages are addressed by slug, issues by iid, and
 * repository files by their repo-relative path.
 */
const WIKI_PREFIX = 'wiki:'
const ISSUE_PREFIX = 'issue:'
const FILE_PREFIX = 'file:'
const MERGE_REQUEST_PREFIX = 'merge_request:'
const MAX_COMMENT_PAGES = 200
const MAX_METADATA_RESPONSE_BYTES = 16 * 1024 * 1024

/**
 * Selects which GitLab resources to sync. `repo` = repository files (code/docs),
 * `all` = repo + wiki + issues + merge requests. `both` is retained for backward compatibility and
 * means wiki + issues (no repository files).
 */
type ContentTypeChoice = 'repo' | 'wiki' | 'issues' | 'merge_requests' | 'both' | 'all'

/** Listing phases, walked in order: repository files, wiki, issues, merge requests. */
type SyncPhase = 'repo' | 'wiki' | 'issues' | 'merge_requests'

interface GitLabTreeEntry {
  id: string
  name: string
  type: 'blob' | 'tree'
  path: string
  mode?: string
}

interface GitLabFile {
  file_path?: string
  blob_id?: string
  content?: string
  encoding?: string
  size?: number
}

/**
 * Heuristic binary detection: a NUL byte in the first 8 KB marks the file as
 * binary, matching `git diff` / `git grep` semantics.
 */
function isBinaryBuffer(buf: Buffer): boolean {
  const len = Math.min(buf.length, BINARY_SNIFF_BYTES)
  for (let i = 0; i < len; i++) {
    if (buf[i] === 0) return true
  }
  return false
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
 */
function matchesExtension(filePath: string, extSet: Set<string> | null): boolean {
  if (!extSet) return true
  const lastDot = filePath.lastIndexOf('.')
  if (lastDot === -1) return false
  return extSet.has(filePath.slice(lastDot).toLowerCase())
}

/**
 * Extracts the full `rel="next"` URL from a keyset-pagination `Link` response
 * header. GitLab's guidance is to follow this link verbatim rather than rebuild
 * the URL, so the connector stores and re-fetches it as-is — this is robust to
 * whichever continuation parameter the endpoint uses (`page_token`, `cursor`,
 * `id_after`, …). Returns undefined when there is no next page.
 */
function parseNextLink(linkHeader: string | null): string | undefined {
  if (!linkHeader) return undefined
  for (const part of linkHeader.split(',')) {
    if (!/rel="?next"?/i.test(part)) continue
    const urlMatch = part.match(/<([^>]+)>/)
    if (urlMatch) return urlMatch[1]
  }
  return undefined
}

/**
 * Issues a listing GET, transparently downgrading to offset pagination when the
 * GitLab instance rejects keyset pagination.
 *
 * Keyset support is per-resource and version-gated — GitLab's documented
 * pagination table records the repository tree gaining it in 17.1 and project
 * issues only in 18.3 — so self-managed hosts on an older release would fail the
 * whole sync. The request is therefore retried once without `pagination=keyset`;
 * offset pagination emits the same `Link: rel="next"` header the caller already
 * follows, so nothing downstream changes.
 *
 * The `405` trigger is NOT documented. It comes from GitLab's own
 * `lib/api/helpers/pagination_strategies.rb`, which raises
 * `error!('Keyset pagination is not yet available for this type of request', 405)`
 * when the relation/order combination has no keyset strategy. Treat it as
 * observed behavior that could change without a docs-visible deprecation; the
 * fallback is written to be a no-op when the URL carries no `pagination` param,
 * so an unrelated 405 is passed straight through.
 */
async function fetchListing(url: string, accessToken: string): Promise<SecureFetchResponse> {
  const response = await secureFetchWithRetry(url, {
    profile: 'configuredEndpoint',
    method: 'GET',
    headers: authHeaders(accessToken),
    maxResponseBytes: MAX_METADATA_RESPONSE_BYTES,
  })
  if (response.status !== 405) return response

  let offsetUrl: string
  try {
    const parsed = new URL(url)
    if (!parsed.searchParams.has('pagination')) return response
    parsed.searchParams.delete('pagination')
    offsetUrl = parsed.toString()
  } catch {
    return response
  }

  logger.warn('GitLab rejected keyset pagination; retrying with offset pagination', { url })
  return secureFetchWithRetry(offsetUrl, {
    profile: 'configuredEndpoint',
    method: 'GET',
    headers: authHeaders(accessToken),
    maxResponseBytes: MAX_METADATA_RESPONSE_BYTES,
  })
}

/**
 * Returns the ordered list of active sync phases for a content-type choice.
 */
function activePhases(choice: ContentTypeChoice): SyncPhase[] {
  const phases: SyncPhase[] = []
  if (choice === 'repo' || choice === 'all') phases.push('repo')
  if (choice === 'wiki' || choice === 'both' || choice === 'all') phases.push('wiki')
  if (choice === 'issues' || choice === 'both' || choice === 'all') phases.push('issues')
  if (choice === 'merge_requests' || choice === 'all') phases.push('merge_requests')
  return phases
}

/**
 * Returns the phase following `current` for a choice, or undefined when `current`
 * is the last active phase.
 */
function nextPhase(current: SyncPhase, choice: ContentTypeChoice): SyncPhase | undefined {
  const phases = activePhases(choice)
  const idx = phases.indexOf(current)
  return idx >= 0 && idx + 1 < phases.length ? phases[idx + 1] : undefined
}

interface GitLabWikiPage {
  slug: string
  title?: string
  format?: string
  content?: string
  encoding?: string
}

interface GitLabUser {
  id?: number
  username?: string
  name?: string
}

interface GitLabMilestone {
  title?: string
}

interface GitLabIssue {
  iid: number
  title?: string
  description?: string | null
  state?: string
  labels?: string[]
  author?: GitLabUser | null
  assignees?: GitLabUser[] | null
  milestone?: GitLabMilestone | null
  updated_at?: string
  created_at?: string
  web_url?: string
  confidential?: boolean
}

interface GitLabProject {
  id: number
  path_with_namespace?: string
  web_url?: string
  default_branch?: string
  wiki_access_level?: string
  wiki_enabled?: boolean
}

/**
 * Normalizes the host config value via the shared GitLab host normalizer:
 * trims, strips any protocol prefix and trailing slashes, rejects structurally
 * unsafe hosts (userinfo, whitespace, embedded path), and falls back to
 * gitlab.com when empty. Shared with the GitLab tools and webhook provider so
 * every surface resolves and validates hosts identically.
 *
 * @throws {UnsafeGitLabHostError} when a non-empty host is structurally unsafe.
 */
function normalizeHost(rawHost: unknown): string {
  return normalizeGitLabHost(rawHost)
}

/**
 * Builds the REST API v4 base URL for the configured host.
 */
function buildApiBase(host: string): string {
  return `https://${host}/api/v4`
}

/**
 * Returns the encoded project identifier (numeric ID or URL-encoded path).
 * GitLab accepts a numeric ID or the URL-encoded `group/project` path.
 *
 * Decoding first makes `group/project` and an already-encoded
 * `group%2Fproject` converge on the same single-encoded result — without it a
 * pasted `%2F` becomes `%252F`, which GitLab decodes once to the literal string
 * `%2F` and the project lookup 404s. Mirrors `encodeGitLabResourceId` in the
 * GitLab tools.
 */
function encodeProjectId(project: unknown): string {
  const raw = String(project ?? '').trim()
  let decoded = raw
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    // Not a valid percent-encoding (e.g. a bare `%`) — treat as already raw.
  }
  return encodeURIComponent(decoded)
}

/**
 * Reads the parsed content-type choice from sourceConfig (defaults to 'both').
 */
function getContentTypeChoice(sourceConfig: Record<string, unknown>): ContentTypeChoice {
  const value = typeof sourceConfig.contentTypes === 'string' ? sourceConfig.contentTypes : 'both'
  if (
    value === 'repo' ||
    value === 'wiki' ||
    value === 'issues' ||
    value === 'merge_requests' ||
    value === 'both' ||
    value === 'all'
  ) {
    return value
  }
  return 'both'
}

/**
 * Standard request headers carrying the Personal Access Token.
 */
function authHeaders(accessToken: string): Record<string, string> {
  return {
    'PRIVATE-TOKEN': accessToken,
    Accept: 'application/json',
  }
}

/** Wiki title and body both participate in change detection after deferred hydration. */
async function buildWikiContentHash(
  projectId: string,
  slug: string,
  body: string
): Promise<string> {
  return `gitlab:wiki:${projectId}:${slug}:${await computeContentHash(body)}`
}

/** A per-run stub hash forces comment refresh without assuming parent timestamp semantics. */
function listingToken(syncContext?: Record<string, unknown>): string {
  if (typeof syncContext?.syncRunId === 'string') return syncContext.syncRunId
  if (typeof syncContext?._gitlabListingToken === 'string') return syncContext._gitlabListingToken
  const token = generateId()
  if (syncContext) syncContext._gitlabListingToken = token
  return token
}

/**
 * Builds the change-detection hash for a repository file. The git blob SHA is
 * content-addressable, so it changes exactly when the file content changes — and
 * it is available both on the tree listing (`tree entry.id`) and the file fetch
 * (`blob_id`), so the stub and hydrated document hash identically without a
 * content fetch during listing.
 */
function buildFileContentHash(projectId: string, path: string, blobSha: string): string {
  return `gitlab:file:${projectId}:${path}:${blobSha}`
}

/**
 * Builds the web UI URL for a repository file at a given ref.
 */
function buildFileSourceUrl(
  apiBase: string,
  encodedProject: string,
  host: string,
  projectPath: string,
  ref: string,
  path: string
): string {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/')
  if (projectPath) {
    const encodedRef = ref.split('/').map(encodeURIComponent).join('/')
    return `https://${host}/${projectPath}/-/blob/${encodedRef}/${encodedPath}`
  }
  return `${apiBase}/projects/${encodedProject}/repository/files/${encodeURIComponent(path)}/raw?ref=${encodeURIComponent(ref)}`
}

/**
 * Builds a deferred stub for a repository file from a tree entry. Content is empty
 * and fetched lazily via getDocument for new/changed files only.
 */
function treeEntryToStub(
  apiBase: string,
  encodedProject: string,
  host: string,
  projectPath: string,
  ref: string,
  entry: GitLabTreeEntry
): ExternalDocument {
  return {
    externalId: `${FILE_PREFIX}${entry.path}`,
    title: entry.name || entry.path,
    content: '',
    contentDeferred: true,
    mimeType: 'text/plain',
    sourceUrl: buildFileSourceUrl(apiBase, encodedProject, host, projectPath, ref, entry.path),
    contentHash: buildFileContentHash(encodedProject, entry.path, entry.id),
    metadata: {
      contentType: 'file',
      title: entry.name || entry.path,
      path: entry.path,
    },
  }
}

/**
 * Builds a repository-file document from a fetched (non-raw) file response. Returns
 * null for binary, oversized, or empty files so they are not indexed.
 */
function fileToDocument(
  apiBase: string,
  encodedProject: string,
  host: string,
  projectPath: string,
  ref: string,
  path: string,
  file: GitLabFile
): ExternalDocument | null {
  const blobSha = file.blob_id?.trim()
  if (!blobSha) return null

  const title = path.split('/').pop() || path
  /**
   * Returns the file as an explicitly skipped document rather than dropping it.
   * A dropped (`null`) file is never stored, so the next sync lists it again and
   * re-downloads the same blob forever; a skipped document carries the blob-SHA
   * hash, so it surfaces once as a failed row and is not re-fetched until the
   * file actually changes.
   */
  const skipped = (reason: string, size: number): ExternalDocument =>
    markSkipped(
      {
        externalId: `${FILE_PREFIX}${path}`,
        title,
        content: '',
        mimeType: 'text/plain',
        sourceUrl: buildFileSourceUrl(apiBase, encodedProject, host, projectPath, ref, path),
        contentHash: buildFileContentHash(encodedProject, path, blobSha),
        metadata: { contentType: 'file', title, path, size },
      },
      reason
    )

  if (typeof file.size === 'number' && file.size > MAX_FILE_SIZE) {
    logger.info('Skipping oversized GitLab file', { path, size: file.size })
    return skipped(sizeLimitSkipReason(MAX_FILE_SIZE), file.size)
  }

  const raw = typeof file.content === 'string' ? file.content : ''
  const buffer = file.encoding === 'base64' ? Buffer.from(raw, 'base64') : Buffer.from(raw, 'utf8')
  if (isBinaryBuffer(buffer)) {
    logger.info('Skipping binary GitLab file', { path })
    return skipped('Binary file was not indexed', buffer.byteLength)
  }
  if (buffer.byteLength > MAX_FILE_SIZE) {
    logger.info('Skipping oversized GitLab file', { path, size: buffer.byteLength })
    return skipped(sizeLimitSkipReason(MAX_FILE_SIZE), buffer.byteLength)
  }

  const content = buffer.toString('utf8')
  const body = composeBody(title, content)
  if (!body.trim()) return null

  return {
    externalId: `${FILE_PREFIX}${path}`,
    title,
    content: body,
    contentDeferred: false,
    mimeType: 'text/plain',
    sourceUrl: buildFileSourceUrl(apiBase, encodedProject, host, projectPath, ref, path),
    contentHash: buildFileContentHash(encodedProject, path, blobSha),
    metadata: {
      contentType: 'file',
      title,
      path,
      size: buffer.byteLength,
    },
  }
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
 * Builds a wiki page document (full content) from a fetched page.
 */
async function wikiPageToDocument(
  apiBase: string,
  encodedProject: string,
  host: string,
  projectPath: string,
  page: GitLabWikiPage
): Promise<ExternalDocument | null> {
  const content = typeof page.content === 'string' ? page.content : ''
  const title = page.title?.trim() || page.slug
  const body = composeBody(title, content)
  if (!body.trim()) return null
  if (Buffer.byteLength(body, 'utf8') > CONNECTOR_TEXT_DOCUMENT_MAX_BYTES) {
    throw new ConnectorFileTooLargeError(CONNECTOR_TEXT_DOCUMENT_MAX_BYTES)
  }

  const contentHash = await buildWikiContentHash(encodedProject, page.slug, body)

  return {
    externalId: `${WIKI_PREFIX}${page.slug}`,
    title,
    content: body,
    contentDeferred: false,
    mimeType: 'text/plain',
    sourceUrl: projectPath
      ? `https://${host}/${projectPath}/-/wikis/${page.slug}`
      : `${apiBase}/projects/${encodedProject}/wikis/${page.slug}`,
    contentHash,
    metadata: {
      contentType: 'wiki',
      title,
      slug: page.slug,
    },
  }
}

type WorkItemKind = 'issue' | 'merge_request'

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function readUser(value: unknown): GitLabUser | undefined {
  if (!isPlainRecord(value)) return undefined
  return {
    id: typeof value.id === 'number' ? value.id : undefined,
    name: optionalString(value.name),
    username: optionalString(value.username),
  }
}

/** Do not let malformed provider collections masquerade as complete empty listings. */
function readWorkItem(value: unknown): GitLabIssue {
  if (!isPlainRecord(value) || !Number.isSafeInteger(value.iid) || Number(value.iid) <= 0) {
    throw new Error('GitLab returned an invalid issue or merge request')
  }
  return {
    iid: Number(value.iid),
    title: optionalString(value.title),
    description: optionalString(value.description),
    state: optionalString(value.state),
    labels: Array.isArray(value.labels)
      ? value.labels.filter((label): label is string => typeof label === 'string')
      : [],
    author: readUser(value.author),
    assignees: Array.isArray(value.assignees)
      ? value.assignees.map(readUser).filter((user): user is GitLabUser => user !== undefined)
      : [],
    milestone: isPlainRecord(value.milestone)
      ? { title: optionalString(value.milestone.title) }
      : undefined,
    updated_at: optionalString(value.updated_at),
    created_at: optionalString(value.created_at),
    web_url: optionalString(value.web_url),
    confidential: typeof value.confidential === 'boolean' ? value.confidential : undefined,
  }
}

function readWorkItems(value: unknown): GitLabIssue[] {
  if (!Array.isArray(value) || value.length > PAGE_SIZE) {
    throw new Error('GitLab returned an invalid work item collection')
  }
  return value.map(readWorkItem)
}

function readWikiPages(value: unknown): GitLabWikiPage[] {
  if (!Array.isArray(value)) throw new Error('GitLab returned an invalid wiki collection')
  return value.map((page) => {
    if (!isPlainRecord(page) || typeof page.slug !== 'string' || !page.slug) {
      throw new Error('GitLab returned an invalid wiki page')
    }
    return {
      slug: page.slug,
      title: optionalString(page.title),
      content: optionalString(page.content),
    }
  })
}

/** Continuations must remain on the same collection before forwarding a PAT. */
function continuationUrl(candidate: string | undefined, initial: string): string {
  if (!candidate) return initial
  const parsed = new URL(candidate)
  const expected = new URL(initial)
  if (
    parsed.origin !== expected.origin ||
    parsed.pathname !== expected.pathname ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error('GitLab pagination cursor points to an unexpected collection')
  }
  return candidate
}

function checkedNextLink(response: SecureFetchResponse, current: string): string | undefined {
  let next = parseNextLink(response.headers.get('link'))
  const nextPage = response.headers.get('x-next-page')
  if (!next && nextPage) {
    if (!/^\d+$/.test(nextPage) || Number(nextPage) <= 0) {
      throw new Error('GitLab returned an invalid pagination header')
    }
    const parsed = new URL(current)
    parsed.searchParams.set('page', nextPage)
    next = parsed.toString()
  }
  if (!next) return undefined
  continuationUrl(next, current)
  if (next === current) throw new Error('GitLab repeated a pagination cursor')
  return next
}

/** Parent timestamps cannot prove comments unchanged; hydrated body hashes handle edits and deletions. */
function workItemToStub(
  encodedProject: string,
  host: string,
  projectPath: string,
  item: GitLabIssue,
  kind: WorkItemKind,
  syncContext?: Record<string, unknown>
): ExternalDocument {
  const title =
    item.title?.trim() || `${kind === 'issue' ? 'Issue #' : 'Merge Request !'}${item.iid}`
  const resource = kind === 'issue' ? 'issues' : 'merge_requests'
  return {
    externalId: `${kind === 'issue' ? ISSUE_PREFIX : MERGE_REQUEST_PREFIX}${item.iid}`,
    title,
    content: '',
    contentDeferred: true,
    estimatedBytes: CONNECTOR_TEXT_DOCUMENT_MAX_BYTES,
    mimeType: 'text/plain',
    sourceUrl:
      item.web_url ||
      (projectPath ? `https://${host}/${projectPath}/-/${resource}/${item.iid}` : undefined),
    contentHash: `gitlab:${kind}:listing:v2:${encodedProject}:${item.iid}:${listingToken(syncContext)}`,
    metadata: {
      contentType: kind,
      title,
      iid: item.iid,
      confidential: item.confidential,
      authorId: item.author?.id,
      assigneeIds:
        item.assignees?.map((assignee) => assignee.id).filter((id) => id !== undefined) ?? [],
      state: item.state,
      author: item.author?.username?.trim() || item.author?.name?.trim() || '',
      labels: item.labels ?? [],
      milestone: item.milestone?.title?.trim() || '',
      createdAt: item.created_at ?? '',
      updatedAt: item.updated_at ?? item.created_at ?? '',
    },
  }
}

/** Notes share their parent audience only when neither internal nor confidential. */
async function hydrateWorkItem(
  accessToken: string,
  apiBase: string,
  encodedProject: string,
  host: string,
  projectPath: string,
  item: GitLabIssue,
  kind: WorkItemKind
): Promise<ExternalDocument> {
  const doc = workItemToStub(encodedProject, host, projectPath, item, kind)
  const lines = new BoundedLines(CONNECTOR_TEXT_DOCUMENT_MAX_BYTES)
  if (!lines.push(composeBody(doc.title, item.description ?? ''))) {
    throw new ConnectorFileTooLargeError(CONNECTOR_TEXT_DOCUMENT_MAX_BYTES)
  }
  const resource = kind === 'issue' ? 'issues' : 'merge_requests'
  let url: string | undefined =
    `${apiBase}/projects/${encodedProject}/${resource}/${item.iid}/notes?per_page=${PAGE_SIZE}&sort=asc&order_by=created_at`
  const visited = new Set<string>()
  const noteIds = new Set<number>()
  while (url) {
    if (visited.has(url) || visited.size >= MAX_COMMENT_PAGES) {
      throw new Error('GitLab comments could not be completely paginated')
    }
    visited.add(url)
    const response = await secureFetchWithRetry(url, {
      profile: 'configuredEndpoint',
      method: 'GET',
      headers: authHeaders(accessToken),
      maxResponseBytes: MAX_METADATA_RESPONSE_BYTES,
    })
    if (!response.ok) throw new Error(`Failed to fetch GitLab ${kind} comments: ${response.status}`)
    const notes: unknown = await response.json()
    if (!Array.isArray(notes) || notes.length > PAGE_SIZE) {
      throw new Error('GitLab returned an invalid comment collection')
    }
    for (const note of notes) {
      if (
        !isPlainRecord(note) ||
        !Number.isSafeInteger(note.id) ||
        Number(note.id) <= 0 ||
        typeof note.body !== 'string' ||
        typeof note.system !== 'boolean' ||
        (note.internal !== undefined && typeof note.internal !== 'boolean') ||
        (note.confidential !== undefined && typeof note.confidential !== 'boolean')
      ) {
        throw new Error('GitLab returned an invalid comment')
      }
      const noteId = Number(note.id)
      if (noteIds.has(noteId)) throw new Error('GitLab repeated a comment during pagination')
      noteIds.add(noteId)
      if (note.system || note.internal || note.confidential) continue
      const author = readUser(note.author)
      const label = author?.name || author?.username || 'Unknown author'
      const link = doc.sourceUrl ? `${doc.sourceUrl}#note_${noteId}` : `Comment ${noteId}`
      if (!lines.push('', `${label} (${optionalString(note.created_at) ?? ''})`, link, note.body)) {
        throw new ConnectorFileTooLargeError(CONNECTOR_TEXT_DOCUMENT_MAX_BYTES)
      }
    }
    url = checkedNextLink(response, url)
  }
  const content = lines.join()
  return {
    ...doc,
    content,
    contentDeferred: false,
    estimatedBytes: Buffer.byteLength(content, 'utf8'),
    contentHash: `gitlab:${kind}:v2:${encodedProject}:${item.iid}:${await computeContentHash(content)}`,
  }
}

/**
 * Fetches the project record, used to resolve the human-readable path for
 * source URLs and to confirm access during validation.
 */
async function fetchProject(
  apiBase: string,
  encodedProject: string,
  accessToken: string,
  retryOptions?: typeof VALIDATE_RETRY_OPTIONS
): Promise<SecureFetchResponse> {
  return secureFetchWithRetry(
    `${apiBase}/projects/${encodedProject}`,
    { profile: 'configuredEndpoint', method: 'GET', headers: authHeaders(accessToken) },
    retryOptions
  )
}

/**
 * Resolves the project's `group/project` path, used to build web UI source URLs.
 * Cached on syncContext so listing pages and deferred `getDocument` hydration in
 * the same run share one lookup.
 *
 * Throws when the project itself cannot be read. That is not a cosmetic failure:
 * GitLab collapses "not authorized to read" into `404 Not Found` on read
 * endpoints, so a token that has lost access would otherwise produce an empty
 * but apparently successful listing and let deletion reconciliation hard-delete
 * every previously synced document. Failing here also establishes that the
 * project is visible, which is what lets the per-phase 404 handling below be read
 * as "this ref/wiki is genuinely absent" rather than "access was revoked".
 *
 * Returns '' only when the project record itself carries no
 * `path_with_namespace`, in which case callers fall back to API source URLs.
 */
async function resolveProjectPath(
  syncContext: Record<string, unknown> | undefined,
  apiBase: string,
  encodedProject: string,
  accessToken: string
): Promise<string> {
  const cached = syncContext?.projectPath
  if (typeof cached === 'string' && cached) return cached

  const response = await fetchProject(apiBase, encodedProject, accessToken)
  if (!response.ok) {
    throw new Error(
      `Cannot access GitLab project ${encodedProject}: ${response.status}. On GitLab a 404 also means the token is no longer authorized to read it.`
    )
  }

  const project = (await response.json()) as GitLabProject
  const path = project.path_with_namespace ?? ''
  if (syncContext) {
    if (path) syncContext.projectPath = path
    if (project.default_branch && !syncContext.defaultBranch) {
      syncContext.defaultBranch = project.default_branch
    }
  }
  return path
}

/**
 * Encodes the listing cursor. The cursor packs the resource phase (repo ➜ wiki ➜
 * issues) and a per-phase continuation token so a single sync walks the phases in
 * order. The repository-tree and issues phases both use GitLab keyset pagination
 * and store the full `rel="next"` URL from the Link header to fetch verbatim.
 */
interface CursorState {
  phase: SyncPhase
  issuePage: number
  /** Full `rel="next"` URL for the repository-tree keyset page to fetch next. */
  fileNextUrl?: string
  /** Full `rel="next"` URL for the issues keyset page to fetch next. */
  issueNextUrl?: string
  wikiNextUrl?: string
  mergeNextUrl?: string
}

function encodeCursor(state: CursorState): string {
  return Buffer.from(JSON.stringify(state), 'utf8').toString('base64url')
}

function decodeCursor(cursor: string | undefined, initialPhase: SyncPhase): CursorState {
  if (!cursor) return { phase: initialPhase, issuePage: 1 }
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Partial<{
      phase: SyncPhase
      issuePage: number
      fileNextUrl: string
      issueNextUrl: string
      wikiNextUrl: string
      mergeNextUrl: string
    }>
    const phase: SyncPhase =
      parsed.phase === 'repo' ||
      parsed.phase === 'issues' ||
      parsed.phase === 'wiki' ||
      parsed.phase === 'merge_requests'
        ? parsed.phase
        : initialPhase
    return {
      phase,
      issuePage: Number(parsed.issuePage) > 0 ? Number(parsed.issuePage) : 1,
      fileNextUrl: typeof parsed.fileNextUrl === 'string' ? parsed.fileNextUrl : undefined,
      issueNextUrl: typeof parsed.issueNextUrl === 'string' ? parsed.issueNextUrl : undefined,
      wikiNextUrl: typeof parsed.wikiNextUrl === 'string' ? parsed.wikiNextUrl : undefined,
      mergeNextUrl: typeof parsed.mergeNextUrl === 'string' ? parsed.mergeNextUrl : undefined,
    }
  } catch {
    return { phase: initialPhase, issuePage: 1 }
  }
}

/**
 * Resolves the git ref (branch/tag) to sync repository files from. Uses the
 * user-configured `ref` when set, otherwise the project's default branch, which
 * is cached on syncContext to avoid repeat lookups across pages and getDocument.
 */
async function resolveRef(
  sourceConfig: Record<string, unknown>,
  syncContext: Record<string, unknown> | undefined,
  apiBase: string,
  encodedProject: string,
  accessToken: string
): Promise<string> {
  const configured = typeof sourceConfig.ref === 'string' ? sourceConfig.ref.trim() : ''
  if (configured) return configured

  const cached = syncContext?.defaultBranch as string | undefined
  if (cached) return cached

  const response = await fetchProject(apiBase, encodedProject, accessToken)
  if (response.ok) {
    const project = (await response.json()) as GitLabProject
    const branch = project.default_branch?.trim() || 'main'
    if (syncContext) {
      syncContext.defaultBranch = branch
      if (project.path_with_namespace) syncContext.projectPath = project.path_with_namespace
    }
    return branch
  }
  logger.warn('Failed to fetch GitLab project for default branch; falling back to "main"', {
    project: encodedProject,
    status: response.status,
  })
  return 'main'
}

/**
 * Applies the optional maxItems cap to a batch, tracking the running total in
 * syncContext and flagging `listingCapped` when the cap is hit.
 */
function applyMaxItemsCap(
  documents: ExternalDocument[],
  maxItems: number,
  syncContext: Record<string, unknown> | undefined
): { documents: ExternalDocument[]; capped: boolean } {
  if (maxItems <= 0) return { documents, capped: false }
  const prevTotal = (syncContext?.totalDocsFetched as number) ?? 0
  const remaining = Math.max(0, maxItems - prevTotal)
  const sliced = documents.length > remaining ? documents.slice(0, remaining) : documents
  const newTotal = prevTotal + sliced.length
  if (syncContext) syncContext.totalDocsFetched = newTotal
  const capped = newTotal >= maxItems
  if (capped && syncContext) syncContext.listingCapped = true
  return { documents: sliced, capped }
}

export const gitlabConnector: ConnectorConfig = {
  ...gitlabConnectorMeta,
  openDirectory: openGitLabDirectory,
  getDocumentAcls: getGitLabDocumentAcls,

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const host = normalizeHost(sourceConfig.host)
    const apiBase = buildApiBase(host)
    const encodedProject = encodeProjectId(sourceConfig.project)
    const choice = getContentTypeChoice(sourceConfig)
    const maxItems = sourceConfig.maxItems ? Number(sourceConfig.maxItems) : 0

    if (!encodedProject) {
      throw new Error('Project is required')
    }

    const phases = activePhases(choice)
    if (phases.length === 0) return { documents: [], hasMore: false }

    const projectPath = await resolveProjectPath(syncContext, apiBase, encodedProject, accessToken)

    let state = decodeCursor(cursor, phases[0])
    if (!phases.includes(state.phase)) state = { phase: phases[0], issuePage: 1 }

    /** Cursor that advances to the first page of the phase after `current`, if any. */
    const advance = (current: SyncPhase): { nextCursor?: string; hasMore: boolean } => {
      const next = nextPhase(current, choice)
      if (!next) return { hasMore: false }
      return { nextCursor: encodeCursor({ phase: next, issuePage: 1 }), hasMore: true }
    }

    if (state.phase === 'repo') {
      const ref = await resolveRef(sourceConfig, syncContext, apiBase, encodedProject, accessToken)
      const extSet = parseExtensions(sourceConfig.fileExtensions)
      const rawPrefix =
        typeof sourceConfig.pathPrefix === 'string' ? sourceConfig.pathPrefix.trim() : ''
      const pathPrefix = rawPrefix && !rawPrefix.endsWith('/') ? `${rawPrefix}/` : rawPrefix

      const treeParams = new URLSearchParams({
        ref,
        recursive: 'true',
        per_page: String(PAGE_SIZE),
        pagination: 'keyset',
      })
      const url = continuationUrl(
        state.fileNextUrl,
        `${apiBase}/projects/${encodedProject}/repository/tree?${treeParams.toString()}`
      )
      logger.info('Listing GitLab repository files', {
        host,
        project: encodedProject,
        ref,
        continued: Boolean(state.fileNextUrl),
      })

      const response = await fetchListing(url, accessToken)

      if (!response.ok) {
        if (response.status === 401 || response.status === 403 || response.status === 404) {
          /**
           * 401/403 mean the token stopped working mid-sync — flag the listing as
           * incomplete so deletion reconciliation does not hard-delete previously
           * synced files. A 404 here is safe to reconcile against precisely because
           * `resolveProjectPath` already proved the project is readable, so the only
           * remaining meaning is that the ref or repository is absent.
           */
          if (response.status !== 404 && syncContext) syncContext.listingCapped = true
          logger.warn('GitLab repository tree unavailable; skipping files', {
            host,
            project: encodedProject,
            ref,
            status: response.status,
          })
          const adv = advance('repo')
          return { documents: [], nextCursor: adv.nextCursor, hasMore: adv.hasMore }
        }
        const errorText = await response.text().catch(() => '')
        logger.error('Failed to list GitLab repository tree', {
          status: response.status,
          error: errorText.slice(0, 500),
        })
        throw new Error(`Failed to list GitLab repository tree: ${response.status}`)
      }

      const entries = (await response.json()) as GitLabTreeEntry[]
      const documents: ExternalDocument[] = []
      for (const entry of entries) {
        if (entry.type !== 'blob' || !entry.path) continue
        if (pathPrefix && !entry.path.startsWith(pathPrefix)) continue
        if (!matchesExtension(entry.path, extSet)) continue
        documents.push(treeEntryToStub(apiBase, encodedProject, host, projectPath, ref, entry))
      }

      const { documents: capped, capped: hitLimit } = applyMaxItemsCap(
        documents,
        maxItems,
        syncContext
      )
      if (hitLimit) return { documents: capped, hasMore: false }

      const nextLink = checkedNextLink(response, url)
      if (nextLink) {
        return {
          documents: capped,
          nextCursor: encodeCursor({ phase: 'repo', issuePage: 1, fileNextUrl: nextLink }),
          hasMore: true,
        }
      }
      const adv = advance('repo')
      return { documents: capped, nextCursor: adv.nextCursor, hasMore: adv.hasMore }
    }

    if (state.phase === 'wiki') {
      const initialUrl = `${apiBase}/projects/${encodedProject}/wikis?with_content=0`
      const url = continuationUrl(state.wikiNextUrl, initialUrl)
      logger.info('Listing GitLab wiki pages', { host, project: encodedProject })

      const response = await secureFetchWithRetry(url, {
        profile: 'configuredEndpoint',
        method: 'GET',
        headers: authHeaders(accessToken),
        maxResponseBytes: MAX_METADATA_RESPONSE_BYTES,
      })

      if (!response.ok) {
        if (response.status === 401 || response.status === 403 || response.status === 404) {
          /**
           * 401/403 mean the token stopped working mid-sync — flag the listing as
           * incomplete so deletion reconciliation does not hard-delete previously
           * synced wiki pages. A 404 here is safe to reconcile against precisely
           * because `resolveProjectPath` already proved the project is readable, so
           * the only remaining meaning is that the wiki feature or its content is
           * absent.
           */
          if (response.status !== 404 && syncContext) syncContext.listingCapped = true
          logger.warn('GitLab wiki unavailable; skipping wiki phase', {
            host,
            project: encodedProject,
            status: response.status,
          })
          const adv = advance('wiki')
          return { documents: [], nextCursor: adv.nextCursor, hasMore: adv.hasMore }
        }
        const errorText = await response.text().catch(() => '')
        logger.error('Failed to list GitLab wiki pages', {
          status: response.status,
          error: errorText.slice(0, 500),
        })
        throw new Error(`Failed to list GitLab wiki pages: ${response.status}`)
      }

      const pages = readWikiPages(await response.json())
      const documents: ExternalDocument[] = []
      for (const page of pages) {
        if (!page.slug) continue
        documents.push({
          externalId: `${WIKI_PREFIX}${page.slug}`,
          title: page.title?.trim() || page.slug,
          content: '',
          contentDeferred: true,
          mimeType: 'text/plain',
          contentHash: `gitlab:wiki-listing:v2:${encodedProject}:${page.slug}:${listingToken(syncContext)}`,
          metadata: {
            contentType: 'wiki',
            title: page.title?.trim() || page.slug,
            slug: page.slug,
          },
        })
      }

      const { documents: capped, capped: hitLimit } = applyMaxItemsCap(
        documents,
        maxItems,
        syncContext
      )

      if (hitLimit) {
        return { documents: capped, hasMore: false }
      }

      const nextLink = checkedNextLink(response, url)
      if (nextLink) {
        return {
          documents: capped,
          nextCursor: encodeCursor({ phase: 'wiki', issuePage: 1, wikiNextUrl: nextLink }),
          hasMore: true,
        }
      }
      const adv = advance('wiki')
      return { documents: capped, nextCursor: adv.nextCursor, hasMore: adv.hasMore }
    }

    if (state.phase === 'issues') {
      const params = new URLSearchParams({
        per_page: String(PAGE_SIZE),
        order_by: 'updated_at',
        sort: 'desc',
        pagination: 'keyset',
      })
      const issueState =
        typeof sourceConfig.issueState === 'string' ? sourceConfig.issueState.trim() : ''
      if (issueState && issueState !== 'all') params.set('state', issueState)
      const issueLabels =
        typeof sourceConfig.issueLabels === 'string' ? sourceConfig.issueLabels.trim() : ''
      if (issueLabels) params.set('labels', issueLabels)
      const issueMilestone =
        typeof sourceConfig.issueMilestone === 'string' ? sourceConfig.issueMilestone.trim() : ''
      if (issueMilestone) params.set('milestone', issueMilestone)

      const url = continuationUrl(
        state.issueNextUrl,
        `${apiBase}/projects/${encodedProject}/issues?${params.toString()}`
      )
      logger.info('Listing GitLab issues', {
        host,
        project: encodedProject,
        continued: Boolean(state.issueNextUrl),
      })

      const response = await fetchListing(url, accessToken)

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        logger.error('Failed to list GitLab issues', {
          status: response.status,
          error: errorText.slice(0, 500),
        })
        throw new Error(`Failed to list GitLab issues: ${response.status}`)
      }

      const issues = readWorkItems(await response.json())
      const documents: ExternalDocument[] = []
      for (const issue of issues) {
        if (issue.iid == null) continue
        documents.push(
          workItemToStub(encodedProject, host, projectPath, issue, 'issue', syncContext)
        )
      }

      const { documents: capped, capped: hitLimit } = applyMaxItemsCap(
        documents,
        maxItems,
        syncContext
      )
      if (hitLimit) return { documents: capped, hasMore: false }

      const nextLink = checkedNextLink(response, url)
      if (nextLink) {
        return {
          documents: capped,
          nextCursor: encodeCursor({ phase: 'issues', issuePage: 1, issueNextUrl: nextLink }),
          hasMore: true,
        }
      }

      const adv = advance('issues')
      return { documents: capped, nextCursor: adv.nextCursor, hasMore: adv.hasMore }
    }

    if (state.phase === 'merge_requests') {
      const initialUrl = `${apiBase}/projects/${encodedProject}/merge_requests?scope=all&state=all&per_page=${PAGE_SIZE}&order_by=updated_at&sort=desc`
      const url = continuationUrl(state.mergeNextUrl, initialUrl)
      const response = await fetchListing(url, accessToken)
      if (!response.ok) throw new Error(`Failed to list GitLab merge requests: ${response.status}`)
      const items = readWorkItems(await response.json())
      const documents = items.map((item) =>
        workItemToStub(encodedProject, host, projectPath, item, 'merge_request', syncContext)
      )
      const capped = applyMaxItemsCap(documents, maxItems, syncContext)
      if (capped.capped) return { documents: capped.documents, hasMore: false }
      const nextLink = checkedNextLink(response, url)
      return {
        documents: capped.documents,
        nextCursor: nextLink
          ? encodeCursor({ phase: 'merge_requests', issuePage: 1, mergeNextUrl: nextLink })
          : undefined,
        hasMore: Boolean(nextLink),
      }
    }

    return { documents: [], hasMore: false }
  },

  getDocument: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    externalId: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocument | null> => {
    const host = normalizeHost(sourceConfig.host)
    const apiBase = buildApiBase(host)
    const encodedProject = encodeProjectId(sourceConfig.project)
    if (!encodedProject || !externalId) return null

    try {
      const projectPath = await resolveProjectPath(
        syncContext,
        apiBase,
        encodedProject,
        accessToken
      )

      if (externalId.startsWith(WIKI_PREFIX)) {
        const slug = externalId.slice(WIKI_PREFIX.length)
        if (!slug) return null

        const url = `${apiBase}/projects/${encodedProject}/wikis/${encodeURIComponent(slug)}?render_html=false`
        const response = await secureFetchWithRetry(url, {
          profile: 'configuredEndpoint',
          method: 'GET',
          headers: authHeaders(accessToken),
        })

        if (!response.ok) {
          if (response.status === 404) return null
          throw new Error(`Failed to fetch GitLab wiki page: ${response.status}`)
        }

        const page = readWikiPages([await response.json()])[0]
        if (page.slug !== slug) throw new Error('GitLab returned a different wiki page')
        return wikiPageToDocument(apiBase, encodedProject, host, projectPath, page)
      }

      if (externalId.startsWith(ISSUE_PREFIX) || externalId.startsWith(MERGE_REQUEST_PREFIX)) {
        const kind = externalId.startsWith(ISSUE_PREFIX) ? 'issue' : 'merge_request'
        const prefix = kind === 'issue' ? ISSUE_PREFIX : MERGE_REQUEST_PREFIX
        const iidStr = externalId.slice(prefix.length)
        const iid = Number(iidStr)
        if (!/^\d+$/.test(iidStr) || !Number.isSafeInteger(iid) || iid <= 0) return null
        const resource = kind === 'issue' ? 'issues' : 'merge_requests'
        const url = `${apiBase}/projects/${encodedProject}/${resource}/${iid}`
        const response = await secureFetchWithRetry(url, {
          profile: 'configuredEndpoint',
          method: 'GET',
          headers: authHeaders(accessToken),
          maxResponseBytes: MAX_METADATA_RESPONSE_BYTES,
        })
        if (!response.ok) {
          if (response.status === 404) return null
          throw new Error(`Failed to fetch GitLab ${kind}: ${response.status}`)
        }
        const item = readWorkItem(await response.json())
        if (item.iid !== iid) throw new Error('GitLab returned a different issue or merge request')
        return hydrateWorkItem(accessToken, apiBase, encodedProject, host, projectPath, item, kind)
      }

      if (externalId.startsWith(FILE_PREFIX)) {
        const path = externalId.slice(FILE_PREFIX.length)
        if (!path) return null

        const ref = await resolveRef(
          sourceConfig,
          syncContext,
          apiBase,
          encodedProject,
          accessToken
        )
        const url = `${apiBase}/projects/${encodedProject}/repository/files/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref)}`
        const response = await secureFetchWithRetry(url, {
          profile: 'configuredEndpoint',
          method: 'GET',
          headers: authHeaders(accessToken),
        })

        if (!response.ok) {
          if (response.status === 404) return null
          throw new Error(`Failed to fetch GitLab file: ${response.status}`)
        }

        const file = (await response.json()) as GitLabFile
        return fileToDocument(apiBase, encodedProject, host, projectPath, ref, path, file)
      }

      return null
    } catch (error) {
      /**
       * Only the 404 checks above (and an unrecognized externalId prefix) mean the object
       * is genuinely gone. Every other failure is rethrown so the sync engine records a
       * visible `docsFailed` row. Returning `null` instead would report a transient
       * GitLab fault as success — an already-indexed document is silently counted as
       * unchanged, and a new one vanishes from the run with nothing recorded.
       */
      logger.warn(`Failed to fetch GitLab document ${externalId}`, {
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
    const project = (sourceConfig.project as string)?.trim()
    if (!project) {
      return { valid: false, error: 'Project is required' }
    }

    const maxItems = sourceConfig.maxItems as string | undefined
    if (maxItems && (Number.isNaN(Number(maxItems)) || Number(maxItems) <= 0)) {
      return { valid: false, error: 'Max items must be a positive number' }
    }

    let host: string
    try {
      host = normalizeHost(sourceConfig.host)
    } catch (error) {
      if (error instanceof UnsafeGitLabHostError) {
        return {
          valid: false,
          error: 'Host must be a valid GitLab domain (e.g. gitlab.example.com)',
        }
      }
      throw error
    }
    const apiBase = buildApiBase(host)
    const encodedProject = encodeProjectId(project)
    const choice = getContentTypeChoice(sourceConfig)

    try {
      if (syncContext?.mirrorsSourceAcls === true) {
        await validateGitLabPermissionToken(accessToken, sourceConfig)
      }
      const response = await fetchProject(
        apiBase,
        encodedProject,
        accessToken,
        VALIDATE_RETRY_OPTIONS
      )

      if (response.status === 404) {
        return { valid: false, error: `Project "${project}" not found on ${host}` }
      }
      if (response.status === 401 || response.status === 403) {
        return { valid: false, error: 'Invalid token or insufficient permissions' }
      }
      if (!response.ok) {
        return { valid: false, error: `Cannot access project: ${response.status}` }
      }

      const projectRecord = (await response.json()) as GitLabProject

      if (activePhases(choice).includes('wiki')) {
        const accessLevel = projectRecord.wiki_access_level
        const enabled =
          accessLevel != null ? accessLevel !== 'disabled' : projectRecord.wiki_enabled !== false
        if (!enabled) {
          if (choice === 'wiki') {
            return { valid: false, error: 'The wiki feature is disabled for this project' }
          }
          logger.warn('Wiki feature disabled; it will be skipped', { project })
        }
      }

      const userRef = typeof sourceConfig.ref === 'string' ? sourceConfig.ref.trim() : ''
      if (userRef && activePhases(choice).includes('repo')) {
        const refResponse = await secureFetchWithRetry(
          `${apiBase}/projects/${encodedProject}/repository/commits/${encodeURIComponent(userRef)}`,
          { profile: 'configuredEndpoint', method: 'GET', headers: authHeaders(accessToken) },
          VALIDATE_RETRY_OPTIONS
        )
        if (refResponse.status === 404) {
          return {
            valid: false,
            error: `Branch, tag, or commit "${userRef}" not found in project "${project}"`,
          }
        }
        if (!refResponse.ok) {
          return {
            valid: false,
            error: `Cannot verify ref "${userRef}": ${refResponse.status}`,
          }
        }
      }

      return { valid: true }
    } catch (error) {
      return { valid: false, error: getErrorMessage(error, 'Failed to validate configuration') }
    }
  },

  /**
   * Maps document metadata to tag slots. `contentType` and `title` apply to every
   * document type. `state`/`author`/`labels`/`milestone`/`createdAt`/`updatedAt`
   * are issue-only and `path`/`size` are repository-file-only; each document type
   * leaves the others' fields empty and the type/empty guards below skip them.
   */
  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    if (typeof metadata.contentType === 'string' && metadata.contentType.trim()) {
      result.contentType = metadata.contentType
    }
    if (typeof metadata.title === 'string' && metadata.title.trim()) {
      result.title = metadata.title
    }
    if (typeof metadata.state === 'string' && metadata.state.trim()) {
      result.state = metadata.state
    }
    if (typeof metadata.author === 'string' && metadata.author.trim()) {
      result.author = metadata.author
    }

    const labels = joinTagArray(metadata.labels)
    if (labels) result.labels = labels

    if (typeof metadata.milestone === 'string' && metadata.milestone.trim()) {
      result.milestone = metadata.milestone
    }

    if (typeof metadata.path === 'string' && metadata.path.trim()) {
      result.path = metadata.path
    }

    if (metadata.size != null) {
      const num = Number(metadata.size)
      if (!Number.isNaN(num)) result.size = num
    }

    const createdAt = parseTagDate(metadata.createdAt)
    if (createdAt) result.createdAt = createdAt

    const updatedAt = parseTagDate(metadata.updatedAt)
    if (updatedAt) result.updatedAt = updatedAt

    return result
  },
}
