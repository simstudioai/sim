import type { ToolResponse } from '@/tools/types'

// Base parameters shared by all GitHub operations
export interface BaseGitHubParams {
  owner: string
  repo: string
  apiKey: string
}

// PR operation parameters
export interface PROperationParams extends BaseGitHubParams {
  pullNumber: number
}

// Comment operation parameters
export interface CreateCommentParams extends PROperationParams {
  body: string
  path?: string
  position?: number
  line?: number
  side?: string
  commitId?: string
  commentType?: 'pr_comment' | 'file_comment'
}

// Latest commit parameters
export interface LatestCommitParams extends BaseGitHubParams {
  branch?: string
}

// Create PR parameters
export interface CreatePRParams extends BaseGitHubParams {
  title: string
  head: string
  base: string
  body?: string
  draft?: boolean
}

// Update PR parameters
export interface UpdatePRParams extends BaseGitHubParams {
  pullNumber: number
  title?: string
  body?: string
  state?: 'open' | 'closed'
  base?: string
}

// Merge PR parameters
export interface MergePRParams extends BaseGitHubParams {
  pullNumber: number
  commit_title?: string
  commit_message?: string
  merge_method?: 'merge' | 'squash' | 'rebase'
}

// List PRs parameters
export interface ListPRsParams extends BaseGitHubParams {
  state?: 'open' | 'closed' | 'all'
  head?: string
  base?: string
  sort?: 'created' | 'updated' | 'popularity' | 'long-running'
  direction?: 'asc' | 'desc'
  per_page?: number
  page?: number
}

// Get PR files parameters
export interface GetPRFilesParams extends BaseGitHubParams {
  pullNumber: number
  per_page?: number
  page?: number
}

// Close PR parameters
export interface ClosePRParams extends BaseGitHubParams {
  pullNumber: number
}

// Request reviewers parameters
export interface RequestReviewersParams extends BaseGitHubParams {
  pullNumber: number
  reviewers: string
  team_reviewers?: string
}

// Response metadata interfaces
interface BasePRMetadata {
  number: number
  title: string
  state: string
  html_url: string
  diff_url: string
  created_at: string
  updated_at: string
}

interface PRFilesMetadata {
  files?: Array<{
    filename: string
    additions: number
    deletions: number
    changes: number
    patch?: string
    blob_url: string
    raw_url: string
    status: string
  }>
}

interface PRCommentsMetadata {
  comments?: Array<{
    id: number
    body: string
    path?: string
    line?: number
    commit_id: string
    created_at: string
    updated_at: string
    html_url: string
  }>
}

interface CommentMetadata {
  id: number
  html_url: string
  created_at: string
  updated_at: string
  path?: string
  line?: number
  side?: string
  commit_id?: string
}

interface CommitMetadata {
  sha: string
  html_url: string
  commit_message: string
  author: {
    name: string
    login: string
    avatar_url: string
    html_url: string
  }
  committer: {
    name: string
    login: string
    avatar_url: string
    html_url: string
  }
  stats?: {
    additions: number
    deletions: number
    total: number
  }
  files?: Array<{
    filename: string
    additions: number
    deletions: number
    changes: number
    status: string
    raw_url: string
    blob_url: string
    patch?: string
    content?: string
  }>
}

interface RepoMetadata {
  name: string
  description: string
  stars: number
  forks: number
  openIssues: number
  language: string
}

// PR operation response metadata
interface PRMetadata {
  number: number
  title: string
  state: string
  html_url: string
  merged: boolean
  draft: boolean
  created_at?: string
  updated_at?: string
  merge_commit_sha?: string
}

interface MergeResultMetadata {
  sha: string
  merged: boolean
  message: string
}

interface PRListMetadata {
  prs: Array<{
    number: number
    title: string
    state: string
    html_url: string
    created_at: string
    updated_at: string
  }>
  total_count: number
  open_count?: number
  closed_count?: number
}

