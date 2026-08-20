import type { ToolOutputProperty } from '@/tools/types'

export interface BitbucketAuthParams {
  accessToken: string
}

export interface BitbucketPaginationParams {
  nextUrl?: string
  pageLen?: number
}

export interface BitbucketRepositoryParams extends BitbucketAuthParams {
  workspaceSlug: string
  repoSlug: string
}

export interface BitbucketPullRequestParams extends BitbucketRepositoryParams {
  prId: number
}

export interface BitbucketListWorkspacesParams
  extends BitbucketAuthParams,
    BitbucketPaginationParams {
  sort?: string
  administrator?: boolean
}

export interface BitbucketListRepositoriesParams
  extends BitbucketAuthParams,
    BitbucketPaginationParams {
  workspaceSlug: string
  role?: 'admin' | 'contributor' | 'member' | 'owner'
  q?: string
  sort?: string
}

export interface BitbucketListBranchesParams
  extends BitbucketRepositoryParams,
    BitbucketPaginationParams {
  q?: string
  sort?: string
}

export interface BitbucketCreateBranchParams extends BitbucketRepositoryParams {
  name: string
  target: string
}

export interface BitbucketDeleteBranchParams extends BitbucketRepositoryParams {
  name: string
}

export interface BitbucketListCommitsParams
  extends BitbucketRepositoryParams,
    BitbucketPaginationParams {}

export interface BitbucketGetCommitParams extends BitbucketRepositoryParams {
  commit: string
}

export interface BitbucketListDirectoryParams
  extends BitbucketRepositoryParams,
    BitbucketPaginationParams {
  commit: string
  path?: string
  q?: string
  sort?: string
}

export interface BitbucketFileParams extends BitbucketRepositoryParams {
  commit: string
  path: string
}

export interface BitbucketGetFileParams extends BitbucketFileParams {
  maxCharacters?: number
}

export interface BitbucketListPullRequestsParams
  extends BitbucketRepositoryParams,
    BitbucketPaginationParams {
  state?: 'OPEN' | 'MERGED' | 'DECLINED' | 'SUPERSEDED'
  q?: string
  sort?: string
}

export interface BitbucketCreatePullRequestParams extends BitbucketRepositoryParams {
  title: string
  sourceBranch: string
  destinationBranch: string
  description?: string
  closeSourceBranch?: boolean
  draft?: boolean
  reviewerUuids?: string[]
}

export type BitbucketMergeStrategy =
  | 'merge_commit'
  | 'squash'
  | 'fast_forward'
  | 'squash_fast_forward'
  | 'rebase_fast_forward'
  | 'rebase_merge'

export interface BitbucketMergePullRequestParams extends BitbucketPullRequestParams {
  mergeStrategy?: BitbucketMergeStrategy
  message?: string
  closeSourceBranch?: boolean
}

export interface BitbucketGetMergeTaskStatusParams extends BitbucketPullRequestParams {
  taskId: string
}

export interface BitbucketGetPullRequestDiffParams extends BitbucketPullRequestParams {
  path: string
  maxCharacters?: number
}

export interface BitbucketPaginatedPullRequestParams
  extends BitbucketPullRequestParams,
    BitbucketPaginationParams {}

export interface BitbucketListPullRequestCommentsParams
  extends BitbucketPaginatedPullRequestParams {
  q?: string
  sort?: string
}

export interface BitbucketCreatePullRequestCommentParams extends BitbucketPullRequestParams {
  content: string
  parentId?: number
}

export interface BitbucketListPullRequestCommitStatusesParams
  extends BitbucketPaginatedPullRequestParams {
  q?: string
  sort?: string
}

export type BitbucketPipelineListRefType = 'BRANCH' | 'TAG' | 'ANNOTATED_TAG'
export type BitbucketPipelineListSelectorType =
  | 'BRANCH'
  | 'TAG'
  | 'CUSTOM'
  | 'PULLREQUESTS'
  | 'DEFAULT'
export type BitbucketPipelineTriggerType = 'PUSH' | 'MANUAL' | 'SCHEDULED' | 'PARENT_STEP'
export type BitbucketPipelineStatus =
  | 'PARSING'
  | 'PENDING'
  | 'PAUSED'
  | 'HALTED'
  | 'BUILDING'
  | 'ERROR'
  | 'PASSED'
  | 'FAILED'
  | 'STOPPED'
  | 'UNKNOWN'

