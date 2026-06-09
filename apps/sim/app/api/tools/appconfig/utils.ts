import {
  AppConfigClient,
  CreateApplicationCommand,
  CreateConfigurationProfileCommand,
  CreateEnvironmentCommand,
  CreateHostedConfigurationVersionCommand,
  DeleteApplicationCommand,
  DeleteConfigurationProfileCommand,
  DeleteEnvironmentCommand,
  DeleteHostedConfigurationVersionCommand,
  GetApplicationCommand,
  GetConfigurationProfileCommand,
  GetDeploymentCommand,
  GetEnvironmentCommand,
  GetHostedConfigurationVersionCommand,
  ListApplicationsCommand,
  ListConfigurationProfilesCommand,
  ListDeploymentStrategiesCommand,
  ListDeploymentsCommand,
  ListEnvironmentsCommand,
  ListHostedConfigurationVersionsCommand,
  StartDeploymentCommand,
  StopDeploymentCommand,
  UpdateApplicationCommand,
  UpdateConfigurationProfileCommand,
  UpdateEnvironmentCommand,
} from '@aws-sdk/client-appconfig'
import {
  AppConfigDataClient,
  GetLatestConfigurationCommand,
  StartConfigurationSessionCommand,
} from '@aws-sdk/client-appconfigdata'
import type { AppConfigConnectionConfig } from '@/tools/appconfig/types'

export function createAppConfigClient(config: AppConfigConnectionConfig): AppConfigClient {
  return new AppConfigClient({
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })
}

export function createAppConfigDataClient(config: AppConfigConnectionConfig): AppConfigDataClient {
  return new AppConfigDataClient({
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })
}

const textDecoder = new TextDecoder()

function decodeContent(content?: Uint8Array): string {
  if (!content || content.length === 0) return ''
  return textDecoder.decode(content)
}

export async function listApplications(
  client: AppConfigClient,
  maxResults?: number | null,
  nextToken?: string | null
) {
  const response = await client.send(
    new ListApplicationsCommand({
      ...(maxResults ? { MaxResults: maxResults } : {}),
      ...(nextToken ? { NextToken: nextToken } : {}),
    })
  )

  const applications = (response.Items ?? []).map((item) => ({
    id: item.Id ?? '',
    name: item.Name ?? '',
    description: item.Description ?? null,
  }))

  return {
    applications,
    nextToken: response.NextToken ?? null,
    count: applications.length,
  }
}

export async function createApplication(
  client: AppConfigClient,
  name: string,
  description?: string | null
) {
  const response = await client.send(
    new CreateApplicationCommand({
      Name: name,
      ...(description ? { Description: description } : {}),
    })
  )

  return {
    message: `Application "${response.Name ?? name}" created`,
    id: response.Id ?? '',
    name: response.Name ?? '',
    description: response.Description ?? null,
  }
}

export async function listEnvironments(
  client: AppConfigClient,
  applicationId: string,
  maxResults?: number | null,
  nextToken?: string | null
) {
  const response = await client.send(
    new ListEnvironmentsCommand({
      ApplicationId: applicationId,
      ...(maxResults ? { MaxResults: maxResults } : {}),
      ...(nextToken ? { NextToken: nextToken } : {}),
    })
  )

  const environments = (response.Items ?? []).map((item) => ({
    applicationId: item.ApplicationId ?? '',
    id: item.Id ?? '',
    name: item.Name ?? '',
    description: item.Description ?? null,
    state: item.State ?? null,
  }))

  return {
    environments,
    nextToken: response.NextToken ?? null,
    count: environments.length,
  }
}

export async function createEnvironment(
  client: AppConfigClient,
  applicationId: string,
  name: string,
  description?: string | null
) {
  const response = await client.send(
    new CreateEnvironmentCommand({
      ApplicationId: applicationId,
      Name: name,
      ...(description ? { Description: description } : {}),
    })
  )

  return {
    message: `Environment "${response.Name ?? name}" created`,
    applicationId: response.ApplicationId ?? applicationId,
    id: response.Id ?? '',
    name: response.Name ?? '',
    state: response.State ?? null,
  }
}

