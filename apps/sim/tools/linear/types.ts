import type { ToolResponse } from '@/tools/types'

// ===== Core Types =====

export interface LinearIssue {
  id: string
  title: string
  description?: string
  state?: {
    id: string
    name: string
    type: string
  }
  assignee?: {
    id: string
    name: string
    email: string
  }
  priority?: number
  estimate?: number
  teamId?: string
  projectId?: string
  labels?: Array<{
    id: string
    name: string
    color: string
  }>
  createdAt?: string
  updatedAt?: string
  completedAt?: string
  canceledAt?: string
  archivedAt?: string
  url?: string
}

export interface LinearComment {
  id: string
  body: string
  createdAt: string
  updatedAt?: string
  user: {
    id: string
    name: string
    email?: string
  }
  issue?: {
    id: string
    title: string
  }
}

export interface LinearProject {
  id: string
  name: string
  description?: string
  state: string
  priority: number
  startDate?: string
  targetDate?: string
  completedAt?: string
  canceledAt?: string
  archivedAt?: string
  lead?: {
    id: string
    name: string
  }
  teams?: Array<{
    id: string
    name: string
  }>
  url?: string
}

export interface LinearUser {
  id: string
  name: string
  email: string
  displayName: string
  active: boolean
  admin: boolean
  avatarUrl?: string
}

export interface LinearTeam {
  id: string
  name: string
  key: string
  description?: string
}

export interface LinearLabel {
  id: string
  name: string
  color: string
  description?: string
  team?: {
    id: string
    name: string
  }
}

export interface LinearWorkflowState {
  id: string
  name: string
  type: string
  color: string
  position: number
  team: {
    id: string
    name: string
  }
}

export interface LinearCycle {
  id: string
  number: number
  name?: string
  startsAt: string
  endsAt: string
  completedAt?: string
  progress: number
  team: {
    id: string
    name: string
  }
}

// ===== Request Params =====

export interface LinearReadIssuesParams {
  teamId: string
  projectId: string
  accessToken?: string
}

export interface LinearGetIssueParams {
  issueId: string
  accessToken?: string
}

export interface LinearCreateIssueParams {
  teamId: string
  projectId: string
  title: string
  description?: string
  accessToken?: string
}

export interface LinearUpdateIssueParams {
  issueId: string
  title?: string
  description?: string
  stateId?: string
  assigneeId?: string
  priority?: number
  estimate?: number
  labelIds?: string[]
  accessToken?: string
}

export interface LinearArchiveIssueParams {
  issueId: string
  accessToken?: string
}

export interface LinearUnarchiveIssueParams {
  issueId: string
  accessToken?: string
}

export interface LinearDeleteIssueParams {
  issueId: string
  accessToken?: string
}

export interface LinearAddLabelToIssueParams {
  issueId: string
  labelId: string
  accessToken?: string
}

export interface LinearRemoveLabelFromIssueParams {
  issueId: string
  labelId: string
  accessToken?: string
}

export interface LinearSearchIssuesParams {
  query: string
  teamId?: string
  includeArchived?: boolean
  first?: number
  accessToken?: string
}

export interface LinearCreateCommentParams {
  issueId: string
  body: string
  accessToken?: string
}

export interface LinearUpdateCommentParams {
  commentId: string
  body: string
  accessToken?: string
}

export interface LinearDeleteCommentParams {
  commentId: string
  accessToken?: string
}

export interface LinearListCommentsParams {
  issueId: string
  first?: number
  after?: string
  accessToken?: string
}

export interface LinearListProjectsParams {
  teamId?: string
  includeArchived?: boolean
  first?: number
  after?: string
  accessToken?: string
}

export interface LinearGetProjectParams {
  projectId: string
  accessToken?: string
}

export interface LinearCreateProjectParams {
  teamId: string
  name: string
  description?: string
  leadId?: string
  startDate?: string
  targetDate?: string
  priority?: number
  accessToken?: string
}

export interface LinearUpdateProjectParams {
  projectId: string
  name?: string
  description?: string
  state?: string
  leadId?: string
  startDate?: string
  targetDate?: string
  priority?: number
  accessToken?: string
}

export interface LinearArchiveProjectParams {
  projectId: string
  accessToken?: string
}

export interface LinearListUsersParams {
  includeDisabled?: boolean
  first?: number
  after?: string
  accessToken?: string
}

