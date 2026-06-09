import type { ToolResponse } from '@/tools/types'

export interface AppConfigConnectionConfig {
  region: string
  accessKeyId: string
  secretAccessKey: string
}

export interface AppConfigCreateVersionParams extends AppConfigConnectionConfig {
  applicationId: string
  configurationProfileId: string
  content: string
  contentType: string
  description?: string
  versionLabel?: string
  latestVersionNumber?: number
}

export interface AppConfigGetVersionParams extends AppConfigConnectionConfig {
  applicationId: string
  configurationProfileId: string
  versionNumber: number
}

export interface AppConfigListVersionsParams extends AppConfigConnectionConfig {
  applicationId: string
  configurationProfileId: string
  maxResults?: number
  nextToken?: string
}

export interface AppConfigStartDeploymentParams extends AppConfigConnectionConfig {
  applicationId: string
  environmentId: string
  deploymentStrategyId: string
  configurationProfileId: string
  configurationVersion: string
  description?: string
}

export interface AppConfigDeploymentRefParams extends AppConfigConnectionConfig {
  applicationId: string
  environmentId: string
  deploymentNumber: number
}

export interface AppConfigListDeploymentsParams extends AppConfigConnectionConfig {
  applicationId: string
  environmentId: string
  maxResults?: number
  nextToken?: string
}

export interface AppConfigListEnvironmentsParams extends AppConfigConnectionConfig {
  applicationId: string
  maxResults?: number
  nextToken?: string
}

export interface AppConfigListProfilesParams extends AppConfigConnectionConfig {
  applicationId: string
  maxResults?: number
  nextToken?: string
}

export interface AppConfigListPaginatedParams extends AppConfigConnectionConfig {
  maxResults?: number
  nextToken?: string
}

export interface AppConfigVersionSummary {
  applicationId: string | null
  configurationProfileId: string | null
  versionNumber: number | null
  description: string | null
  contentType: string | null
  versionLabel: string | null
}

export interface AppConfigDeploymentSummary {
  deploymentNumber: number | null
  configurationName: string | null
  configurationVersion: string | null
  state: string | null
  percentageComplete: number | null
  startedAt: string | null
  completedAt: string | null
  versionLabel: string | null
}

export interface AppConfigApplicationSummary {
  id: string | null
  name: string | null
  description: string | null
}

export interface AppConfigEnvironmentSummary {
  applicationId: string | null
  id: string | null
  name: string | null
  state: string | null
  description: string | null
}

export interface AppConfigProfileSummary {
  applicationId: string | null
  id: string | null
  name: string | null
  locationUri: string | null
  type: string | null
}

export interface AppConfigStrategySummary {
  id: string | null
  name: string | null
  description: string | null
  deploymentDurationInMinutes: number | null
  growthType: string | null
  growthFactor: number | null
  finalBakeTimeInMinutes: number | null
  replicateTo: string | null
}

export interface AppConfigCreateVersionResponse extends ToolResponse {
  output: {
    message: string
    applicationId: string | null
    configurationProfileId: string | null
    versionNumber: number | null
    contentType: string | null
    description: string | null
    versionLabel: string | null
  }
}

export interface AppConfigGetVersionResponse extends ToolResponse {
  output: {
    applicationId: string | null
    configurationProfileId: string | null
    versionNumber: number | null
    content: string | null
    contentType: string | null
    description: string | null
    versionLabel: string | null
  }
}

export interface AppConfigListVersionsResponse extends ToolResponse {
  output: {
    items: AppConfigVersionSummary[]
    nextToken: string | null
  }
}

export interface AppConfigDeploymentResponse extends ToolResponse {
  output: {
    message: string
    applicationId: string | null
    environmentId: string | null
    deploymentNumber: number | null
    deploymentStrategyId: string | null
    configurationProfileId: string | null
    configurationVersion: string | null
    description: string | null
    state: string | null
    percentageComplete: number | null
    startedAt: string | null
    completedAt: string | null
  }
}

export interface AppConfigListDeploymentsResponse extends ToolResponse {
  output: {
    items: AppConfigDeploymentSummary[]
    nextToken: string | null
  }
}

export interface AppConfigListApplicationsResponse extends ToolResponse {
  output: {
    items: AppConfigApplicationSummary[]
    nextToken: string | null
  }
}

export interface AppConfigListEnvironmentsResponse extends ToolResponse {
  output: {
    items: AppConfigEnvironmentSummary[]
    nextToken: string | null
  }
}

export interface AppConfigListProfilesResponse extends ToolResponse {
  output: {
    items: AppConfigProfileSummary[]
    nextToken: string | null
  }
}

export interface AppConfigListStrategiesResponse extends ToolResponse {
  output: {
    items: AppConfigStrategySummary[]
    nextToken: string | null
  }
}

export type AppConfigResponse =
  | AppConfigCreateVersionResponse
  | AppConfigGetVersionResponse
  | AppConfigListVersionsResponse
  | AppConfigDeploymentResponse
  | AppConfigListDeploymentsResponse
  | AppConfigListApplicationsResponse
  | AppConfigListEnvironmentsResponse
  | AppConfigListProfilesResponse
  | AppConfigListStrategiesResponse
