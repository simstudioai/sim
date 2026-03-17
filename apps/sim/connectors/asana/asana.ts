import { createLogger } from '@sim/logger'
import { AsanaIcon } from '@/components/icons'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { computeContentHash, joinTagArray, parseTagDate } from '@/connectors/utils'

const logger = createLogger('AsanaConnector')

const ASANA_API = 'https://app.asana.com/api/1.0'

const TASK_OPT_FIELDS =
  'name,notes,completed,completed_at,modified_at,assignee.name,tags.name,permalink_url'

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
interface AsanaTask {
  gid: string
  name: string
  notes?: string
  completed: boolean
  completed_at?: string
  modified_at?: string
  assignee?: { name: string }
  tags?: { name: string }[]
  permalink_url?: string
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
interface AsanaProject {
  gid: string
  name: string
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
    throw new Error(`Asana API error: ${response.status}`)
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
 * Fetches all project GIDs in a workspace, used when no specific project is configured.
 */
async function listWorkspaceProjects(
  accessToken: string,
  workspaceGid: string
): Promise<AsanaProject[]> {
  const projects: AsanaProject[] = []
  let offset: string | undefined

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const offsetParam = offset ? `&offset=${offset}` : ''
    const result = await asanaGet<{ data: AsanaProject[]; next_page: { offset: string } | null }>(
      accessToken,
      `/projects?workspace=${workspaceGid}&limit=100${offsetParam}`
    )
    projects.push(...result.data)
    if (!result.next_page) break
    offset = result.next_page.offset
  }

  return projects
}

export const asanaConnector: ConnectorConfig = {
  id: 'asana',
  name: 'Asana',
  description: 'Sync tasks from Asana into your knowledge base',
  version: '1.0.0',
  icon: AsanaIcon,

  auth: { mode: 'oauth', provider: 'asana', requiredScopes: ['default'] },

  configFields: [
    {
      id: 'workspaceSelector',
      title: 'Workspace',
      type: 'selector',
      selectorKey: 'asana.workspaces',
      canonicalParamId: 'workspace',
      mode: 'basic',
      placeholder: 'Select a workspace',
      required: true,
    },
    {
      id: 'workspace',
      title: 'Workspace GID',
      type: 'short-input',
      canonicalParamId: 'workspace',
      mode: 'advanced',
      placeholder: 'e.g. 1234567890',
      required: true,
    },
    {
      id: 'project',
      title: 'Project GID',
      type: 'short-input',
      placeholder: 'e.g. 9876543210 (leave empty for all projects)',
      required: false,
    },
    {
      id: 'maxTasks',
      title: 'Max Tasks',
      type: 'short-input',
      placeholder: 'e.g. 500 (default: unlimited)',
      required: false,
    },
  ],

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const workspaceGid = sourceConfig.workspace as string
    const projectGid = (sourceConfig.project as string) || ''
    const maxTasks = sourceConfig.maxTasks ? Number(sourceConfig.maxTasks) : 0
    const pageSize = maxTasks > 0 ? Math.min(maxTasks, 100) : 100

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

    while (projectIndex < projectGids.length) {
      const currentProjectGid = projectGids[projectIndex]
      const offsetParam = offset ? `&offset=${offset}` : ''

      const result = await asanaGet<AsanaPageResponse>(
        accessToken,
        `/tasks?project=${currentProjectGid}&opt_fields=${TASK_OPT_FIELDS}&limit=${pageSize}${offsetParam}`
      )

      for (const task of result.data) {
        const content = buildTaskContent(task)
        const contentHash = await computeContentHash(content)
        const tagNames = task.tags?.map((t) => t.name).filter(Boolean) || []

        documents.push({
          externalId: task.gid,
          title: task.name || 'Untitled',
          content,
          mimeType: 'text/plain',
          sourceUrl: task.permalink_url || undefined,
          contentHash,
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
        nextCursor = JSON.stringify({ projectIndex, offset: result.next_page.offset })
        hasMore = true
        break
      }

      projectIndex++
      offset = undefined

      if (projectIndex < projectGids.length) {
        nextCursor = JSON.stringify({ projectIndex, offset: undefined })
        hasMore = true
        break
      }
    }

    const previouslyFetched = (syncContext?.totalDocsFetched as number) ?? 0
    if (maxTasks > 0) {
      const remaining = maxTasks - previouslyFetched
      if (documents.length > remaining) {
        documents.splice(remaining)
      }
    }

    const totalFetched = previouslyFetched + documents.length
    if (syncContext) syncContext.totalDocsFetched = totalFetched
    const hitLimit = maxTasks > 0 && totalFetched >= maxTasks

    if (hitLimit) {
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
    _sourceConfig: Record<string, unknown>,
    externalId: string
  ): Promise<ExternalDocument | null> => {
    try {
      const result = await asanaGet<{ data: AsanaTask }>(
        accessToken,
        `/tasks/${externalId}?opt_fields=${TASK_OPT_FIELDS}`
      )
      const task = result.data

      if (!task) return null

      const content = buildTaskContent(task)
      const contentHash = await computeContentHash(content)
      const tagNames = task.tags?.map((t) => t.name).filter(Boolean) || []

      return {
        externalId: task.gid,
        title: task.name || 'Untitled',
        content,
        mimeType: 'text/plain',
        sourceUrl: task.permalink_url || undefined,
        contentHash,
        metadata: {
          assignee: task.assignee?.name,
          completed: task.completed,
          lastModified: task.modified_at,
          labels: tagNames,
        },
      }
    } catch (error) {
      logger.error('Failed to get Asana task', {
        externalId,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
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
      const message = error instanceof Error ? error.message : 'Failed to validate configuration'
      return { valid: false, error: message }
    }
  },

  tagDefinitions: [
    { id: 'project', displayName: 'Project', fieldType: 'text' },
    { id: 'assignee', displayName: 'Assignee', fieldType: 'text' },
    { id: 'completed', displayName: 'Completed', fieldType: 'boolean' },
    { id: 'lastModified', displayName: 'Last Modified', fieldType: 'date' },
    { id: 'labels', displayName: 'Labels', fieldType: 'text' },
  ],

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
