import {
  AppConfigClient,
  CreateHostedConfigurationVersionCommand,
  GetDeploymentCommand,
  GetHostedConfigurationVersionCommand,
  ListApplicationsCommand,
  ListConfigurationProfilesCommand,
  ListDeploymentStrategiesCommand,
  ListDeploymentsCommand,
  ListEnvironmentsCommand,
  ListHostedConfigurationVersionsCommand,
  StartDeploymentCommand,
  StopDeploymentCommand,
} from '@aws-sdk/client-appconfig'
import type {
  AppConfigApplicationSummary,
  AppConfigConnectionConfig,
  AppConfigDeploymentSummary,
  AppConfigEnvironmentSummary,
  AppConfigProfileSummary,
  AppConfigStrategySummary,
  AppConfigVersionSummary,
} from '@/tools/appconfig/types'

export function createAppConfigClient(config: AppConfigConnectionConfig): AppConfigClient {
  return new AppConfigClient({
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })
}

const toIso = (date?: Date): string | null => (date ? date.toISOString() : null)
const decodeContent = (content?: Uint8Array): string | null =>
  content ? new TextDecoder().decode(content) : null

export async function createHostedConfigurationVersion(
  client: AppConfigClient,
  params: {
    applicationId: string
    configurationProfileId: string
    content: string
    contentType: string
    description?: string
    versionLabel?: string
    latestVersionNumber?: number
  }
) {
  const response = await client.send(
    new CreateHostedConfigurationVersionCommand({
      ApplicationId: params.applicationId,
      ConfigurationProfileId: params.configurationProfileId,
      Content: new TextEncoder().encode(params.content),
      ContentType: params.contentType,
      ...(params.description && { Description: params.description }),
      ...(params.versionLabel && { VersionLabel: params.versionLabel }),
      ...(params.latestVersionNumber !== undefined && {
        LatestVersionNumber: params.latestVersionNumber,
      }),
    })
  )

  return {
    message: `Created hosted configuration version ${response.VersionNumber ?? ''}`.trim(),
    applicationId: response.ApplicationId ?? null,
    configurationProfileId: response.ConfigurationProfileId ?? null,
    versionNumber: response.VersionNumber ?? null,
    contentType: response.ContentType ?? null,
    description: response.Description ?? null,
    versionLabel: response.VersionLabel ?? null,
  }
}

export async function getHostedConfigurationVersion(
  client: AppConfigClient,
  params: { applicationId: string; configurationProfileId: string; versionNumber: number }
) {
  const response = await client.send(
    new GetHostedConfigurationVersionCommand({
      ApplicationId: params.applicationId,
      ConfigurationProfileId: params.configurationProfileId,
      VersionNumber: params.versionNumber,
    })
  )

  return {
    applicationId: response.ApplicationId ?? null,
    configurationProfileId: response.ConfigurationProfileId ?? null,
    versionNumber: response.VersionNumber ?? null,
    content: decodeContent(response.Content),
    contentType: response.ContentType ?? null,
    description: response.Description ?? null,
    versionLabel: response.VersionLabel ?? null,
  }
}

export async function listHostedConfigurationVersions(
  client: AppConfigClient,
  params: {
    applicationId: string
    configurationProfileId: string
    maxResults?: number
    nextToken?: string
  }
) {
  const response = await client.send(
    new ListHostedConfigurationVersionsCommand({
      ApplicationId: params.applicationId,
      ConfigurationProfileId: params.configurationProfileId,
      ...(params.maxResults !== undefined && { MaxResults: params.maxResults }),
      ...(params.nextToken && { NextToken: params.nextToken }),
    })
  )

  const items: AppConfigVersionSummary[] = (response.Items ?? []).map((item) => ({
    applicationId: item.ApplicationId ?? null,
    configurationProfileId: item.ConfigurationProfileId ?? null,
    versionNumber: item.VersionNumber ?? null,
    description: item.Description ?? null,
    contentType: item.ContentType ?? null,
    versionLabel: item.VersionLabel ?? null,
  }))

  return { items, nextToken: response.NextToken ?? null }
}