interface PRFilesListMetadata {
  files: Array<{
    filename: string
    status: string
    additions: number
    deletions: number
    changes: number
    patch?: string
    blob_url: string
    raw_url: string
  }>
  total_count: number
}

interface ReviewersMetadata {
  requested_reviewers: Array<{
    login: string
    id: number
  }>
  requested_teams?: Array<{
    name: string
    id: number
  }>
}

// Response types
export interface PullRequestResponse extends ToolResponse {
  output: {
    content: string
    metadata: BasePRMetadata & PRFilesMetadata & PRCommentsMetadata
  }
}

export interface CreateCommentResponse extends ToolResponse {
  output: {
    content: string
    metadata: CommentMetadata
  }
}

export interface LatestCommitResponse extends ToolResponse {
  output: {
    content: string
    metadata: CommitMetadata
  }
}

export interface RepoInfoResponse extends ToolResponse {
  output: {
    content: string
    metadata: RepoMetadata
  }
}

// Issue comment operation parameters
export interface CreateIssueCommentParams extends BaseGitHubParams {
  issue_number: number
  body: string
}

export interface ListIssueCommentsParams extends BaseGitHubParams {
  issue_number: number
  since?: string
  per_page?: number
  page?: number
}

export interface UpdateCommentParams extends BaseGitHubParams {
  comment_id: number
  body: string
}

export interface DeleteCommentParams extends BaseGitHubParams {
  comment_id: number
}

export interface ListPRCommentsParams extends BaseGitHubParams {
  pullNumber: number
  sort?: 'created' | 'updated'
  direction?: 'asc' | 'desc'
  since?: string
  per_page?: number
  page?: number
}

// Branch operation parameters
export interface ListBranchesParams extends BaseGitHubParams {
  protected?: boolean
  per_page?: number
  page?: number
}

export interface GetBranchParams extends BaseGitHubParams {
  branch: string
}

export interface CreateBranchParams extends BaseGitHubParams {
  branch: string
  sha: string // commit SHA to point to
}

export interface DeleteBranchParams extends BaseGitHubParams {
  branch: string
}

export interface GetBranchProtectionParams extends BaseGitHubParams {
  branch: string
}

export interface UpdateBranchProtectionParams extends BaseGitHubParams {
  branch: string
  required_status_checks: {
    strict: boolean
    contexts: string[]
  } | null
  enforce_admins: boolean
  required_pull_request_reviews: {
    required_approving_review_count?: number
    dismiss_stale_reviews?: boolean
    require_code_owner_reviews?: boolean
  } | null
  restrictions: {
    users: string[]
    teams: string[]
  } | null
}

// Issue comment response metadata
interface IssueCommentMetadata {
  id: number
  html_url: string
  body: string
  created_at: string
  updated_at: string
  user: {
    login: string
    id: number
  }
}

interface CommentsListMetadata {
  comments: Array<{
    id: number
    body: string
    user: { login: string }
    created_at: string
    html_url: string
  }>
  total_count: number
}

// Response types for new tools
export interface IssueCommentResponse extends ToolResponse {
  output: {
    content: string
    metadata: IssueCommentMetadata
  }
}

export interface CommentsListResponse extends ToolResponse {
  output: {
    content: string
    metadata: CommentsListMetadata
  }
}

export interface DeleteCommentResponse extends ToolResponse {
  output: {
    content: string
    metadata: {
      deleted: boolean
      comment_id: number
    }
  }
}

// New PR operation response types
export interface PRResponse extends ToolResponse {
  output: {
    content: string
    metadata: PRMetadata
  }
}

export interface MergeResultResponse extends ToolResponse {
  output: {
    content: string
    metadata: MergeResultMetadata
  }
}

export interface PRListResponse extends ToolResponse {
  output: {
    content: string
    metadata: PRListMetadata
  }
}

export interface PRFilesListResponse extends ToolResponse {
  output: {
    content: string
    metadata: PRFilesListMetadata
  }
}