export async function listConfigurationProfiles(
  client: AppConfigClient,
  applicationId: string,
  maxResults?: number | null,
  nextToken?: string | null
) {
  const response = await client.send(
    new ListConfigurationProfilesCommand({
      ApplicationId: applicationId,
      ...(maxResults ? { MaxResults: maxResults } : {}),
      ...(nextToken ? { NextToken: nextToken } : {}),
    })
  )

  const configurationProfiles = (response.Items ?? []).map((item) => ({
    applicationId: item.ApplicationId ?? '',
    id: item.Id ?? '',
    name: item.Name ?? '',
    description: null,
    locationUri: item.LocationUri ?? null,
    retrievalRoleArn: null,
    type: item.Type ?? null,
    validatorTypes: item.ValidatorTypes ?? [],
  }))

  return {
    configurationProfiles,
    nextToken: response.NextToken ?? null,
    count: configurationProfiles.length,
  }
}

export async function createConfigurationProfile(
  client: AppConfigClient,
  applicationId: string,
  name: string,
  locationUri: string,
  description?: string | null,
  retrievalRoleArn?: string | null,
  type?: string | null
) {
  const response = await client.send(
    new CreateConfigurationProfileCommand({
      ApplicationId: applicationId,
      Name: name,
      LocationUri: locationUri,
      ...(description ? { Description: description } : {}),
      ...(retrievalRoleArn ? { RetrievalRoleArn: retrievalRoleArn } : {}),
      ...(type ? { Type: type } : {}),
    })
  )

  return {
    message: `Configuration profile "${response.Name ?? name}" created`,
    applicationId: response.ApplicationId ?? applicationId,
    id: response.Id ?? '',
    name: response.Name ?? '',
    locationUri: response.LocationUri ?? null,
    type: response.Type ?? null,
  }
}

export async function createHostedConfigurationVersion(
  client: AppConfigClient,
  applicationId: string,
  configurationProfileId: string,
  content: string,
  contentType: string,
  description?: string | null,
  latestVersionNumber?: number | null,
  versionLabel?: string | null
) {
  const response = await client.send(
    new CreateHostedConfigurationVersionCommand({
      ApplicationId: applicationId,
      ConfigurationProfileId: configurationProfileId,
      Content: new TextEncoder().encode(content),
      ContentType: contentType,
      ...(description ? { Description: description } : {}),
      ...(latestVersionNumber != null ? { LatestVersionNumber: latestVersionNumber } : {}),
      ...(versionLabel ? { VersionLabel: versionLabel } : {}),
    })
  )

  return {
    message: `Hosted configuration version ${response.VersionNumber ?? ''} created`,
    applicationId: response.ApplicationId ?? applicationId,
    configurationProfileId: response.ConfigurationProfileId ?? configurationProfileId,
    versionNumber: response.VersionNumber ?? null,
    contentType: response.ContentType ?? null,
    versionLabel: response.VersionLabel ?? null,
  }
}

export async function getHostedConfigurationVersion(
  client: AppConfigClient,
  applicationId: string,
  configurationProfileId: string,
  versionNumber: number
) {
  const response = await client.send(
    new GetHostedConfigurationVersionCommand({
      ApplicationId: applicationId,
      ConfigurationProfileId: configurationProfileId,
      VersionNumber: versionNumber,
    })
  )

  return {
    applicationId: response.ApplicationId ?? applicationId,
    configurationProfileId: response.ConfigurationProfileId ?? configurationProfileId,
    versionNumber: response.VersionNumber ?? null,
    description: response.Description ?? null,
    content: decodeContent(response.Content),
    contentType: response.ContentType ?? null,
    versionLabel: response.VersionLabel ?? null,
  }
}