export interface BitbucketListPipelinesParams
  extends BitbucketRepositoryParams,
    BitbucketPaginationParams {
  refType?: BitbucketPipelineListRefType
  refName?: string
  commitHash?: string
  selectorType?: BitbucketPipelineListSelectorType
  selectorPattern?: string
  triggerType?: BitbucketPipelineTriggerType
  status?: BitbucketPipelineStatus
  sort?: 'creator.uuid' | 'created_on' | 'run_creation_date'
}

export interface BitbucketPipelineParams extends BitbucketRepositoryParams {
  pipelineUuid: string
}

export interface BitbucketTriggerPipelineParams extends BitbucketRepositoryParams {
  refType: 'branch' | 'tag' | 'named_branch' | 'bookmark'
  refName: string
  commitHash?: string
}

export interface BitbucketListPipelineStepsParams
  extends BitbucketPipelineParams,
    BitbucketPaginationParams {}

export interface BitbucketGetPipelineStepLogParams extends BitbucketPipelineParams {
  stepUuid: string
  maxCharacters?: number
}

export interface BitbucketPage {
  size: number | null
  page: number | null
  pageLen: number | null
  nextUrl: string | null
  previousUrl: string | null
}

export interface BitbucketUser {
  type: string
  uuid: string | null
  accountId: string | null
  displayName: string | null
  createdOn: string | null
  selfUrl: string | null
  htmlUrl: string | null
  avatarUrl: string | null
}

export interface BitbucketWorkspaceAccess {
  type: string
  slug: string | null
  uuid: string | null
  administrator: boolean | null
  selfUrl: string | null
  avatarUrl: string | null
}

export interface BitbucketRepository {
  type: string
  uuid: string | null
  slug: string | null
  name: string | null
  fullName: string | null
  description: string | null
  isPrivate: boolean | null
  scm: string | null
  language: string | null
  size: number | null
  createdOn: string | null
  updatedOn: string | null
  mainBranch: string | null
  owner: BitbucketUser | null
  project: {
    uuid: string | null
    key: string | null
    name: string | null
  } | null
  selfUrl: string | null
  htmlUrl: string | null
}

export interface BitbucketCommit {
  type: string
  hash: string | null
  date: string | null
  message: string | null
  summary: string | null
  authorRaw: string | null
  author: BitbucketUser | null
  committerRaw: string | null
  committer: BitbucketUser | null
  parents: Array<{ hash: string | null }> | null
  selfUrl: string | null
  htmlUrl: string | null
}

export interface BitbucketBranch {
  type: string
  name: string | null
  target: BitbucketCommit | null
  mergeStrategies: string[] | null
  defaultMergeStrategy: string | null
  selfUrl: string | null
  htmlUrl: string | null
}

export interface BitbucketDirectoryEntry {
  type: string
  path: string | null
  commitHash: string | null
  size: number | null
  attributes: string[] | null
  isBinary: boolean | null
  selfUrl: string | null
  metadataUrl: string | null
}

export interface BitbucketFileMetadata {
  type: 'commit_file'
  path: string | null
  commitHash: string | null
  escapedPath: string | null
  size: number | null
  attributes: string[] | null
  isBinary: boolean | null
}

export interface BitbucketPullRequestEndpoint {
  branchName: string | null
  commitHash: string | null
  repositoryUuid: string | null
  repositoryFullName: string | null
}

export interface BitbucketParticipant {
  type: string
  user: BitbucketUser | null
  role: string | null
  approved: boolean | null
  state: string | null
  participatedOn: string | null
}

export interface BitbucketPullRequest {
  type: string
  id: number | null
  title: string | null
  description: string | null
  state: string | null
  draft: boolean | null
  queued: boolean | null
  author: BitbucketUser | null
  closedBy: BitbucketUser | null
  source: BitbucketPullRequestEndpoint | null
  destination: BitbucketPullRequestEndpoint | null
  mergeCommitHash: string | null
  commentCount: number | null
  taskCount: number | null
  closeSourceBranch: boolean | null
  reason: string | null
  createdOn: string | null
  updatedOn: string | null
  reviewers: BitbucketUser[] | null
  participants: BitbucketParticipant[] | null
  selfUrl: string | null
  htmlUrl: string | null
}

