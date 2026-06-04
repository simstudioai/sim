import type { ToolResponse } from '@/tools/types'

// ===== Core Types =====

interface GitLabProject {
  id: number
  name: string
  path: string
  path_with_namespace: string
  description?: string
  visibility: string
  web_url: string
  default_branch?: string
  created_at: string
  last_activity_at: string
  namespace?: {
    id: number
    name: string
    path: string
    kind: string
  }
  owner?: {
    id: number
    name: string
    username: string
  }
}

interface GitLabIssue {
  id: number
  iid: number
  project_id: number
  title: string
  description?: string
  state: string
  created_at: string
  updated_at: string
  closed_at?: string
  labels: string[]
  milestone?: {
    id: number
    iid: number
    title: string
  }
  assignees?: Array<{
    id: number
    name: string
    username: string
  }>
  assignee?: {
    id: number
    name: string
    username: string
  }
  author: {
    id: number
    name: string
    username: string
  }
  web_url: string
  due_date?: string
  confidential: boolean
}

interface GitLabMergeRequest {
  id: number
  iid: number
  project_id: number
  title: string
  description?: string
  state: string
  created_at: string
  updated_at: string
  merged_at?: string
  closed_at?: string
  source_branch: string
  target_branch: string
  source_project_id: number
  target_project_id: number
  labels: string[]
  milestone?: {
    id: number
    iid: number
    title: string
  }
  assignee?: {
    id: number
    name: string
    username: string
  }
  assignees?: Array<{
    id: number
    name: string
    username: string
  }>
  author: {
    id: number
    name: string
    username: string
  }
  merge_status: string
  web_url: string
  draft: boolean
  work_in_progress: boolean
  has_conflicts: boolean
  merge_when_pipeline_succeeds: boolean
}

interface GitLabPipeline {
  id: number
  iid: number
  project_id: number
  sha: string
  ref: string
  status: string
  source: string
  created_at: string
  updated_at: string
  web_url: string
  user?: {
    id: number
    name: string
    username: string
  }
}

interface GitLabBranch {
  name: string
  merged: boolean
  protected: boolean
  default: boolean
  developers_can_push: boolean
  developers_can_merge: boolean
  can_push: boolean
  web_url: string
  commit?: {
    id: string
    short_id: string
    title: string
    author_name: string
    authored_date: string
  }
}

interface GitLabNote {
  id: number
  body: string
  author: {
    id: number
    name: string
    username: string
  }
  created_at: string
  updated_at: string
  system: boolean
  noteable_id: number
  noteable_type: string
  noteable_iid?: number
}

interface GitLabUser {
  id: number
  name: string
  username: string
  email?: string
  state: string
  avatar_url: string
  web_url: string
}

interface GitLabLabel {
  id: number
  name: string
  color: string
  description?: string
  text_color: string
}

interface GitLabMilestone {
  id: number
  iid: number
  project_id: number
  title: string
  description?: string
  state: string
  created_at: string
  updated_at: string
  due_date?: string
  start_date?: string
  web_url: string
}

// ===== Common Parameters =====

interface GitLabBaseParams {
  accessToken: string
}

// ===== Project Parameters =====

export interface GitLabListProjectsParams extends GitLabBaseParams {
  owned?: boolean
  membership?: boolean
  search?: string
  visibility?: 'public' | 'internal' | 'private'
  orderBy?: 'id' | 'name' | 'path' | 'created_at' | 'updated_at' | 'last_activity_at'
  sort?: 'asc' | 'desc'
  perPage?: number
  page?: number
}

export interface GitLabGetProjectParams extends GitLabBaseParams {
  projectId: string | number
}

// ===== Issue Parameters =====

export interface GitLabListIssuesParams extends GitLabBaseParams {
  projectId: string | number
  state?: 'opened' | 'closed' | 'all'
  labels?: string
  assigneeId?: number
  milestoneTitle?: string
  search?: string
  orderBy?: 'created_at' | 'updated_at'
  sort?: 'asc' | 'desc'
  perPage?: number
  page?: number
}

export interface GitLabGetIssueParams extends GitLabBaseParams {
  projectId: string | number
  issueIid: number
}

export interface GitLabCreateIssueParams extends GitLabBaseParams {
  projectId: string | number
  title: string
  description?: string
  labels?: string
  assigneeIds?: number[]
  milestoneId?: number
  dueDate?: string
  confidential?: boolean
}

export interface GitLabUpdateIssueParams extends GitLabBaseParams {
  projectId: string | number
  issueIid: number
  title?: string
  description?: string
  stateEvent?: 'close' | 'reopen'
  labels?: string
  assigneeIds?: number[]
  milestoneId?: number
  dueDate?: string
  confidential?: boolean
}

