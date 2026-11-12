import type { OutputProperty, ToolResponse } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const TASKS_API_BASE = 'https://tasks.googleapis.com/tasks/v1'

interface BaseGoogleTasksParams {
  accessToken: string
}

export interface GoogleTasksListTaskListsParams extends BaseGoogleTasksParams {
  maxResults?: number
  pageToken?: string
}

export interface GoogleTasksCreateParams extends BaseGoogleTasksParams {
  taskListId?: string
  title: string
  notes?: string
  due?: string
  status?: string
  parent?: string
  previous?: string
}

export interface GoogleTasksListParams extends BaseGoogleTasksParams {
  taskListId?: string
  maxResults?: number
  pageToken?: string
  showCompleted?: boolean
  showDeleted?: boolean
  showHidden?: boolean
  dueMin?: string
  dueMax?: string
  completedMin?: string
  completedMax?: string
  updatedMin?: string
  showAssigned?: boolean
}

export interface GoogleTasksGetParams extends BaseGoogleTasksParams {
  taskListId?: string
  taskId: string
}

export interface GoogleTasksUpdateParams extends BaseGoogleTasksParams {
  taskListId?: string
  taskId: string
  title?: string
  notes?: string
  due?: string
  status?: string
}

export interface GoogleTasksDeleteParams extends BaseGoogleTasksParams {
  taskListId?: string
  taskId: string
}

export interface GoogleTasksResponse extends ToolResponse {
  output: {
    id: string | null
    title: string | null
    notes: string | null
    status: string | null
    due: string | null
    updated: string | null
    selfLink: string | null
    webViewLink: string | null
    parent: string | null
    position: string | null
    completed: string | null
    deleted: boolean | null
    hidden: boolean | null
    links: TaskLink[]
    assignmentInfo: Record<string, unknown> | null
  }
}

export interface GoogleTasksListResponse extends ToolResponse {
  output: {
    tasks: Array<{
      id: string | null
      title: string | null
      notes: string | null
      status: string | null
      due: string | null
      completed: string | null
      updated: string | null
      selfLink: string | null
      webViewLink: string | null
      parent: string | null
      position: string | null
      hidden: boolean | null
      deleted: boolean | null
      links: TaskLink[]
      assignmentInfo: Record<string, unknown> | null
    }>
    nextPageToken: string | null
  }
}

export interface GoogleTasksListTaskListsResponse extends ToolResponse {
  output: {
    taskLists: Array<{
      id: string | null
      title: string | null
      updated: string | null
      selfLink: string | null
    }>
    nextPageToken: string | null
  }
}

export interface GoogleTasksDeleteResponse extends ToolResponse {
  output: {
    taskId: string
    deleted: boolean
  }
}

interface TaskLink {
  type: string
  description: string
  link: string
}

/** Builds the `lists/{tasklist}` path segment, defaulting to the primary list. */
export function taskListPath(taskListId: string | undefined): string {
  return `lists/${safeUrlPathSegment(String(taskListId ?? '').trim() || '@default', 'taskListId', { allowSeparators: true })}`
}

/** Builds the `lists/{tasklist}/tasks/{task}` path. */
export function taskPath(taskListId: string | undefined, taskId: string): string {
  return `${taskListPath(taskListId)}/tasks/${safeUrlPathSegment(taskId, 'taskId', { allowSeparators: true })}`
}

/** Maps the read-only `links` array of a Task resource. */
export function mapTaskLinks(links: unknown): TaskLink[] {
  if (!Array.isArray(links)) return []
  return links.map((link: Record<string, string | undefined>) => ({
    type: link.type ?? '',
    description: link.description ?? '',
    link: link.link ?? '',
  }))
}

/** Maps a Task resource to the single-task tool output. */
export function mapTaskOutput(data: Record<string, unknown>): GoogleTasksResponse['output'] {
  return {
    id: (data.id as string) ?? null,
    title: (data.title as string) ?? null,
    notes: (data.notes as string) ?? null,
    status: (data.status as string) ?? null,
    due: (data.due as string) ?? null,
    updated: (data.updated as string) ?? null,
    selfLink: (data.selfLink as string) ?? null,
    webViewLink: (data.webViewLink as string) ?? null,
    parent: (data.parent as string) ?? null,
    position: (data.position as string) ?? null,
    completed: (data.completed as string) ?? null,
    deleted: (data.deleted as boolean) ?? null,
    hidden: (data.hidden as boolean) ?? null,
    links: mapTaskLinks(data.links),
    assignmentInfo: (data.assignmentInfo as Record<string, unknown>) ?? null,
  }
}

export const TASK_LINKS_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Read-only links attached to the task',
  optional: true,
  items: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        description: 'Link type (e.g., "email", "generic", "chat_message", "keep_note")',
      },
      description: { type: 'string', description: 'Link description' },
      link: { type: 'string', description: 'The URL' },
    },
  },
}

export const TASK_ASSIGNMENT_INFO_OUTPUT: OutputProperty = {
  type: 'json',
  description:
    'Source of a task assigned to the current user from Google Docs or Chat (linkToTask, surfaceType, driveResourceInfo, spaceInfo)',
  optional: true,
}

export const TASK_EXTRA_OUTPUTS: Record<string, OutputProperty> = {
  hidden: {
    type: 'boolean',
    description: 'Whether the task was hidden when its list was cleared',
    optional: true,
  },
  links: TASK_LINKS_OUTPUT,
  assignmentInfo: TASK_ASSIGNMENT_INFO_OUTPUT,
}
