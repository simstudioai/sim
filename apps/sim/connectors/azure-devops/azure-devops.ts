import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { AzureDevOpsIcon } from '@/components/icons'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { htmlToPlainText, joinTagArray, parseTagDate, readBodyWithLimit } from '@/connectors/utils'

const logger = createLogger('AzureDevOpsConnector')

const ADO_BASE_URL = 'https://dev.azure.com'
const WIKI_API_VERSION = '7.1'
const WIKIS_LIST_API_VERSION = '7.1'
const WIQL_API_VERSION = '7.1'
const WORKITEMS_API_VERSION = '7.1'
const PROJECT_API_VERSION = '7.1'
const GIT_API_VERSION = '7.1'

/** Page size for the wiki `pagesbatch` endpoint. */
const WIKI_PAGE_BATCH_SIZE = 100
/** Page size for the WIQL → workitemsbatch listing pipeline. ADO caps a batch at 200 ids. */
const WORK_ITEM_BATCH_SIZE = 200
/** Concurrency for per-page wiki ETag lookups during listing. */
const WIKI_ETAG_CONCURRENCY = 5
/** Page size for paginating repository-file stubs out of the in-memory tree. */
const FILE_BATCH_SIZE = 100
/**
 * Max repository file size to index. The Items list API does not return file
 * size, so this cap is enforced at content-fetch time in getDocument: the raw
 * octet-stream body is read through `readBodyWithLimit`, which streams the bytes
 * and aborts (returning null) the moment the cap is exceeded. Larger files are
 * skipped without being fully buffered.
 */
const MAX_FILE_SIZE = 10 * 1024 * 1024
/** Bytes sniffed for a NUL byte when detecting binary files (matches git's heuristic). */
const BINARY_SNIFF_BYTES = 8000
/**
 * WIQL returns at most 20,000 work item references. We cap `$top` at this bound
 * so the connector never silently relies on truncated results; users who need
 * more should narrow the query via the work-item filters.
 */
const WIQL_MAX_RESULTS = 20000

/**
 * externalId discriminators. Wiki pages are addressed by `wiki:{wikiId}:{path}`,
 * work items by `wi:{id}`, and repository files by `file:{repoId}:{path}`.
 */
const FILE_PREFIX = 'file:'

type ContentType = 'wiki' | 'workitems' | 'files' | 'both' | 'all'

/** Listing phases, walked in order: wiki ➜ work items ➜ repository files. */
type SyncPhase = 'wiki' | 'workitems' | 'file'

/**
 * Returns the ordered list of active sync phases for a content-type choice.
 * Phase order is fixed (wiki ➜ workitems ➜ file) so the phase-encoded cursor and
 * the maxItems phase-boundary guard compose deterministically.
 */
function activePhases(contentType: ContentType): SyncPhase[] {
  const phases: SyncPhase[] = []
  if (contentType === 'wiki' || contentType === 'both' || contentType === 'all') phases.push('wiki')
  if (contentType === 'workitems' || contentType === 'both' || contentType === 'all') {
    phases.push('workitems')
  }
  if (contentType === 'files' || contentType === 'all') phases.push('file')
  return phases
}

/**
 * Returns the phase following `current` for a content type, or undefined when
 * `current` is the last active phase.
 */
function nextPhase(current: SyncPhase, contentType: ContentType): SyncPhase | undefined {
  const phases = activePhases(contentType)
  const idx = phases.indexOf(current)
  return idx >= 0 && idx + 1 < phases.length ? phases[idx + 1] : undefined
}

/**
 * Builds the Azure DevOps PAT auth header. ADO PATs authenticate via HTTP Basic
 * with an empty username and the token as the password.
 */
function patAuthHeader(accessToken: string): string {
  return `Basic ${Buffer.from(`:${accessToken}`).toString('base64')}`
}

/**
 * Normalizes the configured content type, defaulting to wiki pages.
 */
