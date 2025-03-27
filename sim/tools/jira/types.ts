import { ToolResponse } from '../types'

export interface JiraRetrieveParams {
  accessToken: string
  issueKey: string
  domain: string
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

export interface JiraUpdateParams {
  accessToken: string
  domain: string
  boardId: string
  issueKey: string
  summary?: string
  description?: string
  status?: string
  priority?: string
  assignee?: string
}

export interface JiraUpdateResponse extends ToolResponse {
  output: {
    ts: string
    issueKey: string
    boardId: string
    summary: string
    success: boolean
  }
}

export interface JiraWriteParams {
  accessToken: string
  domain: string
  projectKey: string
  summary: string
  description?: string
  issueType: string
  priority?: string
  assignee?: string
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

export interface JiraListParams {
  accessToken: string
  domain: string
  projectKey?: string
  status?: string
  assignee?: string
  limit?: number
  jql?: string
}

export interface JiraListResponse extends ToolResponse {
  output: {
    ts: string
    issues: JiraIssue[]
    total: number
  }
}