export interface ReviewersResponse extends ToolResponse {
  output: {
    content: string
    metadata: ReviewersMetadata
  }
}

// Branch response metadata
interface BranchMetadata {
  name: string
  commit: {
    sha: string
    url: string
  }
  protected: boolean
}

interface BranchListMetadata {
  branches: Array<{
    name: string
    commit: {
      sha: string
      url: string
    }
    protected: boolean
  }>
  total_count: number
}

interface BranchProtectionMetadata {
  required_status_checks: {
    strict: boolean
    contexts: string[]
  } | null
  enforce_admins: {
    enabled: boolean
  }
  required_pull_request_reviews: {
    required_approving_review_count: number
    dismiss_stale_reviews: boolean
    require_code_owner_reviews: boolean
  } | null
  restrictions: {
    users: string[]
    teams: string[]
  } | null
}

interface RefMetadata {
  ref: string
  url: string
  sha: string
}

interface DeleteBranchMetadata {
  deleted: boolean
  branch: string
}

// Branch response types
export interface BranchResponse extends ToolResponse {
  output: {
    content: string
    metadata: BranchMetadata
  }
}

export interface BranchListResponse extends ToolResponse {
  output: {
    content: string
    metadata: BranchListMetadata
  }
}

export interface BranchProtectionResponse extends ToolResponse {
  output: {
    content: string
    metadata: BranchProtectionMetadata
  }
}

export interface RefResponse extends ToolResponse {
  output: {
    content: string
    metadata: RefMetadata
  }
}

export interface DeleteBranchResponse extends ToolResponse {
  output: {
    content: string
    metadata: DeleteBranchMetadata
  }
}

// GitHub Projects V2 parameters
export interface ListProjectsParams {
  owner_type: 'org' | 'user'
  owner_login: string
  apiKey: string
}

export interface GetProjectParams {
  owner_type: 'org' | 'user'
  owner_login: string
  project_number: number
  apiKey: string
}

export interface CreateProjectParams {
  owner_id: string // Node ID
  title: string
  apiKey: string
}

export interface UpdateProjectParams {
  project_id: string // Node ID
  title?: string
  shortDescription?: string
  project_public?: boolean
  closed?: boolean
  apiKey: string
}

export interface DeleteProjectParams {
  project_id: string
  apiKey: string
}

// GitHub Projects V2 response metadata
interface ProjectMetadata {
  id: string
  title: string
  number?: number
  url: string
  closed?: boolean
  public?: boolean
  shortDescription?: string
}

// GitHub Projects V2 response types
export interface ListProjectsResponse extends ToolResponse {
  output: {
    content: string
    metadata: {
      projects: ProjectMetadata[]
      totalCount: number
    }
  }
}

export interface ProjectResponse extends ToolResponse {
  output: {
    content: string
    metadata: ProjectMetadata
  }
}

// Workflow operation parameters
export interface ListWorkflowsParams extends BaseGitHubParams {
  per_page?: number
  page?: number
}

export interface GetWorkflowParams extends BaseGitHubParams {
  workflow_id: number | string
}

export interface TriggerWorkflowParams extends BaseGitHubParams {
  workflow_id: number | string
  ref: string // branch or tag name
  inputs?: Record<string, string>
}

export interface ListWorkflowRunsParams extends BaseGitHubParams {
  actor?: string
  branch?: string
  event?: string
  status?: string
  per_page?: number
  page?: number
}

export interface GetWorkflowRunParams extends BaseGitHubParams {
  run_id: number
}

export interface CancelWorkflowRunParams extends BaseGitHubParams {
  run_id: number
}

export interface RerunWorkflowParams extends BaseGitHubParams {
  run_id: number
  enable_debug_logging?: boolean
}

// Workflow response metadata interfaces
interface WorkflowMetadata {
  id: number
  name: string
  path: string
  state: string
  badge_url: string
}

interface WorkflowRunMetadata {
  id: number
  name: string
  status: string
  conclusion: string
  html_url: string
  run_number: number
}