function parseContentType(value: unknown): ContentType {
  if (value === 'workitems' || value === 'files' || value === 'both' || value === 'all') {
    return value
  }
  return 'wiki'
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
 * Strips the `refs/heads/` prefix from a default-branch ref so it can be used as
 * a `versionDescriptor.version` branch name.
 */
function stripRefsHeads(ref: string): string {
  return ref.replace(/^refs\/heads\//, '')
}

/**
 * Reads a trimmed string config value, returning '' when absent.
 */
function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Escapes a value for safe interpolation into a single-quoted WIQL string literal.
 * WIQL escapes an embedded single quote by doubling it.
 */
function escapeWiql(value: string): string {
  return value.replace(/'/g, "''")
}

/**
 * Encodes an external ID that combines a discriminator with its identifier,
 * e.g. `wiki:{wikiId}:{pagePath}` or `wi:{id}`.
 */
function workItemExternalId(id: number): string {
  return `wi:${id}`
}

function wikiPageExternalId(wikiId: string, pagePath: string): string {
  return `wiki:${wikiId}:${pagePath}`
}

/**
 * Parses a wiki external ID back into its wiki ID and page path.
 */
function parseWikiExternalId(externalId: string): { wikiId: string; pagePath: string } | null {
  if (!externalId.startsWith('wiki:')) return null
  const rest = externalId.slice('wiki:'.length)
  const sep = rest.indexOf(':')
  if (sep === -1) return null
  return { wikiId: rest.slice(0, sep), pagePath: rest.slice(sep + 1) }
}

/**
 * Builds the externalId for a repository file: `file:{repoId}:{path}`. The path
 * retains its leading slash as returned by the Items API.
 */
function fileExternalId(repoId: string, path: string): string {
  return `${FILE_PREFIX}${repoId}:${path}`
}

/**
 * Parses a file externalId back into its repository ID and path. Returns null
 * when the externalId is not a file ID.
 */
function parseFileExternalId(externalId: string): { repoId: string; path: string } | null {
  if (!externalId.startsWith(FILE_PREFIX)) return null
  const rest = externalId.slice(FILE_PREFIX.length)
  const sep = rest.indexOf(':')
  if (sep === -1) return null
  return { repoId: rest.slice(0, sep), path: rest.slice(sep + 1) }
}

/**
 * Builds the change-detection hash for a repository file. The git blob objectId
 * is content-addressable, so it changes exactly when the file content changes,
 * and it is reported both by the tree listing (`objectId`) and the per-file
 * metadata fetch (`objectId`) — so the listing stub and the hydrated document
 * normally hash identically without a content fetch during listing.
 *
 * Hydration in getFileDocument is a two-step fetch against the same branch ref:
 * a JSON metadata call yields the objectId used for this hash, then a raw
 * octet-stream call yields the content. Both pin to the branch *name*, not a
 * commit SHA, so if the branch advances between the two calls the stored hash
 * (metadata call's objectId) and the stored content (content call's bytes) can
 * be one commit apart. This window is bounded and self-heals: the next listing
 * reports the branch's current objectId, which differs from the stored
 * one-commit-old hash, queuing an update that re-fetches and re-converges
 * content and hash. (A revert to identical bytes yields the identical objectId
 * by content-addressing, so the stored content is already correct in that case.)
 */
function buildFileContentHash(repoId: string, objectId: string): string {
  return `ado:file:${repoId}:${objectId}`
}

interface WikiV2 {
  id: string
  name: string
  remoteUrl?: string
  type?: string
}

interface GitRepository {
  id: string
  name: string
  defaultBranch?: string
  isDisabled?: boolean
  remoteUrl?: string
  webUrl?: string
  size?: number
}

interface GitItem {
  objectId: string
  gitObjectType?: string
  path: string
  isFolder?: boolean
  content?: string
  contentMetadata?: {
    isBinary?: boolean
    fileName?: string
    encoding?: number
  }
}

/**
 * A repository file flattened across all in-scope repositories, carrying enough
 * context to build its stub and source URL during offset-based pagination.
 */
interface RepoFileEntry {
  repoId: string
  repoName: string
  repoWebUrl?: string
  branch: string
  item: GitItem
}

interface WikiPageDetail {
  id: number
  path: string
}

interface WorkItemRef {
  id: number
}

interface RawWorkItem {
  id: number
  rev?: number
  url?: string
  fields?: Record<string, unknown>
}

/**
 * Resolves the change-detection revision for a work item. ADO returns the
 * revision as the top-level `rev` property on each batch item; `System.Rev` is
 * not guaranteed to be echoed in the requested `fields`, so `rev` is the
 * authoritative source. Falls back to the in-fields rev, then `System.ChangedDate`.
 */
function resolveWorkItemRev(raw: RawWorkItem, fields: Record<string, unknown>): string {
  if (typeof raw.rev === 'number') return String(raw.rev)
  const fieldRev = fields['System.Rev']
  if (typeof fieldRev === 'number') return String(fieldRev)
  const changed = fields['System.ChangedDate']
  if (typeof changed === 'string' && changed) return changed
  return '0'
}

/**
 * Fetches the list of wikis in the configured project. Returns an empty list on
 * 401/403/404 so a missing or inaccessible wiki feature degrades gracefully
 * rather than aborting the sync.
 */
async function listWikis(
  accessToken: string,
  organization: string,
  project: string,
  retryOptions?: Parameters<typeof fetchWithRetry>[2],
  syncContext?: Record<string, unknown>
): Promise<WikiV2[]> {
  const url = `${ADO_BASE_URL}/${encodeURIComponent(organization)}/${encodeURIComponent(project)}/_apis/wiki/wikis?api-version=${WIKIS_LIST_API_VERSION}`
  const response = await fetchWithRetry(
    url,
    {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: patAuthHeader(accessToken) },
    },
    retryOptions
  )
  if (!response.ok) {
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      /**
       * 401/403 mean the wikis still exist but this PAT cannot read them right
       * now — flag the listing as incomplete so reconciliation does not delete
       * previously synced wiki pages. A 404 means the wiki feature/content is
       * genuinely absent, so reconciliation stays enabled.
       */
      if ((response.status === 401 || response.status === 403) && syncContext) {
        syncContext.listingCapped = true
      }
      logger.warn('Azure DevOps wikis unavailable; skipping wiki listing', {
        organization,
        project,
        status: response.status,
      })
      return []
    }
    const errorText = await response.text().catch(() => '')
    logger.error('Failed to list Azure DevOps wikis', { status: response.status, error: errorText })
    throw new Error(`Failed to list wikis: ${response.status}`)
  }
  const data = await response.json()
  return (data.value as WikiV2[] | undefined) ?? []
}

/**
 * Resolves the wikis for the project, caching them on the sync context so a
 * single sync (and its deferred getDocument calls) reuse one listing.
 */
async function resolveWikis(
  accessToken: string,
  organization: string,
  project: string,
  syncContext?: Record<string, unknown>
): Promise<WikiV2[]> {
  const cached = syncContext?.wikis as WikiV2[] | undefined
  if (cached) return cached
  const wikis = await listWikis(accessToken, organization, project, undefined, syncContext)
  if (syncContext) syncContext.wikis = wikis
  return wikis
}

/**
 * Returns true when the wiki should be included given an optional wiki filter
 * (matched case-insensitively against the wiki id or name).
 */
function wikiMatchesFilter(wiki: WikiV2, filter: string): boolean {
  if (!filter) return true
  const needle = filter.toLowerCase()
  return wiki.id.toLowerCase() === needle || (wiki.name ?? '').toLowerCase() === needle
}

/**
 * Fetches the ETag for a single wiki page without downloading its content.
 * The ETag changes whenever the page is edited, making it a reliable
 * metadata-only change-detection hash for the deferred-content pattern.
 */
async function fetchWikiPageETag(
  accessToken: string,
  organization: string,
  project: string,
  wikiId: string,
  pagePath: string
): Promise<string | null> {
  const url = `${ADO_BASE_URL}/${encodeURIComponent(organization)}/${encodeURIComponent(project)}/_apis/wiki/wikis/${encodeURIComponent(wikiId)}/pages?path=${encodeURIComponent(pagePath)}&api-version=${WIKI_API_VERSION}`
  const response = await fetchWithRetry(url, {
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: patAuthHeader(accessToken) },
  })
  if (!response.ok) {
    if (response.status === 404) return null
    logger.warn('Failed to fetch wiki page ETag', { pagePath, status: response.status })
    return null
  }
  const etag = response.headers.get('etag')
  return etag ? etag.replace(/"/g, '') : null
}

/**
 * Builds a wiki page stub. The contentHash is derived from the page ETag
 * (falls back to the page id when no ETag is available), guaranteeing the
 * hash is identical between listing and content fetch.
 */
function wikiPageToStub(
  organization: string,
  project: string,
  wiki: WikiV2,
  page: WikiPageDetail,
  etag: string | null
): ExternalDocument {
  const title = page.path.split('/').filter(Boolean).pop() || page.path || 'Untitled'
  const sourceUrl = wiki.remoteUrl
    ? `${wiki.remoteUrl}?pagePath=${encodeURIComponent(page.path)}`
    : undefined
  return {
    externalId: wikiPageExternalId(wiki.id, page.path),
    title,
    content: '',
    contentDeferred: true,
    mimeType: 'text/plain',
    sourceUrl,
    contentHash: `ado:wiki:${wiki.id}:${page.path}:${etag ?? page.id}`,
    metadata: {
      kind: 'wiki',
      organization,
      project,
      wikiId: wiki.id,
      wikiName: wiki.name,
      pageId: page.id,
      pagePath: page.path,
    },
  }
}

/**
 * Builds a work item document. Work items are returned inline (not deferred)
 * because the batch fetch already includes all field content. The contentHash
 * uses the work item revision, which increments on every change. HTML-bearing
 * fields (description, repro steps, acceptance criteria) are stripped to text.
 */
function workItemToDocument(
  organization: string,
  project: string,
  raw: RawWorkItem
): ExternalDocument {
  const fields = raw.fields ?? {}
  const title = (fields['System.Title'] as string | undefined) ?? `Work Item ${raw.id}`
  const workItemType = (fields['System.WorkItemType'] as string | undefined) ?? ''
  const state = (fields['System.State'] as string | undefined) ?? ''
  const rev = resolveWorkItemRev(raw, fields)
  const changedDate = (fields['System.ChangedDate'] as string | undefined) ?? ''
  const areaPath = (fields['System.AreaPath'] as string | undefined) ?? ''
  const iterationPath = (fields['System.IterationPath'] as string | undefined) ?? ''
  const rawTags = (fields['System.Tags'] as string | undefined) ?? ''
  const tags = rawTags
    .split(';')
    .map((t) => t.trim())
    .filter(Boolean)
  const description = htmlToPlainText((fields['System.Description'] as string | undefined) ?? '')
  const reproSteps = htmlToPlainText(
    (fields['Microsoft.VSTS.TCM.ReproSteps'] as string | undefined) ?? ''
  )
  const acceptanceCriteria = htmlToPlainText(
    (fields['Microsoft.VSTS.Common.AcceptanceCriteria'] as string | undefined) ?? ''
  )

  const contentParts: string[] = [`Title: ${title}`, `Type: ${workItemType}`, `State: ${state}`]
  if (tags.length > 0) contentParts.push(`Tags: ${tags.join(', ')}`)
  if (description) contentParts.push('', 'Description:', description)
  if (reproSteps) contentParts.push('', 'Repro Steps:', reproSteps)
  if (acceptanceCriteria) contentParts.push('', 'Acceptance Criteria:', acceptanceCriteria)

  return {
    externalId: workItemExternalId(raw.id),
    title: `#${raw.id}: ${title}`,
    content: contentParts.join('\n'),
    contentDeferred: false,
    mimeType: 'text/plain',
    sourceUrl: `${ADO_BASE_URL}/${encodeURIComponent(organization)}/${encodeURIComponent(project)}/_workitems/edit/${raw.id}`,
    contentHash: `ado:wi:${raw.id}:${rev}`,
    metadata: {
      kind: 'workitem',
      organization,
      project,
      workItemId: raw.id,
      workItemType,
      state,
      areaPath,
      iterationPath,
      tags,
      changedDate,
      rev,
    },
  }
}

/**
 * Reads the work-item filter configuration from sourceConfig.
 */
interface WorkItemFilters {
  workItemType: string
  state: string
  areaPath: string
  tags: string[]
  customWiql: string
}

function readWorkItemFilters(sourceConfig: Record<string, unknown>): WorkItemFilters {
  const tagsRaw = readString(sourceConfig.workItemTags)
  const tags = tagsRaw
    ? tagsRaw
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
    : []
  return {
    workItemType: readString(sourceConfig.workItemType),
    state: readString(sourceConfig.state),
    areaPath: readString(sourceConfig.areaPath),
    tags,
    customWiql: readString(sourceConfig.customWiql),
  }
}

/**
 * Builds the WIQL query for the configured work-item filters. User-supplied
 * values are escaped against WIQL string-literal injection. `lastSyncAt`
 * narrows results to items changed since the previous sync, and `idAfter`
 * restricts to items with a greater id (used to probe past the 20,000-item
 * WIQL cap).
 *
 * A custom WIQL query is used verbatim: neither the incremental changed-date
 * filter nor the probe condition can be injected into arbitrary user WIQL
 * safely, so custom queries always run as full listings on every sync. Change
 * detection still short-circuits unchanged items via the content hash.
 */
function buildWiql(filters: WorkItemFilters, lastSyncAt?: Date, idAfter?: number): string {
  if (filters.customWiql) return filters.customWiql

  const clauses: string[] = ['[System.TeamProject] = @project']
  if (filters.workItemType) {
    clauses.push(`[System.WorkItemType] = '${escapeWiql(filters.workItemType)}'`)
  }
  if (filters.state) {
    clauses.push(`[System.State] = '${escapeWiql(filters.state)}'`)
  }
  if (filters.areaPath) {
    clauses.push(`[System.AreaPath] UNDER '${escapeWiql(filters.areaPath)}'`)
  }
  for (const tag of filters.tags) {
    clauses.push(`[System.Tags] CONTAINS '${escapeWiql(tag)}'`)
  }
  if (lastSyncAt) {
    clauses.push(`[System.ChangedDate] >= '${lastSyncAt.toISOString()}'`)
  }
  if (idAfter !== undefined) {
    clauses.push(`[System.Id] > ${idAfter}`)
  }

  return `SELECT [System.Id] FROM workitems WHERE ${clauses.join(' AND ')} ORDER BY [System.ChangedDate] DESC`
}

/**
 * Runs a WIQL query for work items in the project and returns their IDs.
 * WIQL itself is not paginated and returns at most 20,000 ids; pagination
 * happens over the resulting ID list via the workitemsbatch endpoint.
 */
async function queryWorkItemIds(
  accessToken: string,
  organization: string,
  project: string,
  wiql: string,
  top: number = WIQL_MAX_RESULTS
): Promise<number[]> {
  const url = `${ADO_BASE_URL}/${encodeURIComponent(organization)}/${encodeURIComponent(project)}/_apis/wit/wiql?$top=${top}&api-version=${WIQL_API_VERSION}`
  const response = await fetchWithRetry(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: patAuthHeader(accessToken),
    },
    body: JSON.stringify({ query: wiql }),
  })
  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    logger.error('Failed to query Azure DevOps work items', {
      status: response.status,
      error: errorText,
    })
    throw new Error(`Failed to query work items: ${response.status}`)
  }
  const data = await response.json()
  const refs = (data.workItems as WorkItemRef[] | undefined) ?? []
  if (refs.length >= WIQL_MAX_RESULTS) {
    logger.warn('WIQL result hit the 20,000-item cap; narrow work-item filters to sync all items', {
      organization,
      project,
    })
  }
  return refs.map((ref) => ref.id)
}