export interface LinearListTeamsParams {
  first?: number
  after?: string
  accessToken?: string
}

export interface LinearGetViewerParams {
  accessToken?: string
}

export interface LinearListLabelsParams {
  teamId?: string
  first?: number
  after?: string
  accessToken?: string
}

export interface LinearCreateLabelParams {
  name: string
  color?: string
  description?: string
  teamId?: string
  accessToken?: string
}

export interface LinearUpdateLabelParams {
  labelId: string
  name?: string
  color?: string
  description?: string
  accessToken?: string
}

export interface LinearArchiveLabelParams {
  labelId: string
  accessToken?: string
}

export interface LinearListWorkflowStatesParams {
  teamId?: string
  first?: number
  after?: string
  accessToken?: string
}

export interface LinearCreateWorkflowStateParams {
  teamId: string
  name: string
  color: string
  type: string
  description?: string
  position?: number
  accessToken?: string
}

export interface LinearUpdateWorkflowStateParams {
  stateId: string
  name?: string
  color?: string
  description?: string
  position?: number
  accessToken?: string
}

export interface LinearListCyclesParams {
  teamId?: string
  first?: number
  after?: string
  accessToken?: string
}

export interface LinearGetCycleParams {
  cycleId: string
  accessToken?: string
}

export interface LinearCreateCycleParams {
  teamId: string
  startsAt: string
  endsAt: string
  name?: string
  accessToken?: string
}

export interface LinearGetActiveCycleParams {
  teamId: string
  accessToken?: string
}

export interface LinearCreateAttachmentParams {
  issueId: string
  url: string
  title?: string
  subtitle?: string
  accessToken?: string
}

export interface LinearListAttachmentsParams {
  issueId: string
  first?: number
  after?: string
  accessToken?: string
}

export interface LinearUpdateAttachmentParams {
  attachmentId: string
  title?: string
  subtitle?: string
  accessToken?: string
}

export interface LinearDeleteAttachmentParams {
  attachmentId: string
  accessToken?: string
}

export interface LinearCreateIssueRelationParams {
  issueId: string
  relatedIssueId: string
  type: string
  accessToken?: string
}

export interface LinearListIssueRelationsParams {
  issueId: string
  first?: number
  after?: string
  accessToken?: string
}

export interface LinearDeleteIssueRelationParams {
  relationId: string
  accessToken?: string
}

export interface LinearCreateFavoriteParams {
  issueId?: string
  projectId?: string
  cycleId?: string
  labelId?: string
  accessToken?: string
}

export interface LinearListFavoritesParams {
  first?: number
  after?: string
  accessToken?: string
}

export interface LinearCreateProjectUpdateParams {
  projectId: string
  body: string
  health?: string
  accessToken?: string
}

export interface LinearListProjectUpdatesParams {
  projectId: string
  first?: number
  after?: string
  accessToken?: string
}

export interface LinearCreateProjectLinkParams {
  projectId: string
  url: string
  label?: string
  accessToken?: string
}

export interface LinearListNotificationsParams {
  first?: number
  after?: string
  accessToken?: string
}

export interface LinearUpdateNotificationParams {
  notificationId: string
  readAt?: string
  accessToken?: string
}

// ===== Response Types =====

export interface LinearReadIssuesResponse extends ToolResponse {
  output: {
    issues?: LinearIssue[]
  }
}

export interface LinearGetIssueResponse extends ToolResponse {
  output: {
    issue?: LinearIssue
  }
}

export interface LinearCreateIssueResponse extends ToolResponse {
  output: {
    issue?: LinearIssue
  }
}

export interface LinearUpdateIssueResponse extends ToolResponse {
  output: {
    issue?: LinearIssue
  }
}

export interface LinearArchiveIssueResponse extends ToolResponse {
  output: {
    success?: boolean
    issueId?: string
  }
}

export interface LinearUnarchiveIssueResponse extends ToolResponse {
  output: {
    success?: boolean
    issueId?: string
  }
}

export interface LinearDeleteIssueResponse extends ToolResponse {
  output: {
    success?: boolean
  }
}

export interface LinearAddLabelResponse extends ToolResponse {
  output: {
    success?: boolean
    issueId?: string
  }
}

export interface LinearRemoveLabelResponse extends ToolResponse {
  output: {
    success?: boolean
    issueId?: string
  }
}

