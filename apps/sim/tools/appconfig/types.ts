import type { ToolResponse } from '@/tools/types'

export interface AppConfigConnectionConfig {
  region: string
  accessKeyId: string
  secretAccessKey: string
}

export interface AppConfigApplication {
  id: string
  name: string
  description: string | null
}

export interface AppConfigEnvironment {
  applicationId: string
  id: string
  name: string
  description: string | null
  state: string | null
}

export interface AppConfigConfigurationProfile {
  applicationId: string
  id: string
  name: string
  description: string | null
  locationUri: string | null
  retrievalRoleArn: string | null
  type: string | null
  validatorTypes: string[]
}

export interface AppConfigDeploymentSummary {
  deploymentNumber: number | null
  configurationName: string | null
  configurationVersion: string | null
  deploymentDurationInMinutes: number | null
  growthType: string | null
  growthFactor: number | null
  finalBakeTimeInMinutes: number | null
  state: string | null
  percentageComplete: number | null
  startedAt: string | null
  completedAt: string | null
  versionLabel: string | null
}

export interface AppConfigDeploymentDetail {
  applicationId: string
  environmentId: string
  deploymentStrategyId: string
  configurationProfileId: string
  deploymentNumber: number | null
  configurationName: string | null
  configurationVersion: string | null
  description: string | null
  state: string | null
  percentageComplete: number | null
  startedAt: string | null
  completedAt: string | null
}

export interface AppConfigDeploymentStrategy {
  id: string
  name: string
  description: string | null
  deploymentDurationInMinutes: number | null
  growthType: string | null
  growthFactor: number | null
  finalBakeTimeInMinutes: number | null
  replicateTo: string | null
}

export interface AppConfigHostedConfigurationVersionSummary {
  applicationId: string | null
  configurationProfileId: string | null
  versionNumber: number | null
  description: string | null
  contentType: string | null
  versionLabel: string | null
}

export interface AppConfigListApplicationsParams extends AppConfigConnectionConfig {
  maxResults?: number | null
  nextToken?: string | null
}

export interface AppConfigCreateApplicationParams extends AppConfigConnectionConfig {
  name: string
  description?: string | null
}

export interface AppConfigListEnvironmentsParams extends AppConfigConnectionConfig {
  applicationId: string
  maxResults?: number | null
  nextToken?: string | null
}

export interface AppConfigCreateEnvironmentParams extends AppConfigConnectionConfig {
  applicationId: string
  name: string
  description?: string | null
}

export interface AppConfigListConfigurationProfilesParams extends AppConfigConnectionConfig {
  applicationId: string
  maxResults?: number | null
  nextToken?: string | null
}

export interface AppConfigCreateConfigurationProfileParams extends AppConfigConnectionConfig {
  applicationId: string
  name: string
  locationUri: string
  description?: string | null
  retrievalRoleArn?: string | null
  type?: string | null
}

export interface AppConfigCreateHostedConfigurationVersionParams extends AppConfigConnectionConfig {
  applicationId: string
  configurationProfileId: string
  content: string
  contentType: string
  description?: string | null
  latestVersionNumber?: number | null
  versionLabel?: string | null
}

export interface AppConfigGetHostedConfigurationVersionParams extends AppConfigConnectionConfig {
  applicationId: string
  configurationProfileId: string
  versionNumber: number
}

export interface AppConfigListHostedConfigurationVersionsParams extends AppConfigConnectionConfig {
  applicationId: string
  configurationProfileId: string
  maxResults?: number | null
  nextToken?: string | null
}

export interface AppConfigListDeploymentStrategiesParams extends AppConfigConnectionConfig {
  maxResults?: number | null
  nextToken?: string | null
}

export interface AppConfigStartDeploymentParams extends AppConfigConnectionConfig {
  applicationId: string
  environmentId: string
  deploymentStrategyId: string
  configurationProfileId: string
  configurationVersion: string
  description?: string | null
}

export interface AppConfigGetDeploymentParams extends AppConfigConnectionConfig {
  applicationId: string
  environmentId: string
  deploymentNumber: number
}

export interface AppConfigListDeploymentsParams extends AppConfigConnectionConfig {
  applicationId: string
  environmentId: string
  maxResults?: number | null
  nextToken?: string | null
}

export interface AppConfigStopDeploymentParams extends AppConfigConnectionConfig {
  applicationId: string
  environmentId: string
  deploymentNumber: number
}

export interface AppConfigGetConfigurationParams extends AppConfigConnectionConfig {
  applicationId: string
  environmentId: string
  configurationProfileId: string
}

export interface AppConfigListApplicationsResponse extends ToolResponse {
  output: {
    applications: AppConfigApplication[]
    nextToken: string | null
    count: number
  }
  error?: string
}

export interface AppConfigCreateApplicationResponse extends ToolResponse {
  output: {
    message: string
    id: string
    name: string
    description: string | null
  }
  error?: string
}

export interface AppConfigListEnvironmentsResponse extends ToolResponse {
  output: {
    environments: AppConfigEnvironment[]
    nextToken: string | null
    count: number
  }
  error?: string
}

export interface AppConfigCreateEnvironmentResponse extends ToolResponse {
  output: {
    message: string
    applicationId: string
    id: string
    name: string
    state: string | null
  }
  error?: string
}

export interface AppConfigListConfigurationProfilesResponse extends ToolResponse {
  output: {
    configurationProfiles: AppConfigConfigurationProfile[]
    nextToken: string | null
    count: number
  }
  error?: string
}