/**
 * Fetches full field details for a batch of work item IDs (max 200 per call).
 * `errorPolicy: 'Omit'` keeps the batch resilient: a single inaccessible or
 * deleted id is dropped from the response rather than failing the whole call.
 */
async function fetchWorkItemsBatch(
  accessToken: string,
  organization: string,
  project: string,
  ids: number[]
): Promise<RawWorkItem[]> {
  if (ids.length === 0) return []
  const url = `${ADO_BASE_URL}/${encodeURIComponent(organization)}/${encodeURIComponent(project)}/_apis/wit/workitemsbatch?api-version=${WORKITEMS_API_VERSION}`
  const response = await fetchWithRetry(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: patAuthHeader(accessToken),
    },
    body: JSON.stringify({
      ids,
      errorPolicy: 'Omit',
      fields: [
        'System.Id',
        'System.Title',
        'System.WorkItemType',
        'System.State',
        'System.AreaPath',
        'System.IterationPath',
        'System.ChangedDate',
        'System.Tags',
        'System.Description',
        'Microsoft.VSTS.TCM.ReproSteps',
        'Microsoft.VSTS.Common.AcceptanceCriteria',
      ],
    }),
  })
  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    logger.error('Failed to fetch Azure DevOps work items batch', {
      status: response.status,
      error: errorText,
    })
    throw new Error(`Failed to fetch work items batch: ${response.status}`)
  }
  const data = await response.json()
  return (data.value as RawWorkItem[] | undefined) ?? []
}

/**
 * Reads the repository-file filter configuration from sourceConfig.
 */
interface FileFilters {
  repositoryName: string
  branch: string
  pathPrefix: string
  extensions: Set<string> | null
}

function readFileFilters(sourceConfig: Record<string, unknown>): FileFilters {
  const rawPrefix = readString(sourceConfig.pathPrefix)
  return {
    repositoryName: readString(sourceConfig.repositoryName),
    branch: readString(sourceConfig.branch),
    pathPrefix: rawPrefix,
    extensions: parseExtensions(sourceConfig.fileExtensions),
  }
}

/**
 * Lists the project's git repositories. Returns an empty list on 401/403/404 so
 * a project without Git or without repo access degrades gracefully instead of
 * aborting the sync.
 */