export interface BitbucketComment {
  type: string
  id: number | null
  createdOn: string | null
  updatedOn: string | null
  content: string | null
  user: BitbucketUser | null
  deleted: boolean | null
  parentId: number | null
  inline: {
    path: string | null
    from: number | null
    to: number | null
    startFrom: number | null
    startTo: number | null
  } | null
  pending: boolean | null
  resolution: {
    resolver: BitbucketUser | null
    resolvedOn: string | null
  } | null
  selfUrl: string | null
  htmlUrl: string | null
}

export interface BitbucketCommitStatus {
  type: string
  key: string | null
  refName: string | null
  url: string | null
  state: string | null
  name: string | null
  description: string | null
  createdOn: string | null
  updatedOn: string | null
  selfUrl: string | null
  commitUrl: string | null
}

export interface BitbucketDiffstat {
  type: string
  status: string | null
  linesAdded: number | null
  linesRemoved: number | null
  oldPath: string | null
  newPath: string | null
  oldCommitHash: string | null
  newCommitHash: string | null
}

export interface BitbucketPipeline {
  type: string
  uuid: string | null
  buildNumber: number | null
  creator: BitbucketUser | null
  repositoryFullName: string | null
  target: {
    type: string | null
    refType: string | null
    refName: string | null
    commitHash: string | null
    selectorType: string | null
    selectorPattern: string | null
  } | null
  triggerType: string | null
  state: {
    name: string | null
    stage: string | null
    result: string | null
    errorKey: string | null
    errorMessage: string | null
  } | null
  createdOn: string | null
  completedOn: string | null
  buildSecondsUsed: number | null
  selfUrl: string | null
  stepsUrl: string | null
}

export interface BitbucketPipelineStep {
  type: string
  uuid: string | null
  startedOn: string | null
  completedOn: string | null
  state: {
    name: string | null
    result: string | null
    errorKey: string | null
    errorMessage: string | null
  } | null
  imageName: string | null
  setupCommands: Array<{ name: string | null; command: string | null }> | null
  scriptCommands: Array<{ name: string | null; command: string | null }> | null
}

export interface BitbucketListOutput<T> {
  items: T[]
  page: BitbucketPage
}

export interface BitbucketToolResponse<T> {
  success: true
  output: T
}

export const BITBUCKET_USER_OUTPUT_PROPERTIES: Record<string, ToolOutputProperty> = {
  type: { type: 'string', description: 'Bitbucket account object type' },
  uuid: { type: 'string', description: 'Bitbucket account UUID', nullable: true },
  accountId: { type: 'string', description: 'Atlassian account ID', nullable: true },
  displayName: { type: 'string', description: 'Account display name', nullable: true },
  createdOn: { type: 'string', description: 'Account creation timestamp', nullable: true },
  selfUrl: { type: 'string', description: 'Account API URL', nullable: true },
  htmlUrl: { type: 'string', description: 'Account web URL', nullable: true },
  avatarUrl: { type: 'string', description: 'Account avatar URL', nullable: true },
}

export const BITBUCKET_WORKSPACE_OUTPUT_PROPERTIES: Record<string, ToolOutputProperty> = {
  type: { type: 'string', description: 'Bitbucket workspace-access object type' },
  slug: { type: 'string', description: 'Workspace slug', nullable: true },
  uuid: { type: 'string', description: 'Workspace UUID', nullable: true },
  administrator: {
    type: 'boolean',
    description: 'Whether the caller administers the workspace',
    nullable: true,
  },
  selfUrl: { type: 'string', description: 'Workspace API URL', nullable: true },
  avatarUrl: { type: 'string', description: 'Workspace avatar URL', nullable: true },
}

