import { AppConfigIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { AppConfigResponse } from '@/tools/appconfig/types'

const APP_ID_OPERATIONS = [
  'create_version',
  'get_version',
  'list_versions',
  'start_deployment',
  'get_deployment',
  'stop_deployment',
  'list_deployments',
  'list_environments',
  'list_profiles',
]
const PROFILE_ID_OPERATIONS = ['create_version', 'get_version', 'list_versions', 'start_deployment']
const ENVIRONMENT_ID_OPERATIONS = [
  'start_deployment',
  'get_deployment',
  'stop_deployment',
  'list_deployments',
]
const DEPLOYMENT_NUMBER_OPERATIONS = ['get_deployment', 'stop_deployment']
const PAGINATED_OPERATIONS = [
  'list_versions',
  'list_deployments',
  'list_applications',
  'list_environments',
  'list_profiles',
  'list_strategies',
]

const toNumber = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = Number.parseInt(String(value), 10)
  return Number.isNaN(parsed) ? undefined : parsed
}

export const AppConfigBlock: BlockConfig<AppConfigResponse> = {
  type: 'appconfig',
  name: 'AWS AppConfig',
  description: 'Manage configuration versions and deployments in AWS AppConfig',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate AWS AppConfig into workflows. Create hosted configuration versions, start, stop, and inspect deployments, and discover applications, environments, configuration profiles, and deployment strategies.',
  docsLink: 'https://docs.sim.ai/tools/appconfig',
  category: 'tools',
  integrationType: IntegrationType.DevOps,
  bgColor: '#E7157B',
  iconColor: '#E7157B',
  icon: AppConfigIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Create Configuration Version', id: 'create_version' },
        { label: 'Get Configuration Version', id: 'get_version' },
        { label: 'List Configuration Versions', id: 'list_versions' },
        { label: 'Start Deployment', id: 'start_deployment' },
        { label: 'Get Deployment', id: 'get_deployment' },
        { label: 'Stop Deployment', id: 'stop_deployment' },
        { label: 'List Deployments', id: 'list_deployments' },
        { label: 'List Applications', id: 'list_applications' },
        { label: 'List Environments', id: 'list_environments' },
        { label: 'List Configuration Profiles', id: 'list_profiles' },
        { label: 'List Deployment Strategies', id: 'list_strategies' },
      ],
      value: () => 'list_applications',
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
      placeholder: 'The AppConfig application ID',
      condition: { field: 'operation', value: APP_ID_OPERATIONS },
      required: { field: 'operation', value: APP_ID_OPERATIONS },
    },
    {
      id: 'configurationProfileId',
      title: 'Configuration Profile ID',
      type: 'short-input',
      placeholder: 'The configuration profile ID',
      condition: { field: 'operation', value: PROFILE_ID_OPERATIONS },
      required: { field: 'operation', value: PROFILE_ID_OPERATIONS },
    },
    {
      id: 'environmentId',
      title: 'Environment ID',
      type: 'short-input',
      placeholder: 'The environment ID',
      condition: { field: 'operation', value: ENVIRONMENT_ID_OPERATIONS },
      required: { field: 'operation', value: ENVIRONMENT_ID_OPERATIONS },
    },
    {
      id: 'content',
      title: 'Configuration Content',
      type: 'code',
      placeholder: '{\n  "featureEnabled": true\n}',
      condition: { field: 'operation', value: 'create_version' },
      required: { field: 'operation', value: 'create_version' },
      wandConfig: {
        enabled: true,
        prompt: `Generate AppConfig configuration content based on the user's description.
Match the format selected in the Content Type field — JSON for application/json, YAML for application/x-yaml, or plain text for text/plain.

Return ONLY the configuration content - no explanations, no markdown code blocks.`,
        placeholder: 'Describe the configuration...',
      },
    },
    {
      id: 'contentType',
      title: 'Content Type',
      type: 'dropdown',
      options: [
        { label: 'application/json', id: 'application/json' },
        { label: 'application/x-yaml', id: 'application/x-yaml' },
        { label: 'text/plain', id: 'text/plain' },
      ],
      value: () => 'application/json',
      condition: { field: 'operation', value: 'create_version' },
      required: { field: 'operation', value: 'create_version' },
    },
    {
      id: 'versionNumber',
      title: 'Version Number',
      type: 'short-input',
      placeholder: '1',
      condition: { field: 'operation', value: 'get_version' },
      required: { field: 'operation', value: 'get_version' },
    },
    {
      id: 'deploymentStrategyId',
      title: 'Deployment Strategy ID',
      type: 'short-input',
      placeholder: 'e.g., AppConfig.AllAtOnce',
      condition: { field: 'operation', value: 'start_deployment' },
      required: { field: 'operation', value: 'start_deployment' },
    },
    {
      id: 'configurationVersion',
      title: 'Configuration Version',
      type: 'short-input',
      placeholder: 'Version number or label to deploy',
      condition: { field: 'operation', value: 'start_deployment' },
      required: { field: 'operation', value: 'start_deployment' },
    },
    {
      id: 'deploymentNumber',
      title: 'Deployment Number',
      type: 'short-input',
      placeholder: '1',
      condition: { field: 'operation', value: DEPLOYMENT_NUMBER_OPERATIONS },
      required: { field: 'operation', value: DEPLOYMENT_NUMBER_OPERATIONS },
    },
    {
      id: 'description',
      title: 'Description',
      type: 'short-input',
      placeholder: 'Optional description',
      condition: { field: 'operation', value: ['create_version', 'start_deployment'] },
      mode: 'advanced',
    },
    {
      id: 'versionLabel',
      title: 'Version Label',
      type: 'short-input',
      placeholder: 'e.g., v2.2.0',
      condition: { field: 'operation', value: 'create_version' },
      mode: 'advanced',
    },
    {
      id: 'latestVersionNumber',
      title: 'Latest Version Number (Lock)',
      type: 'short-input',
      placeholder: 'Prevents overwrites if set',
      condition: { field: 'operation', value: 'create_version' },
      mode: 'advanced',
    },
    {
      id: 'maxResults',
      title: 'Max Results',
      type: 'short-input',
      placeholder: '50',
      condition: { field: 'operation', value: PAGINATED_OPERATIONS },
      mode: 'advanced',
    },
    {
      id: 'nextToken',
      title: 'Next Token',
      type: 'short-input',
      placeholder: 'Pagination token from a previous response',
      condition: { field: 'operation', value: PAGINATED_OPERATIONS },
      mode: 'advanced',
    },
  ],
  tools: {
    access: [
      'appconfig_create_hosted_configuration_version',
      'appconfig_get_hosted_configuration_version',
      'appconfig_list_hosted_configuration_versions',
      'appconfig_start_deployment',
      'appconfig_get_deployment',
      'appconfig_stop_deployment',
      'appconfig_list_deployments',
      'appconfig_list_applications',
      'appconfig_list_environments',
      'appconfig_list_configuration_profiles',
      'appconfig_list_deployment_strategies',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'create_version':
            return 'appconfig_create_hosted_configuration_version'
          case 'get_version':
            return 'appconfig_get_hosted_configuration_version'
          case 'list_versions':
            return 'appconfig_list_hosted_configuration_versions'
          case 'start_deployment':
            return 'appconfig_start_deployment'
          case 'get_deployment':
            return 'appconfig_get_deployment'
          case 'stop_deployment':
            return 'appconfig_stop_deployment'
          case 'list_deployments':
            return 'appconfig_list_deployments'
          case 'list_applications':
            return 'appconfig_list_applications'
          case 'list_environments':
            return 'appconfig_list_environments'
          case 'list_profiles':
            return 'appconfig_list_configuration_profiles'
          case 'list_strategies':
            return 'appconfig_list_deployment_strategies'
          default:
            throw new Error(`Invalid AppConfig operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const op = params.operation as string
        const result: Record<string, unknown> = {
          region: params.region,
          accessKeyId: params.accessKeyId,
          secretAccessKey: params.secretAccessKey,
        }

        if (APP_ID_OPERATIONS.includes(op)) result.applicationId = params.applicationId
        if (PROFILE_ID_OPERATIONS.includes(op))
          result.configurationProfileId = params.configurationProfileId
        if (ENVIRONMENT_ID_OPERATIONS.includes(op)) result.environmentId = params.environmentId

        if (op === 'create_version') {
          result.content = params.content
          result.contentType = params.contentType
          if (params.description) result.description = params.description
          if (params.versionLabel) result.versionLabel = params.versionLabel
          const latest = toNumber(params.latestVersionNumber)
          if (latest !== undefined) result.latestVersionNumber = latest
        }

        if (op === 'get_version') {
          const version = toNumber(params.versionNumber)
          if (version !== undefined) result.versionNumber = version
        }

        if (op === 'start_deployment') {
          result.deploymentStrategyId = params.deploymentStrategyId
          // Stringify: a versionNumber piped from a create/list step resolves to a JSON
          // number, but AppConfig's ConfigurationVersion (number or label) is a string.
          if (params.configurationVersion !== undefined && params.configurationVersion !== null) {
            result.configurationVersion = String(params.configurationVersion)
          }
          if (params.description) result.description = params.description
        }

        if (DEPLOYMENT_NUMBER_OPERATIONS.includes(op)) {
          const deployment = toNumber(params.deploymentNumber)
          if (deployment !== undefined) result.deploymentNumber = deployment
        }

        if (PAGINATED_OPERATIONS.includes(op)) {
          const max = toNumber(params.maxResults)
          if (max !== undefined) result.maxResults = max
          if (params.nextToken) result.nextToken = params.nextToken
        }

        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'AppConfig operation to perform' },
    region: { type: 'string', description: 'AWS region' },
    accessKeyId: { type: 'string', description: 'AWS access key ID' },
    secretAccessKey: { type: 'string', description: 'AWS secret access key' },
    applicationId: { type: 'string', description: 'The AppConfig application ID' },
    configurationProfileId: { type: 'string', description: 'The configuration profile ID' },
    environmentId: { type: 'string', description: 'The environment ID' },
    content: { type: 'string', description: 'Configuration content for a new version' },
    contentType: { type: 'string', description: 'MIME type of the configuration content' },
    versionNumber: { type: 'number', description: 'Hosted configuration version number' },
    deploymentStrategyId: { type: 'string', description: 'The deployment strategy ID' },
    configurationVersion: { type: 'string', description: 'Configuration version to deploy' },
    deploymentNumber: { type: 'number', description: 'The deployment sequence number' },
    description: { type: 'string', description: 'Optional description' },
    versionLabel: { type: 'string', description: 'Optional version label' },
    latestVersionNumber: { type: 'number', description: 'Locking token for create version' },
    maxResults: { type: 'number', description: 'Maximum number of results to return' },
    nextToken: { type: 'string', description: 'Pagination token' },
  },
  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    applicationId: { type: 'string', description: 'The application ID' },
    configurationProfileId: { type: 'string', description: 'The configuration profile ID' },
    environmentId: { type: 'string', description: 'The environment ID' },
    versionNumber: { type: 'number', description: 'The hosted configuration version number' },
    content: { type: 'string', description: 'The configuration content' },
    contentType: { type: 'string', description: 'The content MIME type' },
    versionLabel: { type: 'string', description: 'The version label' },
    deploymentNumber: { type: 'number', description: 'The deployment sequence number' },
    deploymentStrategyId: { type: 'string', description: 'The deployment strategy ID' },
    configurationVersion: { type: 'string', description: 'The deployed configuration version' },
    description: { type: 'string', description: 'Description of the version or deployment' },
    state: { type: 'string', description: 'The deployment state' },
    percentageComplete: { type: 'number', description: 'Percentage of targets deployed' },
    startedAt: { type: 'string', description: 'When the deployment started (ISO)' },
    completedAt: { type: 'string', description: 'When the deployment completed (ISO)' },
    items: {
      type: 'array',
      description:
        'List results — versions, deployments, applications, environments, profiles, or strategies depending on the operation',
    },
    nextToken: { type: 'string', description: 'Pagination token for the next page' },
  },
}

export const AppConfigBlockMeta = {
  tags: ['cloud', 'feature-flags'],
  templates: [
    {
      icon: AppConfigIcon,
      title: 'AppConfig version + deploy',
      prompt:
        'Build a workflow that creates a new AppConfig hosted configuration version from provided JSON, then starts a deployment to the production environment and reports the resulting deployment number.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'automation'],
    },
    {
      icon: AppConfigIcon,
      title: 'AppConfig deployment watcher',
      prompt:
        'Create a scheduled workflow that lists in-progress AppConfig deployments for an environment, checks each deployment status, and posts a summary to Slack when any deployment completes or rolls back.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: AppConfigIcon,
      title: 'AppConfig auto-rollback on alarm',
      prompt:
        'Build a workflow that watches a CloudWatch alarm and, when it fires, stops the active AppConfig deployment for the affected environment and notifies the on-call engineer.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'incident'],
      alsoIntegrations: ['cloudwatch', 'slack'],
    },
    {
      icon: AppConfigIcon,
      title: 'AppConfig config audit',
      prompt:
        'Create a scheduled workflow that lists every AppConfig application, environment, and configuration profile, fetches the latest hosted version content, and writes a configuration inventory to a file.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['devops', 'audit'],
    },
    {
      icon: AppConfigIcon,
      title: 'AppConfig feature flag rollout',
      prompt:
        'Build a workflow that creates a new feature-flag configuration version enabling a flag, then deploys it to staging using a gradual deployment strategy and confirms the deployment reached 100 percent.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['feature-flags', 'devops'],
    },
    {
      icon: AppConfigIcon,
      title: 'AppConfig promote staging to prod',
      prompt:
        'Create a workflow that reads the configuration version currently deployed to staging in AppConfig and starts a deployment of that same version to the production environment after approval.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'promotion'],
    },
    {
      icon: AppConfigIcon,
      title: 'AppConfig deployment digest',
      prompt:
        'Build a scheduled weekly workflow that lists AppConfig deployments across environments, summarizes successes, rollbacks, and durations, and emails the digest to the platform team.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'reporting'],
      alsoIntegrations: ['gmail'],
    },
  ],
} as const satisfies BlockMeta
