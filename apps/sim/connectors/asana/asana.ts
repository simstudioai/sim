import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import { asanaConnectorMeta } from '@/connectors/asana/meta'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { joinTagArray, parseTagDate } from '@/connectors/utils'

const logger = createLogger('AsanaConnector')

const ASANA_API = 'https://app.asana.com/api/1.0'

const TASK_OPT_FIELDS = 'name,notes,completed,modified_at,assignee.name,tags.name,permalink_url'

/**
 * Asana caps `limit` at 100 objects per page on every collection endpoint.
 */
const ASANA_MAX_PAGE_SIZE = 100

/**
 * Upper bound on Asana task requests issued per `listDocuments` call.
 *
 * The connector walks one project at a time, so without this the choice is
 * between one HTTP request per sync page — which burns the sync engine's
 * `MAX_PAGES` budget on workspaces with more projects than that, silently
 * setting `listingTruncated` and blocking deletion reconciliation forever — and
 * an unbounded loop that fans a 5,000-project workspace into 5,000 sequential
 * requests inside a single call. Batching a bounded number of projects per call
 * keeps both the request budget and the per-call time budget in range.
 */
const MAX_TASK_REQUESTS_PER_PAGE = 25

/**
 * Asana API response shape for paginated endpoints.
 */
interface AsanaPageResponse {
  data: AsanaTask[]
  next_page: { offset: string; uri: string } | null
}

/**
 * Minimal Asana task shape used by this connector.
 */
export interface AsanaTask {
  gid: string
  name: string
  notes?: string
  completed: boolean
  modified_at?: string
  assignee?: { name: string }
  tags?: { name: string }[]
  permalink_url?: string
  projects?: AsanaProject[]
}

/**
 * Asana workspace shape.
 */
interface AsanaWorkspace {
  gid: string
  name: string
}

/**
 * Asana project shape.
 */
export interface AsanaProject {
  gid: string
  name: string
  archived?: boolean
}

/**
 * Optional fields requested when enumerating workspace projects. `archived` is
 * not returned by default and is needed to defensively re-check the server-side
 * `archived=false` filter.
 */
const PROJECT_OPT_FIELDS = 'gid,name,archived'

/**
 * Optional fields requested when re-fetching a single task. Adds the task's
 * parent projects (with their archived flag) on top of the listing fields so
 * `isTaskUnderActiveProject` can run on the rehydrate path. `opt_fields`
 * supports dot paths, so `projects.archived` expands the compact project stubs
 * with the field the listing filter relies on. `projects.gid` is deliberately
 * not requested: Asana always returns the `gid` of included objects regardless
 * of the field options.
 */
const TASK_DETAIL_OPT_FIELDS = `${TASK_OPT_FIELDS},projects.archived`

/**
 * Builds the workspace projects listing path.
 *
 * `GET /projects` only filters on `archived` when the parameter is supplied —
 * omitting it returns archived AND active projects. Archived projects are
 * hidden from view in Asana, yet their tasks keep appearing in the connector's
 * full listing, so those tasks would never fall out via deletion reconciliation
 * (which hard-deletes only stored documents absent from the full listing) and
 * would linger in the knowledge base forever.
 *
 * `opt_fields` is appended raw rather than through `URLSearchParams` so its
 * separators stay literal commas, matching every other task call in this
 * connector and Asana's own documented examples. Only the caller-supplied
 * values (workspace gid, pagination offset) go through `URLSearchParams`, which
 * is where escaping actually matters.
 */
export function buildProjectsPath(workspaceGid: string, offset?: string): string {
  const params = new URLSearchParams({
    workspace: workspaceGid,
    archived: 'false',
    limit: '100',
  })
  if (offset) params.append('offset', offset)
  return `/projects?${params.toString()}&opt_fields=${PROJECT_OPT_FIELDS}`
}

/**
 * Builds the project task listing path.
 *
 * Mirrors `buildProjectsPath`: caller-supplied values (project gid, pagination
 * offset) go through `URLSearchParams` so they are escaped, while `opt_fields`
 * is appended raw to keep its separators literal commas. Asana offsets are
 * opaque tokens it may change the encoding of, so they are never interpolated
 * unescaped.
 */
export function buildTasksPath(projectGid: string, limit: number, offset?: string): string {
  const params = new URLSearchParams({ project: projectGid, limit: String(limit) })
  if (offset) params.append('offset', offset)
  return `/tasks?${params.toString()}&opt_fields=${TASK_OPT_FIELDS}`
}