export interface AppConfigCreateConfigurationProfileResponse extends ToolResponse {
  output: {
    message: string
    applicationId: string
    id: string
    name: string
    locationUri: string | null
    type: string | null
  }
  error?: string
}

export interface AppConfigCreateHostedConfigurationVersionResponse extends ToolResponse {
  output: {
    message: string
    applicationId: string
    configurationProfileId: string
    versionNumber: number | null
    contentType: string | null
    versionLabel: string | null
  }
  error?: string
}

export interface AppConfigGetHostedConfigurationVersionResponse extends ToolResponse {
  output: {
    applicationId: string
    configurationProfileId: string
    versionNumber: number | null
    description: string | null
    content: string
    contentType: string | null
    versionLabel: string | null
  }
  error?: string
}

export interface AppConfigListDeploymentStrategiesResponse extends ToolResponse {
  output: {
    deploymentStrategies: AppConfigDeploymentStrategy[]
    nextToken: string | null
    count: number
  }
  error?: string
}

export interface AppConfigListHostedConfigurationVersionsResponse extends ToolResponse {
  output: {
    versions: AppConfigHostedConfigurationVersionSummary[]
    nextToken: string | null
    count: number
  }
  error?: string
}

export interface AppConfigStartDeploymentResponse extends ToolResponse {
  output: {
    message: string
    deploymentNumber: number | null
    state: string | null
    percentageComplete: number | null
  }
  error?: string
}

export interface AppConfigGetDeploymentResponse extends ToolResponse {
  output: AppConfigDeploymentDetail
  error?: string
}

export interface AppConfigListDeploymentsResponse extends ToolResponse {
  output: {
    deployments: AppConfigDeploymentSummary[]
    nextToken: string | null
    count: number
  }
  error?: string
}

export interface AppConfigStopDeploymentResponse extends ToolResponse {
  output: {
    message: string
    deploymentNumber: number | null
    state: string | null
  }
  error?: string
}

export interface AppConfigGetConfigurationResponse extends ToolResponse {
  output: {
    configuration: string
    contentType: string | null
    versionLabel: string | null
  }
  error?: string
}

export interface AppConfigGetApplicationParams extends AppConfigConnectionConfig {
  applicationId: string
}

export interface AppConfigUpdateApplicationParams extends AppConfigConnectionConfig {
  applicationId: string
  name?: string | null
  description?: string | null
}

export interface AppConfigDeleteApplicationParams extends AppConfigConnectionConfig {
  applicationId: string
}

export interface AppConfigGetEnvironmentParams extends AppConfigConnectionConfig {
  applicationId: string
  environmentId: string
}

export interface AppConfigUpdateEnvironmentParams extends AppConfigConnectionConfig {
  applicationId: string
  environmentId: string
  name?: string | null
  description?: string | null
}

export interface AppConfigDeleteEnvironmentParams extends AppConfigConnectionConfig {
  applicationId: string
  environmentId: string
}

export interface AppConfigGetConfigurationProfileParams extends AppConfigConnectionConfig {
  applicationId: string
  configurationProfileId: string
}

export interface AppConfigUpdateConfigurationProfileParams extends AppConfigConnectionConfig {
  applicationId: string
  configurationProfileId: string
  name?: string | null
  description?: string | null
  retrievalRoleArn?: string | null
}

export interface AppConfigDeleteConfigurationProfileParams extends AppConfigConnectionConfig {
  applicationId: string
  configurationProfileId: string
}

export interface AppConfigDeleteHostedConfigurationVersionParams extends AppConfigConnectionConfig {
  applicationId: string
  configurationProfileId: string
  versionNumber: number
}

export interface AppConfigGetApplicationResponse extends ToolResponse {
  output: {
    id: string
    name: string
    description: string | null
  }
  error?: string
}

export interface AppConfigUpdateApplicationResponse extends ToolResponse {
  output: {
    message: string
    id: string
    name: string
    description: string | null
  }
  error?: string
}

export interface AppConfigGetEnvironmentResponse extends ToolResponse {
  output: {
    applicationId: string
    id: string
    name: string
    description: string | null
    state: string | null
    monitors: Array<{ alarmArn: string; alarmRoleArn: string | null }>
  }
  error?: string
}

export interface AppConfigUpdateEnvironmentResponse extends ToolResponse {
  output: {
    message: string
    applicationId: string
    id: string
    name: string
    state: string | null
  }
  error?: string
}

export interface AppConfigGetConfigurationProfileResponse extends ToolResponse {
  output: {
    applicationId: string
    id: string
    name: string
    description: string | null
    locationUri: string | null
    retrievalRoleArn: string | null
    type: string | null
    validators: Array<{ type: string }>
  }
  error?: string
}

export interface AppConfigUpdateConfigurationProfileResponse extends ToolResponse {
  output: {
    message: string
    applicationId: string
    id: string
    name: string
    description: string | null
    type: string | null
  }
  error?: string
}

export interface AppConfigDeleteResourceResponse extends ToolResponse {
  output: {
    message: string
    applicationId?: string
    id: string
  }
  error?: string
}

export interface AppConfigDeleteHostedConfigurationVersionResponse extends ToolResponse {
  output: {
    message: string
    applicationId: string
    configurationProfileId: string
    versionNumber: number
  }
  error?: string
}
