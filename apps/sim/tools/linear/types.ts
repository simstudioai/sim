import type { ToolResponse } from '../types'

export interface LinearIssue {
  id: string
  title: string
  description?: string
  state?: string
  teamId: string
  projectId: string
}

export interface LinearReadIssuesParams {
  teamId: string
  projectId: string
  accessToken?: string
}

export interface LinearCreateIssueParams {
  teamId: string
  projectId: string
  title: string
  description?: string
  accessToken?: string
}

export interface LinearReadIssuesResponse extends ToolResponse {
  output: {
    issues: LinearIssue[]
  }
}

export interface LinearCreateIssueResponse extends ToolResponse {
  output: {
    issue: LinearIssue
  }
}

export type LinearResponse = LinearReadIssuesResponse | LinearCreateIssueResponse