export async function startDeployment(
  client: AppConfigClient,
  params: {
    applicationId: string
    environmentId: string
    deploymentStrategyId: string
    configurationProfileId: string
    configurationVersion: string
    description?: string
  }
) {
  const response = await client.send(
    new StartDeploymentCommand({
      ApplicationId: params.applicationId,
      EnvironmentId: params.environmentId,
      DeploymentStrategyId: params.deploymentStrategyId,
      ConfigurationProfileId: params.configurationProfileId,
      ConfigurationVersion: params.configurationVersion,
      ...(params.description && { Description: params.description }),
    })
  )

  return {
    message: `Started deployment ${response.DeploymentNumber ?? ''}`.trim(),
    applicationId: response.ApplicationId ?? null,
    environmentId: response.EnvironmentId ?? null,
    deploymentNumber: response.DeploymentNumber ?? null,
    deploymentStrategyId: response.DeploymentStrategyId ?? null,
    configurationProfileId: response.ConfigurationProfileId ?? null,
    configurationVersion: response.ConfigurationVersion ?? null,
    description: response.Description ?? null,
    state: response.State ?? null,
    percentageComplete: response.PercentageComplete ?? null,
    startedAt: toIso(response.StartedAt),
    completedAt: toIso(response.CompletedAt),
  }
}

export async function getDeployment(
  client: AppConfigClient,
  params: { applicationId: string; environmentId: string; deploymentNumber: number }
) {
  const response = await client.send(
    new GetDeploymentCommand({
      ApplicationId: params.applicationId,
      EnvironmentId: params.environmentId,
      DeploymentNumber: params.deploymentNumber,
    })
  )

  return {
    message:
      `Deployment ${response.DeploymentNumber ?? ''} is ${response.State ?? 'UNKNOWN'}`.trim(),
    applicationId: response.ApplicationId ?? null,
    environmentId: response.EnvironmentId ?? null,
    deploymentNumber: response.DeploymentNumber ?? null,
    deploymentStrategyId: response.DeploymentStrategyId ?? null,
    configurationProfileId: response.ConfigurationProfileId ?? null,
    configurationVersion: response.ConfigurationVersion ?? null,
    description: response.Description ?? null,
    state: response.State ?? null,
    percentageComplete: response.PercentageComplete ?? null,
    startedAt: toIso(response.StartedAt),
    completedAt: toIso(response.CompletedAt),
  }
}

export async function stopDeployment(
  client: AppConfigClient,
  params: { applicationId: string; environmentId: string; deploymentNumber: number }
) {
  const response = await client.send(
    new StopDeploymentCommand({
      ApplicationId: params.applicationId,
      EnvironmentId: params.environmentId,
      DeploymentNumber: params.deploymentNumber,
    })
  )

  return {
    message: `Stopped deployment ${response.DeploymentNumber ?? ''}`.trim(),
    applicationId: response.ApplicationId ?? null,
    environmentId: response.EnvironmentId ?? null,
    deploymentNumber: response.DeploymentNumber ?? null,
    deploymentStrategyId: response.DeploymentStrategyId ?? null,
    configurationProfileId: response.ConfigurationProfileId ?? null,
    configurationVersion: response.ConfigurationVersion ?? null,
    description: response.Description ?? null,
    state: response.State ?? null,
    percentageComplete: response.PercentageComplete ?? null,
    startedAt: toIso(response.StartedAt),
    completedAt: toIso(response.CompletedAt),
  }
}

