import type { ToolResponse } from '@/tools/types'

export type RailwayTokenType = 'account' | 'workspace' | 'project' | 'oauth'

export interface RailwayAuthParams {
  apiKey: string
  tokenType?: RailwayTokenType
}

export interface RailwayPageInfo {
  hasNextPage: boolean
  endCursor: string | null
}

export interface RailwayProjectSummary {
  id: string
  name: string
  description: string | null
  createdAt: string
  updatedAt?: string | null
}

export interface RailwayUpdatedProject {
  id: string
  name: string
  description: string | null
}

export interface RailwayProjectService {
  id: string
  name: string
  icon: string | null
}

export interface RailwayProjectEnvironment {
  id: string
  name: string
}

export interface RailwayProjectMember {
  id: string
  role: string
  user: {
    id: string
    name: string | null
    email: string | null
  } | null
}

export interface RailwayCreatedResource {
  id: string
  name: string
}

export interface RailwayDeploymentSummary {
  id: string
  status: string
  createdAt: string
  url: string | null
  staticUrl: string | null
}

export interface RailwayListProjectsParams extends RailwayAuthParams {
  workspaceId?: string
  first?: number
  after?: string
}

export interface RailwayGetProjectParams extends RailwayAuthParams {
  projectId: string
}

export interface RailwayCreateProjectParams extends RailwayAuthParams {
  name: string
  description?: string
  workspaceId?: string
  isPublic?: boolean
  defaultEnvironmentName?: string
  prDeploys?: boolean
}

export interface RailwayUpdateProjectParams extends RailwayAuthParams {
  projectId: string
  name?: string
  description?: string
  isPublic?: boolean
  prDeploys?: boolean
}

export interface RailwayDeleteProjectParams extends RailwayAuthParams {
  projectId: string
}

export interface RailwayTransferProjectParams extends RailwayAuthParams {
  projectId: string
  workspaceId: string
}

export interface RailwayListProjectMembersParams extends RailwayAuthParams {
  projectId: string
}

export interface RailwayCreateEnvironmentParams extends RailwayAuthParams {
  projectId: string
  name: string
  sourceEnvironmentId?: string
  ephemeral?: boolean
  skipInitialDeploys?: boolean
  stageInitialChanges?: boolean
}

export interface RailwayDeleteEnvironmentParams extends RailwayAuthParams {
  environmentId: string
}

export interface RailwayListDeploymentsParams extends RailwayAuthParams {
  projectId: string
  serviceId: string
  environmentId: string
  first?: number
  after?: string
}

export interface RailwayDeployServiceParams extends RailwayAuthParams {
  serviceId: string
  environmentId: string
  commitSha?: string
}

export interface RailwayListVariablesParams extends RailwayAuthParams {
  projectId: string
  environmentId: string
  serviceId?: string
}

export interface RailwayUpsertVariableParams extends RailwayAuthParams {
  projectId: string
  environmentId: string
  name: string
  value: string
  serviceId?: string
  skipDeploys?: boolean
}

export interface RailwayListProjectsResponse extends ToolResponse {
  output: {
    projects: RailwayProjectSummary[]
    pageInfo: RailwayPageInfo
    count: number
  }
}

export interface RailwayGetProjectResponse extends ToolResponse {
  output: {
    project: RailwayProjectSummary & {
      services: RailwayProjectService[]
      environments: RailwayProjectEnvironment[]
    }
  }
}

export interface RailwayCreateProjectResponse extends ToolResponse {
  output: {
    project: RailwayCreatedResource
  }
}

export interface RailwayUpdateProjectResponse extends ToolResponse {
  output: {
    project: RailwayUpdatedProject
  }
}

export interface RailwayDeleteProjectResponse extends ToolResponse {
  output: {
    success: boolean
  }
}

export interface RailwayTransferProjectResponse extends ToolResponse {
  output: {
    success: boolean
  }
}

export interface RailwayListProjectMembersResponse extends ToolResponse {
  output: {
    members: RailwayProjectMember[]
    count: number
  }
}

export interface RailwayCreateEnvironmentResponse extends ToolResponse {
  output: {
    environment: RailwayCreatedResource
  }
}

export interface RailwayDeleteEnvironmentResponse extends ToolResponse {
  output: {
    success: boolean
  }
}

export interface RailwayListDeploymentsResponse extends ToolResponse {
  output: {
    deployments: RailwayDeploymentSummary[]
    pageInfo: RailwayPageInfo
    count: number
  }
}

export interface RailwayDeployServiceResponse extends ToolResponse {
  output: {
    deploymentId: string
  }
}

export interface RailwayListVariablesResponse extends ToolResponse {
  output: {
    variables: Record<string, string>
    count: number
  }
}

export interface RailwayUpsertVariableResponse extends ToolResponse {
  output: {
    success: boolean
  }
}

export type RailwayResponse =
  | RailwayListProjectsResponse
  | RailwayGetProjectResponse
  | RailwayCreateProjectResponse
  | RailwayUpdateProjectResponse
  | RailwayDeleteProjectResponse
  | RailwayTransferProjectResponse
  | RailwayListProjectMembersResponse
  | RailwayCreateEnvironmentResponse
  | RailwayDeleteEnvironmentResponse
  | RailwayListDeploymentsResponse
  | RailwayDeployServiceResponse
  | RailwayListVariablesResponse
  | RailwayUpsertVariableResponse