export interface GitLabDeleteIssueParams extends GitLabBaseParams {
  projectId: string | number
  issueIid: number
}

// ===== Merge Request Parameters =====

export interface GitLabListMergeRequestsParams extends GitLabBaseParams {
  projectId: string | number
  state?: 'opened' | 'closed' | 'merged' | 'all'
  labels?: string
  sourceBranch?: string
  targetBranch?: string
  orderBy?: 'created_at' | 'updated_at'
  sort?: 'asc' | 'desc'
  perPage?: number
  page?: number
}

export interface GitLabGetMergeRequestParams extends GitLabBaseParams {
  projectId: string | number
  mergeRequestIid: number
}

export interface GitLabCreateMergeRequestParams extends GitLabBaseParams {
  projectId: string | number
  sourceBranch: string
  targetBranch: string
  title: string
  description?: string
  labels?: string
  assigneeIds?: number[]
  milestoneId?: number
  removeSourceBranch?: boolean
  squash?: boolean
  draft?: boolean
}

export interface GitLabUpdateMergeRequestParams extends GitLabBaseParams {
  projectId: string | number
  mergeRequestIid: number
  title?: string
  description?: string
  stateEvent?: 'close' | 'reopen'
  labels?: string
  assigneeIds?: number[]
  milestoneId?: number
  targetBranch?: string
  removeSourceBranch?: boolean
  squash?: boolean
  draft?: boolean
}

export interface GitLabMergeMergeRequestParams extends GitLabBaseParams {
  projectId: string | number
  mergeRequestIid: number
  mergeCommitMessage?: string
  squashCommitMessage?: string
  squash?: boolean
  shouldRemoveSourceBranch?: boolean
  mergeWhenPipelineSucceeds?: boolean
}

// ===== Pipeline Parameters =====

export interface GitLabListPipelinesParams extends GitLabBaseParams {
  projectId: string | number
  ref?: string
  status?:
    | 'created'
    | 'waiting_for_resource'
    | 'preparing'
    | 'pending'
    | 'running'
    | 'success'
    | 'failed'
    | 'canceled'
    | 'skipped'
    | 'manual'
    | 'scheduled'
  orderBy?: 'id' | 'status' | 'ref' | 'updated_at' | 'user_id'
  sort?: 'asc' | 'desc'
  perPage?: number
  page?: number
}

export interface GitLabGetPipelineParams extends GitLabBaseParams {
  projectId: string | number
  pipelineId: number
}

export interface GitLabCreatePipelineParams extends GitLabBaseParams {
  projectId: string | number
  ref: string
  variables?: Array<{ key: string; value: string; variable_type?: 'env_var' | 'file' }>
}

export interface GitLabRetryPipelineParams extends GitLabBaseParams {
  projectId: string | number
  pipelineId: number
}

export interface GitLabCancelPipelineParams extends GitLabBaseParams {
  projectId: string | number
  pipelineId: number
}

// ===== Branch Parameters =====

interface GitLabListBranchesParams extends GitLabBaseParams {
  projectId: string | number
  search?: string
  perPage?: number
  page?: number
}

interface GitLabGetBranchParams extends GitLabBaseParams {
  projectId: string | number
  branch: string
}

interface GitLabCreateBranchParams extends GitLabBaseParams {
  projectId: string | number
  branch: string
  ref: string
}

interface GitLabDeleteBranchParams extends GitLabBaseParams {
  projectId: string | number
  branch: string
}

// ===== Note/Comment Parameters =====

interface GitLabListIssueNotesParams extends GitLabBaseParams {
  projectId: string | number
  issueIid: number
  orderBy?: 'created_at' | 'updated_at'
  sort?: 'asc' | 'desc'
  perPage?: number
  page?: number
}

export interface GitLabCreateIssueNoteParams extends GitLabBaseParams {
  projectId: string | number
  issueIid: number
  body: string
}

interface GitLabListMergeRequestNotesParams extends GitLabBaseParams {
  projectId: string | number
  mergeRequestIid: number
  orderBy?: 'created_at' | 'updated_at'
  sort?: 'asc' | 'desc'
  perPage?: number
  page?: number
}

export interface GitLabCreateMergeRequestNoteParams extends GitLabBaseParams {
  projectId: string | number
  mergeRequestIid: number
  body: string
}

// ===== Label Parameters =====

interface GitLabListLabelsParams extends GitLabBaseParams {
  projectId: string | number
  search?: string
  perPage?: number
  page?: number
}

interface GitLabCreateLabelParams extends GitLabBaseParams {
  projectId: string | number
  name: string
  color: string
  description?: string
}

// ===== User Parameters =====

interface GitLabGetCurrentUserParams extends GitLabBaseParams {}

interface GitLabListUsersParams extends GitLabBaseParams {
  search?: string
  perPage?: number
  page?: number
}