/**
 * Keeps only projects that are still active. Asana regressed the server-side
 * `archived=false` filter once before (fixed 2024-11-06), so results are
 * re-checked client side. Fails open: a project is dropped only on an explicit
 * `archived === true`, never on a missing or non-boolean field.
 */
export function isActiveProject(project: AsanaProject): boolean {
  return project.archived !== true
}

/**
 * Mirrors `isActiveProject` on the single-task rehydrate path so a task whose
 * every parent project is archived cannot be resurrected after the listing
 * dropped it. Fails open in every ambiguous case: a task with no `projects`
 * field (the field is optional and only returned when requested), an empty
 * array, or any entry whose `archived` is missing or non-boolean is kept. A
 * task that still sits in at least one active project is kept, matching the
 * listing, which reaches it through that active project.
 *
 * `pinnedProjectGid` mirrors the listing's pinned-project exception: when the
 * user configured a specific `project`, the listing keeps syncing it even once
 * archived, so a task reachable through that project must survive rehydration
 * too. Without this the listing would keep emitting the task while every
 * hydration returned `null`, stranding it as permanently empty.
 */
export function isTaskUnderActiveProject(task: AsanaTask, pinnedProjectGid?: string): boolean {
  const projects = task.projects
  if (!Array.isArray(projects) || projects.length === 0) return true
  if (pinnedProjectGid && projects.some((project) => project?.gid === pinnedProjectGid)) return true
  return !projects.every((project) => project?.archived === true)
}

/**
 * Outcome of applying the `maxTasks` cap to one listing page.
 */
export interface TaskCapDecision {
  /** How many of this page's documents to keep. */
  keepCount: number
  /** True once the cap is reached, so pagination must stop. */
  hitLimit: boolean
  /**
   * True when the cap made the listing knowingly incomplete — either documents
   * on this page were dropped, or pages beyond the cap were left unread. The
   * caller flags `syncContext.listingCapped` so the sync engine refuses to
   * reconcile deletions against a partial listing and hard-delete everything
   * past the cap.
   */
  truncated: boolean
}

/**
 * Decides how the `maxTasks` cap applies to a listing page.
 *
 * `pageDocumentCount` and `previouslyFetched` are pre-filter counts of returned
 * tasks — the cap is never derived from post-filter array lengths. Reaching the
 * cap exactly as the source runs out (`morePagesAvailable === false` and nothing
 * dropped) leaves the listing complete, so it is not reported as truncated.
 */
export function decideTaskCap(
  maxTasks: number,
  previouslyFetched: number,
  pageDocumentCount: number,
  morePagesAvailable: boolean
): TaskCapDecision {
  if (!(maxTasks > 0)) {
    return { keepCount: pageDocumentCount, hitLimit: false, truncated: false }
  }

  const remaining = Math.max(maxTasks - previouslyFetched, 0)
  const keepCount = Math.min(pageDocumentCount, remaining)
  const droppedFromPage = keepCount < pageDocumentCount
  const hitLimit = previouslyFetched + keepCount >= maxTasks

  return {
    keepCount,
    hitLimit,
    truncated: droppedFromPage || (hitLimit && morePagesAvailable),
  }
}

/**
 * Carries the HTTP status so callers can tell a genuinely missing task (404) from a
 * transient fault (429, 5xx) that must not be swallowed.
 */
class AsanaApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'AsanaApiError'
  }
}

/**
 * Makes a GET request to the Asana REST API.
 */
async function asanaGet<T>(
  accessToken: string,
  path: string,
  retryOptions?: Parameters<typeof fetchWithRetry>[2]
): Promise<T> {
  const response = await fetchWithRetry(
    `${ASANA_API}${path}`,
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
    const errorText = await response.text()
    logger.error('Asana API request failed', { status: response.status, path, error: errorText })
    throw new AsanaApiError(`Asana API error: ${response.status}`, response.status)
  }

  return (await response.json()) as T
}

/**
 * Builds a formatted text document from an Asana task.
 */