async function listRepositories(
  accessToken: string,
  organization: string,
  project: string,
  retryOptions?: Parameters<typeof fetchWithRetry>[2],
  syncContext?: Record<string, unknown>
): Promise<GitRepository[]> {
  const url = `${ADO_BASE_URL}/${encodeURIComponent(organization)}/${encodeURIComponent(project)}/_apis/git/repositories?api-version=${GIT_API_VERSION}`
  const response = await fetchWithRetry(
    url,
    {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: patAuthHeader(accessToken) },
    },
    retryOptions
  )
  if (!response.ok) {
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      /**
       * 401/403 mean repositories still exist but this PAT cannot read them
       * right now — flag the listing as incomplete so reconciliation does not
       * delete previously synced repository files. A 404 means the Git feature
       * is genuinely absent, so reconciliation stays enabled.
       */
      if ((response.status === 401 || response.status === 403) && syncContext) {
        syncContext.listingCapped = true
      }
      logger.warn('Azure DevOps repositories unavailable; skipping file listing', {
        organization,
        project,
        status: response.status,
      })
      return []
    }
    const errorText = await response.text().catch(() => '')
    logger.error('Failed to list Azure DevOps repositories', {
      status: response.status,
      error: errorText,
    })
    throw new Error(`Failed to list repositories: ${response.status}`)
  }
  const data = await response.json()
  return (data.value as GitRepository[] | undefined) ?? []
}

/**
 * Resolves the in-scope repositories for the project, caching them on the sync
 * context so a single sync reuses one listing. Disabled repositories and, when a
 * filter is set, non-matching repositories are excluded.
 */
async function resolveRepositories(
  accessToken: string,
  organization: string,
  project: string,
  repositoryFilter: string,
  syncContext?: Record<string, unknown>
): Promise<GitRepository[]> {
  const cached = syncContext?.repositories as GitRepository[] | undefined
  const all =
    cached ?? (await listRepositories(accessToken, organization, project, undefined, syncContext))
  if (syncContext && !cached) syncContext.repositories = all

  const needle = repositoryFilter.toLowerCase()
  return all.filter((repo) => {
    if (repo.isDisabled) return false
    if (!needle) return true
    return repo.id.toLowerCase() === needle || (repo.name ?? '').toLowerCase() === needle
  })
}

/**
 * Lists every blob in a repository at the given branch via the non-paginated
 * Items list API (recursionLevel=Full). Returns an empty list on 401/403/404 so
 * a single inaccessible or empty repo does not abort the sync.
 */
async function listRepositoryBlobs(
  accessToken: string,
  organization: string,
  project: string,
  repoId: string,
  branch: string,
  syncContext?: Record<string, unknown>
): Promise<GitItem[]> {
  const params = new URLSearchParams({
    recursionLevel: 'Full',
    'versionDescriptor.version': branch,
    'versionDescriptor.versionType': 'Branch',
    'api-version': GIT_API_VERSION,
  })
  const url = `${ADO_BASE_URL}/${encodeURIComponent(organization)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repoId)}/items?${params.toString()}`
  const response = await fetchWithRetry(url, {
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: patAuthHeader(accessToken) },
  })
  if (!response.ok) {
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      /**
       * 401/403 mean the repository's files still exist but this PAT cannot
       * read them right now — flag the listing as incomplete so reconciliation
       * does not delete previously synced files. A 404 means the branch/repo
       * content is genuinely absent (empty repo, deleted branch), so
       * reconciliation stays enabled.
       */
      if ((response.status === 401 || response.status === 403) && syncContext) {
        syncContext.listingCapped = true
      }
      logger.warn('Azure DevOps repository items unavailable; skipping repository', {
        repoId,
        branch,
        status: response.status,
      })
      return []
    }
    const errorText = await response.text().catch(() => '')
    logger.error('Failed to list Azure DevOps repository items', {
      repoId,
      branch,
      status: response.status,
      error: errorText,
    })
    throw new Error(`Failed to list repository items: ${response.status}`)
  }
  /**
   * The Items list API documents no pagination, but very large trees may emit
   * an `x-ms-continuationtoken` response header. No request parameter exists
   * to follow it, so when it appears the tree is treated as incomplete: the
   * listing is flagged so deletion reconciliation cannot remove files that
   * were never returned.
   */
  if (response.headers.get('x-ms-continuationtoken')) {
    if (syncContext) syncContext.listingCapped = true
    logger.warn(
      'Azure DevOps repository tree listing returned a continuation token; partial tree',
      {
        repoId,
        branch,
      }
    )
  }
  const data = await response.json()
  const items = (data.value as GitItem[] | undefined) ?? []
  return items.filter((item) => item.gitObjectType === 'blob' && !item.isFolder && item.path)
}

/**
 * Builds the web UI URL for a repository file at a given branch. Azure DevOps
 * file links use `{repoWebUrl}?path={path}&version=GB{branch}` (GB = Git Branch).
 */
function buildFileSourceUrl(
  repoWebUrl: string | undefined,
  branch: string,
  path: string
): string | undefined {
  if (!repoWebUrl) return undefined
  return `${repoWebUrl}?path=${encodeURIComponent(path)}&version=GB${encodeURIComponent(branch)}`
}

/**
 * Builds a deferred stub for a repository file. Content is empty and fetched
 * lazily via getDocument for new/changed files only. The contentHash is the git
 * blob objectId, identical between the stub and the hydrated document.
 */
function fileToStub(organization: string, project: string, entry: RepoFileEntry): ExternalDocument {
  const path = entry.item.path
  const title = path.split('/').filter(Boolean).pop() || path
  return {
    externalId: fileExternalId(entry.repoId, path),
    title,
    content: '',
    contentDeferred: true,
    mimeType: 'text/plain',
    sourceUrl: buildFileSourceUrl(entry.repoWebUrl, entry.branch, path),
    contentHash: buildFileContentHash(entry.repoId, entry.item.objectId),
    metadata: {
      kind: 'file',
      organization,
      project,
      repository: entry.repoName,
      repositoryId: entry.repoId,
      branch: entry.branch,
      path,
    },
  }
}

/**
 * Resolves the flattened, filtered list of repository files for the configured
 * scope. Repositories are listed once, each is walked via the recursive Items
 * API, and blobs are filtered by path prefix and extension. The result is cached
 * on syncContext so offset-based pagination and the maxItems cap apply over a
 * stable list across pages.
 */
async function resolveRepoFiles(
  accessToken: string,
  organization: string,
  project: string,
  filters: FileFilters,
  syncContext?: Record<string, unknown>
): Promise<RepoFileEntry[]> {
  const cached = syncContext?.repoFiles as RepoFileEntry[] | undefined
  if (cached) return cached

  const repositories = await resolveRepositories(
    accessToken,
    organization,
    project,
    filters.repositoryName,
    syncContext
  )

  const normalizedPrefix =
    filters.pathPrefix && !filters.pathPrefix.startsWith('/')
      ? `/${filters.pathPrefix}`
      : filters.pathPrefix

  const entries: RepoFileEntry[] = []
  for (const repo of repositories) {
    const branch = filters.branch || stripRefsHeads(repo.defaultBranch ?? '')
    if (!branch) {
      /**
       * No branch override and no resolvable default branch. An empty
       * repository (size 0) has nothing to list and nothing previously synced,
       * so it is skipped without flagging — flagging here would permanently
       * suppress deletion reconciliation for any project containing an empty
       * repo. A non-empty repository reaching this branch means content exists
       * but its default branch ref is missing/unreadable, so the listing is
       * flagged incomplete to protect previously synced files from
       * reconciliation deletion.
       */
      if ((repo.size ?? 0) > 0 && syncContext) {
        syncContext.listingCapped = true
      }
      logger.warn('Skipping Azure DevOps repository with no default branch', {
        repoId: repo.id,
        repoName: repo.name,
        size: repo.size ?? 0,
      })
      continue
    }
    const blobs = await listRepositoryBlobs(
      accessToken,
      organization,
      project,
      repo.id,
      branch,
      syncContext
    )
    for (const item of blobs) {
      if (normalizedPrefix && !item.path.startsWith(normalizedPrefix)) continue
      if (!matchesExtension(item.path, filters.extensions)) continue
      entries.push({
        repoId: repo.id,
        repoName: repo.name,
        repoWebUrl: repo.webUrl,
        branch,
        item,
      })
    }
  }

  if (syncContext) syncContext.repoFiles = entries
  return entries
}