export interface LinearSearchIssuesResponse extends ToolResponse {
  output: {
    issues?: LinearIssue[]
    pageInfo?: {
      hasNextPage: boolean
      endCursor?: string
    }
  }
}

export interface LinearCreateCommentResponse extends ToolResponse {
  output: {
    comment?: LinearComment
  }
}

export interface LinearUpdateCommentResponse extends ToolResponse {
  output: {
    comment?: LinearComment
  }
}

export interface LinearDeleteCommentResponse extends ToolResponse {
  output: {
    success?: boolean
  }
}

export interface LinearListCommentsResponse extends ToolResponse {
  output: {
    comments?: LinearComment[]
    pageInfo?: {
      hasNextPage: boolean
      endCursor?: string
    }
  }
}

export interface LinearListProjectsResponse extends ToolResponse {
  output: {
    projects?: LinearProject[]
    pageInfo?: {
      hasNextPage: boolean
      endCursor?: string
    }
  }
}

export interface LinearGetProjectResponse extends ToolResponse {
  output: {
    project?: LinearProject
  }
}

export interface LinearCreateProjectResponse extends ToolResponse {
  output: {
    project?: LinearProject
  }
}

export interface LinearUpdateProjectResponse extends ToolResponse {
  output: {
    project?: LinearProject
  }
}

export interface LinearArchiveProjectResponse extends ToolResponse {
  output: {
    success?: boolean
    projectId?: string
  }
}

export interface LinearListUsersResponse extends ToolResponse {
  output: {
    users?: LinearUser[]
    pageInfo?: {
      hasNextPage: boolean
      endCursor?: string
    }
  }
}

export interface LinearListTeamsResponse extends ToolResponse {
  output: {
    teams?: LinearTeam[]
    pageInfo?: {
      hasNextPage: boolean
      endCursor?: string
    }
  }
}

export interface LinearGetViewerResponse extends ToolResponse {
  output: {
    user?: LinearUser
  }
}

export interface LinearListLabelsResponse extends ToolResponse {
  output: {
    labels?: LinearLabel[]
    pageInfo?: {
      hasNextPage: boolean
      endCursor?: string
    }
  }
}

export interface LinearCreateLabelResponse extends ToolResponse {
  output: {
    label?: LinearLabel
  }
}

export interface LinearUpdateLabelResponse extends ToolResponse {
  output: {
    label?: LinearLabel
  }
}

export interface LinearArchiveLabelResponse extends ToolResponse {
  output: {
    success?: boolean
    labelId?: string
  }
}

export interface LinearListWorkflowStatesResponse extends ToolResponse {
  output: {
    states?: LinearWorkflowState[]
    pageInfo?: {
      hasNextPage: boolean
      endCursor?: string
    }
  }
}

export interface LinearCreateWorkflowStateResponse extends ToolResponse {
  output: {
    state?: LinearWorkflowState
  }
}

export interface LinearUpdateWorkflowStateResponse extends ToolResponse {
  output: {
    state?: LinearWorkflowState
  }
}

export interface LinearListCyclesResponse extends ToolResponse {
  output: {
    cycles?: LinearCycle[]
    pageInfo?: {
      hasNextPage: boolean
      endCursor?: string
    }
  }
}

export interface LinearGetCycleResponse extends ToolResponse {
  output: {
    cycle?: LinearCycle
  }
}

export interface LinearCreateCycleResponse extends ToolResponse {
  output: {
    cycle?: LinearCycle
  }
}

export interface LinearGetActiveCycleResponse extends ToolResponse {
  output: {
    cycle?: LinearCycle | null
  }
}

export interface LinearAttachment {
  id: string
  title?: string
  subtitle?: string
  url: string
  createdAt: string
  updatedAt?: string
}

export interface LinearCreateAttachmentResponse extends ToolResponse {
  output: {
    attachment?: LinearAttachment
  }
}

export interface LinearListAttachmentsResponse extends ToolResponse {
  output: {
    attachments?: LinearAttachment[]
    pageInfo?: {
      hasNextPage: boolean
      endCursor?: string
    }
  }
}

export interface LinearUpdateAttachmentResponse extends ToolResponse {
  output: {
    attachment?: LinearAttachment
  }
}

export interface LinearDeleteAttachmentResponse extends ToolResponse {
  output: {
    success?: boolean
  }
}

