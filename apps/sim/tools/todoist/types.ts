import type { ToolResponse } from '@/tools/types'

export interface TodoistCreateTaskParams {
  apiKey: string
  content: string
  description?: string
  projectId?: string
  priority?: number
  dueString?: string
  labels?: string[]
}

export interface TodoistCreateTaskResponse extends ToolResponse {
  output: {
    id: string
    content: string
    description: string
    projectId: string
    priority: number
    url: string
    createdAt: string
    due: {
      date: string
      string: string
      isRecurring: boolean
    } | null
    labels: string[]
  }
}

export interface TodoistGetTaskParams {
  apiKey: string
  taskId: string
}

export interface TodoistGetTaskResponse extends ToolResponse {
  output: {
    id: string
    content: string
    description: string
    projectId: string
    priority: number
    url: string
    isCompleted: boolean
    createdAt: string
    due: {
      date: string
      string: string
      isRecurring: boolean
    } | null
    labels: string[]
  }
}

export interface TodoistListTasksParams {
  apiKey: string
  projectId?: string
  filter?: string
  label?: string
}

export interface TodoistListTasksResponse extends ToolResponse {
  output: {
    tasks: Array<{
      id: string
      content: string
      description: string
      projectId: string
      priority: number
      url: string
      isCompleted: boolean
      createdAt: string
      due: {
        date: string
        string: string
        isRecurring: boolean
      } | null
      labels: string[]
    }>
  }
}

export interface TodoistUpdateTaskParams {
  apiKey: string
  taskId: string
  content?: string
  description?: string
  priority?: number
  dueString?: string
  labels?: string[]
}

export interface TodoistUpdateTaskResponse extends ToolResponse {
  output: {
    id: string
    content: string
    description: string
    projectId: string
    priority: number
    url: string
    createdAt: string
    due: {
      date: string
      string: string
      isRecurring: boolean
    } | null
    labels: string[]
  }
}

export interface TodoistCloseTaskParams {
  apiKey: string
  taskId: string
}

export interface TodoistCloseTaskResponse extends ToolResponse {
  output: {
    success: boolean
    taskId: string
  }
}

export interface TodoistDeleteTaskParams {
  apiKey: string
  taskId: string
}

export interface TodoistDeleteTaskResponse extends ToolResponse {
  output: {
    success: boolean
    taskId: string
  }
}

export interface TodoistListProjectsParams {
  apiKey: string
}

export interface TodoistListProjectsResponse extends ToolResponse {
  output: {
    projects: Array<{
      id: string
      name: string
      color: string
      isFavorite: boolean
      isInboxProject: boolean
      viewStyle: string
    }>
  }
}

export interface TodoistAddCommentParams {
  apiKey: string
  taskId: string
  content: string
}

export interface TodoistAddCommentResponse extends ToolResponse {
  output: {
    id: string
    content: string
    postedAt: string
    taskId: string
  }
}

export type TodoistResponse =
  | TodoistCreateTaskResponse
  | TodoistGetTaskResponse
  | TodoistListTasksResponse
  | TodoistUpdateTaskResponse
  | TodoistCloseTaskResponse
  | TodoistDeleteTaskResponse
  | TodoistListProjectsResponse
  | TodoistAddCommentResponse
