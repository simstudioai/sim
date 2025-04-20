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
  issueTypeId: string
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

export interface JiraProject {
  id: string
  name: string
  key: string
  url: string
  lastModified: string
}

export interface JiraListProjectsParams {
  accessToken: string
  domain: string
  projectId: string
  title?:string
  status?: string
  assignee?: string
  limit?: number
  jql?: string
}

export interface JiraListProjectsResponse extends ToolResponse {
  output: {
    ts: string
    projects: JiraProject[]
  }
}

export interface JiraIssueType {
  id: string
  name: string
  description: string
}

export interface JiraListIssueTypesParams {
  accessToken: string
  domain: string
  projectId: string
  issueTypeId: string
  title?:string
  status?: string
  assignee?: string
  limit?: number
  jql?: string
}

export interface JiraListIssueTypesResponse extends ToolResponse {
  output: {
    ts: string
    issueTypes: JiraIssueType[]
  }
}