export async function listDeployments(
  client: AppConfigClient,
  params: { applicationId: string; environmentId: string; maxResults?: number; nextToken?: string }
) {
  const response = await client.send(
    new ListDeploymentsCommand({
      ApplicationId: params.applicationId,
      EnvironmentId: params.environmentId,
      ...(params.maxResults !== undefined && { MaxResults: params.maxResults }),
      ...(params.nextToken && { NextToken: params.nextToken }),
    })
  )

  const items: AppConfigDeploymentSummary[] = (response.Items ?? []).map((item) => ({
    deploymentNumber: item.DeploymentNumber ?? null,
    configurationName: item.ConfigurationName ?? null,
    configurationVersion: item.ConfigurationVersion ?? null,
    state: item.State ?? null,
    percentageComplete: item.PercentageComplete ?? null,
    startedAt: toIso(item.StartedAt),
    completedAt: toIso(item.CompletedAt),
    versionLabel: item.VersionLabel ?? null,
  }))

  return { items, nextToken: response.NextToken ?? null }
}

export async function listApplications(
  client: AppConfigClient,
  params: { maxResults?: number; nextToken?: string }
) {
  const response = await client.send(
    new ListApplicationsCommand({
      ...(params.maxResults !== undefined && { MaxResults: params.maxResults }),
      ...(params.nextToken && { NextToken: params.nextToken }),
    })
  )

  const items: AppConfigApplicationSummary[] = (response.Items ?? []).map((item) => ({
    id: item.Id ?? null,
    name: item.Name ?? null,
    description: item.Description ?? null,
  }))

  return { items, nextToken: response.NextToken ?? null }
}

export async function listEnvironments(
  client: AppConfigClient,
  params: { applicationId: string; maxResults?: number; nextToken?: string }
) {
  const response = await client.send(
    new ListEnvironmentsCommand({
      ApplicationId: params.applicationId,
      ...(params.maxResults !== undefined && { MaxResults: params.maxResults }),
      ...(params.nextToken && { NextToken: params.nextToken }),
    })
  )

  const items: AppConfigEnvironmentSummary[] = (response.Items ?? []).map((item) => ({
    applicationId: item.ApplicationId ?? null,
    id: item.Id ?? null,
    name: item.Name ?? null,
    state: item.State ?? null,
    description: item.Description ?? null,
  }))

  return { items, nextToken: response.NextToken ?? null }
}

export async function listConfigurationProfiles(
  client: AppConfigClient,
  params: { applicationId: string; maxResults?: number; nextToken?: string }
) {
  const response = await client.send(
    new ListConfigurationProfilesCommand({
      ApplicationId: params.applicationId,
      ...(params.maxResults !== undefined && { MaxResults: params.maxResults }),
      ...(params.nextToken && { NextToken: params.nextToken }),
    })
  )

  const items: AppConfigProfileSummary[] = (response.Items ?? []).map((item) => ({
    applicationId: item.ApplicationId ?? null,
    id: item.Id ?? null,
    name: item.Name ?? null,
    locationUri: item.LocationUri ?? null,
    type: item.Type ?? null,
  }))

  return { items, nextToken: response.NextToken ?? null }
}

export async function listDeploymentStrategies(
  client: AppConfigClient,
  params: { maxResults?: number; nextToken?: string }
) {
  const response = await client.send(
    new ListDeploymentStrategiesCommand({
      ...(params.maxResults !== undefined && { MaxResults: params.maxResults }),
      ...(params.nextToken && { NextToken: params.nextToken }),
    })
  )

  const items: AppConfigStrategySummary[] = (response.Items ?? []).map((item) => ({
    id: item.Id ?? null,
    name: item.Name ?? null,
    description: item.Description ?? null,
    deploymentDurationInMinutes: item.DeploymentDurationInMinutes ?? null,
    growthType: item.GrowthType ?? null,
    growthFactor: item.GrowthFactor ?? null,
    finalBakeTimeInMinutes: item.FinalBakeTimeInMinutes ?? null,
    replicateTo: item.ReplicateTo ?? null,
  }))

  return { items, nextToken: response.NextToken ?? null }
}
