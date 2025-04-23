import { ToolResponse } from '../types'

export interface JiraRetrieveParams {
  accessToken: string
  issueKey: string
  domain: string
  cloudId: string
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