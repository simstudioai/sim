import type { AppConfigClient } from '@aws-sdk/client-appconfig'
import type { AppConfigDataClient } from '@aws-sdk/client-appconfigdata'
import type { AwsAppConfigCreateApplicationBody } from '@/lib/api/contracts/tools/aws/appconfig-create-application'
import type { AwsAppConfigCreateConfigurationProfileBody } from '@/lib/api/contracts/tools/aws/appconfig-create-configuration-profile'
import type { AwsAppConfigCreateEnvironmentBody } from '@/lib/api/contracts/tools/aws/appconfig-create-environment'
import type { AwsAppConfigCreateHostedConfigurationVersionBody } from '@/lib/api/contracts/tools/aws/appconfig-create-hosted-configuration-version'
import type { AwsAppConfigDeleteApplicationBody } from '@/lib/api/contracts/tools/aws/appconfig-delete-application'
import type { AwsAppConfigDeleteConfigurationProfileBody } from '@/lib/api/contracts/tools/aws/appconfig-delete-configuration-profile'
import type { AwsAppConfigDeleteEnvironmentBody } from '@/lib/api/contracts/tools/aws/appconfig-delete-environment'
import type { AwsAppConfigDeleteHostedConfigurationVersionBody } from '@/lib/api/contracts/tools/aws/appconfig-delete-hosted-configuration-version'
import type { AwsAppConfigGetApplicationBody } from '@/lib/api/contracts/tools/aws/appconfig-get-application'
import type { AwsAppConfigGetConfigurationBody } from '@/lib/api/contracts/tools/aws/appconfig-get-configuration'
import type { AwsAppConfigGetConfigurationProfileBody } from '@/lib/api/contracts/tools/aws/appconfig-get-configuration-profile'
import type { AwsAppConfigGetDeploymentBody } from '@/lib/api/contracts/tools/aws/appconfig-get-deployment'
import type { AwsAppConfigGetEnvironmentBody } from '@/lib/api/contracts/tools/aws/appconfig-get-environment'
import type { AwsAppConfigGetHostedConfigurationVersionBody } from '@/lib/api/contracts/tools/aws/appconfig-get-hosted-configuration-version'
import type { AwsAppConfigListApplicationsBody } from '@/lib/api/contracts/tools/aws/appconfig-list-applications'
import type { AwsAppConfigListConfigurationProfilesBody } from '@/lib/api/contracts/tools/aws/appconfig-list-configuration-profiles'
import type { AwsAppConfigListDeploymentStrategiesBody } from '@/lib/api/contracts/tools/aws/appconfig-list-deployment-strategies'
import type { AwsAppConfigListDeploymentsBody } from '@/lib/api/contracts/tools/aws/appconfig-list-deployments'
import type { AwsAppConfigListEnvironmentsBody } from '@/lib/api/contracts/tools/aws/appconfig-list-environments'
import type { AwsAppConfigListHostedConfigurationVersionsBody } from '@/lib/api/contracts/tools/aws/appconfig-list-hosted-configuration-versions'
import type { AwsAppConfigStartDeploymentBody } from '@/lib/api/contracts/tools/aws/appconfig-start-deployment'
import type { AwsAppConfigStopDeploymentBody } from '@/lib/api/contracts/tools/aws/appconfig-stop-deployment'
import type { AwsAppConfigUpdateApplicationBody } from '@/lib/api/contracts/tools/aws/appconfig-update-application'
import type { AwsAppConfigUpdateConfigurationProfileBody } from '@/lib/api/contracts/tools/aws/appconfig-update-configuration-profile'
import type { AwsAppConfigUpdateEnvironmentBody } from '@/lib/api/contracts/tools/aws/appconfig-update-environment'
import {
  createAppConfigClient,
  createAppConfigDataClient,
  createApplication,
  createConfigurationProfile,
  createEnvironment,
  createHostedConfigurationVersion,
  deleteApplication,
  deleteConfigurationProfile,
  deleteEnvironment,
  deleteHostedConfigurationVersion,
  getApplication,
  getConfiguration,
  getConfigurationProfile,
  getDeployment,
  getEnvironment,
  getHostedConfigurationVersion,
  listApplications,
  listConfigurationProfiles,
  listDeploymentStrategies,
  listDeployments,
  listEnvironments,
  listHostedConfigurationVersions,
  startDeployment,
  stopDeployment,
  updateApplication,
  updateConfigurationProfile,
  updateEnvironment,
} from '@/lib/internal/appconfig/client'
import type { AppConfigConnectionConfig } from '@/tools/appconfig/types'

