import type { ToolResponse } from '@/tools/types'

export interface JiraRetrieveParams {
  accessToken: string
  issueKey: string
  domain: string
  cloudId?: string
}

export interface JiraRetrieveResponse extends ToolResponse {
  output: {
    ts: string
    issueKey: string
    summary: string
    description: string
    created: string
    updated: string
  }
}

export interface JiraRetrieveBulkParams {
  accessToken: string
  domain: string
  projectId: string
  cloudId?: string
}

export interface JiraRetrieveResponseBulk extends ToolResponse {
  output: {
    ts: string
    summary: string
    description: string
    created: string
    updated: string
  }[]
}

export interface JiraUpdateParams {
  accessToken: string
  domain: string
  projectId?: string
  issueKey: string
  summary?: string
  title?: string
  description?: string
  status?: string
  priority?: string
  assignee?: string
  cloudId?: string
}

export interface JiraUpdateResponse extends ToolResponse {
  output: {
    ts: string
    issueKey: string
    summary: string
    success: boolean
  }
}

export interface JiraWriteParams {
  accessToken: string
  domain: string
  projectId: string
  summary: string
  description?: string
  priority?: string
  assignee?: string
  cloudId?: string
  issueType: string
  parent?: { key: string }
}

export interface JiraWriteResponse extends ToolResponse {
  output: {
    ts: string
    issueKey: string
    summary: string
    success: boolean
    url: string
  }
}

export interface JiraIssue {
  key: string
  summary: string
  status: string
  priority?: string
  assignee?: string
  updated: string
}

export interface JiraProject {
  id: string
  key: string
  name: string
  url: string
}

export interface JiraCloudResource {
  id: string
  url: string
  name: string
  scopes: string[]
  avatarUrl: string
}

// Delete Issue
export interface JiraDeleteIssueParams {
  accessToken: string
  domain: string
  issueKey: string
  cloudId?: string
  deleteSubtasks?: boolean
}

export interface JiraDeleteIssueResponse extends ToolResponse {
  output: {
    ts: string
    issueKey: string
    success: boolean
  }
}

// Assign Issue
export interface JiraAssignIssueParams {
  accessToken: string
  domain: string
  issueKey: string
  accountId: string
  cloudId?: string
}

export interface JiraAssignIssueResponse extends ToolResponse {
  output: {
    ts: string
    issueKey: string
    assigneeId: string
    success: boolean
  }
}

// Transition Issue
export interface JiraTransitionIssueParams {
  accessToken: string
  domain: string
  issueKey: string
  transitionId: string
  comment?: string
  cloudId?: string
}

export interface JiraTransitionIssueResponse extends ToolResponse {
  output: {
    ts: string
    issueKey: string
    transitionId: string
    success: boolean
  }
}

// Search Issues
export interface JiraSearchIssuesParams {
  accessToken: string
  domain: string
  jql: string
  startAt?: number
  maxResults?: number
  fields?: string[]
  cloudId?: string
}

export interface JiraSearchIssuesResponse extends ToolResponse {
  output: {
    ts: string
    total: number
    startAt: number
    maxResults: number
    issues: Array<{
      key: string
      summary: string
      status: string
      assignee?: string
      priority?: string
      created: string
      updated: string
    }>
  }
}

// Comments
export interface JiraAddCommentParams {
  accessToken: string
  domain: string
  issueKey: string
  body: string
  cloudId?: string
}

export interface JiraAddCommentResponse extends ToolResponse {
  output: {
    ts: string
    issueKey: string
    commentId: string
    body: string
    success: boolean
  }
}

export interface JiraGetCommentsParams {
  accessToken: string
  domain: string
  issueKey: string
  startAt?: number
  maxResults?: number
  cloudId?: string
}

export interface JiraGetCommentsResponse extends ToolResponse {
  output: {
    ts: string
    issueKey: string
    total: number
    comments: Array<{
      id: string
      author: string
      body: string
      created: string
      updated: string
    }>
  }
}

export interface JiraUpdateCommentParams {
  accessToken: string
  domain: string
  issueKey: string
  commentId: string
  body: string
  cloudId?: string
}

export interface JiraUpdateCommentResponse extends ToolResponse {
  output: {
    ts: string
    issueKey: string
    commentId: string
    body: string
    success: boolean
  }
}

export interface JiraDeleteCommentParams {
  accessToken: string
  domain: string
  issueKey: string
  commentId: string
  cloudId?: string
}

export interface JiraDeleteCommentResponse extends ToolResponse {
  output: {
    ts: string
    issueKey: string
    commentId: string
    success: boolean
  }
}