export const BITBUCKET_REPOSITORY_OUTPUT_PROPERTIES: Record<string, ToolOutputProperty> = {
  type: { type: 'string', description: 'Bitbucket repository object type' },
  uuid: { type: 'string', description: 'Repository UUID', nullable: true },
  slug: { type: 'string', description: 'Repository slug', nullable: true },
  name: { type: 'string', description: 'Repository name', nullable: true },
  fullName: { type: 'string', description: 'Workspace and repository full name', nullable: true },
  description: { type: 'string', description: 'Repository description', nullable: true },
  isPrivate: { type: 'boolean', description: 'Whether the repository is private', nullable: true },
  scm: { type: 'string', description: 'Source control system', nullable: true },
  language: { type: 'string', description: 'Primary repository language', nullable: true },
  size: { type: 'number', description: 'Repository size in bytes', nullable: true },
  createdOn: { type: 'string', description: 'Repository creation timestamp', nullable: true },
  updatedOn: { type: 'string', description: 'Repository update timestamp', nullable: true },
  mainBranch: { type: 'string', description: 'Main branch name', nullable: true },
  owner: {
    type: 'object',
    description: 'Repository owner',
    nullable: true,
    properties: BITBUCKET_USER_OUTPUT_PROPERTIES,
  },
  project: {
    type: 'object',
    description: 'Containing Bitbucket project',
    nullable: true,
    properties: {
      uuid: { type: 'string', description: 'Project UUID', nullable: true },
      key: { type: 'string', description: 'Project key', nullable: true },
      name: { type: 'string', description: 'Project name', nullable: true },
    },
  },
  selfUrl: { type: 'string', description: 'Repository API URL', nullable: true },
  htmlUrl: { type: 'string', description: 'Repository web URL', nullable: true },
}

export const BITBUCKET_COMMIT_OUTPUT_PROPERTIES: Record<string, ToolOutputProperty> = {
  type: { type: 'string', description: 'Bitbucket commit object type' },
  hash: { type: 'string', description: 'Commit hash', nullable: true },
  date: { type: 'string', description: 'Commit timestamp', nullable: true },
  message: { type: 'string', description: 'Full commit message', nullable: true },
  summary: { type: 'string', description: 'Raw commit summary', nullable: true },
  authorRaw: { type: 'string', description: 'Raw author value stored by Git', nullable: true },
  author: {
    type: 'object',
    description: 'Matched Bitbucket account, when available',
    nullable: true,
    properties: BITBUCKET_USER_OUTPUT_PROPERTIES,
  },
  committerRaw: {
    type: 'string',
    description: 'Raw committer value stored by Git',
    nullable: true,
  },
  committer: {
    type: 'object',
    description: 'Matched Bitbucket committer account, when available',
    nullable: true,
    properties: BITBUCKET_USER_OUTPUT_PROPERTIES,
  },
  parents: {
    type: 'array',
    description: 'Parent commits',
    nullable: true,
    items: {
      type: 'object',
      properties: {
        hash: { type: 'string', description: 'Parent commit hash', nullable: true },
      },
    },
  },
  selfUrl: { type: 'string', description: 'Commit API URL', nullable: true },
  htmlUrl: { type: 'string', description: 'Commit web URL', nullable: true },
}

export const BITBUCKET_BRANCH_OUTPUT_PROPERTIES: Record<string, ToolOutputProperty> = {
  type: { type: 'string', description: 'Bitbucket branch object type' },
  name: { type: 'string', description: 'Branch name', nullable: true },
  target: {
    type: 'object',
    description: 'Commit targeted by the branch',
    nullable: true,
    properties: BITBUCKET_COMMIT_OUTPUT_PROPERTIES,
  },
  mergeStrategies: {
    type: 'array',
    description: 'Merge strategies available for the branch',
    nullable: true,
    items: { type: 'string' },
  },
  defaultMergeStrategy: { type: 'string', description: 'Default merge strategy', nullable: true },
  selfUrl: { type: 'string', description: 'Branch API URL', nullable: true },
  htmlUrl: { type: 'string', description: 'Branch web URL', nullable: true },
}

export const BITBUCKET_DIRECTORY_ENTRY_OUTPUT_PROPERTIES: Record<string, ToolOutputProperty> = {
  type: {
    type: 'string',
    description: 'Entry type, such as commit_file or commit_directory',
  },
  path: { type: 'string', description: 'Repository-relative path', nullable: true },
  commitHash: { type: 'string', description: 'Resolved commit hash', nullable: true },
  size: {
    type: 'number',
    description: 'File size in bytes when the entry is a file',
    nullable: true,
  },
  attributes: {
    type: 'array',
    description: 'File attributes when the entry is a file',
    nullable: true,
    items: { type: 'string' },
  },
  isBinary: {
    type: 'boolean',
    description: 'Whether file attributes include the binary marker',
    nullable: true,
  },
  selfUrl: { type: 'string', description: 'Source API URL', nullable: true },
  metadataUrl: { type: 'string', description: 'Source metadata API URL', nullable: true },
}