export async function listHostedConfigurationVersions(
  client: AppConfigClient,
  applicationId: string,
  configurationProfileId: string,
  maxResults?: number | null,
  nextToken?: string | null
) {
  const response = await client.send(
    new ListHostedConfigurationVersionsCommand({
      ApplicationId: applicationId,
      ConfigurationProfileId: configurationProfileId,
      ...(maxResults ? { MaxResults: maxResults } : {}),
      ...(nextToken ? { NextToken: nextToken } : {}),
    })
  )

  const versions = (response.Items ?? []).map((item) => ({
    applicationId: item.ApplicationId ?? null,
    configurationProfileId: item.ConfigurationProfileId ?? null,
    versionNumber: item.VersionNumber ?? null,
    description: item.Description ?? null,
    contentType: item.ContentType ?? null,
    versionLabel: item.VersionLabel ?? null,
  }))

  return {
    versions,
    nextToken: response.NextToken ?? null,
    count: versions.length,
  }
}

export async function listDeploymentStrategies(
  client: AppConfigClient,
  maxResults?: number | null,
  nextToken?: string | null
) {
  const response = await client.send(
    new ListDeploymentStrategiesCommand({
      ...(maxResults ? { MaxResults: maxResults } : {}),
      ...(nextToken ? { NextToken: nextToken } : {}),
    })
  )

  const deploymentStrategies = (response.Items ?? []).map((item) => ({
    id: item.Id ?? '',
    name: item.Name ?? '',
    description: item.Description ?? null,
    deploymentDurationInMinutes: item.DeploymentDurationInMinutes ?? null,
    growthType: item.GrowthType ?? null,
    growthFactor: item.GrowthFactor ?? null,
    finalBakeTimeInMinutes: item.FinalBakeTimeInMinutes ?? null,
    replicateTo: item.ReplicateTo ?? null,
  }))

  return {
    deploymentStrategies,
    nextToken: response.NextToken ?? null,
    count: deploymentStrategies.length,
  }
}

export async function startDeployment(
  client: AppConfigClient,
  applicationId: string,
  environmentId: string,
  deploymentStrategyId: string,
  configurationProfileId: string,
  configurationVersion: string,
  description?: string | null
) {
  const response = await client.send(
    new StartDeploymentCommand({
      ApplicationId: applicationId,
      EnvironmentId: environmentId,
      DeploymentStrategyId: deploymentStrategyId,
      ConfigurationProfileId: configurationProfileId,
      ConfigurationVersion: configurationVersion,
      ...(description ? { Description: description } : {}),
    })
  )

  return {
    message: `Deployment ${response.DeploymentNumber ?? ''} started`,
    deploymentNumber: response.DeploymentNumber ?? null,
    state: response.State ?? null,
    percentageComplete: response.PercentageComplete ?? null,
  }
}

export async function getDeployment(
  client: AppConfigClient,
  applicationId: string,
  environmentId: string,
  deploymentNumber: number
) {
  const response = await client.send(
    new GetDeploymentCommand({
      ApplicationId: applicationId,
      EnvironmentId: environmentId,
      DeploymentNumber: deploymentNumber,
    })
  )

  return {
    applicationId: response.ApplicationId ?? applicationId,
    environmentId: response.EnvironmentId ?? environmentId,
    deploymentStrategyId: response.DeploymentStrategyId ?? '',
    configurationProfileId: response.ConfigurationProfileId ?? '',
    deploymentNumber: response.DeploymentNumber ?? null,
    configurationName: response.ConfigurationName ?? null,
    configurationVersion: response.ConfigurationVersion ?? null,
    description: response.Description ?? null,
    state: response.State ?? null,
    percentageComplete: response.PercentageComplete ?? null,
    startedAt: response.StartedAt?.toISOString() ?? null,
    completedAt: response.CompletedAt?.toISOString() ?? null,
  }
}