function buildTaskContent(task: AsanaTask): string {
  const parts: string[] = []

  parts.push(task.name || 'Untitled')

  if (task.assignee?.name) parts.push(`Assignee: ${task.assignee.name}`)

  parts.push(`Completed: ${task.completed ? 'Yes' : 'No'}`)

  const tagNames = task.tags?.map((t) => t.name).filter(Boolean)
  if (tagNames && tagNames.length > 0) {
    parts.push(`Labels: ${tagNames.join(', ')}`)
  }

  if (task.notes) {
    parts.push('')
    parts.push(task.notes)
  }

  return parts.join('\n')
}

/**
 * Fetches all active project GIDs in a workspace, used when no specific project
 * is configured. Archived projects are excluded so their tasks drop out of the
 * full listing and get purged by deletion reconciliation. A project the user
 * pinned explicitly via the `project` config field keeps syncing even once
 * archived — that is a deliberate user choice, not a stale listing.
 *
 * This is a one-time destructive change on rollout: the first full sync after
 * deploy stops listing tasks that live only under archived projects, so
 * deletion reconciliation removes their stored documents. That is the intended
 * correction — those documents track content the workspace already archived —
 * but it must be called out in the release notes, since re-indexing them
 * requires unarchiving the project in Asana.
 */
async function listWorkspaceProjects(
  accessToken: string,
  workspaceGid: string
): Promise<AsanaProject[]> {
  const projects: AsanaProject[] = []
  let offset: string | undefined

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const result = await asanaGet<{ data: AsanaProject[]; next_page: { offset: string } | null }>(
      accessToken,
      buildProjectsPath(workspaceGid, offset)
    )
    projects.push(...result.data.filter(isActiveProject))
    if (!result.next_page) break
    offset = result.next_page.offset
  }

  return projects
}