export const BITBUCKET_FILE_METADATA_OUTPUT_PROPERTIES: Record<string, ToolOutputProperty> = {
  type: { type: 'string', description: 'Entry type (commit_file)' },
  path: { type: 'string', description: 'Repository-relative path', nullable: true },
  commitHash: { type: 'string', description: 'Resolved commit hash', nullable: true },
  escapedPath: { type: 'string', description: 'Escaped display path', nullable: true },
  size: { type: 'number', description: 'File size in bytes', nullable: true },
  attributes: {
    type: 'array',
    description: 'File attributes reported by Bitbucket',
    nullable: true,
    items: { type: 'string' },
  },
  isBinary: {
    type: 'boolean',
    description: 'Whether the documented attributes include the binary marker',
    nullable: true,
  },
}

export const BITBUCKET_PARTICIPANT_OUTPUT_PROPERTIES: Record<string, ToolOutputProperty> = {
  type: { type: 'string', description: 'Bitbucket participant object type' },
  user: {
    type: 'object',
    description: 'Participating account',
    nullable: true,
    properties: BITBUCKET_USER_OUTPUT_PROPERTIES,
  },
  role: { type: 'string', description: 'Participant role', nullable: true },
  approved: { type: 'boolean', description: 'Whether the participant approved', nullable: true },
  state: { type: 'string', description: 'Review state', nullable: true },
  participatedOn: {
    type: 'string',
    description: 'Timestamp of the participant action',
    nullable: true,
  },
}

export const BITBUCKET_PR_ENDPOINT_OUTPUT_PROPERTIES: Record<string, ToolOutputProperty> = {
  branchName: { type: 'string', description: 'Branch name', nullable: true },
  commitHash: { type: 'string', description: 'Commit hash', nullable: true },
  repositoryUuid: { type: 'string', description: 'Repository UUID', nullable: true },
  repositoryFullName: { type: 'string', description: 'Repository full name', nullable: true },
}

export const BITBUCKET_PULL_REQUEST_OUTPUT_PROPERTIES: Record<string, ToolOutputProperty> = {
  type: { type: 'string', description: 'Bitbucket pull request object type' },
  id: { type: 'number', description: 'Repository-scoped pull request ID', nullable: true },
  title: { type: 'string', description: 'Pull request title', nullable: true },
  description: { type: 'string', description: 'Pull request description', nullable: true },
  state: { type: 'string', description: 'Pull request state', nullable: true },
  draft: { type: 'boolean', description: 'Whether the pull request is a draft', nullable: true },
  queued: { type: 'boolean', description: 'Whether the pull request is queued', nullable: true },
  author: {
    type: 'object',
    description: 'Pull request author',
    nullable: true,
    properties: BITBUCKET_USER_OUTPUT_PROPERTIES,
  },
  closedBy: {
    type: 'object',
    description: 'Account that closed the pull request',
    nullable: true,
    properties: BITBUCKET_USER_OUTPUT_PROPERTIES,
  },
  source: {
    type: 'object',
    description: 'Source endpoint',
    nullable: true,
    properties: BITBUCKET_PR_ENDPOINT_OUTPUT_PROPERTIES,
  },
  destination: {
    type: 'object',
    description: 'Destination endpoint',
    nullable: true,
    properties: BITBUCKET_PR_ENDPOINT_OUTPUT_PROPERTIES,
  },
  mergeCommitHash: { type: 'string', description: 'Merge commit hash', nullable: true },
  commentCount: { type: 'number', description: 'Comment count', nullable: true },
  taskCount: { type: 'number', description: 'Open task count', nullable: true },
  closeSourceBranch: {
    type: 'boolean',
    description: 'Whether merging closes the source branch',
    nullable: true,
  },
  reason: { type: 'string', description: 'Reason the pull request was declined', nullable: true },
  createdOn: { type: 'string', description: 'Creation timestamp', nullable: true },
  updatedOn: { type: 'string', description: 'Update timestamp', nullable: true },
  reviewers: {
    type: 'array',
    description: 'Explicit reviewers',
    nullable: true,
    items: { type: 'object', properties: BITBUCKET_USER_OUTPUT_PROPERTIES },
  },
  participants: {
    type: 'array',
    description: 'Pull request participants',
    nullable: true,
    items: { type: 'object', properties: BITBUCKET_PARTICIPANT_OUTPUT_PROPERTIES },
  },
  selfUrl: { type: 'string', description: 'Pull request API URL', nullable: true },
  htmlUrl: { type: 'string', description: 'Pull request web URL', nullable: true },
}

