import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { GitLabIcon } from '@/components/icons'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { computeContentHash, joinTagArray, parseTagDate } from '@/connectors/utils'

const logger = createLogger('GitLabConnector')

const DEFAULT_HOST = 'gitlab.com'
const PAGE_SIZE = 100

/**
 * Prefix encoded into each document's externalId so getDocument can route to the
 * correct GitLab resource. Wiki pages are addressed by slug, issues by iid.
 */
const WIKI_PREFIX = 'wiki:'
const ISSUE_PREFIX = 'issue:'

/**
 * Selects which GitLab resources to sync.
 */
type ContentTypeChoice = 'wiki' | 'issues' | 'both'

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
  if (value === 'wiki' || value === 'issues') return value
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
 * Encodes the listing cursor. The cursor packs the resource phase (wiki ➜ issues)
 * and the issues page number so a single sync walks wikis first, then paginates
 * issues via the X-Next-Page header.
 */
interface CursorState {
  phase: 'wiki' | 'issues'
  issuePage: number
}

function encodeCursor(state: CursorState): string {
  return Buffer.from(JSON.stringify(state), 'utf8').toString('base64url')
}

function decodeCursor(cursor: string | undefined, initialPhase: 'wiki' | 'issues'): CursorState {
  if (!cursor) return { phase: initialPhase, issuePage: 1 }
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Partial<{
      phase: 'wiki' | 'issues'
      issuePage: number
    }>
    return {
      phase: parsed.phase === 'issues' ? 'issues' : 'wiki',
      issuePage: Number(parsed.issuePage) > 0 ? Number(parsed.issuePage) : 1,
    }
  } catch {
    return { phase: initialPhase, issuePage: 1 }
  }
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
  description: 'Sync wiki pages and issues from a GitLab project into your knowledge base',
  version: '1.0.0',
  icon: GitLabIcon,

  auth: {
    mode: 'apiKey',
    label: 'Personal Access Token',
    placeholder: 'Enter your GitLab PAT',
  },

  /**
   * Incremental sync applies to issues only (via the `updated_after` filter
   * derived from lastSyncAt). Wikis lack a change timestamp, so they are always
   * re-listed in full and reconciled by content hash.
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
        { label: 'Wiki only', id: 'wiki' },
        { label: 'Issues only', id: 'issues' },
        { label: 'Both', id: 'both' },
      ],
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

    const wantsWiki = choice === 'wiki' || choice === 'both'
    const wantsIssues = choice === 'issues' || choice === 'both'

    if (!encodedProject) {
      throw new Error('Project is required')
    }

    let projectPath = (syncContext?.projectPath as string) ?? ''
    if (!projectPath && syncContext) {
      const projectResponse = await fetchProject(apiBase, encodedProject, accessToken)
      if (projectResponse.ok) {
        const project = (await projectResponse.json()) as GitLabProject
        projectPath = project.path_with_namespace ?? ''
        syncContext.projectPath = projectPath
      }
    }

    const initialPhase: 'wiki' | 'issues' = wantsWiki ? 'wiki' : 'issues'
    const state = decodeCursor(cursor, initialPhase)

    if (state.phase === 'wiki' && wantsWiki) {
      const url = `${apiBase}/projects/${encodedProject}/wikis?with_content=1`
      logger.info('Listing GitLab wiki pages', { host, project: encodedProject })

      const response = await fetchWithRetry(url, {
        method: 'GET',
        headers: authHeaders(accessToken),
      })

      if (!response.ok) {
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

      if (hitLimit || !wantsIssues) {
        return { documents: capped, hasMore: false }
      }

      return {
        documents: capped,
        nextCursor: encodeCursor({ phase: 'issues', issuePage: 1 }),
        hasMore: true,
      }
    }

    if (wantsIssues) {
      const params = new URLSearchParams({
        per_page: String(PAGE_SIZE),
        page: String(state.issuePage),
        order_by: 'updated_at',
        sort: 'desc',
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

      const url = `${apiBase}/projects/${encodedProject}/issues?${params.toString()}`
      logger.info('Listing GitLab issues', {
        host,
        project: encodedProject,
        page: state.issuePage,
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

      const nextPageHeader = response.headers.get('x-next-page')?.trim()
      const nextPage = nextPageHeader ? Number(nextPageHeader) : 0
      const hasMorePages = !hitLimit && Number.isFinite(nextPage) && nextPage > 0

      return {
        documents: capped,
        nextCursor: hasMorePages
          ? encodeCursor({ phase: 'issues', issuePage: nextPage })
          : undefined,
        hasMore: hasMorePages,
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

      if (choice === 'wiki' || choice === 'both') {
        const accessLevel = projectRecord.wiki_access_level
        const enabled =
          accessLevel != null ? accessLevel !== 'disabled' : projectRecord.wiki_enabled !== false
        if (!enabled) {
          if (choice === 'wiki') {
            return { valid: false, error: 'The wiki feature is disabled for this project' }
          }
          logger.warn('Wiki feature disabled; only issues will sync', { project })
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
    { id: 'createdAt', displayName: 'Created At', fieldType: 'date' },
    { id: 'updatedAt', displayName: 'Updated At', fieldType: 'date' },
  ],

  /**
   * Maps document metadata to tag slots. The `contentType` and `title` tags
   * apply to both wikis and issues. The remaining tags (state, author, labels,
   * milestone, createdAt, updatedAt) are issue-only — wiki pages expose none of
   * them in the REST API, so wiki documents leave those metadata fields empty
   * and the type/empty guards below skip them.
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

    const createdAt = parseTagDate(metadata.createdAt)
    if (createdAt) result.createdAt = createdAt

    const updatedAt = parseTagDate(metadata.updatedAt)
    if (updatedAt) result.updatedAt = updatedAt

    return result
  },
}
