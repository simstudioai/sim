import type { ToolResponse } from '@/tools/types'

export interface AsanaGetTaskParams {
  accessToken: string
  taskGid?: string
  workspace?: string
  project?: string
  limit?: number
}

export interface AsanaGetTaskResponse extends ToolResponse {
  output: {
    ts: string
    gid?: string
    resource_type?: string
    resource_subtype?: string
    name?: string
    notes?: string
    completed?: boolean
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
    created_at?: string
    modified_at?: string
    tasks?: Array<{
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

interface AsanaTask {
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

interface AsanaProject {
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

export interface AsanaCreateProjectParams {
  accessToken: string
  workspace: string
  name: string
  notes?: string
}

export interface AsanaProjectRecordResponse extends ToolResponse {
  output: {
    ts: string
    gid: string
    name: string
    notes: string
    archived?: boolean
    color?: string | null
    created_at?: string
    modified_at?: string
    permalink_url?: string
  }
}

export interface AsanaGetProjectParams {
  accessToken: string
  projectGid: string
}

export interface AsanaListWorkspacesParams {
  accessToken: string
}

export interface AsanaListWorkspacesResponse extends ToolResponse {
  output: {
    ts: string
    workspaces: Array<{
      gid: string
      name: string
      resource_type?: string
    }>
  }
}

export interface AsanaCreateSubtaskParams {
  accessToken: string
  taskGid: string
  name: string
  notes?: string
  assignee?: string
  due_on?: string
}

export interface AsanaDeleteTaskParams {
  accessToken: string
  taskGid: string
}

export interface AsanaDeleteTaskResponse extends ToolResponse {
  output: {
    ts: string
    gid: string
    deleted: true
  }
}

export interface AsanaAddFollowersParams {
  accessToken: string
  taskGid: string
  followers: string[]
}

export interface AsanaAddFollowersResponse extends ToolResponse {
  output: {
    ts: string
    gid: string
    name: string
    followers: Array<{
      gid: string
      name: string
    }>
  }
}

export interface AsanaCreateSectionParams {
  accessToken: string
  projectGid: string
  name: string
}

export interface AsanaSectionResponse extends ToolResponse {
  output: {
    ts: string
    gid: string
    name: string
    created_at?: string
  }
}

export interface AsanaListSectionsParams {
  accessToken: string
  projectGid: string
}

export interface AsanaListSectionsResponse extends ToolResponse {
  output: {
    ts: string
    sections: Array<{
      gid: string
      name: string
      resource_type?: string
    }>
  }
}

export type AsanaResponse =
  | AsanaGetTaskResponse
  | AsanaCreateTaskResponse
  | AsanaUpdateTaskResponse
  | AsanaGetProjectsResponse
  | AsanaSearchTasksResponse
  | AsanaAddCommentResponse
  | AsanaProjectRecordResponse
  | AsanaListWorkspacesResponse
  | AsanaDeleteTaskResponse
  | AsanaAddFollowersResponse
  | AsanaSectionResponse
  | AsanaListSectionsResponse