async function withAppConfigClient<T>(
  input: AppConfigConnectionConfig,
  execute: (client: AppConfigClient) => Promise<T>
): Promise<T> {
  const client = createAppConfigClient(input)
  try {
    return await execute(client)
  } finally {
    client.destroy()
  }
}

async function withAppConfigDataClient<T>(
  input: AppConfigConnectionConfig,
  execute: (client: AppConfigDataClient) => Promise<T>
): Promise<T> {
  const client = createAppConfigDataClient(input)
  try {
    return await execute(client)
  } finally {
    client.destroy()
  }
}

export function executeAppConfigListApplications(
  input: AwsAppConfigListApplicationsBody,
  signal?: AbortSignal
) {
  return withAppConfigClient(input, (client) =>
    listApplications(client, signal, input.maxResults, input.nextToken)
  )
}

export function executeAppConfigCreateApplication(
  input: AwsAppConfigCreateApplicationBody,
  signal?: AbortSignal
) {
  return withAppConfigClient(input, (client) =>
    createApplication(client, signal, input.name, input.description)
  )
}

export function executeAppConfigListEnvironments(
  input: AwsAppConfigListEnvironmentsBody,
  signal?: AbortSignal
) {
  return withAppConfigClient(input, (client) =>
    listEnvironments(client, signal, input.applicationId, input.maxResults, input.nextToken)
  )
}

export function executeAppConfigCreateEnvironment(
  input: AwsAppConfigCreateEnvironmentBody,
  signal?: AbortSignal
) {
  return withAppConfigClient(input, (client) =>
    createEnvironment(client, signal, input.applicationId, input.name, input.description)
  )
}

export function executeAppConfigListConfigurationProfiles(
  input: AwsAppConfigListConfigurationProfilesBody,
  signal?: AbortSignal
) {
  return withAppConfigClient(input, (client) =>
    listConfigurationProfiles(
      client,
      signal,
      input.applicationId,
      input.maxResults,
      input.nextToken
    )
  )
}

export function executeAppConfigCreateConfigurationProfile(
  input: AwsAppConfigCreateConfigurationProfileBody,
  signal?: AbortSignal
) {
  return withAppConfigClient(input, (client) =>
    createConfigurationProfile(
      client,
      signal,
      input.applicationId,
      input.name,
      input.locationUri,
      input.description,
      input.retrievalRoleArn,
      input.type
    )
  )
}

export function executeAppConfigCreateHostedConfigurationVersion(
  input: AwsAppConfigCreateHostedConfigurationVersionBody,
  signal?: AbortSignal
) {
  return withAppConfigClient(input, (client) =>
    createHostedConfigurationVersion(
      client,
      signal,
      input.applicationId,
      input.configurationProfileId,
      input.content,
      input.contentType,
      input.description,
      input.latestVersionNumber,
      input.versionLabel
    )
  )
}

export function executeAppConfigGetHostedConfigurationVersion(
  input: AwsAppConfigGetHostedConfigurationVersionBody,
  signal?: AbortSignal
) {
  return withAppConfigClient(input, (client) =>
    getHostedConfigurationVersion(
      client,
      signal,
      input.applicationId,
      input.configurationProfileId,
      input.versionNumber
    )
  )
}

export function executeAppConfigListHostedConfigurationVersions(
  input: AwsAppConfigListHostedConfigurationVersionsBody,
  signal?: AbortSignal
) {
  return withAppConfigClient(input, (client) =>
    listHostedConfigurationVersions(
      client,
      signal,
      input.applicationId,
      input.configurationProfileId,
      input.maxResults,
      input.nextToken
    )
  )
}

export function executeAppConfigListDeploymentStrategies(
  input: AwsAppConfigListDeploymentStrategiesBody,
  signal?: AbortSignal
) {
  return withAppConfigClient(input, (client) =>
    listDeploymentStrategies(client, signal, input.maxResults, input.nextToken)
  )
}

export function executeAppConfigStartDeployment(
  input: AwsAppConfigStartDeploymentBody,
  signal?: AbortSignal
) {
  return withAppConfigClient(input, (client) =>
    startDeployment(
      client,
      signal,
      input.applicationId,
      input.environmentId,
      input.deploymentStrategyId,
      input.configurationProfileId,
      input.configurationVersion,
      input.description
    )
  )
}