export const asanaConnector: ConnectorConfig = {
  ...asanaConnectorMeta,

  isListingScopeUnavailableError: (error) =>
    error instanceof AsanaApiError && (error.status === 404 || error.status === 403),

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const workspaceGid = sourceConfig.workspace as string
    const projectGid = (sourceConfig.project as string) || ''
    const maxTasks = sourceConfig.maxTasks ? Number(sourceConfig.maxTasks) : 0
    const previouslyFetched = (syncContext?.totalDocsFetched as number) ?? 0

    /**
     * Held constant across every request of a sync. Asana's `offset` is an
     * opaque token and the docs do not say it survives a changed `limit`, while
     * `decideTaskCap` already trims the cap exactly — so varying the page size
     * per call would buy nothing and risk invalidating a mid-project offset.
     */
    const pageSize = maxTasks > 0 ? Math.min(maxTasks, ASANA_MAX_PAGE_SIZE) : ASANA_MAX_PAGE_SIZE

    /**
     * Cursor format:
     * - For a single project: the offset string directly, or undefined
     * - For all projects: JSON-encoded { projectIndex, offset }
     */
    let projectGids: string[]
    let projectIndex = 0
    let offset: string | undefined

    if (projectGid) {
      projectGids = [projectGid]
    } else {
      if (!syncContext?.projectGids) {
        logger.info('Fetching all projects in workspace', { workspaceGid })
        const projects = await listWorkspaceProjects(accessToken, workspaceGid)
        if (syncContext) syncContext.projectGids = projects.map((p) => p.gid)
        projectGids = projects.map((p) => p.gid)
      } else {
        projectGids = syncContext.projectGids as string[]
      }
    }

    if (cursor) {
      try {
        const parsed = JSON.parse(cursor) as { projectIndex: number; offset?: string }
        projectIndex = parsed.projectIndex
        offset = parsed.offset
      } catch {
        offset = cursor
      }
    }

    logger.info('Listing Asana tasks', {
      workspaceGid,
      projectCount: projectGids.length,
      projectIndex,
      offset,
      pageSize,
    })

    const documents: ExternalDocument[] = []
    let nextCursor: string | undefined
    let hasMore = false

    for (
      let request = 0;
      projectIndex < projectGids.length &&
      request < MAX_TASK_REQUESTS_PER_PAGE &&
      documents.length < pageSize;
      request++
    ) {
      const currentProjectGid = projectGids[projectIndex]

      const result = await asanaGet<AsanaPageResponse>(
        accessToken,
        buildTasksPath(currentProjectGid, pageSize, offset)
      )

      for (const task of result.data) {
        const content = buildTaskContent(task)
        const tagNames = task.tags?.map((t) => t.name).filter(Boolean) || []

        documents.push({
          externalId: task.gid,
          title: task.name || 'Untitled',
          content,
          mimeType: 'text/plain',
          sourceUrl: task.permalink_url || undefined,
          contentHash: `asana:${task.gid}:${task.modified_at ?? ''}`,
          metadata: {
            project: currentProjectGid,
            assignee: task.assignee?.name,
            completed: task.completed,
            lastModified: task.modified_at,
            labels: tagNames,
          },
        })
      }

      if (result.next_page) {
        offset = result.next_page.offset
        nextCursor = JSON.stringify({ projectIndex, offset })
        hasMore = true
        continue
      }

      projectIndex++
      offset = undefined
      hasMore = projectIndex < projectGids.length
      nextCursor = hasMore ? JSON.stringify({ projectIndex }) : undefined
    }

    const cap = decideTaskCap(maxTasks, previouslyFetched, documents.length, hasMore)
    if (cap.keepCount < documents.length) documents.splice(cap.keepCount)

    if (syncContext) syncContext.totalDocsFetched = previouslyFetched + documents.length
    if (cap.truncated && syncContext) syncContext.listingCapped = true

    if (cap.hitLimit) {
      hasMore = false
      nextCursor = undefined
    }

    return {
      documents,
      nextCursor: hasMore ? nextCursor : undefined,
      hasMore,
    }
  },

  getDocument: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    externalId: string
  ): Promise<ExternalDocument | null> => {
    const pinnedProjectGid = (sourceConfig.project as string) || undefined
    try {
      const result = await asanaGet<{ data: AsanaTask }>(
        accessToken,
        `/tasks/${encodeURIComponent(externalId)}?opt_fields=${TASK_DETAIL_OPT_FIELDS}`
      )
      const task = result.data

      if (!task) return null

      if (!isTaskUnderActiveProject(task, pinnedProjectGid)) {
        logger.info('Skipping Asana task whose projects are all archived', { externalId })
        return null
      }

      const content = buildTaskContent(task)
      const tagNames = task.tags?.map((t) => t.name).filter(Boolean) || []

      return {
        externalId: task.gid,
        title: task.name || 'Untitled',
        content,
        mimeType: 'text/plain',
        sourceUrl: task.permalink_url || undefined,
        contentHash: `asana:${task.gid}:${task.modified_at ?? ''}`,
        metadata: {
          /**
           * The listing reaches a task through exactly one project and records
           * that gid, so the rehydrate path must record one too or the `project`
           * tag would silently disappear on refresh. A pinned project wins;
           * otherwise the task's first still-active project stands in.
           */
          project: pinnedProjectGid ?? task.projects?.find((p) => p?.archived !== true)?.gid,
          assignee: task.assignee?.name,
          completed: task.completed,
          lastModified: task.modified_at,
          labels: tagNames,
        },
      }
    } catch (error) {
      /**
       * Only a 404 means the task is genuinely gone. Every other failure — 429, 5xx,
       * network faults — is rethrown so the sync engine records a failed row and keeps
       * the already-indexed task out of deletion reconciliation.
       */
      if (error instanceof AsanaApiError && error.status === 404) {
        logger.info('Asana task not found', { externalId })
        return null
      }
      logger.error('Failed to get Asana task', {
        externalId,
        error: toError(error).message,
      })
      throw toError(error)
    }
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const workspaceGid = sourceConfig.workspace as string | undefined
    if (!workspaceGid) {
      return { valid: false, error: 'Workspace GID is required' }
    }

    const maxTasks = sourceConfig.maxTasks as string | undefined
    if (maxTasks && (Number.isNaN(Number(maxTasks)) || Number(maxTasks) <= 0)) {
      return { valid: false, error: 'Max tasks must be a positive number' }
    }

    try {
      await asanaGet<{ data: AsanaWorkspace }>(
        accessToken,
        `/workspaces/${workspaceGid}`,
        VALIDATE_RETRY_OPTIONS
      )
      return { valid: true }
    } catch (error) {
      const message = getErrorMessage(error, 'Failed to validate configuration')
      return { valid: false, error: message }
    }
  },

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    if (typeof metadata.project === 'string') result.project = metadata.project
    if (typeof metadata.assignee === 'string') result.assignee = metadata.assignee
    if (typeof metadata.completed === 'boolean') result.completed = metadata.completed

    const lastModified = parseTagDate(metadata.lastModified)
    if (lastModified) result.lastModified = lastModified

    const labels = joinTagArray(metadata.labels)
    if (labels) result.labels = labels

    return result
  },
}
