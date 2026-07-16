import type { UserFile } from '@/executor/types'
import type { ToolResponse } from '@/tools/types'

export interface ClickUpUser {
  id: number | null
  username: string | null
  email: string | null
  profilePicture: string | null
}

export interface ClickUpMember {
  id: number | null
  username: string | null
  email: string | null
  color: string | null
  initials: string | null
  profilePicture: string | null
}

export interface ClickUpStatus {
  status: string | null
  color: string | null
  type: string | null
}

export interface ClickUpPriority {
  id: string | null
  priority: string | null
  color: string | null
}

export interface ClickUpTag {
  name: string | null
  tagFg: string | null
  tagBg: string | null
}

export interface ClickUpTask {
  id: string
  customId: string | null
  name: string
  textContent: string | null
  description: string | null
  status: ClickUpStatus | null
  archived: boolean
  creator: ClickUpUser | null
  assignees: ClickUpUser[]
  tags: ClickUpTag[]
  parent: string | null
  priority: ClickUpPriority | null
  dueDate: string | null
  startDate: string | null
  points: number | null
  timeEstimate: number | null
  dateCreated: string | null
  dateUpdated: string | null
  dateClosed: string | null
  dateDone: string | null
  list: { id: string; name: string | null } | null
  url: string | null
}

export interface ClickUpComment {
  id: string
  commentText: string | null
  resolved: boolean | null
  user: ClickUpUser | null
  assignee: ClickUpUser | null
  date: string | null
  replyCount: string | null
}

export interface ClickUpWorkspace {
  id: string
  name: string | null
  color: string | null
  avatar: string | null
}

export interface ClickUpSpace {
  id: string
  name: string | null
  private: boolean | null
  archived: boolean | null
  statuses: ClickUpStatus[]
}

export interface ClickUpFolder {
  id: string
  name: string | null
  hidden: boolean | null
  taskCount: string | null
  space: { id: string; name: string | null } | null
}

export interface ClickUpList {
  id: string
  name: string | null
  taskCount: string | null
  archived: boolean | null
}

export interface ClickUpAttachment {
  id: string
  title: string | null
  extension: string | null
  url: string | null
  date: number | null
}

export interface ClickUpCustomField {
  id: string
  name: string | null
  type: string | null
  typeConfig: Record<string, unknown> | null
  dateCreated: string | null
  hideFromGuests: boolean | null
  required: boolean | null
}

export interface ClickUpCreateTaskParams {
  accessToken: string
  listId: string
  name: string
  description?: string
  markdownContent?: string
  status?: string
  priority?: number
  dueDate?: number
  startDate?: number
  assignees?: number[]
  tags?: string[]
  timeEstimate?: number
  parent?: string
  notifyAll?: boolean
}

export interface ClickUpTaskResponse extends ToolResponse {
  output: {
    task?: ClickUpTask
    error?: string
  }
}

export interface ClickUpGetTaskParams {
  accessToken: string
  taskId: string
  includeSubtasks?: boolean
  includeMarkdownDescription?: boolean
}

export interface ClickUpUpdateTaskParams {
  accessToken: string
  taskId: string
  name?: string
  description?: string
  markdownContent?: string
  status?: string
  priority?: number
  dueDate?: number
  startDate?: number
  timeEstimate?: number
  points?: number
  parent?: string
  archived?: boolean
}

export interface ClickUpDeleteTaskParams {
  accessToken: string
  taskId: string
}

export interface ClickUpDeleteResponse extends ToolResponse {
  output: {
    id?: string
    deleted?: boolean
    error?: string
  }
}

export interface ClickUpGetTasksParams {
  accessToken: string
  listId: string
  page?: number
  orderBy?: string
  reverse?: boolean
  subtasks?: boolean
  includeClosed?: boolean
  archived?: boolean
  statuses?: string[]
}

export interface ClickUpTaskListResponse extends ToolResponse {
  output: {
    tasks?: ClickUpTask[]
    error?: string
  }
}

export interface ClickUpSearchTasksParams {
  accessToken: string
  workspaceId: string
  page?: number
  orderBy?: string
  reverse?: boolean
  subtasks?: boolean
  listIds?: string[]
  spaceIds?: string[]
  folderIds?: string[]
}

export interface ClickUpCreateCommentParams {
  accessToken: string
  taskId: string
  commentText: string
  assignee?: number
  notifyAll?: boolean
}

