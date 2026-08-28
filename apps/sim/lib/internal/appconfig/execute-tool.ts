import { getErrorMessage } from '@sim/utils/errors'
import type { AnyApiRouteContract, ContractBody } from '@/lib/api/contracts'
import { awsAppConfigCreateApplicationContract } from '@/lib/api/contracts/tools/aws/appconfig-create-application'
import { awsAppConfigCreateConfigurationProfileContract } from '@/lib/api/contracts/tools/aws/appconfig-create-configuration-profile'
import { awsAppConfigCreateEnvironmentContract } from '@/lib/api/contracts/tools/aws/appconfig-create-environment'
import { awsAppConfigCreateHostedConfigurationVersionContract } from '@/lib/api/contracts/tools/aws/appconfig-create-hosted-configuration-version'
import { awsAppConfigDeleteApplicationContract } from '@/lib/api/contracts/tools/aws/appconfig-delete-application'
import { awsAppConfigDeleteConfigurationProfileContract } from '@/lib/api/contracts/tools/aws/appconfig-delete-configuration-profile'
import { awsAppConfigDeleteEnvironmentContract } from '@/lib/api/contracts/tools/aws/appconfig-delete-environment'
import { awsAppConfigDeleteHostedConfigurationVersionContract } from '@/lib/api/contracts/tools/aws/appconfig-delete-hosted-configuration-version'
import { awsAppConfigGetApplicationContract } from '@/lib/api/contracts/tools/aws/appconfig-get-application'
import { awsAppConfigGetConfigurationContract } from '@/lib/api/contracts/tools/aws/appconfig-get-configuration'
import { awsAppConfigGetConfigurationProfileContract } from '@/lib/api/contracts/tools/aws/appconfig-get-configuration-profile'
import { awsAppConfigGetDeploymentContract } from '@/lib/api/contracts/tools/aws/appconfig-get-deployment'
import { awsAppConfigGetEnvironmentContract } from '@/lib/api/contracts/tools/aws/appconfig-get-environment'
import { awsAppConfigGetHostedConfigurationVersionContract } from '@/lib/api/contracts/tools/aws/appconfig-get-hosted-configuration-version'
import { awsAppConfigListApplicationsContract } from '@/lib/api/contracts/tools/aws/appconfig-list-applications'
import { awsAppConfigListConfigurationProfilesContract } from '@/lib/api/contracts/tools/aws/appconfig-list-configuration-profiles'
import { awsAppConfigListDeploymentStrategiesContract } from '@/lib/api/contracts/tools/aws/appconfig-list-deployment-strategies'
import { awsAppConfigListDeploymentsContract } from '@/lib/api/contracts/tools/aws/appconfig-list-deployments'
import { awsAppConfigListEnvironmentsContract } from '@/lib/api/contracts/tools/aws/appconfig-list-environments'
import { awsAppConfigListHostedConfigurationVersionsContract } from '@/lib/api/contracts/tools/aws/appconfig-list-hosted-configuration-versions'
import { awsAppConfigStartDeploymentContract } from '@/lib/api/contracts/tools/aws/appconfig-start-deployment'
import { awsAppConfigStopDeploymentContract } from '@/lib/api/contracts/tools/aws/appconfig-stop-deployment'
import { awsAppConfigUpdateApplicationContract } from '@/lib/api/contracts/tools/aws/appconfig-update-application'
import { awsAppConfigUpdateConfigurationProfileContract } from '@/lib/api/contracts/tools/aws/appconfig-update-configuration-profile'
import { awsAppConfigUpdateEnvironmentContract } from '@/lib/api/contracts/tools/aws/appconfig-update-environment'
import {
  executeAppConfigCreateApplication,
  executeAppConfigCreateConfigurationProfile,
  executeAppConfigCreateEnvironment,
  executeAppConfigCreateHostedConfigurationVersion,
  executeAppConfigDeleteApplication,
  executeAppConfigDeleteConfigurationProfile,
  executeAppConfigDeleteEnvironment,
  executeAppConfigDeleteHostedConfigurationVersion,
  executeAppConfigGetApplication,
  executeAppConfigGetConfiguration,
  executeAppConfigGetConfigurationProfile,
  executeAppConfigGetDeployment,
  executeAppConfigGetEnvironment,
  executeAppConfigGetHostedConfigurationVersion,
  executeAppConfigListApplications,
  executeAppConfigListConfigurationProfiles,
  executeAppConfigListDeploymentStrategies,
  executeAppConfigListDeployments,
  executeAppConfigListEnvironments,
  executeAppConfigListHostedConfigurationVersions,
  executeAppConfigStartDeployment,
  executeAppConfigStopDeployment,
  executeAppConfigUpdateApplication,
  executeAppConfigUpdateConfigurationProfile,
  executeAppConfigUpdateEnvironment,
} from '@/lib/internal/appconfig/operations'
import { parseInternalToolInput } from '@/lib/internal/tool-operations/parse-input'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