export interface LinearIssueRelation {
  id: string
  type: string
  issue: {
    id: string
    title: string
  }
  relatedIssue: {
    id: string
    title: string
  }
}

export interface LinearCreateIssueRelationResponse extends ToolResponse {
  output: {
    relation?: LinearIssueRelation
  }
}

export interface LinearListIssueRelationsResponse extends ToolResponse {
  output: {
    relations?: LinearIssueRelation[]
    pageInfo?: {
      hasNextPage: boolean
      endCursor?: string
    }
  }
}

export interface LinearDeleteIssueRelationResponse extends ToolResponse {
  output: {
    success?: boolean
  }
}

export interface LinearFavorite {
  id: string
  type: string
  issue?: {
    id: string
    title: string
  }
  project?: {
    id: string
    name: string
  }
  cycle?: {
    id: string
    name: string
  }
}

export interface LinearCreateFavoriteResponse extends ToolResponse {
  output: {
    favorite?: LinearFavorite
  }
}

export interface LinearListFavoritesResponse extends ToolResponse {
  output: {
    favorites?: LinearFavorite[]
    pageInfo?: {
      hasNextPage: boolean
      endCursor?: string
    }
  }
}

export interface LinearProjectUpdate {
  id: string
  body: string
  health: string
  createdAt: string
  user: {
    id: string
    name: string
  }
}

export interface LinearCreateProjectUpdateResponse extends ToolResponse {
  output: {
    update?: LinearProjectUpdate
  }
}

export interface LinearListProjectUpdatesResponse extends ToolResponse {
  output: {
    updates?: LinearProjectUpdate[]
    pageInfo?: {
      hasNextPage: boolean
      endCursor?: string
    }
  }
}

export interface LinearProjectLink {
  id: string
  url: string
  label: string
  createdAt: string
}

export interface LinearCreateProjectLinkResponse extends ToolResponse {
  output: {
    link?: LinearProjectLink
  }
}

export interface LinearNotification {
  id: string
  type: string
  createdAt: string
  readAt?: string
  issue?: {
    id: string
    title: string
  }
}

export interface LinearListNotificationsResponse extends ToolResponse {
  output: {
    notifications?: LinearNotification[]
    pageInfo?: {
      hasNextPage: boolean
      endCursor?: string
    }
  }
}

export interface LinearUpdateNotificationResponse extends ToolResponse {
  output: {
    notification?: LinearNotification
  }
}

export type LinearResponse =
  | LinearReadIssuesResponse
  | LinearGetIssueResponse
  | LinearCreateIssueResponse
  | LinearUpdateIssueResponse
  | LinearArchiveIssueResponse
  | LinearUnarchiveIssueResponse
  | LinearDeleteIssueResponse
  | LinearAddLabelResponse
  | LinearRemoveLabelResponse
  | LinearSearchIssuesResponse
  | LinearCreateCommentResponse
  | LinearUpdateCommentResponse
  | LinearDeleteCommentResponse
  | LinearListCommentsResponse
  | LinearListProjectsResponse
  | LinearGetProjectResponse
  | LinearCreateProjectResponse
  | LinearUpdateProjectResponse
  | LinearArchiveProjectResponse
  | LinearListUsersResponse
  | LinearListTeamsResponse
  | LinearGetViewerResponse
  | LinearListLabelsResponse
  | LinearCreateLabelResponse
  | LinearUpdateLabelResponse
  | LinearArchiveLabelResponse
  | LinearListWorkflowStatesResponse
  | LinearCreateWorkflowStateResponse
  | LinearUpdateWorkflowStateResponse
  | LinearListCyclesResponse
  | LinearGetCycleResponse
  | LinearCreateCycleResponse
  | LinearGetActiveCycleResponse
  | LinearCreateAttachmentResponse
  | LinearListAttachmentsResponse
  | LinearUpdateAttachmentResponse
  | LinearDeleteAttachmentResponse
  | LinearCreateIssueRelationResponse
  | LinearListIssueRelationsResponse
  | LinearDeleteIssueRelationResponse
  | LinearCreateFavoriteResponse
  | LinearListFavoritesResponse
  | LinearCreateProjectUpdateResponse
  | LinearListProjectUpdatesResponse
  | LinearCreateProjectLinkResponse
  | LinearListNotificationsResponse
  | LinearUpdateNotificationResponse