/**
 * Lists a single batch of repository-file stubs. The full filtered file list is
 * resolved once and cached on syncContext; the cursor is an offset into that
 * list, of the form `file|{offset}`.
 */
async function listRepoFiles(
  accessToken: string,
  organization: string,
  project: string,
  filters: FileFilters,
  maxItems: number,
  cursor: string | undefined,
  syncContext: Record<string, unknown> | undefined
): Promise<ExternalDocumentList> {
  const entries = await resolveRepoFiles(accessToken, organization, project, filters, syncContext)

  if (entries.length === 0) {
    return { documents: [], hasMore: false }
  }

  let offset = 0
  if (cursor) {
    const parts = cursor.split('|')
    offset = Number(parts[1]) || 0
  }

  const chunk = entries.slice(offset, offset + FILE_BATCH_SIZE)
  const documents = chunk.map((entry) => fileToStub(organization, project, entry))

  const nextOffset = offset + FILE_BATCH_SIZE
  const { documents: capped, capped: hitLimit } = applyMaxItemsCap(
    documents,
    maxItems,
    syncContext,
    nextOffset < entries.length
  )

  const hasMore = !hitLimit && nextOffset < entries.length

  return {
    documents: capped,
    nextCursor: hasMore ? `file|${nextOffset}` : undefined,
    hasMore,
  }
}

/**
 * Resolves the branch to fetch a single repository file from in getDocument. Uses
 * the configured branch override when set, otherwise the repository's default
 * branch (resolved from the cached or freshly-listed repository record).
 */
async function resolveFileBranch(
  accessToken: string,
  organization: string,
  project: string,
  repoId: string,
  branchOverride: string,
  syncContext?: Record<string, unknown>
): Promise<{ branch: string; repo?: GitRepository }> {
  if (branchOverride) {
    const repos = (syncContext?.repositories as GitRepository[] | undefined) ?? []
    return { branch: branchOverride, repo: repos.find((r) => r.id === repoId) }
  }
  const repos =
    (syncContext?.repositories as GitRepository[] | undefined) ??
    (await listRepositories(accessToken, organization, project))
  if (syncContext && !syncContext.repositories) syncContext.repositories = repos
  const repo = repos.find((r) => r.id === repoId)
  return { branch: stripRefsHeads(repo?.defaultBranch ?? ''), repo }
}

/**
 * Fetches and hydrates a single repository file by its externalId. Re-fetches the
 * item with content, rebuilds the objectId-based hash identically to the stub,
 * and skips binary, oversized, or empty files. Returns null for 404 / not found.
 */
async function getFileDocument(
  accessToken: string,
  organization: string,
  project: string,
  externalId: string,
  branchOverride: string,
  syncContext?: Record<string, unknown>
): Promise<ExternalDocument | null> {
  const parsed = parseFileExternalId(externalId)
  if (!parsed) return null
  const { repoId, path } = parsed

  const { branch, repo } = await resolveFileBranch(
    accessToken,
    organization,
    project,
    repoId,
    branchOverride,
    syncContext
  )
  if (!branch) {
    logger.warn('Cannot resolve branch for Azure DevOps file', { externalId })
    return null
  }

  const metadataParams = new URLSearchParams({
    path,
    'versionDescriptor.version': branch,
    'versionDescriptor.versionType': 'Branch',
    includeContentMetadata: 'true',
    $format: 'json',
    'api-version': GIT_API_VERSION,
  })
  const metadataUrl = `${ADO_BASE_URL}/${encodeURIComponent(organization)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repoId)}/items?${metadataParams.toString()}`
  const metadataResponse = await fetchWithRetry(metadataUrl, {
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: patAuthHeader(accessToken) },
  })

  if (!metadataResponse.ok) {
    if (metadataResponse.status === 404) return null
    throw new Error(`Failed to fetch repository file metadata: ${metadataResponse.status}`)
  }

  const item = (await metadataResponse.json()) as GitItem
  if (!item.objectId) return null
  if (item.contentMetadata?.isBinary) {
    logger.info('Skipping binary Azure DevOps file', { path })
    return null
  }

  /**
   * Content is fetched as raw bytes (Accept: application/octet-stream) rather
   * than via `includeContent=true` JSON. The JSON `content` field's encoding is
   * ambiguous (the API may deliver base64 or codepage-transcoded text per
   * `ItemContentType`), whereas the octet-stream response is the byte-exact git
   * blob, which is then binary-sniffed and decoded as UTF-8.
   */
  const contentParams = new URLSearchParams({
    path,
    'versionDescriptor.version': branch,
    'versionDescriptor.versionType': 'Branch',
    'api-version': GIT_API_VERSION,
  })
  const contentUrl = `${ADO_BASE_URL}/${encodeURIComponent(organization)}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repoId)}/items?${contentParams.toString()}`
  const contentResponse = await fetchWithRetry(contentUrl, {
    method: 'GET',
    headers: { Accept: 'application/octet-stream', Authorization: patAuthHeader(accessToken) },
  })

  if (!contentResponse.ok) {
    if (contentResponse.status === 404) return null
    throw new Error(`Failed to fetch repository file content: ${contentResponse.status}`)
  }

  const buffer = await readBodyWithLimit(contentResponse, MAX_FILE_SIZE)
  if (buffer === null) {
    logger.info('Skipping oversized Azure DevOps file', { path })
    return null
  }
  if (isBinaryBuffer(buffer)) {
    logger.info('Skipping binary Azure DevOps file', { path })
    return null
  }

  const content = buffer.toString('utf8')
  if (!content.trim()) return null

  const title = path.split('/').filter(Boolean).pop() || path
  return {
    externalId,
    title,
    content,
    contentDeferred: false,
    mimeType: 'text/plain',
    sourceUrl: buildFileSourceUrl(repo?.webUrl, branch, path),
    contentHash: buildFileContentHash(repoId, item.objectId),
    metadata: {
      kind: 'file',
      organization,
      project,
      repository: repo?.name ?? '',
      repositoryId: repoId,
      branch,
      path,
      size: buffer.byteLength,
    },
  }
}

/**
 * Applies the optional maxItems cap to a batch, tracking the running total in
 * syncContext and flagging `listingCapped` when the cap actually truncated the
 * listing. The sync engine reads `listingCapped` to suppress deletion
 * reconciliation on a truncated listing — without it, a capped full sync would
 * wrongly delete every source document beyond the cap.
 *
 * `moreAvailable` tells the helper whether the current phase has further items
 * beyond this page. The flag is only set when documents were actually dropped
 * (this page was sliced, or more pages exist) — when the cap merely coincides
 * with source exhaustion, reconciliation stays enabled so deleted source
 * documents are still cleaned up.
 */
