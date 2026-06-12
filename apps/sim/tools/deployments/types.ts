import type { ToolResponse, WorkflowToolExecutionContext } from '@/tools/types'

export interface DeploymentsDeployParams {
  workflowId: string
  name?: string
  description?: string
  _context?: WorkflowToolExecutionContext
}

export interface DeploymentsUndeployParams {
  workflowId: string
  _context?: WorkflowToolExecutionContext
}

export interface DeploymentsPromoteParams {
  workflowId: string
  version: number
  _context?: WorkflowToolExecutionContext
}

export interface DeploymentsListVersionsParams {
  workflowId: string
  _context?: WorkflowToolExecutionContext
}

export interface DeploymentsGetVersionParams {
  workflowId: string
  version: number
  _context?: WorkflowToolExecutionContext
}

export interface DeploymentVersionSummary {
  id: string
  version: number
  name: string | null
  description: string | null
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
