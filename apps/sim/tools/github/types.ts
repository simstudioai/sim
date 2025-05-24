import type { ToolResponse } from '../types'

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