interface ListWorkflowsMetadata {
  total_count: number
  workflows: Array<{
    id: number
    name: string
    path: string
    state: string
    badge_url: string
  }>
}

interface ListWorkflowRunsMetadata {
  total_count: number
  workflow_runs: Array<{
    id: number
    name: string
    status: string
    conclusion: string
    html_url: string
    run_number: number
  }>
}

// Workflow response types
export interface WorkflowResponse extends ToolResponse {
  output: {
    content: string
    metadata: WorkflowMetadata
  }
}

export interface WorkflowRunResponse extends ToolResponse {
  output: {
    content: string
    metadata: WorkflowRunMetadata
  }
}

export interface ListWorkflowsResponse extends ToolResponse {
  output: {
    content: string
    metadata: ListWorkflowsMetadata
  }
}

export interface ListWorkflowRunsResponse extends ToolResponse {
  output: {
    content: string
    metadata: ListWorkflowRunsMetadata
  }
}

export interface TriggerWorkflowResponse extends ToolResponse {
  output: {
    content: string
    metadata: Record<string, never>
  }
}

export interface CancelWorkflowRunResponse extends ToolResponse {
  output: {
    content: string
    metadata: {
      run_id: number
      status: string
    }
  }
}

export interface RerunWorkflowResponse extends ToolResponse {
  output: {
    content: string
    metadata: {
      run_id: number
      status: string
    }
  }
}

export type GitHubResponse =
  | PullRequestResponse
  | CreateCommentResponse
  | LatestCommitResponse
  | RepoInfoResponse
  | IssueCommentResponse
  | CommentsListResponse
  | DeleteCommentResponse
  | PRResponse
  | MergeResultResponse
  | PRListResponse
  | PRFilesListResponse
  | ReviewersResponse
  | ListProjectsResponse
  | ProjectResponse
  | BranchResponse
  | BranchListResponse
  | BranchProtectionResponse
  | RefResponse
  | DeleteBranchResponse
  | WorkflowResponse
  | WorkflowRunResponse
  | ListWorkflowsResponse
  | ListWorkflowRunsResponse
  | TriggerWorkflowResponse
  | CancelWorkflowRunResponse
  | RerunWorkflowResponse
  | IssueResponse
  | IssuesListResponse
  | LabelsResponse

// Release operation parameters
export interface CreateReleaseParams extends BaseGitHubParams {
  tag_name: string
  target_commitish?: string
  name?: string
  body?: string
  draft?: boolean
  prerelease?: boolean
}

export interface UpdateReleaseParams extends BaseGitHubParams {
  release_id: number
  tag_name?: string
  target_commitish?: string
  name?: string
  body?: string
  draft?: boolean
  prerelease?: boolean
}

export interface ListReleasesParams extends BaseGitHubParams {
  per_page?: number
  page?: number
}

export interface GetReleaseParams extends BaseGitHubParams {
  release_id: number
}

export interface DeleteReleaseParams extends BaseGitHubParams {
  release_id: number
}

// Release metadata interface
interface ReleaseMetadata {
  id: number
  tag_name: string
  name: string
  html_url: string
  tarball_url: string
  zipball_url: string
  draft: boolean
  prerelease: boolean
  created_at: string
  published_at: string
}

// Response types for releases
export interface ReleaseResponse extends ToolResponse {
  output: {
    content: string
    metadata: ReleaseMetadata
  }
}

export interface ListReleasesResponse extends ToolResponse {
  output: {
    content: string
    metadata: {
      total_count: number
      releases: Array<ReleaseMetadata>
    }
  }
}

export interface DeleteReleaseResponse extends ToolResponse {
  output: {
    content: string
    metadata: {
      deleted: boolean
      release_id: number
    }
  }
}

// Issue operation parameters
export interface CreateIssueParams extends BaseGitHubParams {
  title: string
  body?: string
  assignees?: string
  labels?: string
  milestone?: number
}