function applyMaxItemsCap(
  documents: ExternalDocument[],
  maxItems: number,
  syncContext: Record<string, unknown> | undefined,
  moreAvailable: boolean
): { documents: ExternalDocument[]; capped: boolean } {
  if (maxItems <= 0) return { documents, capped: false }
  const prevTotal = (syncContext?.totalDocsFetched as number) ?? 0
  const remaining = Math.max(0, maxItems - prevTotal)
  const slicedSome = documents.length > remaining
  const sliced = slicedSome ? documents.slice(0, remaining) : documents
  const newTotal = prevTotal + sliced.length
  if (syncContext) syncContext.totalDocsFetched = newTotal
  const capped = newTotal >= maxItems
  if (capped && (slicedSome || moreAvailable) && syncContext) syncContext.listingCapped = true
  return { documents: sliced, capped }
}

/**
 * Lists a single batch of wiki pages across the project's wikis (optionally
 * filtered to one wiki). Uses a compound cursor of the form
 * `wiki|{wikiIndex}|{continuationToken}` so each wiki's `pagesbatch` pagination
 * is tracked independently.
 */
async function listWikiPages(
  accessToken: string,
  organization: string,
  project: string,
  wikiFilter: string,
  maxItems: number,
  cursor: string | undefined,
  syncContext?: Record<string, unknown>
): Promise<ExternalDocumentList> {
  const allWikis = await resolveWikis(accessToken, organization, project, syncContext)
  const wikis = allWikis.filter((w) => wikiMatchesFilter(w, wikiFilter))

  if (wikis.length === 0) {
    return { documents: [], hasMore: false }
  }

  let wikiIndex = 0
  let continuationToken: string | undefined
  if (cursor) {
    // The continuation token is opaque and may contain `|`; keep everything after
    // the second separator intact instead of truncating it with a naive split.
    const firstSep = cursor.indexOf('|')
    const secondSep = firstSep === -1 ? -1 : cursor.indexOf('|', firstSep + 1)
    if (secondSep !== -1) {
      wikiIndex = Number(cursor.slice(firstSep + 1, secondSep)) || 0
      const token = cursor.slice(secondSep + 1)
      continuationToken = token || undefined
    }
  }

  if (wikiIndex >= wikis.length) {
    return { documents: [], hasMore: false }
  }

  const wiki = wikis[wikiIndex]
  const url = `${ADO_BASE_URL}/${encodeURIComponent(organization)}/${encodeURIComponent(project)}/_apis/wiki/wikis/${encodeURIComponent(wiki.id)}/pagesbatch?api-version=${WIKI_API_VERSION}`
  const body: Record<string, unknown> = { top: WIKI_PAGE_BATCH_SIZE }
  if (continuationToken) body.continuationToken = continuationToken

  const response = await fetchWithRetry(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: patAuthHeader(accessToken),
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    logger.error('Failed to list Azure DevOps wiki pages', {
      wikiId: wiki.id,
      status: response.status,
      error: errorText,
    })
    throw new Error(`Failed to list wiki pages: ${response.status}`)
  }

  const data = await response.json()
  const pages = (data.value as WikiPageDetail[] | undefined) ?? []
  const nextContinuation = response.headers.get('x-ms-continuationtoken') || undefined

  const documents: ExternalDocument[] = []
  for (let i = 0; i < pages.length; i += WIKI_ETAG_CONCURRENCY) {
    const batch = pages.slice(i, i + WIKI_ETAG_CONCURRENCY)
    const stubs = await Promise.all(
      batch.map(async (page) => {
        const etag = await fetchWikiPageETag(accessToken, organization, project, wiki.id, page.path)
        return wikiPageToStub(organization, project, wiki, page, etag)
      })
    )
    documents.push(...stubs)
  }

  const { documents: capped, capped: hitLimit } = applyMaxItemsCap(
    documents,
    maxItems,
    syncContext,
    Boolean(nextContinuation) || wikiIndex + 1 < wikis.length
  )
  if (hitLimit) {
    return { documents: capped, hasMore: false }
  }

  let nextCursor: string | undefined
  let hasMore: boolean
  if (nextContinuation) {
    nextCursor = `wiki|${wikiIndex}|${nextContinuation}`
    hasMore = true
  } else if (wikiIndex + 1 < wikis.length) {
    nextCursor = `wiki|${wikiIndex + 1}|`
    hasMore = true
  } else {
    hasMore = false
  }

  return { documents: capped, nextCursor, hasMore }
}

/**
 * Lists a single batch of work items. The full ID list is resolved once via WIQL
 * and cached on the sync context; the cursor is an offset into that list.
 */
async function listWorkItems(
  accessToken: string,
  organization: string,
  project: string,
  filters: WorkItemFilters,
  maxItems: number,
  cursor: string | undefined,
  syncContext: Record<string, unknown> | undefined,
  lastSyncAt: Date | undefined
): Promise<ExternalDocumentList> {
  let ids = syncContext?.workItemIds as number[] | undefined
  if (!ids) {
    const wiql = buildWiql(filters, lastSyncAt)
    ids = await queryWorkItemIds(accessToken, organization, project, wiql)
    if (syncContext) syncContext.workItemIds = ids

    if (ids.length >= WIQL_MAX_RESULTS && syncContext) {
      /**
       * The WIQL result filled the 20,000-item cap. Distinguish an exact fit
       * from genuine truncation: for structured filters, probe for any
       * matching item with an id beyond the largest returned one and only
       * flag the listing incomplete when one exists — otherwise deletion
       * reconciliation would be disabled forever for a project with exactly
       * 20,000 matching items. Custom WIQL cannot be probed (no safe clause
       * injection), so it is flagged conservatively.
       */
      let truncated = true
      if (!filters.customWiql) {
        let maxId = 0
        for (const id of ids) {
          if (id > maxId) maxId = id
        }
        const probeWiql = buildWiql(filters, lastSyncAt, maxId)
        const beyond = await queryWorkItemIds(accessToken, organization, project, probeWiql, 1)
        truncated = beyond.length > 0
      }
      if (truncated) {
        syncContext.listingCapped = true
      }
    }
  }

  if (ids.length === 0) {
    return { documents: [], hasMore: false }
  }

  let offset = 0
  if (cursor) {
    const parts = cursor.split('|')
    offset = Number(parts[1]) || 0
  }

  const chunk = ids.slice(offset, offset + WORK_ITEM_BATCH_SIZE)
  const raw = await fetchWorkItemsBatch(accessToken, organization, project, chunk)
  if (raw.length < chunk.length && syncContext) {
    syncContext.listingCapped = true
    logger.warn(
      'workitemsbatch omitted ids that WIQL returned; flagging listing as incomplete so reconciliation skips deletion',
      { requested: chunk.length, returned: raw.length, organization, project }
    )
  }
  const documents = raw.map((item) => workItemToDocument(organization, project, item))

  const nextOffset = offset + WORK_ITEM_BATCH_SIZE
  const { documents: capped, capped: hitLimit } = applyMaxItemsCap(
    documents,
    maxItems,
    syncContext,
    nextOffset < ids.length
  )

  const hasMore = !hitLimit && nextOffset < ids.length

  return {
    documents: capped,
    nextCursor: hasMore ? `wi|${nextOffset}` : undefined,
    hasMore,
  }
}