export async function listDeployments(
  client: AppConfigClient,
  applicationId: string,
  environmentId: string,
  maxResults?: number | null,
  nextToken?: string | null
) {
  const response = await client.send(
    new ListDeploymentsCommand({
      ApplicationId: applicationId,
      EnvironmentId: environmentId,
      ...(maxResults ? { MaxResults: maxResults } : {}),
      ...(nextToken ? { NextToken: nextToken } : {}),
    })
  )

  const deployments = (response.Items ?? []).map((item) => ({
    deploymentNumber: item.DeploymentNumber ?? null,
    configurationName: item.ConfigurationName ?? null,
    configurationVersion: item.ConfigurationVersion ?? null,
    deploymentDurationInMinutes: item.DeploymentDurationInMinutes ?? null,
    growthType: item.GrowthType ?? null,
    growthFactor: item.GrowthFactor ?? null,
    finalBakeTimeInMinutes: item.FinalBakeTimeInMinutes ?? null,
    state: item.State ?? null,
    percentageComplete: item.PercentageComplete ?? null,
    startedAt: item.StartedAt?.toISOString() ?? null,
    completedAt: item.CompletedAt?.toISOString() ?? null,
    versionLabel: item.VersionLabel ?? null,
  }))

  return {
    deployments,
    nextToken: response.NextToken ?? null,
    count: deployments.length,
  }
}

export async function stopDeployment(
  client: AppConfigClient,
  applicationId: string,
  environmentId: string,
  deploymentNumber: number
) {
  const response = await client.send(
    new StopDeploymentCommand({
      ApplicationId: applicationId,
      EnvironmentId: environmentId,
      DeploymentNumber: deploymentNumber,
    })
  )

  return {
    message: `Deployment ${response.DeploymentNumber ?? deploymentNumber} stopped`,
    deploymentNumber: response.DeploymentNumber ?? null,
    state: response.State ?? null,
  }
}

export async function getConfiguration(
  client: AppConfigDataClient,
  applicationId: string,
  environmentId: string,
  configurationProfileId: string
) {
  const session = await client.send(
    new StartConfigurationSessionCommand({
      ApplicationIdentifier: applicationId,
      EnvironmentIdentifier: environmentId,
      ConfigurationProfileIdentifier: configurationProfileId,
    })
  )

  const response = await client.send(
    new GetLatestConfigurationCommand({
      ConfigurationToken: session.InitialConfigurationToken,
    })
  )

  return {
    configuration: decodeContent(response.Configuration),
    contentType: response.ContentType ?? null,
    versionLabel: response.VersionLabel ?? null,
  }
}

export async function getApplication(client: AppConfigClient, applicationId: string) {
  const response = await client.send(new GetApplicationCommand({ ApplicationId: applicationId }))

  return {
    id: response.Id ?? '',
    name: response.Name ?? '',
    description: response.Description ?? null,
  }
}

export async function updateApplication(
  client: AppConfigClient,
  applicationId: string,
  name?: string | null,
  description?: string | null
) {
  const response = await client.send(
    new UpdateApplicationCommand({
      ApplicationId: applicationId,
      ...(name ? { Name: name } : {}),
      ...(description != null ? { Description: description } : {}),
    })
  )

  return {
    message: `Application "${response.Name ?? applicationId}" updated`,
    id: response.Id ?? '',
    name: response.Name ?? '',
    description: response.Description ?? null,
  }
}

export async function deleteApplication(client: AppConfigClient, applicationId: string) {
  await client.send(new DeleteApplicationCommand({ ApplicationId: applicationId }))

  return {
    message: `Application ${applicationId} deleted`,
    id: applicationId,
  }
}

export async function getEnvironment(
  client: AppConfigClient,
  applicationId: string,
  environmentId: string
) {
  const response = await client.send(
    new GetEnvironmentCommand({ ApplicationId: applicationId, EnvironmentId: environmentId })
  )

  return {
    applicationId: response.ApplicationId ?? applicationId,
    id: response.Id ?? '',
    name: response.Name ?? '',
    description: response.Description ?? null,
    state: response.State ?? null,
    monitors: (response.Monitors ?? []).map((monitor) => ({
      alarmArn: monitor.AlarmArn ?? '',
      alarmRoleArn: monitor.AlarmRoleArn ?? null,
    })),
  }
}

