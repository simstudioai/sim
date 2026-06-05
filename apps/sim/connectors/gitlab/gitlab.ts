import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { GitLabIcon } from '@/components/icons'
import { isSameOrigin } from '@/lib/core/utils/validation'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { computeContentHash, joinTagArray, parseTagDate } from '@/connectors/utils'

const logger = createLogger('GitLabConnector')

const DEFAULT_HOST = 'gitlab.com'
const PAGE_SIZE = 100
/** Max repository file size to index. Larger blobs are skipped. */
const MAX_FILE_SIZE = 10 * 1024 * 1024
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

/**
 * Selects which GitLab resources to sync. `repo` = repository files (code/docs),
 * `all` = repo + wiki + issues. `both` is retained for backward compatibility and
 * means wiki + issues (no repository files).
 */
type ContentTypeChoice = 'repo' | 'wiki' | 'issues' | 'both' | 'all'

/** Listing phases, walked in order: repository files ➜ wiki ➜ issues. */
type SyncPhase = 'repo' | 'wiki' | 'issues'

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
 * Returns the ordered list of active sync phases for a content-type choice.
 */
function activePhases(choice: ContentTypeChoice): SyncPhase[] {
  const phases: SyncPhase[] = []
  if (choice === 'repo' || choice === 'all') phases.push('repo')
  if (choice === 'wiki' || choice === 'both' || choice === 'all') phases.push('wiki')
  if (choice === 'issues' || choice === 'both' || choice === 'all') phases.push('issues')
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
 * Normalizes the host config value: trims whitespace, strips any protocol
 * prefix and trailing slashes, and falls back to gitlab.com when empty.
 */
function normalizeHost(rawHost: unknown): string {
  const host = typeof rawHost === 'string' ? rawHost.trim() : ''
  if (!host) return DEFAULT_HOST
  return host
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
    .trim()
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
 */
function encodeProjectId(project: unknown): string {
  return encodeURIComponent(String(project ?? '').trim())
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

/**
 * Builds the change-detection hash for a wiki page.
 *
 * GitLab wiki pages expose no version number or `updated_at` timestamp in the
 * REST API, so there is no metadata field that reliably changes when a page is
 * edited. As a last resort we hash the page content itself. To keep the hash
 * identical between the listing stub and getDocument, both paths request the
 * page content (the list endpoint supports `with_content=1`) and feed it through
 * this same function.
 */
async function buildWikiContentHash(
  projectId: string,
  slug: string,
  content: string
): Promise<string> {
  const contentDigest = await computeContentHash(content)
  return `gitlab:wiki:${projectId}:${slug}:${contentDigest}`
}

/**
 * Builds the change-detection hash for an issue. Issues expose `updated_at`,
 * which increments on every edit, comment, or state change — an ideal metadata
 * indicator that requires no content fetch.
 */
function buildIssueContentHash(projectId: string, iid: number, updatedAt: string): string {
  return `gitlab:issue:${projectId}:${iid}:${updatedAt}`
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

  if (typeof file.size === 'number' && file.size > MAX_FILE_SIZE) {
    logger.info('Skipping oversized GitLab file', { path, size: file.size })
    return null
  }

  const raw = typeof file.content === 'string' ? file.content : ''
  const buffer = file.encoding === 'base64' ? Buffer.from(raw, 'base64') : Buffer.from(raw, 'utf8')
  if (isBinaryBuffer(buffer)) {
    logger.info('Skipping binary GitLab file', { path })
    return null
  }
  if (buffer.byteLength > MAX_FILE_SIZE) {
    logger.info('Skipping oversized GitLab file', { path, size: buffer.byteLength })
    return null
  }

  const content = buffer.toString('utf8')
  const title = path.split('/').pop() || path
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

  const contentHash = await buildWikiContentHash(encodedProject, page.slug, content)

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

/**
 * Builds an issue document from a fetched issue.
 */
function issueToDocument(
  encodedProject: string,
  host: string,
  projectPath: string,
  issue: GitLabIssue
): ExternalDocument | null {
  const title = issue.title?.trim() || `Issue #${issue.iid}`
  const description = typeof issue.description === 'string' ? issue.description : ''
  const body = composeBody(title, description)
  if (!body.trim()) return null

  const updatedAt = issue.updated_at ?? issue.created_at ?? ''
  const createdAt = issue.created_at ?? ''
  const author = issue.author?.username?.trim() || issue.author?.name?.trim() || ''
  const labels = Array.isArray(issue.labels) ? issue.labels : []
  const milestone = issue.milestone?.title?.trim() || ''

  const fallbackUrl = projectPath
    ? `https://${host}/${projectPath}/-/issues/${issue.iid}`
    : undefined

  return {
    externalId: `${ISSUE_PREFIX}${issue.iid}`,
    title,
    content: body,
    contentDeferred: false,
    mimeType: 'text/plain',
    sourceUrl: issue.web_url || fallbackUrl,
    contentHash: buildIssueContentHash(encodedProject, issue.iid, updatedAt),
    metadata: {
      contentType: 'issue',
      title,
      iid: issue.iid,
      state: issue.state,
      author,
      labels,
      milestone,
      createdAt,
      updatedAt,
    },
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
): Promise<Response> {
  return fetchWithRetry(
    `${apiBase}/projects/${encodedProject}`,
    { method: 'GET', headers: authHeaders(accessToken) },
    retryOptions
  )
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
    }>
    const phase: SyncPhase =
      parsed.phase === 'repo' || parsed.phase === 'issues' || parsed.phase === 'wiki'
        ? parsed.phase
        : initialPhase
    return {
      phase,
      issuePage: Number(parsed.issuePage) > 0 ? Number(parsed.issuePage) : 1,
      fileNextUrl: typeof parsed.fileNextUrl === 'string' ? parsed.fileNextUrl : undefined,
      issueNextUrl: typeof parsed.issueNextUrl === 'string' ? parsed.issueNextUrl : undefined,
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
  id: 'gitlab',
  name: 'GitLab',
  description:
    'Sync repository files, wiki pages, and issues from a GitLab project into your knowledge base',
  version: '1.0.0',
  icon: GitLabIcon,

  auth: {
    mode: 'apiKey',
    label: 'Personal Access Token',
    placeholder: 'Enter your GitLab PAT',
  },

  /**
   * Incremental sync applies to issues only (via the `updated_after` filter
   * derived from lastSyncAt). Wikis and repository files lack a change timestamp
   * on listing, so they are always re-listed in full and reconciled by content
   * hash (wiki: content digest, file: git blob SHA) — unchanged docs are skipped.
   */
  supportsIncrementalSync: true,

  configFields: [
    {
      id: 'host',
      title: 'Host',
      type: 'short-input',
      placeholder: 'gitlab.com',
      required: false,
      description: 'Self-managed GitLab host. Leave blank for gitlab.com.',
    },
    {
      id: 'project',
      title: 'Project',
      type: 'short-input',
      placeholder: 'group/project or numeric ID',
      required: true,
      description: 'Project path (e.g. my-group/my-repo) or numeric project ID.',
    },
    {
      id: 'contentTypes',
      title: 'Content',
      type: 'dropdown',
      required: false,
      options: [
        { label: 'Code, Wiki & Issues', id: 'all' },
        { label: 'Code (repository files) only', id: 'repo' },
        { label: 'Wiki only', id: 'wiki' },
        { label: 'Issues only', id: 'issues' },
        { label: 'Wiki & Issues', id: 'both' },
      ],
      description: 'Which content to index. "Code" syncs repository files (READMEs, docs, source).',
    },
    {
      id: 'ref',
      title: 'Branch',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'Default branch',
      description: 'Branch or tag to sync repository files from. Applies only when syncing Code.',
    },
    {
      id: 'pathPrefix',
      title: 'Path Filter',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'e.g. docs/',
      description:
        'Only sync repository files under this path prefix. Applies only when syncing Code.',
    },
    {
      id: 'fileExtensions',
      title: 'File Extensions',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'e.g. .md, .txt, .mdx',
      description:
        'Only sync repository files with these extensions (comma-separated). Leave blank for all text files. Applies only when syncing Code.',
    },
    {
      id: 'issueState',
      title: 'Issue State',
      type: 'dropdown',
      required: false,
      mode: 'advanced',
      options: [
        { label: 'All', id: 'all' },
        { label: 'Open only', id: 'opened' },
        { label: 'Closed only', id: 'closed' },
      ],
      description: 'Which issues to sync by state. Applies only when syncing issues.',
    },
    {
      id: 'issueLabels',
      title: 'Issue Labels',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'e.g. bug,docs (comma-separated)',
      description:
        'Only sync issues with all of these labels (comma-separated). Applies only when syncing issues.',
    },
    {
      id: 'issueMilestone',
      title: 'Issue Milestone',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'e.g. v1.0 (milestone title)',
      description:
        'Only sync issues assigned to this milestone (exact title). Applies only when syncing issues.',
    },
    {
      id: 'maxItems',
      title: 'Max Items',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 500 (default: unlimited)',
    },
  ],

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>,
    lastSyncAt?: Date
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

    let projectPath = (syncContext?.projectPath as string) ?? ''
    if (!projectPath && syncContext) {
      const projectResponse = await fetchProject(apiBase, encodedProject, accessToken)
      if (projectResponse.ok) {
        const project = (await projectResponse.json()) as GitLabProject
        projectPath = project.path_with_namespace ?? ''
        syncContext.projectPath = projectPath
        if (project.default_branch && !syncContext.defaultBranch) {
          syncContext.defaultBranch = project.default_branch
        }
      }
    }

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
      if (state.fileNextUrl && !isSameOrigin(state.fileNextUrl, apiBase)) {
        throw new Error('GitLab pagination cursor points to an unexpected host')
      }
      const url =
        state.fileNextUrl ??
        `${apiBase}/projects/${encodedProject}/repository/tree?${treeParams.toString()}`
      logger.info('Listing GitLab repository files', {
        host,
        project: encodedProject,
        ref,
        continued: Boolean(state.fileNextUrl),
      })

      const response = await fetchWithRetry(url, {
        method: 'GET',
        headers: authHeaders(accessToken),
      })

      if (!response.ok) {
        if (response.status === 404 || response.status === 403) {
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

      const nextLink = parseNextLink(response.headers.get('link'))
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
      const url = `${apiBase}/projects/${encodedProject}/wikis?with_content=1`
      logger.info('Listing GitLab wiki pages', { host, project: encodedProject })

      const response = await fetchWithRetry(url, {
        method: 'GET',
        headers: authHeaders(accessToken),
      })

      if (!response.ok) {
        if (response.status === 403 || response.status === 404) {
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

      const pages = (await response.json()) as GitLabWikiPage[]
      const documents: ExternalDocument[] = []
      for (const page of pages) {
        if (!page.slug) continue
        const doc = await wikiPageToDocument(apiBase, encodedProject, host, projectPath, page)
        if (doc) documents.push(doc)
      }

      const { documents: capped, capped: hitLimit } = applyMaxItemsCap(
        documents,
        maxItems,
        syncContext
      )

      if (hitLimit) {
        return { documents: capped, hasMore: false }
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
      if (lastSyncAt) params.set('updated_after', lastSyncAt.toISOString())
      const issueState =
        typeof sourceConfig.issueState === 'string' ? sourceConfig.issueState.trim() : ''
      if (issueState && issueState !== 'all') params.set('state', issueState)
      const issueLabels =
        typeof sourceConfig.issueLabels === 'string' ? sourceConfig.issueLabels.trim() : ''
      if (issueLabels) params.set('labels', issueLabels)
      const issueMilestone =
        typeof sourceConfig.issueMilestone === 'string' ? sourceConfig.issueMilestone.trim() : ''
      if (issueMilestone) params.set('milestone', issueMilestone)

      if (state.issueNextUrl && !isSameOrigin(state.issueNextUrl, apiBase)) {
        throw new Error('GitLab pagination cursor points to an unexpected host')
      }
      const url =
        state.issueNextUrl ?? `${apiBase}/projects/${encodedProject}/issues?${params.toString()}`
      logger.info('Listing GitLab issues', {
        host,
        project: encodedProject,
        continued: Boolean(state.issueNextUrl),
        incremental: Boolean(lastSyncAt),
      })

      const response = await fetchWithRetry(url, {
        method: 'GET',
        headers: authHeaders(accessToken),
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        logger.error('Failed to list GitLab issues', {
          status: response.status,
          error: errorText.slice(0, 500),
        })
        throw new Error(`Failed to list GitLab issues: ${response.status}`)
      }

      const issues = (await response.json()) as GitLabIssue[]
      const documents: ExternalDocument[] = []
      for (const issue of issues) {
        if (issue.iid == null) continue
        const doc = issueToDocument(encodedProject, host, projectPath, issue)
        if (doc) documents.push(doc)
      }

      const { documents: capped, capped: hitLimit } = applyMaxItemsCap(
        documents,
        maxItems,
        syncContext
      )
      if (hitLimit) return { documents: capped, hasMore: false }

      const nextLink = parseNextLink(response.headers.get('link'))
      if (nextLink) {
        return {
          documents: capped,
          nextCursor: encodeCursor({ phase: 'issues', issuePage: 1, issueNextUrl: nextLink }),
          hasMore: true,
        }
      }

      return { documents: capped, hasMore: false }
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

    const projectPath = (syncContext?.projectPath as string) ?? ''

    try {
      if (externalId.startsWith(WIKI_PREFIX)) {
        const slug = externalId.slice(WIKI_PREFIX.length)
        if (!slug) return null

        const url = `${apiBase}/projects/${encodedProject}/wikis/${encodeURIComponent(slug)}?render_html=false`
        const response = await fetchWithRetry(url, {
          method: 'GET',
          headers: authHeaders(accessToken),
        })

        if (!response.ok) {
          if (response.status === 404) return null
          throw new Error(`Failed to fetch GitLab wiki page: ${response.status}`)
        }

        const page = (await response.json()) as GitLabWikiPage
        if (!page.slug) return null
        return wikiPageToDocument(apiBase, encodedProject, host, projectPath, page)
      }

      if (externalId.startsWith(ISSUE_PREFIX)) {
        const iidStr = externalId.slice(ISSUE_PREFIX.length)
        const iid = Number(iidStr)
        if (!iidStr || Number.isNaN(iid)) return null

        const url = `${apiBase}/projects/${encodedProject}/issues/${iid}`
        const response = await fetchWithRetry(url, {
          method: 'GET',
          headers: authHeaders(accessToken),
        })

        if (!response.ok) {
          if (response.status === 404) return null
          throw new Error(`Failed to fetch GitLab issue: ${response.status}`)
        }

        const issue = (await response.json()) as GitLabIssue
        if (issue.iid == null) return null
        return issueToDocument(encodedProject, host, projectPath, issue)
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
        const response = await fetchWithRetry(url, {
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
      logger.warn(`Failed to fetch GitLab document ${externalId}`, {
        error: toError(error).message,
      })
      return null
    }
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const project = (sourceConfig.project as string)?.trim()
    if (!project) {
      return { valid: false, error: 'Project is required' }
    }

    const maxItems = sourceConfig.maxItems as string | undefined
    if (maxItems && (Number.isNaN(Number(maxItems)) || Number(maxItems) <= 0)) {
      return { valid: false, error: 'Max items must be a positive number' }
    }

    const host = normalizeHost(sourceConfig.host)
    const apiBase = buildApiBase(host)
    const encodedProject = encodeProjectId(project)
    const choice = getContentTypeChoice(sourceConfig)

    try {
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
        const refResponse = await fetchWithRetry(
          `${apiBase}/projects/${encodedProject}/repository/commits/${encodeURIComponent(userRef)}`,
          { method: 'GET', headers: authHeaders(accessToken) },
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

  tagDefinitions: [
    { id: 'contentType', displayName: 'Content Type', fieldType: 'text' },
    { id: 'title', displayName: 'Title', fieldType: 'text' },
    { id: 'state', displayName: 'State', fieldType: 'text' },
    { id: 'author', displayName: 'Author', fieldType: 'text' },
    { id: 'labels', displayName: 'Labels', fieldType: 'text' },
    { id: 'milestone', displayName: 'Milestone', fieldType: 'text' },
    { id: 'path', displayName: 'File Path', fieldType: 'text' },
    { id: 'size', displayName: 'File Size (bytes)', fieldType: 'number' },
    { id: 'createdAt', displayName: 'Created At', fieldType: 'date' },
    { id: 'updatedAt', displayName: 'Updated At', fieldType: 'date' },
  ],

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