export interface UpdateIssueParams extends BaseGitHubParams {
  issue_number: number
  title?: string
  body?: string
  state?: 'open' | 'closed'
  labels?: string[]
  assignees?: string[]
}

export interface ListIssuesParams extends BaseGitHubParams {
  state?: 'open' | 'closed' | 'all'
  assignee?: string
  creator?: string
  labels?: string
  sort?: 'created' | 'updated' | 'comments'
  direction?: 'asc' | 'desc'
  per_page?: number
  page?: number
}

export interface GetIssueParams extends BaseGitHubParams {
  issue_number: number
}

export interface CloseIssueParams extends BaseGitHubParams {
  issue_number: number
  state_reason?: 'completed' | 'not_planned'
}

export interface AddLabelsParams extends BaseGitHubParams {
  issue_number: number
  labels: string
}

export interface RemoveLabelParams extends BaseGitHubParams {
  issue_number: number
  name: string
}

export interface AddAssigneesParams extends BaseGitHubParams {
  issue_number: number
  assignees: string
}

// Issue response metadata
interface IssueMetadata {
  number: number
  title: string
  state: string
  html_url: string
  labels: string[]
  assignees: string[]
  created_at?: string
  updated_at?: string
  closed_at?: string
  body?: string
}

interface IssuesListMetadata {
  issues: Array<{
    number: number
    title: string
    state: string
    html_url: string
    labels: string[]
    assignees: string[]
    created_at: string
    updated_at: string
  }>
  total_count: number
  page?: number
}

interface LabelsMetadata {
  labels: string[]
  issue_number: number
  html_url: string
}

// Issue response types
export interface IssueResponse extends ToolResponse {
  output: {
    content: string
    metadata: IssueMetadata
  }
}

export interface IssuesListResponse extends ToolResponse {
  output: {
    content: string
    metadata: IssuesListMetadata
  }
}

export interface LabelsResponse extends ToolResponse {
  output: {
    content: string
    metadata: LabelsMetadata
  }
}

export interface GetFileContentParams extends BaseGitHubParams {
  path: string
  ref?: string // branch, tag, or commit SHA
}

export interface CreateFileParams extends BaseGitHubParams {
  path: string
  message: string
  content: string // Plain text (will be Base64 encoded internally)
  branch?: string
}

export interface UpdateFileParams extends BaseGitHubParams {
  path: string
  message: string
  content: string // Plain text (will be Base64 encoded internally)
  sha: string // Required for update
  branch?: string
}

export interface DeleteFileParams extends BaseGitHubParams {
  path: string
  message: string
  sha: string // Required
  branch?: string
}

export interface GetTreeParams extends BaseGitHubParams {
  path?: string
  ref?: string
}

// File/Content metadata interfaces
export interface FileContentMetadata {
  name: string
  path: string
  sha: string
  size: number
  type: 'file' | 'dir'
  download_url?: string
  html_url?: string
}

export interface FileCommitMetadata {
  sha: string
  message: string
  author: {
    name: string
    email: string
    date: string
  }
  committer: {
    name: string
    email: string
    date: string
  }
  html_url: string
}

export interface TreeItemMetadata {
  name: string
  path: string
  sha: string
  size: number
  type: 'file' | 'dir' | 'symlink' | 'submodule'
  download_url?: string
  html_url?: string
}

// Response types
export interface FileContentResponse extends ToolResponse {
  output: {
    content: string
    metadata: FileContentMetadata
  }
}

export interface FileOperationResponse extends ToolResponse {
  output: {
    content: string
    metadata: {
      file: FileContentMetadata
      commit: FileCommitMetadata
    }
  }
}

export interface DeleteFileResponse extends ToolResponse {
  output: {
    content: string
    metadata: {
      deleted: boolean
      path: string
      commit: FileCommitMetadata
    }
  }
}

export interface TreeResponse extends ToolResponse {
  output: {
    content: string
    metadata: {
      path: string
      items: TreeItemMetadata[]
      total_count: number
    }
  }
}