export interface ClickUpCreateCommentResponse extends ToolResponse {
  output: {
    id?: string
    histId?: string
    date?: number
    error?: string
  }
}

export interface ClickUpGetCommentsParams {
  accessToken: string
  taskId: string
  start?: number
  startId?: string
}

export interface ClickUpCommentListResponse extends ToolResponse {
  output: {
    comments?: ClickUpComment[]
    error?: string
  }
}

export interface ClickUpUpdateCommentParams {
  accessToken: string
  commentId: string
  commentText?: string
  assignee?: number
  resolved?: boolean
}

export interface ClickUpUpdateCommentResponse extends ToolResponse {
  output: {
    id?: string
    updated?: boolean
    error?: string
  }
}

export interface ClickUpDeleteCommentParams {
  accessToken: string
  commentId: string
}

export interface ClickUpUploadAttachmentParams {
  accessToken: string
  taskId: string
  file: UserFile | string
}

export interface ClickUpUploadAttachmentResponse extends ToolResponse {
  output: {
    attachment?: ClickUpAttachment
    files?: UserFile[]
    error?: string
  }
}

export interface ClickUpGetWorkspacesParams {
  accessToken: string
}

export interface ClickUpWorkspaceListResponse extends ToolResponse {
  output: {
    workspaces?: ClickUpWorkspace[]
    error?: string
  }
}

export interface ClickUpGetSpacesParams {
  accessToken: string
  workspaceId: string
  archived?: boolean
}

export interface ClickUpSpaceListResponse extends ToolResponse {
  output: {
    spaces?: ClickUpSpace[]
    error?: string
  }
}

export interface ClickUpGetFoldersParams {
  accessToken: string
  spaceId: string
  archived?: boolean
}

export interface ClickUpFolderListResponse extends ToolResponse {
  output: {
    folders?: ClickUpFolder[]
    error?: string
  }
}

export interface ClickUpCreateFolderParams {
  accessToken: string
  spaceId: string
  name: string
}

export interface ClickUpFolderResponse extends ToolResponse {
  output: {
    folder?: ClickUpFolder
    error?: string
  }
}

export interface ClickUpGetListsParams {
  accessToken: string
  folderId?: string
  spaceId?: string
  archived?: boolean
}

export interface ClickUpListListResponse extends ToolResponse {
  output: {
    lists?: ClickUpList[]
    error?: string
  }
}

export interface ClickUpCreateListParams {
  accessToken: string
  folderId?: string
  spaceId?: string
  name: string
  content?: string
  markdownContent?: string
}

export interface ClickUpListResponse extends ToolResponse {
  output: {
    list?: ClickUpList
    error?: string
  }
}

export interface ClickUpGetSpaceTagsParams {
  accessToken: string
  spaceId: string
}

export interface ClickUpTagListResponse extends ToolResponse {
  output: {
    tags?: ClickUpTag[]
    error?: string
  }
}

export interface ClickUpTaskTagParams {
  accessToken: string
  taskId: string
  tagName: string
}

export interface ClickUpTaskTagResponse extends ToolResponse {
  output: {
    taskId?: string
    tagName?: string
    error?: string
  }
}

export interface ClickUpGetTaskMembersParams {
  accessToken: string
  taskId: string
}

export interface ClickUpGetListMembersParams {
  accessToken: string
  listId: string
}

export interface ClickUpMemberListResponse extends ToolResponse {
  output: {
    members?: ClickUpMember[]
    error?: string
  }
}

export interface ClickUpGetCustomFieldsParams {
  accessToken: string
  listId: string
}

export interface ClickUpCustomFieldListResponse extends ToolResponse {
  output: {
    fields?: ClickUpCustomField[]
    error?: string
  }
}

export type ClickUpResponse =
  | ClickUpTaskResponse
  | ClickUpTaskListResponse
  | ClickUpDeleteResponse
  | ClickUpCreateCommentResponse
  | ClickUpCommentListResponse
  | ClickUpUpdateCommentResponse
  | ClickUpUploadAttachmentResponse
  | ClickUpWorkspaceListResponse
  | ClickUpSpaceListResponse
  | ClickUpFolderListResponse
  | ClickUpFolderResponse
  | ClickUpListListResponse
  | ClickUpListResponse
  | ClickUpTagListResponse
  | ClickUpTaskTagResponse
  | ClickUpMemberListResponse
  | ClickUpCustomFieldListResponse
