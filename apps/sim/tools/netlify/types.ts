import type { ToolResponse } from '@/tools/types'

export interface NetlifySite {
  id: string
  name: string | null
  url: string | null
  sslUrl: string | null
  adminUrl: string | null
  customDomain: string | null
  accountId: string | null
  accountSlug: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface NetlifyDeploy {
  id: string
  siteId: string | null
  state: string
  name: string | null
  url: string | null
  deployUrl: string | null
  deploySslUrl: string | null
  adminUrl: string | null
  branch: string | null
  context: string | null
  commitRef: string | null
  commitUrl: string | null
  errorMessage: string | null
  createdAt: string | null
  updatedAt: string | null
  publishedAt: string | null
}

export interface NetlifyEnvValue {
  id: string | null
  context: string | null
  contextParameter: string | null
  value: string
}

export interface NetlifyEnvVar {
  key: string
  scopes: string[]
  values: NetlifyEnvValue[]
  isSecret: boolean
  updatedAt: string | null
}

export interface NetlifyListSitesParams {
  apiKey: string
  name?: string
  filter?: string
  page?: number
  perPage?: number
}

export interface NetlifyListSitesResponse extends ToolResponse {
  output: {
    sites: NetlifySite[]
    count: number
  }
}

export interface NetlifyListDeploysParams {
  apiKey: string
  siteId: string
  state?: string
  branch?: string
  production?: string
  page?: number
  perPage?: number
}

export interface NetlifyListDeploysResponse extends ToolResponse {
  output: {
    deploys: NetlifyDeploy[]
    count: number
  }
}

export interface NetlifyGetDeployParams {
  apiKey: string
  deployId: string
}

export interface NetlifyGetDeployResponse extends ToolResponse {
  output: NetlifyDeploy
}

export interface NetlifyCancelDeployParams {
  apiKey: string
  deployId: string
}

export interface NetlifyCancelDeployResponse extends ToolResponse {
  output: NetlifyDeploy
}

export interface NetlifyCreateDeployParams {
  apiKey: string
  siteId: string
  branch?: string
  title?: string
  clearCache?: string
}

export interface NetlifyCreateDeployResponse extends ToolResponse {
  output: {
    id: string
    deployId: string | null
    siteId: string | null
    sha: string | null
    done: boolean
    error: string | null
    createdAt: string | null
  }
}

export interface NetlifyListEnvVarsParams {
  apiKey: string
  accountId: string
  siteId?: string
  contextName?: string
  scope?: string
}

export interface NetlifyListEnvVarsResponse extends ToolResponse {
  output: {
    envVars: NetlifyEnvVar[]
    count: number
  }
}

export interface NetlifyCreateEnvVarParams {
  apiKey: string
  accountId: string
  siteId?: string
  key: string
  value: string
  context?: string
  scopes?: string
  isSecret?: string
}

export interface NetlifyCreateEnvVarResponse extends ToolResponse {
  output: {
    envVar: NetlifyEnvVar
  }
}

export interface NetlifyUpdateEnvVarParams {
  apiKey: string
  accountId: string
  siteId?: string
  key: string
  value: string
  context?: string
  scopes?: string
  isSecret?: string
}

export interface NetlifyUpdateEnvVarResponse extends ToolResponse {
  output: {
    envVar: NetlifyEnvVar
  }
}

export interface NetlifyDeleteEnvVarParams {
  apiKey: string
  accountId: string
  siteId?: string
  key: string
}

export interface NetlifyDeleteEnvVarResponse extends ToolResponse {
  output: {
    deleted: boolean
  }
}