export function executeAppConfigGetDeployment(
  input: AwsAppConfigGetDeploymentBody,
  signal?: AbortSignal
) {
  return withAppConfigClient(input, (client) =>
    getDeployment(client, signal, input.applicationId, input.environmentId, input.deploymentNumber)
  )
}

export function executeAppConfigListDeployments(
  input: AwsAppConfigListDeploymentsBody,
  signal?: AbortSignal
) {
  return withAppConfigClient(input, (client) =>
    listDeployments(
      client,
      signal,
      input.applicationId,
      input.environmentId,
      input.maxResults,
      input.nextToken
    )
  )
}

export function executeAppConfigStopDeployment(
  input: AwsAppConfigStopDeploymentBody,
  signal?: AbortSignal
) {
  return withAppConfigClient(input, (client) =>
    stopDeployment(client, signal, input.applicationId, input.environmentId, input.deploymentNumber)
  )
}

export function executeAppConfigGetConfiguration(
  input: AwsAppConfigGetConfigurationBody,
  signal?: AbortSignal
) {
  return withAppConfigDataClient(input, (client) =>
    getConfiguration(
      client,
      signal,
      input.applicationId,
      input.environmentId,
      input.configurationProfileId
    )
  )
}

export function executeAppConfigGetApplication(
  input: AwsAppConfigGetApplicationBody,
  signal?: AbortSignal
) {
  return withAppConfigClient(input, (client) => getApplication(client, signal, input.applicationId))
}

export function executeAppConfigUpdateApplication(
  input: AwsAppConfigUpdateApplicationBody,
  signal?: AbortSignal
) {
  return withAppConfigClient(input, (client) =>
    updateApplication(client, signal, input.applicationId, input.name, input.description)
  )
}

export function executeAppConfigDeleteApplication(
  input: AwsAppConfigDeleteApplicationBody,
  signal?: AbortSignal
) {
  return withAppConfigClient(input, (client) =>
    deleteApplication(client, signal, input.applicationId)
  )
}

export function executeAppConfigGetEnvironment(
  input: AwsAppConfigGetEnvironmentBody,
  signal?: AbortSignal
) {
  return withAppConfigClient(input, (client) =>
    getEnvironment(client, signal, input.applicationId, input.environmentId)
  )
}

export function executeAppConfigUpdateEnvironment(
  input: AwsAppConfigUpdateEnvironmentBody,
  signal?: AbortSignal
) {
  return withAppConfigClient(input, (client) =>
    updateEnvironment(
      client,
      signal,
      input.applicationId,
      input.environmentId,
      input.name,
      input.description
    )
  )
}

export function executeAppConfigDeleteEnvironment(
  input: AwsAppConfigDeleteEnvironmentBody,
  signal?: AbortSignal
) {
  return withAppConfigClient(input, (client) =>
    deleteEnvironment(client, signal, input.applicationId, input.environmentId)
  )
}

export function executeAppConfigGetConfigurationProfile(
  input: AwsAppConfigGetConfigurationProfileBody,
  signal?: AbortSignal
) {
  return withAppConfigClient(input, (client) =>
    getConfigurationProfile(client, signal, input.applicationId, input.configurationProfileId)
  )
}

export function executeAppConfigUpdateConfigurationProfile(
  input: AwsAppConfigUpdateConfigurationProfileBody,
  signal?: AbortSignal
) {
  return withAppConfigClient(input, (client) =>
    updateConfigurationProfile(
      client,
      signal,
      input.applicationId,
      input.configurationProfileId,
      input.name,
      input.description,
      input.retrievalRoleArn
    )
  )
}

export function executeAppConfigDeleteConfigurationProfile(
  input: AwsAppConfigDeleteConfigurationProfileBody,
  signal?: AbortSignal
) {
  return withAppConfigClient(input, (client) =>
    deleteConfigurationProfile(client, signal, input.applicationId, input.configurationProfileId)
  )
}

export function executeAppConfigDeleteHostedConfigurationVersion(
  input: AwsAppConfigDeleteHostedConfigurationVersionBody,
  signal?: AbortSignal
) {
  return withAppConfigClient(input, (client) =>
    deleteHostedConfigurationVersion(
      client,
      signal,
      input.applicationId,
      input.configurationProfileId,
      input.versionNumber
    )
  )
}
