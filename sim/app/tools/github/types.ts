import { ToolResponse } from '../types'

export interface PullRequestResponse extends ToolResponse {
  output: {
    number: number
    title: string
    body: string
    state: string
    html_url: string
    diff_url: string
    created_at: string
    updated_at: string
    files?: {
      filename: string
      additions: number
      deletions: number
      changes: number
      patch?: string
      blob_url: string
      raw_url: string
      status: string
    }[]
    comments?: {
      id: number
      body: string
      path?: string
      line?: number
      commit_id: string
      created_at: string
      updated_at: string
      html_url: string
    }[]
  }
}

export interface CreateCommentResponse extends ToolResponse {
  output: {
    id: number
    body: string
    path?: string
    line?: number
    side?: string
    commit_id?: string
    created_at: string
    updated_at: string
    html_url: string
  }
}

export interface PROperationParams {
  owner: string
  repo: string
  pullNumber: number
  apiKey: string
}

export interface CreateCommentParams extends PROperationParams {
  body: string
  path?: string
  position?: number
  line?: number // Add line number support
  side?: string // Add side parameter
  commitId?: string
  commentType?: 'pr_comment' | 'file_comment' // Add comment type
}