// ===== Response Types =====

export interface GitLabListProjectsResponse extends ToolResponse {
  output: {
    projects?: GitLabProject[]
    total?: number
  }
}

export interface GitLabGetProjectResponse extends ToolResponse {
  output: {
    project?: GitLabProject
  }
}

export interface GitLabListIssuesResponse extends ToolResponse {
  output: {
    issues?: GitLabIssue[]
    total?: number
  }
}

export interface GitLabGetIssueResponse extends ToolResponse {
  output: {
    issue?: GitLabIssue
  }
}

export interface GitLabCreateIssueResponse extends ToolResponse {
  output: {
    issue?: GitLabIssue
  }
}

export interface GitLabUpdateIssueResponse extends ToolResponse {
  output: {
    issue?: GitLabIssue
  }
}

export interface GitLabDeleteIssueResponse extends ToolResponse {
  output: {
    success?: boolean
  }
}

export interface GitLabListMergeRequestsResponse extends ToolResponse {
  output: {
    mergeRequests?: GitLabMergeRequest[]
    total?: number
  }
}

export interface GitLabGetMergeRequestResponse extends ToolResponse {
  output: {
    mergeRequest?: GitLabMergeRequest
  }
}

export interface GitLabCreateMergeRequestResponse extends ToolResponse {
  output: {
    mergeRequest?: GitLabMergeRequest
  }
}

export interface GitLabUpdateMergeRequestResponse extends ToolResponse {
  output: {
    mergeRequest?: GitLabMergeRequest
  }
}

export interface GitLabMergeMergeRequestResponse extends ToolResponse {
  output: {
    mergeRequest?: GitLabMergeRequest
  }
}

export interface GitLabListPipelinesResponse extends ToolResponse {
  output: {
    pipelines?: GitLabPipeline[]
    total?: number
  }
}

export interface GitLabGetPipelineResponse extends ToolResponse {
  output: {
    pipeline?: GitLabPipeline
  }
}

export interface GitLabCreatePipelineResponse extends ToolResponse {
  output: {
    pipeline?: GitLabPipeline
  }
}

export interface GitLabRetryPipelineResponse extends ToolResponse {
  output: {
    pipeline?: GitLabPipeline
  }
}

export interface GitLabCancelPipelineResponse extends ToolResponse {
  output: {
    pipeline?: GitLabPipeline
  }
}

interface GitLabListBranchesResponse extends ToolResponse {
  output: {
    branches?: GitLabBranch[]
    total?: number
  }
}

interface GitLabGetBranchResponse extends ToolResponse {
  output: {
    branch?: GitLabBranch
  }
}

interface GitLabCreateBranchResponse extends ToolResponse {
  output: {
    branch?: GitLabBranch
  }
}

interface GitLabDeleteBranchResponse extends ToolResponse {
  output: {
    success?: boolean
  }
}

interface GitLabListNotesResponse extends ToolResponse {
  output: {
    notes?: GitLabNote[]
    total?: number
  }
}

export interface GitLabCreateNoteResponse extends ToolResponse {
  output: {
    note?: GitLabNote
  }
}

interface GitLabListLabelsResponse extends ToolResponse {
  output: {
    labels?: GitLabLabel[]
    total?: number
  }
}

interface GitLabCreateLabelResponse extends ToolResponse {
  output: {
    label?: GitLabLabel
  }
}

interface GitLabGetCurrentUserResponse extends ToolResponse {
  output: {
    user?: GitLabUser
  }
}

interface GitLabListUsersResponse extends ToolResponse {
  output: {
    users?: GitLabUser[]
    total?: number
  }
}

// ===== Union Response Type =====

export type GitLabResponse =
  | GitLabListProjectsResponse
  | GitLabGetProjectResponse
  | GitLabListIssuesResponse
  | GitLabGetIssueResponse
  | GitLabCreateIssueResponse
  | GitLabUpdateIssueResponse
  | GitLabDeleteIssueResponse
  | GitLabListMergeRequestsResponse
  | GitLabGetMergeRequestResponse
  | GitLabCreateMergeRequestResponse
  | GitLabUpdateMergeRequestResponse
  | GitLabMergeMergeRequestResponse
  | GitLabListPipelinesResponse
  | GitLabGetPipelineResponse
  | GitLabCreatePipelineResponse
  | GitLabRetryPipelineResponse
  | GitLabCancelPipelineResponse
  | GitLabListBranchesResponse
  | GitLabGetBranchResponse
  | GitLabCreateBranchResponse
  | GitLabDeleteBranchResponse
  | GitLabListNotesResponse
  | GitLabCreateNoteResponse
  | GitLabListLabelsResponse
  | GitLabCreateLabelResponse
  | GitLabGetCurrentUserResponse
  | GitLabListUsersResponse
