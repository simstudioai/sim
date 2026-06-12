import type { ToolResponse } from '@/tools/types'

export interface DeploymentsDeployParams {
  workflowId: string
  name?: string
  description?: string
}

export interface DeploymentsUndeployParams {
  workflowId: string
}

export interface DeploymentsPromoteParams {
  workflowId: string
  version: number
}

export interface DeploymentsListVersionsParams {
  workflowId: string
}

export interface DeploymentsGetVersionParams {
  workflowId: string
  version: number
}

export interface DeploymentVersionSummary {
  id: string
  version: number
  name: string | null
  isActive: boolean
  createdAt: string
  createdBy: string | null
  deployedByName: string | null
}

export interface DeploymentsDeployResponse extends ToolResponse {
  output: {
    workflowId: string
    isDeployed: boolean
    deployedAt: string | null
    version?: number
    warnings: string[]
  }
}

export interface DeploymentsUndeployResponse extends ToolResponse {
  output: {
    workflowId: string
    isDeployed: boolean
    deployedAt: null
    warnings: string[]
  }
}

export interface DeploymentsPromoteResponse extends ToolResponse {
  output: {
    workflowId: string
    isDeployed: boolean
    deployedAt: string | null
    version: number
    warnings: string[]
  }
}

export interface DeploymentsListVersionsResponse extends ToolResponse {
  output: {
    workflowId: string
    versions: DeploymentVersionSummary[]
  }
}

export interface DeploymentsGetVersionResponse extends ToolResponse {
  output: {
    workflowId: string
    version: number
    name: string | null
    description: string | null
    isActive: boolean
    createdAt: string
    deployedState: unknown
  }
}