// Attachments
export interface JiraGetAttachmentsParams {
  accessToken: string
  domain: string
  issueKey: string
  cloudId?: string
}

export interface JiraGetAttachmentsResponse extends ToolResponse {
  output: {
    ts: string
    issueKey: string
    attachments: Array<{
      id: string
      filename: string
      author: string
      created: string
      size: number
      mimeType: string
      content: string
    }>
  }
}

export interface JiraDeleteAttachmentParams {
  accessToken: string
  domain: string
  attachmentId: string
  cloudId?: string
}

export interface JiraDeleteAttachmentResponse extends ToolResponse {
  output: {
    ts: string
    attachmentId: string
    success: boolean
  }
}

// Worklogs
export interface JiraAddWorklogParams {
  accessToken: string
  domain: string
  issueKey: string
  timeSpentSeconds: number
  comment?: string
  started?: string
  cloudId?: string
}

export interface JiraAddWorklogResponse extends ToolResponse {
  output: {
    ts: string
    issueKey: string
    worklogId: string
    timeSpentSeconds: number
    success: boolean
  }
}

export interface JiraGetWorklogsParams {
  accessToken: string
  domain: string
  issueKey: string
  startAt?: number
  maxResults?: number
  cloudId?: string
}

export interface JiraGetWorklogsResponse extends ToolResponse {
  output: {
    ts: string
    issueKey: string
    total: number
    worklogs: Array<{
      id: string
      author: string
      timeSpentSeconds: number
      timeSpent: string
      comment?: string
      created: string
      updated: string
      started: string
    }>
  }
}

export interface JiraUpdateWorklogParams {
  accessToken: string
  domain: string
  issueKey: string
  worklogId: string
  timeSpentSeconds?: number
  comment?: string
  started?: string
  cloudId?: string
}

export interface JiraUpdateWorklogResponse extends ToolResponse {
  output: {
    ts: string
    issueKey: string
    worklogId: string
    success: boolean
  }
}

export interface JiraDeleteWorklogParams {
  accessToken: string
  domain: string
  issueKey: string
  worklogId: string
  cloudId?: string
}

export interface JiraDeleteWorklogResponse extends ToolResponse {
  output: {
    ts: string
    issueKey: string
    worklogId: string
    success: boolean
  }
}

// Issue Links
export interface JiraCreateIssueLinkParams {
  accessToken: string
  domain: string
  inwardIssueKey: string
  outwardIssueKey: string
  linkType: string
  comment?: string
  cloudId?: string
}

export interface JiraCreateIssueLinkResponse extends ToolResponse {
  output: {
    ts: string
    inwardIssue: string
    outwardIssue: string
    linkType: string
    success: boolean
  }
}

export interface JiraDeleteIssueLinkParams {
  accessToken: string
  domain: string
  linkId: string
  cloudId?: string
}

export interface JiraDeleteIssueLinkResponse extends ToolResponse {
  output: {
    ts: string
    linkId: string
    success: boolean
  }
}

// Watchers
export interface JiraAddWatcherParams {
  accessToken: string
  domain: string
  issueKey: string
  accountId: string
  cloudId?: string
}

export interface JiraAddWatcherResponse extends ToolResponse {
  output: {
    ts: string
    issueKey: string
    watcherAccountId: string
    success: boolean
  }
}

export interface JiraRemoveWatcherParams {
  accessToken: string
  domain: string
  issueKey: string
  accountId: string
  cloudId?: string
}

export interface JiraRemoveWatcherResponse extends ToolResponse {
  output: {
    ts: string
    issueKey: string
    watcherAccountId: string
    success: boolean
  }
}

export type JiraResponse =
  | JiraRetrieveResponse
  | JiraUpdateResponse
  | JiraWriteResponse
  | JiraRetrieveResponseBulk
  | JiraDeleteIssueResponse
  | JiraAssignIssueResponse
  | JiraTransitionIssueResponse
  | JiraSearchIssuesResponse
  | JiraAddCommentResponse
  | JiraGetCommentsResponse
  | JiraUpdateCommentResponse
  | JiraDeleteCommentResponse
  | JiraGetAttachmentsResponse
  | JiraDeleteAttachmentResponse
  | JiraAddWorklogResponse
  | JiraGetWorklogsResponse
  | JiraUpdateWorklogResponse
  | JiraDeleteWorklogResponse
  | JiraCreateIssueLinkResponse
  | JiraDeleteIssueLinkResponse
  | JiraAddWatcherResponse
  | JiraRemoveWatcherResponse
