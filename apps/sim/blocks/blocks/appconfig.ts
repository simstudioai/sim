import { AppConfigBlockDisplay } from '@/blocks/blocks/appconfig.display'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type {
  AppConfigGetConfigurationResponse,
  AppConfigListApplicationsResponse,
} from '@/tools/appconfig/types'

export const AppConfigBlock: BlockConfig<
  AppConfigListApplicationsResponse | AppConfigGetConfigurationResponse
> = {
  ...AppConfigBlockDisplay,
  authMode: AuthMode.ApiKey,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Get Configuration', id: 'get_configuration' },
        { label: 'List Applications', id: 'list_applications' },
        { label: 'Create Application', id: 'create_application' },
        { label: 'Get Application', id: 'get_application' },
        { label: 'Update Application', id: 'update_application' },
        { label: 'Delete Application', id: 'delete_application' },
        { label: 'List Environments', id: 'list_environments' },
        { label: 'Create Environment', id: 'create_environment' },
        { label: 'Get Environment', id: 'get_environment' },
        { label: 'Update Environment', id: 'update_environment' },
        { label: 'Delete Environment', id: 'delete_environment' },
        { label: 'List Configuration Profiles', id: 'list_configuration_profiles' },
        { label: 'Create Configuration Profile', id: 'create_configuration_profile' },
        { label: 'Get Configuration Profile', id: 'get_configuration_profile' },
        { label: 'Update Configuration Profile', id: 'update_configuration_profile' },
        { label: 'Delete Configuration Profile', id: 'delete_configuration_profile' },
        {
          label: 'Create Hosted Configuration Version',
          id: 'create_hosted_configuration_version',
        },
        { label: 'Get Hosted Configuration Version', id: 'get_hosted_configuration_version' },
        {
          label: 'List Hosted Configuration Versions',
          id: 'list_hosted_configuration_versions',
        },
        {
          label: 'Delete Hosted Configuration Version',
          id: 'delete_hosted_configuration_version',
        },
        { label: 'List Deployment Strategies', id: 'list_deployment_strategies' },
        { label: 'Start Deployment', id: 'start_deployment' },
        { label: 'Get Deployment', id: 'get_deployment' },
        { label: 'List Deployments', id: 'list_deployments' },
        { label: 'Stop Deployment', id: 'stop_deployment' },
      ],
      value: () => 'get_configuration',
    },
    {
      id: 'region',
      title: 'AWS Region',
      type: 'short-input',
      placeholder: 'us-east-1',
      required: true,
    },
    {
      id: 'accessKeyId',
      title: 'AWS Access Key ID',
      type: 'short-input',
      placeholder: 'AKIA...',
      password: true,
      required: true,
    },
    {
      id: 'secretAccessKey',
      title: 'AWS Secret Access Key',
      type: 'short-input',
      placeholder: 'Your secret access key',
      password: true,
      required: true,
    },
    {
      id: 'applicationId',
      title: 'Application ID',
      type: 'short-input',
      placeholder: 'Application ID (or name for Get Configuration)',
      condition: {
        field: 'operation',
        value: [
          'get_application',
          'update_application',
          'delete_application',
          'list_environments',
          'create_environment',
          'get_environment',
          'update_environment',
          'delete_environment',
          'list_configuration_profiles',
          'create_configuration_profile',
          'get_configuration_profile',
          'update_configuration_profile',
          'delete_configuration_profile',
          'create_hosted_configuration_version',
          'get_hosted_configuration_version',
          'list_hosted_configuration_versions',
          'delete_hosted_configuration_version',
          'start_deployment',
          'get_deployment',
          'list_deployments',
          'stop_deployment',
          'get_configuration',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'get_application',
          'update_application',
          'delete_application',
          'list_environments',
          'create_environment',
          'get_environment',
          'update_environment',
          'delete_environment',
          'list_configuration_profiles',
          'create_configuration_profile',
          'get_configuration_profile',
          'update_configuration_profile',
          'delete_configuration_profile',
          'create_hosted_configuration_version',
          'get_hosted_configuration_version',
          'list_hosted_configuration_versions',
          'delete_hosted_configuration_version',
          'start_deployment',
          'get_deployment',
          'list_deployments',
          'stop_deployment',
          'get_configuration',
        ],
      },
    },
    {
      id: 'environmentId',
      title: 'Environment ID',
      type: 'short-input',
      placeholder: 'Environment ID (or name for Get Configuration)',
      condition: {
        field: 'operation',
        value: [
          'get_environment',
          'update_environment',
          'delete_environment',
          'start_deployment',
          'get_deployment',
          'list_deployments',
          'stop_deployment',
          'get_configuration',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'get_environment',
          'update_environment',
          'delete_environment',
          'start_deployment',
          'get_deployment',
          'list_deployments',
          'stop_deployment',
          'get_configuration',
        ],
      },
    },
    {
      id: 'configurationProfileId',
      title: 'Configuration Profile ID',
      type: 'short-input',
      placeholder: 'Configuration profile ID (or name for Get Configuration)',
      condition: {
        field: 'operation',
        value: [
          'get_configuration_profile',
          'update_configuration_profile',
          'delete_configuration_profile',
          'create_hosted_configuration_version',
          'get_hosted_configuration_version',
          'list_hosted_configuration_versions',
          'delete_hosted_configuration_version',
          'start_deployment',
          'get_configuration',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'get_configuration_profile',
          'update_configuration_profile',
          'delete_configuration_profile',
          'create_hosted_configuration_version',
          'get_hosted_configuration_version',
          'list_hosted_configuration_versions',
          'delete_hosted_configuration_version',
          'start_deployment',
          'get_configuration',
        ],
      },
    },
    {
      id: 'name',
      title: 'Name',
      type: 'short-input',
      placeholder: 'Resource name',
      condition: {
        field: 'operation',
        value: [
          'create_application',
          'create_environment',
          'create_configuration_profile',
          'update_application',
          'update_environment',
          'update_configuration_profile',
        ],
      },
      required: {
        field: 'operation',
        value: ['create_application', 'create_environment', 'create_configuration_profile'],
      },
    },
    {
      id: 'locationUri',
      title: 'Location URI',
      type: 'short-input',
      placeholder: 'hosted',
      condition: { field: 'operation', value: 'create_configuration_profile' },
      required: { field: 'operation', value: 'create_configuration_profile' },
    },
    {
      id: 'type',
      title: 'Profile Type',
      type: 'dropdown',
      options: [
        { label: 'Freeform (AWS.Freeform)', id: 'AWS.Freeform' },
        { label: 'Feature Flags (AWS.AppConfig.FeatureFlags)', id: 'AWS.AppConfig.FeatureFlags' },
      ],
      value: () => 'AWS.Freeform',
      condition: { field: 'operation', value: 'create_configuration_profile' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'retrievalRoleArn',
      title: 'Retrieval Role ARN',
      type: 'short-input',
      placeholder: 'arn:aws:iam::123456789012:role/AppConfigRetrieval',
      condition: {
        field: 'operation',
        value: ['create_configuration_profile', 'update_configuration_profile'],
      },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'content',
      title: 'Configuration Content',
      type: 'code',
      placeholder: '{"featureX": {"enabled": true}}',
      condition: { field: 'operation', value: 'create_hosted_configuration_version' },
      required: { field: 'operation', value: 'create_hosted_configuration_version' },
    },
    {
      id: 'contentType',
      title: 'Content Type',
      type: 'short-input',
      placeholder: 'application/json',
      condition: { field: 'operation', value: 'create_hosted_configuration_version' },
      required: { field: 'operation', value: 'create_hosted_configuration_version' },
    },
    {
      id: 'latestVersionNumber',
      title: 'Latest Version Number',
      type: 'short-input',
      placeholder: 'For optimistic concurrency',
      condition: { field: 'operation', value: 'create_hosted_configuration_version' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'versionLabel',
      title: 'Version Label',
      type: 'short-input',
      placeholder: 'v1.0.0',
      condition: { field: 'operation', value: 'create_hosted_configuration_version' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'versionNumber',
      title: 'Version Number',
      type: 'short-input',
      placeholder: '1',
      condition: {
        field: 'operation',
        value: ['get_hosted_configuration_version', 'delete_hosted_configuration_version'],
      },
      required: {
        field: 'operation',
        value: ['get_hosted_configuration_version', 'delete_hosted_configuration_version'],
      },
    },
    {
      id: 'deploymentStrategyId',
      title: 'Deployment Strategy ID',
      type: 'short-input',
      placeholder: 'AppConfig.AllAtOnce',
      condition: { field: 'operation', value: 'start_deployment' },
      required: { field: 'operation', value: 'start_deployment' },
    },
    {
      id: 'configurationVersion',
      title: 'Configuration Version',
      type: 'short-input',
      placeholder: '1',
      condition: { field: 'operation', value: 'start_deployment' },
      required: { field: 'operation', value: 'start_deployment' },
    },
    {
      id: 'deploymentNumber',
      title: 'Deployment Number',
      type: 'short-input',
      placeholder: '1',
      condition: { field: 'operation', value: ['get_deployment', 'stop_deployment'] },
      required: { field: 'operation', value: ['get_deployment', 'stop_deployment'] },
    },
    {
      id: 'description',
      title: 'Description',
      type: 'short-input',
      placeholder: 'Optional description',
      condition: {
        field: 'operation',
        value: [
          'create_application',
          'create_environment',
          'create_configuration_profile',
          'update_application',
          'update_environment',
          'update_configuration_profile',
          'create_hosted_configuration_version',
          'start_deployment',
        ],
      },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'maxResults',
      title: 'Max Results',
      type: 'short-input',
      placeholder: '50',
      condition: {
        field: 'operation',
        value: [
          'list_applications',
          'list_environments',
          'list_configuration_profiles',
          'list_deployment_strategies',
          'list_deployments',
          'list_hosted_configuration_versions',
        ],
      },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'nextToken',
      title: 'Next Token',
      type: 'short-input',
      placeholder: 'Pagination token',
      condition: {
        field: 'operation',
        value: [
          'list_applications',
          'list_environments',
          'list_configuration_profiles',
          'list_deployment_strategies',
          'list_deployments',
          'list_hosted_configuration_versions',
        ],
      },
      required: false,
      mode: 'advanced',
    },
  ],
  tools: {
    access: [
      'appconfig_get_configuration',
      'appconfig_list_applications',
      'appconfig_create_application',
      'appconfig_get_application',
      'appconfig_update_application',
      'appconfig_delete_application',
      'appconfig_list_environments',
      'appconfig_create_environment',
      'appconfig_get_environment',
      'appconfig_update_environment',
      'appconfig_delete_environment',
      'appconfig_list_configuration_profiles',
      'appconfig_create_configuration_profile',
      'appconfig_get_configuration_profile',
      'appconfig_update_configuration_profile',
      'appconfig_delete_configuration_profile',
      'appconfig_create_hosted_configuration_version',
      'appconfig_get_hosted_configuration_version',
      'appconfig_list_hosted_configuration_versions',
      'appconfig_delete_hosted_configuration_version',
      'appconfig_list_deployment_strategies',
      'appconfig_start_deployment',
      'appconfig_get_deployment',
      'appconfig_list_deployments',
      'appconfig_stop_deployment',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'get_configuration':
            return 'appconfig_get_configuration'
          case 'list_applications':
            return 'appconfig_list_applications'
          case 'create_application':
            return 'appconfig_create_application'
          case 'get_application':
            return 'appconfig_get_application'
          case 'update_application':
            return 'appconfig_update_application'
          case 'delete_application':
            return 'appconfig_delete_application'
          case 'list_environments':
            return 'appconfig_list_environments'
          case 'create_environment':
            return 'appconfig_create_environment'
          case 'get_environment':
            return 'appconfig_get_environment'
          case 'update_environment':
            return 'appconfig_update_environment'
          case 'delete_environment':
            return 'appconfig_delete_environment'
          case 'list_configuration_profiles':
            return 'appconfig_list_configuration_profiles'
          case 'create_configuration_profile':
            return 'appconfig_create_configuration_profile'
          case 'get_configuration_profile':
            return 'appconfig_get_configuration_profile'
          case 'update_configuration_profile':
            return 'appconfig_update_configuration_profile'
          case 'delete_configuration_profile':
            return 'appconfig_delete_configuration_profile'
          case 'create_hosted_configuration_version':
            return 'appconfig_create_hosted_configuration_version'
          case 'get_hosted_configuration_version':
            return 'appconfig_get_hosted_configuration_version'
          case 'list_hosted_configuration_versions':
            return 'appconfig_list_hosted_configuration_versions'
          case 'delete_hosted_configuration_version':
            return 'appconfig_delete_hosted_configuration_version'
          case 'list_deployment_strategies':
            return 'appconfig_list_deployment_strategies'
          case 'start_deployment':
            return 'appconfig_start_deployment'
          case 'get_deployment':
            return 'appconfig_get_deployment'
          case 'list_deployments':
            return 'appconfig_list_deployments'
          case 'stop_deployment':
            return 'appconfig_stop_deployment'
          default:
            throw new Error(`Invalid AppConfig operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const {
          operation,
          maxResults,
          versionNumber,
          deploymentNumber,
          latestVersionNumber,
          configurationVersion,
          ...rest
        } = params

        const result: Record<string, unknown> = { ...rest }

        const toInt = (value: unknown): number | undefined => {
          if (value === undefined || value === null || value === '') return undefined
          const parsed = Number.parseInt(String(value), 10)
          return Number.isNaN(parsed) ? undefined : parsed
        }

        // Stringify: a versionNumber piped from an upstream step resolves to a JSON number,
        // but AppConfig's ConfigurationVersion (version number or label) must be a string.
        if (configurationVersion !== undefined && configurationVersion !== null) {
          result.configurationVersion = String(configurationVersion)
        }

        const maxResultsInt = toInt(maxResults)
        if (maxResultsInt !== undefined) result.maxResults = maxResultsInt

        const versionNumberInt = toInt(versionNumber)
        if (versionNumberInt !== undefined) result.versionNumber = versionNumberInt

        const deploymentNumberInt = toInt(deploymentNumber)
        if (deploymentNumberInt !== undefined) result.deploymentNumber = deploymentNumberInt

        const latestVersionNumberInt = toInt(latestVersionNumber)
        if (latestVersionNumberInt !== undefined)
          result.latestVersionNumber = latestVersionNumberInt

        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'AppConfig operation to perform' },
    region: { type: 'string', description: 'AWS region' },
    accessKeyId: { type: 'string', description: 'AWS access key ID' },
    secretAccessKey: { type: 'string', description: 'AWS secret access key' },
    applicationId: { type: 'string', description: 'Application ID or name' },
    environmentId: { type: 'string', description: 'Environment ID or name' },
    configurationProfileId: { type: 'string', description: 'Configuration profile ID or name' },
    name: { type: 'string', description: 'Name for a new resource' },
    locationUri: { type: 'string', description: 'Where the configuration is stored' },
    type: { type: 'string', description: 'Configuration profile type' },
    retrievalRoleArn: { type: 'string', description: 'IAM role ARN to retrieve configuration' },
    content: { type: 'string', description: 'Configuration content' },
    contentType: { type: 'string', description: 'Content type of the configuration' },
    latestVersionNumber: { type: 'number', description: 'Latest version number for concurrency' },
    versionLabel: { type: 'string', description: 'Label for the configuration version' },
    versionNumber: { type: 'number', description: 'Hosted configuration version number' },
    deploymentStrategyId: { type: 'string', description: 'Deployment strategy ID' },
    configurationVersion: { type: 'string', description: 'Configuration version to deploy' },
    deploymentNumber: { type: 'number', description: 'Deployment sequence number' },
    description: { type: 'string', description: 'Optional description' },
    maxResults: { type: 'number', description: 'Maximum number of results to return' },
    nextToken: { type: 'string', description: 'Pagination token' },
  },
  outputs: {
    configuration: { type: 'string', description: 'The deployed configuration content' },
    contentType: { type: 'string', description: 'Content type of the configuration' },
    versionLabel: { type: 'string', description: 'Configuration version label' },
    message: { type: 'string', description: 'Operation status message' },
    id: { type: 'string', description: 'ID of the created or affected resource' },
    name: { type: 'string', description: 'Name of the resource' },
    description: { type: 'string', description: 'Description of the resource' },
    applicationId: { type: 'string', description: 'Application ID' },
    environmentId: { type: 'string', description: 'Environment ID' },
    configurationProfileId: { type: 'string', description: 'Configuration profile ID' },
    locationUri: { type: 'string', description: 'Location URI of the configuration' },
    type: { type: 'string', description: 'Configuration profile type' },
    state: { type: 'string', description: 'State of the resource or deployment' },
    deploymentStrategyId: { type: 'string', description: 'Deployment strategy ID' },
    deploymentNumber: { type: 'number', description: 'Deployment sequence number' },
    configurationName: { type: 'string', description: 'Configuration name' },
    configurationVersion: { type: 'string', description: 'Configuration version' },
    percentageComplete: { type: 'number', description: 'Deployment completion percentage' },
    startedAt: { type: 'string', description: 'When the deployment started' },
    completedAt: { type: 'string', description: 'When the deployment completed' },
    versionNumber: { type: 'number', description: 'Hosted configuration version number' },
    content: { type: 'string', description: 'Hosted configuration content' },
    applications: { type: 'json', description: 'List of applications' },
    environments: { type: 'json', description: 'List of environments' },
    configurationProfiles: { type: 'json', description: 'List of configuration profiles' },
    deploymentStrategies: { type: 'json', description: 'List of deployment strategies' },
    deployments: { type: 'json', description: 'List of deployments' },
    versions: { type: 'json', description: 'List of hosted configuration versions' },
    monitors: { type: 'json', description: 'CloudWatch alarms monitoring an environment' },
    validators: { type: 'json', description: 'Validators configured on a configuration profile' },
    retrievalRoleArn: { type: 'string', description: 'IAM role ARN to retrieve configuration' },
    nextToken: { type: 'string', description: 'Pagination token for the next page' },
    count: { type: 'number', description: 'Number of items returned' },
  },
}
