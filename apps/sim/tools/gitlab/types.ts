import type { GitLabResourceType } from '@/tools/gitlab/utils'
import type { ToolResponse } from '@/tools/types'

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

interface GitLabTreeEntry {
  id: string
  name: string
  type: string
  path: string
  mode: string
}

interface GitLabCommit {
  id: string
  short_id: string
  title: string
  message: string
  author_name: string
  authored_date: string
  created_at: string
  web_url: string
}

interface GitLabJob {
  id: number
  name: string
  stage: string
  status: string
  started_at?: string | null
  finished_at?: string | null
  duration?: number | null
  web_url: string
  ref?: string
}

interface GitLabMergeRequestChange {
  old_path: string
  new_path: string
  diff: string
  new_file: boolean
  deleted_file: boolean
  renamed_file: boolean
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

interface GitLabRelease {
  tag_name: string
  name?: string
  description?: string
  created_at: string
  released_at?: string
  author?: {
    id: number
    name: string
    username: string
  }
  commit?: {
    id: string
    short_id: string
    title: string
  }
  milestones?: unknown[]
  assets?: {
    count?: number
    sources?: unknown[]
    links?: unknown[]
  }
  _links?: Record<string, string>
}

interface GitLabBaseParams {
  accessToken: string
  /**
   * Self-managed GitLab host (e.g. `gitlab.example.com`). Optional — defaults to
   * `gitlab.com` so existing workflows keep working.
   */
  host?: string
}

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

export interface GitLabListIssuesParams extends GitLabBaseParams {
  projectId: string | number
  state?: 'opened' | 'closed' | 'all'
  labels?: string
  assigneeId?: number
  milestoneTitle?: string
  search?: string
  orderBy?:
    | 'created_at'
    | 'updated_at'
    | 'priority'
    | 'due_date'
    | 'relative_position'
    | 'label_priority'
    | 'milestone_due'
    | 'popularity'
    | 'weight'
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

export interface GitLabListMergeRequestsParams extends GitLabBaseParams {
  projectId: string | number
  state?: 'opened' | 'closed' | 'locked' | 'merged' | 'all'
  labels?: string
  sourceBranch?: string
  targetBranch?: string
  orderBy?:
    | 'created_at'
    | 'updated_at'
    | 'merged_at'
    | 'label_priority'
    | 'priority'
    | 'milestone_due'
    | 'popularity'
    | 'title'
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
    | 'canceling'
    | 'canceled'
    | 'skipped'
    | 'manual'
    | 'scheduled'
    | 'waiting_for_callback'
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
  /** Pipeline inputs (spec:inputs) as a key/value object. */
  inputs?: Record<string, unknown>
}

export interface GitLabRetryPipelineParams extends GitLabBaseParams {
  projectId: string | number
  pipelineId: number
}

export interface GitLabCancelPipelineParams extends GitLabBaseParams {
  projectId: string | number
  pipelineId: number
}

export interface GitLabListBranchesParams extends GitLabBaseParams {
  projectId: string | number
  search?: string
  perPage?: number
  page?: number
}

export interface GitLabCreateBranchParams extends GitLabBaseParams {
  projectId: string | number
  branch: string
  ref: string
}

export interface GitLabDeleteBranchParams extends GitLabBaseParams {
  projectId: string | number
  branch: string
}

export interface GitLabCompareBranchesParams extends GitLabBaseParams {
  projectId: string | number
  from: string
  to: string
  straight?: boolean
  fromProjectId?: string | number
  unidiff?: boolean
}

export interface GitLabListRepositoryTreeParams extends GitLabBaseParams {
  projectId: string | number
  path?: string
  ref?: string
  recursive?: boolean
  perPage?: number
  page?: number
}

export interface GitLabGetFileParams extends GitLabBaseParams {
  projectId: string | number
  filePath: string
  ref: string
}

export interface GitLabCreateFileParams extends GitLabBaseParams {
  projectId: string | number
  filePath: string
  branch: string
  content: string
  commitMessage: string
  startBranch?: string
  authorName?: string
  authorEmail?: string
  executeFilemode?: boolean
}

export interface GitLabUpdateFileParams extends GitLabBaseParams {
  projectId: string | number
  filePath: string
  branch: string
  content: string
  commitMessage: string
  lastCommitId?: string
  startBranch?: string
  authorName?: string
  authorEmail?: string
  executeFilemode?: boolean
}

export interface GitLabListCommitsParams extends GitLabBaseParams {
  projectId: string | number
  refName?: string
  since?: string
  until?: string
  path?: string
  author?: string
  perPage?: number
  page?: number
}

export interface GitLabGetMergeRequestChangesParams extends GitLabBaseParams {
  projectId: string | number
  mergeRequestIid: number
}

export interface GitLabApproveMergeRequestParams extends GitLabBaseParams {
  projectId: string | number
  mergeRequestIid: number
  sha?: string
}

export interface GitLabListPipelineJobsParams extends GitLabBaseParams {
  projectId: string | number
  pipelineId: number
  scope?: string
  includeRetried?: boolean
  perPage?: number
  page?: number
}

export interface GitLabGetJobLogParams extends GitLabBaseParams {
  projectId: string | number
  jobId: number
}

export interface GitLabPlayJobParams extends GitLabBaseParams {
  projectId: string | number
  jobId: number
  jobVariables?: Array<{ key: string; value: string }>
}

export interface GitLabCreateIssueNoteParams extends GitLabBaseParams {
  projectId: string | number
  issueIid: number
  body: string
  internal?: boolean
}

export interface GitLabCreateMergeRequestNoteParams extends GitLabBaseParams {
  projectId: string | number
  mergeRequestIid: number
  body: string
  internal?: boolean
}

export interface GitLabListReleasesParams extends GitLabBaseParams {
  projectId: string | number
  orderBy?: 'released_at' | 'created_at'
  sort?: 'asc' | 'desc'
  perPage?: number
  page?: number
}

export interface GitLabCreateReleaseParams extends GitLabBaseParams {
  projectId: string | number
  tagName: string
  name?: string
  description?: string
  ref?: string
  releasedAt?: string
  milestones?: string[]
  tagMessage?: string
  assetLinks?: Array<{
    name: string
    url: string
    link_type?: 'other' | 'runbook' | 'image' | 'package'
    direct_asset_path?: string
  }>
}

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

export interface GitLabListBranchesResponse extends ToolResponse {
  output: {
    branches?: GitLabBranch[]
    total?: number
  }
}

export interface GitLabCreateBranchResponse extends ToolResponse {
  output: {
    name?: string | null
    webUrl?: string | null
    protected?: boolean | null
    commit?: GitLabBranch['commit'] | null
  }
}

export interface GitLabDeleteBranchResponse extends ToolResponse {
  output: {
    success?: boolean
  }
}

export interface GitLabCompareBranchesResponse extends ToolResponse {
  output: {
    commit?: unknown
    commits?: unknown[]
    diffs?: unknown[]
    compareTimeout?: boolean | null
    compareSameRef?: boolean | null
    webUrl?: string | null
  }
}

export interface GitLabCreateNoteResponse extends ToolResponse {
  output: {
    note?: GitLabNote
  }
}

export interface GitLabListReleasesResponse extends ToolResponse {
  output: {
    releases?: GitLabRelease[]
    total?: number
  }
}

export interface GitLabCreateReleaseResponse extends ToolResponse {
  output: {
    release?: GitLabRelease
  }
}

export interface GitLabListRepositoryTreeResponse extends ToolResponse {
  output: {
    tree?: GitLabTreeEntry[]
    total?: number
  }
}

export interface GitLabGetFileResponse extends ToolResponse {
  output: {
    filePath?: string | null
    fileName?: string | null
    size?: number | null
    ref?: string | null
    blobId?: string | null
    lastCommitId?: string | null
    content?: string
    truncated?: boolean
  }
}

export interface GitLabCreateFileResponse extends ToolResponse {
  output: {
    filePath?: string | null
    branch?: string | null
  }
}

export interface GitLabUpdateFileResponse extends ToolResponse {
  output: {
    filePath?: string | null
    branch?: string | null
  }
}

export interface GitLabListCommitsResponse extends ToolResponse {
  output: {
    commits?: GitLabCommit[]
    total?: number
  }
}

export interface GitLabGetMergeRequestChangesResponse extends ToolResponse {
  output: {
    mergeRequestIid?: number | null
    changes?: GitLabMergeRequestChange[]
    changesCount?: number
    hasMore?: boolean
  }
}

export interface GitLabApproveMergeRequestResponse extends ToolResponse {
  output: {
    approvalsRequired?: number | null
    approvalsLeft?: number | null
    approvedBy?: unknown[]
  }
}

export interface GitLabListPipelineJobsResponse extends ToolResponse {
  output: {
    jobs?: GitLabJob[]
    total?: number
  }
}

export interface GitLabGetJobLogResponse extends ToolResponse {
  output: {
    log?: string
    truncated?: boolean
  }
}

export interface GitLabPlayJobResponse extends ToolResponse {
  output: {
    id?: number | null
    name?: string | null
    status?: string | null
    webUrl?: string | null
  }
}

interface GitLabMember {
  id: number
  username: string
  name: string
  state: string
  access_level: number
  web_url?: string
  expires_at?: string | null
  membership_state?: string
  member_role?: { id: number; name: string } | null
}

interface GitLabInvitation {
  id?: number
  invite_email: string
  access_level: number
  created_at?: string
  expires_at?: string | null
  user_name?: string
  created_by_name?: string
  invite_token?: string
  member_role_id?: number | null
}

interface GitLabAccessRequest {
  id: number
  username: string
  name: string
  state: string
  requested_at: string
  access_level?: number
  web_url?: string
}

interface GitLabSamlGroupLink {
  name: string
  access_level: number
  member_role_id?: number | null
  provider?: string | null
}

interface GitLabUser {
  id: number
  username: string
  name: string
  email?: string
  state: string
  web_url?: string
  is_admin?: boolean
  created_at?: string
}

/**
 * The access resources (`/members`, `/invitations`, `/access_requests`) exist
 * on both projects and groups; the tool receives `resourceType` to select which.
 */
interface GitLabResourceScopedParams extends GitLabBaseParams {
  resourceType: GitLabResourceType
  resourceId: string | number
}

export interface GitLabListMembersParams extends GitLabResourceScopedParams {
  /** When true, returns only direct members (`/members`). Defaults to false, which returns inherited members too (`/members/all`). */
  directOnly?: boolean
  query?: string
  /** Comma-separated user IDs to filter to. */
  userIds?: string
  /** 'awaiting' | 'active' — inherited-member listings only (Premium/Ultimate). */
  state?: string
  showSeatInfo?: boolean
  perPage?: number
  page?: number
}

export interface GitLabAddMemberParams extends GitLabResourceScopedParams {
  /** Provide either userId or username to identify the user. */
  userId?: number
  username?: string
  accessLevel: number
  expiresAt?: string
  memberRoleId?: number
}

export interface GitLabUpdateMemberParams extends GitLabResourceScopedParams {
  userId: number
  accessLevel: number
  expiresAt?: string
  memberRoleId?: number
}

export interface GitLabRemoveMemberParams extends GitLabResourceScopedParams {
  userId: number
  skipSubresources?: boolean
  unassignIssuables?: boolean
}

export interface GitLabInviteMemberParams extends GitLabResourceScopedParams {
  email: string
  accessLevel: number
  expiresAt?: string
  memberRoleId?: number
  inviteSource?: string
}

export interface GitLabListInvitationsParams extends GitLabResourceScopedParams {
  query?: string
  perPage?: number
  page?: number
}

export interface GitLabUpdateInvitationParams extends GitLabResourceScopedParams {
  email: string
  accessLevel?: number
  expiresAt?: string
}

export interface GitLabRevokeInvitationParams extends GitLabResourceScopedParams {
  email: string
}

export interface GitLabListAccessRequestsParams extends GitLabResourceScopedParams {
  perPage?: number
  page?: number
}

export interface GitLabApproveAccessRequestParams extends GitLabResourceScopedParams {
  userId: number
  accessLevel?: number
}

export interface GitLabDenyAccessRequestParams extends GitLabResourceScopedParams {
  userId: number
}

export interface GitLabListSamlGroupLinksParams extends GitLabBaseParams {
  groupId: string | number
}

export interface GitLabAddSamlGroupLinkParams extends GitLabBaseParams {
  groupId: string | number
  samlGroupName: string
  accessLevel: number
  memberRoleId?: number
  provider?: string
}

export interface GitLabDeleteSamlGroupLinkParams extends GitLabBaseParams {
  groupId: string | number
  samlGroupName: string
  /** Provider name; required by GitLab when multiple links share the same SAML group name. */
  provider?: string
}

export interface GitLabSearchUsersParams extends GitLabBaseParams {
  search: string
  perPage?: number
  page?: number
}

export interface GitLabCreateUserParams extends GitLabBaseParams {
  email: string
  username: string
  name: string
  password?: string
  resetPassword?: boolean
  forceRandomPassword?: boolean
  admin?: boolean
  skipConfirmation?: boolean
}

export interface GitLabUpdateUserParams extends GitLabBaseParams {
  userId: number
  email?: string
  username?: string
  name?: string
  admin?: boolean
}

export interface GitLabDeleteUserParams extends GitLabBaseParams {
  userId: number
  hardDelete?: boolean
}

/** Shared shape for the single-user POST actions (block/unblock/deactivate/activate/ban/unban/approve/reject). */
export interface GitLabUserActionParams extends GitLabBaseParams {
  userId: number
}

export interface GitLabDeleteUserIdentityParams extends GitLabBaseParams {
  userId: number
  provider: string
}

export interface GitLabListMembersResponse extends ToolResponse {
  output: {
    members?: GitLabMember[]
    total?: number
  }
}

export interface GitLabAddMemberResponse extends ToolResponse {
  output: {
    member?: GitLabMember
    /** True when the user was already a member (409) — treated as a soft success so workflows are re-runnable. */
    alreadyMember?: boolean
  }
}

export interface GitLabUpdateMemberResponse extends ToolResponse {
  output: {
    member?: GitLabMember
  }
}

export interface GitLabRemoveMemberResponse extends ToolResponse {
  output: {
    success?: boolean
  }
}

export interface GitLabInviteMemberResponse extends ToolResponse {
  output: {
    status?: string
    message?: unknown
  }
}

export interface GitLabListInvitationsResponse extends ToolResponse {
  output: {
    invitations?: GitLabInvitation[]
    total?: number
  }
}

export interface GitLabUpdateInvitationResponse extends ToolResponse {
  output: {
    invitation?: GitLabInvitation
  }
}

export interface GitLabRevokeInvitationResponse extends ToolResponse {
  output: {
    success?: boolean
  }
}

export interface GitLabListAccessRequestsResponse extends ToolResponse {
  output: {
    accessRequests?: GitLabAccessRequest[]
    total?: number
  }
}

export interface GitLabApproveAccessRequestResponse extends ToolResponse {
  output: {
    accessRequest?: GitLabAccessRequest
  }
}

export interface GitLabDenyAccessRequestResponse extends ToolResponse {
  output: {
    success?: boolean
  }
}

export interface GitLabListSamlGroupLinksResponse extends ToolResponse {
  output: {
    samlGroupLinks?: GitLabSamlGroupLink[]
    total?: number
  }
}

export interface GitLabSamlGroupLinkResponse extends ToolResponse {
  output: {
    samlGroupLink?: GitLabSamlGroupLink
  }
}

export interface GitLabDeleteSamlGroupLinkResponse extends ToolResponse {
  output: {
    success?: boolean
  }
}

export interface GitLabSearchUsersResponse extends ToolResponse {
  output: {
    users?: GitLabUser[]
    total?: number
  }
}

export interface GitLabUserResponse extends ToolResponse {
  output: {
    user?: GitLabUser
  }
}

export interface GitLabDeleteUserResponse extends ToolResponse {
  output: {
    success?: boolean
  }
}

export interface GitLabUserActionResponse extends ToolResponse {
  output: {
    success?: boolean
    user?: GitLabUser
  }
}

export interface GitLabDeleteUserIdentityResponse extends ToolResponse {
  output: {
    success?: boolean
  }
}

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
  | GitLabCreateBranchResponse
  | GitLabDeleteBranchResponse
  | GitLabCompareBranchesResponse
  | GitLabCreateNoteResponse
  | GitLabListReleasesResponse
  | GitLabCreateReleaseResponse
  | GitLabListRepositoryTreeResponse
  | GitLabGetFileResponse
  | GitLabCreateFileResponse
  | GitLabUpdateFileResponse
  | GitLabListCommitsResponse
  | GitLabGetMergeRequestChangesResponse
  | GitLabApproveMergeRequestResponse
  | GitLabListPipelineJobsResponse
  | GitLabGetJobLogResponse
  | GitLabPlayJobResponse
  | GitLabListMembersResponse
  | GitLabAddMemberResponse
  | GitLabUpdateMemberResponse
  | GitLabRemoveMemberResponse
  | GitLabInviteMemberResponse
  | GitLabListInvitationsResponse
  | GitLabUpdateInvitationResponse
  | GitLabRevokeInvitationResponse
  | GitLabListAccessRequestsResponse
  | GitLabApproveAccessRequestResponse
  | GitLabDenyAccessRequestResponse
  | GitLabListSamlGroupLinksResponse
  | GitLabSamlGroupLinkResponse
  | GitLabDeleteSamlGroupLinkResponse
  | GitLabSearchUsersResponse
  | GitLabUserResponse
  | GitLabDeleteUserResponse
  | GitLabUserActionResponse
  | GitLabDeleteUserIdentityResponse