export async function updateEnvironment(
  client: AppConfigClient,
  applicationId: string,
  environmentId: string,
  name?: string | null,
  description?: string | null
) {
  const response = await client.send(
    new UpdateEnvironmentCommand({
      ApplicationId: applicationId,
      EnvironmentId: environmentId,
      ...(name ? { Name: name } : {}),
      ...(description != null ? { Description: description } : {}),
    })
  )

  return {
    message: `Environment "${response.Name ?? environmentId}" updated`,
    applicationId: response.ApplicationId ?? applicationId,
    id: response.Id ?? '',
    name: response.Name ?? '',
    state: response.State ?? null,
  }
}

export async function deleteEnvironment(
  client: AppConfigClient,
  applicationId: string,
  environmentId: string
) {
  await client.send(
    new DeleteEnvironmentCommand({ ApplicationId: applicationId, EnvironmentId: environmentId })
  )

  return {
    message: `Environment ${environmentId} deleted`,
    applicationId,
    id: environmentId,
  }
}

export async function getConfigurationProfile(
  client: AppConfigClient,
  applicationId: string,
  configurationProfileId: string
) {
  const response = await client.send(
    new GetConfigurationProfileCommand({
      ApplicationId: applicationId,
      ConfigurationProfileId: configurationProfileId,
    })
  )

  return {
    applicationId: response.ApplicationId ?? applicationId,
    id: response.Id ?? '',
    name: response.Name ?? '',
    description: response.Description ?? null,
    locationUri: response.LocationUri ?? null,
    retrievalRoleArn: response.RetrievalRoleArn ?? null,
    type: response.Type ?? null,
    validators: (response.Validators ?? []).map((validator) => ({
      type: validator.Type ?? '',
    })),
  }
}

export async function updateConfigurationProfile(
  client: AppConfigClient,
  applicationId: string,
  configurationProfileId: string,
  name?: string | null,
  description?: string | null,
  retrievalRoleArn?: string | null
) {
  const response = await client.send(
    new UpdateConfigurationProfileCommand({
      ApplicationId: applicationId,
      ConfigurationProfileId: configurationProfileId,
      ...(name ? { Name: name } : {}),
      ...(description != null ? { Description: description } : {}),
      ...(retrievalRoleArn != null ? { RetrievalRoleArn: retrievalRoleArn } : {}),
    })
  )

  return {
    message: `Configuration profile "${response.Name ?? configurationProfileId}" updated`,
    applicationId: response.ApplicationId ?? applicationId,
    id: response.Id ?? '',
    name: response.Name ?? '',
    description: response.Description ?? null,
    type: response.Type ?? null,
  }
}

export async function deleteConfigurationProfile(
  client: AppConfigClient,
  applicationId: string,
  configurationProfileId: string
) {
  await client.send(
    new DeleteConfigurationProfileCommand({
      ApplicationId: applicationId,
      ConfigurationProfileId: configurationProfileId,
    })
  )

  return {
    message: `Configuration profile ${configurationProfileId} deleted`,
    applicationId,
    id: configurationProfileId,
  }
}

export async function deleteHostedConfigurationVersion(
  client: AppConfigClient,
  applicationId: string,
  configurationProfileId: string,
  versionNumber: number
) {
  await client.send(
    new DeleteHostedConfigurationVersionCommand({
      ApplicationId: applicationId,
      ConfigurationProfileId: configurationProfileId,
      VersionNumber: versionNumber,
    })
  )

  return {
    message: `Hosted configuration version ${versionNumber} deleted`,
    applicationId,
    configurationProfileId,
    versionNumber,
  }
}