export const azureDevopsConnector: ConnectorConfig = {
  id: 'azure_devops',
  name: 'Azure DevOps',
  description:
    'Sync wiki pages, work items, and repository files from an Azure DevOps project into your knowledge base',
  version: '1.1.0',
  icon: AzureDevOpsIcon,

  auth: {
    mode: 'apiKey',
    label: 'Personal Access Token',
    placeholder: 'Enter your Azure DevOps PAT (scopes: Wiki Read, Work Items Read, Code Read)',
  },

  /**
   * Incremental sync applies to work items only, via a `System.ChangedDate`
   * WIQL filter derived from lastSyncAt. Wiki pages have no change timestamp on
   * listing, so they are always re-listed and reconciled by ETag content hash.
   * Repository files are likewise always re-listed in full and reconciled by the
   * git blob objectId hash — a commit-diff incremental path is intentionally
   * avoided to match the github/gitlab full-listing approach, keeping change
   * detection correct without tracking per-branch commit state. Unchanged
   * documents are skipped without a content fetch in every case.
   */
  supportsIncrementalSync: true,

  configFields: [
    {
      id: 'organization',
      title: 'Organization',
      type: 'short-input',
      placeholder: 'e.g. my-org',
      required: true,
    },
    {
      id: 'project',
      title: 'Project',
      type: 'short-input',
      placeholder: 'e.g. my-project',
      required: true,
    },
    {
      id: 'contentType',
      title: 'Content',
      type: 'dropdown',
      required: false,
      options: [
        { label: 'Wiki pages only', id: 'wiki' },
        { label: 'Work items only', id: 'workitems' },
        { label: 'Repository files only', id: 'files' },
        { label: 'Wiki pages and work items', id: 'both' },
        { label: 'Wiki, work items, and files', id: 'all' },
      ],
      description: 'Which content to index from the project.',
    },
    {
      id: 'wikiName',
      title: 'Wiki',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'Wiki name or ID (all wikis if blank)',
      description:
        'Restrict syncing to a single wiki by name or ID. Applies only when syncing wiki pages.',
    },
    {
      id: 'workItemType',
      title: 'Work Item Type',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'e.g. Bug, Task, User Story',
      description: 'Only sync work items of this type. Applies only when syncing work items.',
    },
    {
      id: 'state',
      title: 'State',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'e.g. Active, Closed',
      description: 'Only sync work items in this state. Applies only when syncing work items.',
    },
    {
      id: 'areaPath',
      title: 'Area Path',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'e.g. MyProject\\Team A',
      description:
        'Only sync work items under this area path (and its children). Applies only when syncing work items.',
    },
    {
      id: 'workItemTags',
      title: 'Tags',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'e.g. customer, urgent (comma-separated)',
      description:
        'Only sync work items containing all of these tags (comma-separated). Applies only when syncing work items.',
    },
    {
      id: 'customWiql',
      title: 'Custom WIQL Query',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'SELECT [System.Id] FROM workitems WHERE ...',
      description:
        'Advanced: a full WIQL query selecting [System.Id]. Overrides the type, state, area path, and tag filters when set. Custom queries always run as full listings on every sync (the incremental changed-date filter is not applied).',
    },
    {
      id: 'repositoryName',
      title: 'Repository',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'Repository name or ID (all repos if blank)',
      description:
        'Restrict syncing to a single repository by name or ID. Applies only when syncing repository files.',
    },
    {
      id: 'branch',
      title: 'Branch',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: "Each repo's default branch",
      description:
        'Branch to sync repository files from. Defaults to each repository’s default branch. Applies only when syncing repository files.',
    },
    {
      id: 'pathPrefix',
      title: 'Path Filter',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'e.g. docs/, src/',
      description:
        'Only sync repository files under this path prefix. Applies only when syncing repository files.',
    },
    {
      id: 'fileExtensions',
      title: 'File Extensions',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'e.g. .md, .txt, .ts',
      description:
        'Only sync repository files with these extensions (comma-separated). Leave blank for all text files. Applies only when syncing repository files.',
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
    const organization = readString(sourceConfig.organization)
    const project = readString(sourceConfig.project)
    const contentType = parseContentType(sourceConfig.contentType)
    const wikiFilter = readString(sourceConfig.wikiName)
    const filters = readWorkItemFilters(sourceConfig)
    const fileFilters = readFileFilters(sourceConfig)
    const maxItems = sourceConfig.maxItems ? Number(sourceConfig.maxItems) : 0

    if (!organization || !project) {
      throw new Error('Organization and project are required')
    }

    const phases = activePhases(contentType)
    if (phases.length === 0) return { documents: [], hasMore: false }

    /**
     * Resolves which phase a cursor belongs to. Phases run in a fixed order
     * (wiki ➜ workitems ➜ file) and each phase owns a cursor prefix
     * (`wiki|`, `wi|`, `file|`). A missing cursor starts at the first active phase.
     */
    const cursorPhase: SyncPhase = cursor?.startsWith('wi|')
      ? 'workitems'
      : cursor?.startsWith('file|')
        ? 'file'
        : 'wiki'

    /**
     * A cursor from a phase that is no longer active (e.g. the content-type
     * config changed) is discarded along with its offsets — otherwise another
     * phase would misparse its tokens as numeric offsets and skip documents.
     */
    const cursorIsActive = phases.includes(cursorPhase)
    const phase = cursorIsActive ? cursorPhase : phases[0]
    const initialCursor = cursorIsActive ? cursor : undefined

    /** Lists a single batch for the given phase. The cursor is passed only when it belongs to that phase. */
    const runPhase = (target: SyncPhase, phaseCursor: string | undefined) => {
      if (target === 'wiki') {
        return listWikiPages(
          accessToken,
          organization,
          project,
          wikiFilter,
          maxItems,
          phaseCursor,
          syncContext
        )
      }
      if (target === 'workitems') {
        return listWorkItems(
          accessToken,
          organization,
          project,
          filters,
          maxItems,
          phaseCursor,
          syncContext,
          lastSyncAt
        )
      }
      return listRepoFiles(
        accessToken,
        organization,
        project,
        fileFilters,
        maxItems,
        phaseCursor,
        syncContext
      )
    }

    /** True once the maxItems cap has been reached during this sync run. */
    const capReached = () =>
      maxItems > 0 && ((syncContext?.totalDocsFetched as number) ?? 0) >= maxItems

    /**
     * Walks phases starting at `phase`, accumulating documents. Within a phase,
     * pagination is driven by that phase's own cursor; when a phase is exhausted
     * the walker advances to the next active phase (resetting its cursor). The
     * maxItems cap is honored at phase boundaries so the cap is never exceeded
     * across phases.
     */
    let current: SyncPhase | undefined = phase
    let phaseCursor = initialCursor
    const documents: ExternalDocument[] = []

    while (current) {
      const result = await runPhase(current, phaseCursor)
      documents.push(...result.documents)

      if (result.hasMore) {
        return { documents, nextCursor: result.nextCursor, hasMore: true }
      }
      if (capReached()) {
        const remainingPhase = nextPhase(current, contentType)
        if (remainingPhase && syncContext) {
          syncContext.listingCapped = true
        }
        return { documents, hasMore: false }
      }
      current = nextPhase(current, contentType)
      phaseCursor = undefined
    }

    return { documents, hasMore: false }
  },

  getDocument: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    externalId: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocument | null> => {
    const organization = readString(sourceConfig.organization)
    const project = readString(sourceConfig.project)
    if (!organization || !project) {
      throw new Error('Organization and project are required')
    }

    /**
     * Repository files are deferred and re-fetched here. Work items are returned
     * inline during listing, so getDocument is otherwise only invoked for
     * deferred wiki pages. Unknown IDs return null defensively.
     */
    if (externalId.startsWith(FILE_PREFIX)) {
      try {
        return await getFileDocument(
          accessToken,
          organization,
          project,
          externalId,
          readString(sourceConfig.branch),
          syncContext
        )
      } catch (error) {
        logger.warn(`Failed to fetch Azure DevOps file ${externalId}`, {
          error: toError(error).message,
        })
        return null
      }
    }

    const parsed = parseWikiExternalId(externalId)
    if (!parsed) return null

    const { wikiId, pagePath } = parsed

    let wikiName: string | undefined
    let remoteUrl: string | undefined
    try {
      const wikis = await resolveWikis(accessToken, organization, project, syncContext)
      const wiki = wikis.find((w) => w.id === wikiId)
      wikiName = wiki?.name
      remoteUrl = wiki?.remoteUrl
    } catch (error) {
      logger.warn('Failed to resolve wiki metadata for page', {
        externalId,
        error: toError(error).message,
      })
    }

    const url = `${ADO_BASE_URL}/${encodeURIComponent(organization)}/${encodeURIComponent(project)}/_apis/wiki/wikis/${encodeURIComponent(wikiId)}/pages?path=${encodeURIComponent(pagePath)}&includeContent=true&api-version=${WIKI_API_VERSION}`
    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: patAuthHeader(accessToken) },
    })

    if (!response.ok) {
      if (response.status === 404) return null
      throw new Error(`Failed to fetch wiki page: ${response.status}`)
    }

    const etag = response.headers.get('etag')
    const data = await response.json()
    const content = (data.content as string | undefined) ?? ''
    if (!content.trim()) return null

    const pageId = (data.id as number | undefined) ?? 0
    const title = pagePath.split('/').filter(Boolean).pop() || pagePath || 'Untitled'
    const sourceUrl = remoteUrl
      ? `${remoteUrl}?pagePath=${encodeURIComponent(pagePath)}`
      : ((data.remoteUrl as string | undefined) ?? undefined)

    return {
      externalId,
      title,
      content,
      contentDeferred: false,
      mimeType: 'text/plain',
      sourceUrl,
      contentHash: `ado:wiki:${wikiId}:${pagePath}:${etag ? etag.replace(/"/g, '') : pageId}`,
      metadata: {
        kind: 'wiki',
        organization,
        project,
        wikiId,
        wikiName,
        pageId,
        pagePath,
      },
    }
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const organization = readString(sourceConfig.organization)
    const project = readString(sourceConfig.project)

    if (!organization || !project) {
      return { valid: false, error: 'Organization and project are required' }
    }

    const maxItems = sourceConfig.maxItems as string | undefined
    if (maxItems && (Number.isNaN(Number(maxItems)) || Number(maxItems) <= 0)) {
      return { valid: false, error: 'Max items must be a positive number' }
    }

    const customWiql = readString(sourceConfig.customWiql)
    if (customWiql && !/from\s+workitems/i.test(customWiql)) {
      return {
        valid: false,
        error: 'Custom WIQL query must select work items (e.g. "... FROM workitems WHERE ...")',
      }
    }

    const contentType = parseContentType(sourceConfig.contentType)
    const repositoryFilter = readString(sourceConfig.repositoryName)

    try {
      const url = `${ADO_BASE_URL}/${encodeURIComponent(organization)}/_apis/projects/${encodeURIComponent(project)}?api-version=${PROJECT_API_VERSION}`
      const response = await fetchWithRetry(
        url,
        {
          method: 'GET',
          headers: { Accept: 'application/json', Authorization: patAuthHeader(accessToken) },
        },
        VALIDATE_RETRY_OPTIONS
      )

      if (response.status === 401 || response.status === 403) {
        return { valid: false, error: 'Invalid or unauthorized Personal Access Token' }
      }
      if (response.status === 404) {
        return {
          valid: false,
          error: `Project "${project}" not found in organization "${organization}"`,
        }
      }
      if (!response.ok) {
        return { valid: false, error: `Cannot access project: ${response.status}` }
      }

      if (activePhases(contentType).includes('file')) {
        const repos = await listRepositories(
          accessToken,
          organization,
          project,
          VALIDATE_RETRY_OPTIONS
        )
        if (repositoryFilter) {
          const needle = repositoryFilter.toLowerCase()
          const match = repos.find(
            (r) => r.id.toLowerCase() === needle || (r.name ?? '').toLowerCase() === needle
          )
          if (!match) {
            return {
              valid: false,
              error: `Repository "${repositoryFilter}" not found in project "${project}"`,
            }
          }
          if (match.isDisabled) {
            return {
              valid: false,
              error: `Repository "${repositoryFilter}" is disabled`,
            }
          }
        } else if (repos.length === 0) {
          if (contentType === 'files') {
            return {
              valid: false,
              error: `No accessible Git repositories found in project "${project}"`,
            }
          }
          logger.warn('No accessible repositories; repository files will be skipped', {
            organization,
            project,
          })
        }
      }

      return { valid: true }
    } catch (error) {
      return { valid: false, error: getErrorMessage(error, 'Failed to validate configuration') }
    }
  },

  tagDefinitions: [
    { id: 'kind', displayName: 'Type', fieldType: 'text' },
    { id: 'wikiName', displayName: 'Wiki', fieldType: 'text' },
    { id: 'workItemType', displayName: 'Work Item Type', fieldType: 'text' },
    { id: 'state', displayName: 'State', fieldType: 'text' },
    { id: 'areaPath', displayName: 'Area Path', fieldType: 'text' },
    { id: 'tags', displayName: 'Tags', fieldType: 'text' },
    { id: 'repository', displayName: 'Repository', fieldType: 'text' },
    { id: 'path', displayName: 'File Path', fieldType: 'text' },
    { id: 'changedDate', displayName: 'Changed Date', fieldType: 'date' },
  ],

  /**
   * Maps document metadata to tag slots. `kind` applies to every document.
   * `wikiName` is wiki-only; `workItemType`/`state`/`areaPath`/`tags`/`changedDate`
   * are work-item-only; `repository`/`path` are file-only. Each document type leaves
   * the others' fields empty and the type/empty guards below skip them.
   */
  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    if (typeof metadata.kind === 'string') result.kind = metadata.kind
    if (typeof metadata.wikiName === 'string' && metadata.wikiName) {
      result.wikiName = metadata.wikiName
    }
    if (typeof metadata.workItemType === 'string' && metadata.workItemType) {
      result.workItemType = metadata.workItemType
    }
    if (typeof metadata.state === 'string' && metadata.state) result.state = metadata.state
    if (typeof metadata.areaPath === 'string' && metadata.areaPath)
      result.areaPath = metadata.areaPath

    if (typeof metadata.repository === 'string' && metadata.repository) {
      result.repository = metadata.repository
    }
    if (typeof metadata.path === 'string' && metadata.path) result.path = metadata.path

    const tags = joinTagArray(metadata.tags)
    if (tags) result.tags = tags

    const changedDate = parseTagDate(metadata.changedDate)
    if (changedDate) result.changedDate = changedDate

    return result
  },
}