async function executeOperation<C extends AnyApiRouteContract>(
  contract: C,
  input: unknown,
  execute: (input: ContractBody<C>, signal?: AbortSignal) => Promise<unknown>,
  errorMessage: string,
  signal?: AbortSignal
): Promise<Response> {
  const parsed = parseInternalToolInput(contract, input)
  if (!parsed.success) return parsed.response

  try {
    const result = await execute(parsed.data, signal)
    signal?.throwIfAborted()
    return Response.json(result)
  } catch (error) {
    signal?.throwIfAborted()
    return Response.json(
      { error: `${errorMessage}: ${getErrorMessage(error, 'Unknown error occurred')}` },
      { status: 500 }
    )
  }
}

export const executeAppConfigTool: InternalToolOperationHandler = async ({
  toolId,
  input,
  signal,
}) => {
  signal?.throwIfAborted()

  switch (toolId) {
    case 'appconfig_create_application':
      return executeOperation(
        awsAppConfigCreateApplicationContract,
        input,
        executeAppConfigCreateApplication,
        'Failed to create application',
        signal
      )
    case 'appconfig_create_configuration_profile':
      return executeOperation(
        awsAppConfigCreateConfigurationProfileContract,
        input,
        executeAppConfigCreateConfigurationProfile,
        'Failed to create configuration profile',
        signal
      )
    case 'appconfig_create_environment':
      return executeOperation(
        awsAppConfigCreateEnvironmentContract,
        input,
        executeAppConfigCreateEnvironment,
        'Failed to create environment',
        signal
      )
    case 'appconfig_create_hosted_configuration_version':
      return executeOperation(
        awsAppConfigCreateHostedConfigurationVersionContract,
        input,
        executeAppConfigCreateHostedConfigurationVersion,
        'Failed to create hosted configuration version',
        signal
      )
    case 'appconfig_delete_application':
      return executeOperation(
        awsAppConfigDeleteApplicationContract,
        input,
        executeAppConfigDeleteApplication,
        'Failed to delete application',
        signal
      )
    case 'appconfig_delete_configuration_profile':
      return executeOperation(
        awsAppConfigDeleteConfigurationProfileContract,
        input,
        executeAppConfigDeleteConfigurationProfile,
        'Failed to delete configuration profile',
        signal
      )
    case 'appconfig_delete_environment':
      return executeOperation(
        awsAppConfigDeleteEnvironmentContract,
        input,
        executeAppConfigDeleteEnvironment,
        'Failed to delete environment',
        signal
      )
    case 'appconfig_delete_hosted_configuration_version':
      return executeOperation(
        awsAppConfigDeleteHostedConfigurationVersionContract,
        input,
        executeAppConfigDeleteHostedConfigurationVersion,
        'Failed to delete hosted configuration version',
        signal
      )
    case 'appconfig_get_application':
      return executeOperation(
        awsAppConfigGetApplicationContract,
        input,
        executeAppConfigGetApplication,
        'Failed to get application',
        signal
      )
    case 'appconfig_get_configuration':
      return executeOperation(
        awsAppConfigGetConfigurationContract,
        input,
        executeAppConfigGetConfiguration,
        'Failed to retrieve configuration',
        signal
      )
    case 'appconfig_get_configuration_profile':
      return executeOperation(
        awsAppConfigGetConfigurationProfileContract,
        input,
        executeAppConfigGetConfigurationProfile,
        'Failed to get configuration profile',
        signal
      )
    case 'appconfig_get_deployment':
      return executeOperation(
        awsAppConfigGetDeploymentContract,
        input,
        executeAppConfigGetDeployment,
        'Failed to get deployment',
        signal
      )
    case 'appconfig_get_environment':
      return executeOperation(
        awsAppConfigGetEnvironmentContract,
        input,
        executeAppConfigGetEnvironment,
        'Failed to get environment',
        signal
      )
    case 'appconfig_get_hosted_configuration_version':
      return executeOperation(
        awsAppConfigGetHostedConfigurationVersionContract,
        input,
        executeAppConfigGetHostedConfigurationVersion,
        'Failed to get hosted configuration version',
        signal
      )
    case 'appconfig_list_applications':
      return executeOperation(
        awsAppConfigListApplicationsContract,
        input,
        executeAppConfigListApplications,
        'Failed to list applications',
        signal
      )
    case 'appconfig_list_configuration_profiles':
      return executeOperation(
        awsAppConfigListConfigurationProfilesContract,
        input,
        executeAppConfigListConfigurationProfiles,
        'Failed to list configuration profiles',
        signal
      )
    case 'appconfig_list_deployment_strategies':
      return executeOperation(
        awsAppConfigListDeploymentStrategiesContract,
        input,
        executeAppConfigListDeploymentStrategies,
        'Failed to list deployment strategies',
        signal
      )
    case 'appconfig_list_deployments':
      return executeOperation(
        awsAppConfigListDeploymentsContract,
        input,
        executeAppConfigListDeployments,
        'Failed to list deployments',
        signal
      )
    case 'appconfig_list_environments':
      return executeOperation(
        awsAppConfigListEnvironmentsContract,
        input,
        executeAppConfigListEnvironments,
        'Failed to list environments',
        signal
      )
    case 'appconfig_list_hosted_configuration_versions':
      return executeOperation(
        awsAppConfigListHostedConfigurationVersionsContract,
        input,
        executeAppConfigListHostedConfigurationVersions,
        'Failed to list hosted configuration versions',
        signal
      )
    case 'appconfig_start_deployment':
      return executeOperation(
        awsAppConfigStartDeploymentContract,
        input,
        executeAppConfigStartDeployment,
        'Failed to start deployment',
        signal
      )
    case 'appconfig_stop_deployment':
      return executeOperation(
        awsAppConfigStopDeploymentContract,
        input,
        executeAppConfigStopDeployment,
        'Failed to stop deployment',
        signal
      )
    case 'appconfig_update_application':
      return executeOperation(
        awsAppConfigUpdateApplicationContract,
        input,
        executeAppConfigUpdateApplication,
        'Failed to update application',
        signal
      )
    case 'appconfig_update_configuration_profile':
      return executeOperation(
        awsAppConfigUpdateConfigurationProfileContract,
        input,
        executeAppConfigUpdateConfigurationProfile,
        'Failed to update configuration profile',
        signal
      )
    case 'appconfig_update_environment':
      return executeOperation(
        awsAppConfigUpdateEnvironmentContract,
        input,
        executeAppConfigUpdateEnvironment,
        'Failed to update environment',
        signal
      )
    default:
      return Response.json({ error: `Unsupported AppConfig tool: ${toolId}` }, { status: 500 })
  }
}
