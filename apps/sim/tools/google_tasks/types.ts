import type { ToolResponse } from '@/tools/types'

export const TASKS_API_BASE = 'https://tasks.googleapis.com/tasks/v1'

export interface BaseGoogleTasksParams {
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
      links: Array<{ type: string; description: string; link: string }>
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