export const BITBUCKET_COMMENT_RESOLUTION_OUTPUT_PROPERTIES: Record<string, ToolOutputProperty> = {
  resolver: {
    type: 'object',
    description: 'Account that resolved the comment',
    nullable: true,
    properties: BITBUCKET_USER_OUTPUT_PROPERTIES,
  },
  resolvedOn: { type: 'string', description: 'Resolution timestamp', nullable: true },
}

export const BITBUCKET_COMMENT_OUTPUT_PROPERTIES: Record<string, ToolOutputProperty> = {
  type: { type: 'string', description: 'Bitbucket comment object type' },
  id: { type: 'number', description: 'Comment ID', nullable: true },
  createdOn: { type: 'string', description: 'Creation timestamp', nullable: true },
  updatedOn: { type: 'string', description: 'Update timestamp', nullable: true },
  content: { type: 'string', description: 'Raw comment content', nullable: true },
  user: {
    type: 'object',
    description: 'Comment author',
    nullable: true,
    properties: BITBUCKET_USER_OUTPUT_PROPERTIES,
  },
  deleted: { type: 'boolean', description: 'Whether the comment was deleted', nullable: true },
  parentId: { type: 'number', description: 'Parent comment ID', nullable: true },
  inline: {
    type: 'object',
    description: 'Inline comment anchor',
    nullable: true,
    properties: {
      path: { type: 'string', description: 'Anchored file path', nullable: true },
      from: { type: 'number', description: 'Ending line in the old file', nullable: true },
      to: { type: 'number', description: 'Ending line in the new file', nullable: true },
      startFrom: { type: 'number', description: 'Starting line in the old file', nullable: true },
      startTo: { type: 'number', description: 'Starting line in the new file', nullable: true },
    },
  },
  pending: { type: 'boolean', description: 'Whether the comment is pending', nullable: true },
  resolution: {
    type: 'object',
    description: 'Comment resolution details',
    nullable: true,
    properties: BITBUCKET_COMMENT_RESOLUTION_OUTPUT_PROPERTIES,
  },
  selfUrl: { type: 'string', description: 'Comment API URL', nullable: true },
  htmlUrl: { type: 'string', description: 'Comment web URL', nullable: true },
}

export const BITBUCKET_COMMIT_STATUS_OUTPUT_PROPERTIES: Record<string, ToolOutputProperty> = {
  type: { type: 'string', description: 'Bitbucket commit-status object type' },
  key: { type: 'string', description: 'Vendor-unique status key', nullable: true },
  refName: {
    type: 'string',
    description: 'Reference name at status creation time',
    nullable: true,
  },
  url: { type: 'string', description: 'External build URL', nullable: true },
  state: { type: 'string', description: 'Commit status state', nullable: true },
  name: { type: 'string', description: 'Build name', nullable: true },
  description: { type: 'string', description: 'Build description', nullable: true },
  createdOn: { type: 'string', description: 'Creation timestamp', nullable: true },
  updatedOn: { type: 'string', description: 'Update timestamp', nullable: true },
  selfUrl: { type: 'string', description: 'Status API URL', nullable: true },
  commitUrl: { type: 'string', description: 'Commit API URL', nullable: true },
}

export const BITBUCKET_DIFFSTAT_OUTPUT_PROPERTIES: Record<string, ToolOutputProperty> = {
  type: { type: 'string', description: 'Diffstat object type' },
  status: { type: 'string', description: 'File change status', nullable: true },
  linesAdded: { type: 'number', description: 'Lines added', nullable: true },
  linesRemoved: { type: 'number', description: 'Lines removed', nullable: true },
  oldPath: { type: 'string', description: 'Old file path', nullable: true },
  newPath: { type: 'string', description: 'New file path', nullable: true },
  oldCommitHash: { type: 'string', description: 'Old file commit hash', nullable: true },
  newCommitHash: { type: 'string', description: 'New file commit hash', nullable: true },
}

