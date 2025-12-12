import type { ToolResponse } from '@/tools/types'

export interface AsanaGetTaskParams {
  accessToken: string
  taskGid?: string
  workspace?: string
  project?: string
  limit?: number
}

export interface AsanaGetTaskResponse extends ToolResponse {
  output:
    | {
        ts: string
        gid: string
        resource_type: string
        resource_subtype: string
        name: string
        notes: string
        completed: boolean
        assignee?: {
          gid: string
          name: string
        }
        created_by?: {
          gid: string
          resource_type: string
          name: string
        }
        due_on?: string
        created_at: string
        modified_at: string
      }
    | {
        ts: string
        tasks: Array<{
          gid: string
          resource_type: string
          resource_subtype: string
          name: string
          notes?: string
          completed: boolean
          assignee?: {
            gid: string
            name: string
          }
          created_by?: {
            gid: string
            resource_type: string
            name: string
          }
          due_on?: string
          created_at: string
          modified_at: string
        }>
        next_page?: {
          offset: string
          path: string
          uri: string
        }
      }
}

export interface AsanaCreateTaskParams {
  accessToken: string
  workspace: string
  name: string
  notes?: string
  assignee?: string
  due_on?: string
}

export interface AsanaCreateTaskResponse extends ToolResponse {
  output: {
    ts: string
    gid: string
    name: string
    notes: string
    completed: boolean
    created_at: string
    permalink_url: string
  }
}

export interface AsanaUpdateTaskParams {
  accessToken: string
  taskGid: string
  name?: string
  notes?: string
  assignee?: string
  completed?: boolean
  due_on?: string
}

export interface AsanaUpdateTaskResponse extends ToolResponse {
  output: {
    ts: string
    gid: string
    name: string
    notes: string
    completed: boolean
    modified_at: string
  }
}

export interface AsanaGetProjectsParams {
  accessToken: string
  workspace: string
}

export interface AsanaGetProjectsResponse extends ToolResponse {
  output: {
    ts: string
    projects: Array<{
      gid: string
      name: string
      resource_type: string
    }>
  }
}

export interface AsanaSearchTasksParams {
  accessToken: string
  workspace: string
  text?: string
  assignee?: string
  projects?: string[]
  completed?: boolean
}

export interface AsanaSearchTasksResponse extends ToolResponse {
  output: {
    ts: string
    tasks: Array<{
      gid: string
      resource_type: string
      resource_subtype: string
      name: string
      notes?: string
      completed: boolean
      assignee?: {
        gid: string
        name: string
      }
      created_by?: {
        gid: string
        resource_type: string
        name: string
      }
      due_on?: string
      created_at: string
      modified_at: string
    }>
    next_page?: {
      offset: string
      path: string
      uri: string
    }
  }
}

export interface AsanaTask {
  gid: string
  resource_type: string
  resource_subtype: string
  name: string
  notes?: string
  completed: boolean
  assignee?: {
    gid: string
    name: string
  }
  created_by?: {
    gid: string
    resource_type: string
    name: string
  }
  due_on?: string
  created_at: string
  modified_at: string
}

export interface AsanaProject {
  gid: string
  name: string
  resource_type: string
}

export interface AsanaAddCommentParams {
  accessToken: string
  taskGid: string
  text: string
}

export interface AsanaAddCommentResponse extends ToolResponse {
  output: {
    ts: string
    gid: string
    text: string
    created_at: string
    created_by: {
      gid: string
      name: string
    }
  }
}

export type AsanaResponse =
  | AsanaGetTaskResponse
  | AsanaCreateTaskResponse
  | AsanaUpdateTaskResponse
  | AsanaGetProjectsResponse
  | AsanaSearchTasksResponse
  | AsanaAddCommentResponse