export const BITBUCKET_PIPELINE_OUTPUT_PROPERTIES: Record<string, ToolOutputProperty> = {
  type: { type: 'string', description: 'Bitbucket pipeline object type' },
  uuid: { type: 'string', description: 'Pipeline UUID', nullable: true },
  buildNumber: { type: 'number', description: 'Pipeline build number', nullable: true },
  creator: {
    type: 'object',
    description: 'Pipeline creator',
    nullable: true,
    properties: BITBUCKET_USER_OUTPUT_PROPERTIES,
  },
  repositoryFullName: { type: 'string', description: 'Repository full name', nullable: true },
  target: {
    type: 'object',
    description: 'Pipeline target',
    nullable: true,
    properties: {
      type: { type: 'string', description: 'Target object type', nullable: true },
      refType: { type: 'string', description: 'Reference type', nullable: true },
      refName: { type: 'string', description: 'Reference name', nullable: true },
      commitHash: { type: 'string', description: 'Target commit hash', nullable: true },
      selectorType: { type: 'string', description: 'Pipeline selector type', nullable: true },
      selectorPattern: { type: 'string', description: 'Pipeline selector pattern', nullable: true },
    },
  },
  triggerType: { type: 'string', description: 'Pipeline trigger object type', nullable: true },
  state: {
    type: 'object',
    description: 'Pipeline state',
    nullable: true,
    properties: {
      name: { type: 'string', description: 'State name', nullable: true },
      stage: { type: 'string', description: 'In-progress stage name', nullable: true },
      result: { type: 'string', description: 'Completed result name', nullable: true },
      errorKey: { type: 'string', description: 'Completed-error key', nullable: true },
      errorMessage: { type: 'string', description: 'Completed-error message', nullable: true },
    },
  },
  createdOn: { type: 'string', description: 'Creation timestamp', nullable: true },
  completedOn: { type: 'string', description: 'Completion timestamp', nullable: true },
  buildSecondsUsed: { type: 'number', description: 'Build seconds used', nullable: true },
  selfUrl: { type: 'string', description: 'Pipeline API URL', nullable: true },
  stepsUrl: { type: 'string', description: 'Pipeline steps API URL', nullable: true },
}

export const BITBUCKET_PIPELINE_COMMAND_OUTPUT_PROPERTIES: Record<string, ToolOutputProperty> = {
  name: { type: 'string', description: 'Command name', nullable: true },
  command: { type: 'string', description: 'Executable command', nullable: true },
}

export const BITBUCKET_PIPELINE_STEP_OUTPUT_PROPERTIES: Record<string, ToolOutputProperty> = {
  type: { type: 'string', description: 'Bitbucket pipeline-step object type' },
  uuid: { type: 'string', description: 'Pipeline step UUID', nullable: true },
  startedOn: { type: 'string', description: 'Step start timestamp', nullable: true },
  completedOn: { type: 'string', description: 'Step completion timestamp', nullable: true },
  state: {
    type: 'object',
    description: 'Pipeline step state',
    nullable: true,
    properties: {
      name: { type: 'string', description: 'State name', nullable: true },
      result: { type: 'string', description: 'Completed result name', nullable: true },
      errorKey: { type: 'string', description: 'Completed-error key', nullable: true },
      errorMessage: { type: 'string', description: 'Completed-error message', nullable: true },
    },
  },
  imageName: { type: 'string', description: 'Build container image name', nullable: true },
  setupCommands: {
    type: 'array',
    description: 'Setup commands',
    nullable: true,
    items: { type: 'object', properties: BITBUCKET_PIPELINE_COMMAND_OUTPUT_PROPERTIES },
  },
  scriptCommands: {
    type: 'array',
    description: 'Build script commands',
    nullable: true,
    items: { type: 'object', properties: BITBUCKET_PIPELINE_COMMAND_OUTPUT_PROPERTIES },
  },
}

export const BITBUCKET_PAGE_OUTPUT_PROPERTIES: Record<string, ToolOutputProperty> = {
  size: {
    type: 'number',
    description: 'Total result count reported by Bitbucket',
    nullable: true,
  },
  page: { type: 'number', description: 'Current page number', nullable: true },
  pageLen: {
    type: 'number',
    description: 'Number of results requested per page',
    nullable: true,
  },
  nextUrl: { type: 'string', description: 'Validated URL for the next page', nullable: true },
  previousUrl: {
    type: 'string',
    description: 'Validated URL for the previous page',
    nullable: true,
  },
}

export const BITBUCKET_PAGE_OUTPUT: ToolOutputProperty = {
  type: 'object',
  description: 'Pagination information',
  properties: BITBUCKET_PAGE_OUTPUT_PROPERTIES,
}
