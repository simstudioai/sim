import { AppConfigIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type {
  AppConfigGetConfigurationResponse,
  AppConfigListApplicationsResponse,
} from '@/tools/appconfig/types'

export const AppConfigBlock: BlockConfig<
  AppConfigListApplicationsResponse | AppConfigGetConfigurationResponse
> = {
  type: 'appconfig',
  name: 'AWS AppConfig',
  description: 'Manage and retrieve configuration with AWS AppConfig',
  longDescription:
    'Integrate AWS AppConfig into workflows. Manage applications, environments, and configuration profiles, create and read hosted configuration versions, run and inspect deployments, and retrieve the latest deployed configuration at runtime. Requires AWS access key and secret access key.',
  docsLink: 'https://docs.sim.ai/integrations/appconfig',
  category: 'tools',
  integrationType: IntegrationType.DevOps,
  bgColor: 'linear-gradient(45deg, #B0084D 0%, #FF4F8B 100%)',
  icon: AppConfigIcon,
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

export const AppConfigBlockMeta = {
  tags: ['cloud', 'feature-flags', 'automation'],
  url: 'https://aws.amazon.com/systems-manager/features/appconfig',
  templates: [
    {
      icon: AppConfigIcon,
      title: 'AppConfig runtime config loader',
      prompt:
        'Build a workflow that retrieves the latest deployed AWS AppConfig configuration for a given application, environment, and profile, parses the JSON, and uses the feature flags to branch downstream agent behavior.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'feature-flags', 'automation'],
    },
    {
      icon: AppConfigIcon,
      title: 'AppConfig feature-flag publisher',
      prompt:
        'Create a workflow that takes a JSON feature-flag document, creates a new hosted configuration version in an AWS AppConfig configuration profile, and starts a deployment to the target environment using a chosen deployment strategy.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'feature-flags', 'automation'],
    },
    {
      icon: AppConfigIcon,
      title: 'AppConfig deployment monitor',
      prompt:
        'Build a scheduled workflow that lists in-progress AWS AppConfig deployments for an environment, gets each deployment status, and posts a Slack alert when a deployment is rolling back or has stalled.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: AppConfigIcon,
      title: 'AppConfig config inventory',
      prompt:
        'Create a scheduled workflow that lists every AWS AppConfig application, its environments, and its configuration profiles, and writes a unified inventory into a tracking table so the platform team has a single source of truth.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'enterprise', 'reporting'],
    },
    {
      icon: AppConfigIcon,
      title: 'AppConfig change auditor',
      prompt:
        'Build a scheduled workflow that lists recent AWS AppConfig deployments across environments, summarizes which configuration versions were deployed when, and writes an audit report file for compliance review.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'reporting', 'enterprise'],
    },
    {
      icon: AppConfigIcon,
      title: 'AppConfig drift checker',
      prompt:
        'Create a scheduled workflow that retrieves the live AWS AppConfig configuration and compares it against an expected baseline stored in a table, alerting Slack when the deployed configuration drifts from the approved version.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: AppConfigIcon,
      title: 'AppConfig bootstrap from GitHub',
      prompt:
        'Build a workflow triggered when a config file changes in a GitHub pull request that creates a new hosted AWS AppConfig configuration version from the file contents and deploys it to a staging environment for validation.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'automation', 'engineering'],
      alsoIntegrations: ['github'],
    },
    {
      icon: AppConfigIcon,
      title: 'AppConfig gated rollout',
      prompt:
        'Create a workflow that gates an AWS AppConfig deployment behind a Slack approval: it creates the configuration version, waits for sign-off, starts the deployment with a linear strategy, and monitors completion before reporting back.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'enterprise', 'automation'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'read-feature-flags',
      description:
        'Retrieve the latest deployed AWS AppConfig configuration for an application, environment, and profile and use the values to drive feature flags or dynamic settings.',
      content:
        '# Read AppConfig Feature Flags\n\nLoad live configuration to branch workflow behavior.\n\n## Steps\n1. Identify the target application, environment, and configuration profile (IDs or names).\n2. Get the latest deployed configuration for that combination.\n3. Parse the returned content (usually JSON) into a structured object.\n4. Use the flag or setting values to decide which downstream path to take.\n\n## Output\nThe resolved configuration values and the decision they drive. Do not hardcode flag values — always read them fresh from AppConfig.',
    },
    {
      name: 'publish-and-deploy-config',
      description:
        'Create a new hosted AWS AppConfig configuration version from a document and deploy it to an environment with a chosen deployment strategy.',
      content:
        '# Publish and Deploy Config\n\nShip a new configuration version safely.\n\n## Steps\n1. Assemble the configuration content (JSON, YAML, or text) and confirm the target application and configuration profile.\n2. Create a new hosted configuration version with the correct content type.\n3. Start a deployment of that version to the target environment using an appropriate deployment strategy.\n4. Record the returned deployment number for follow-up monitoring.\n\n## Output\nThe new version number and the started deployment number, plus the deployment state.',
    },
    {
      name: 'monitor-deployment-rollback',
      description:
        'Watch in-progress AWS AppConfig deployments for an environment and surface rollbacks or stalled rollouts so they can be acted on.',
      content:
        '# Monitor Deployment Rollback\n\nKeep an eye on configuration rollouts.\n\n## Steps\n1. List deployments for the target environment and find in-progress ones.\n2. Get the status of each active deployment, capturing state and percentage complete.\n3. Flag deployments that are rolling back or have stopped making progress.\n4. Optionally stop a deployment that needs to be halted.\n\n## Output\nA per-deployment status summary with any rollbacks or stalls called out for action.',
    },
    {
      name: 'inventory-appconfig',
      description:
        'List AWS AppConfig applications, environments, and configuration profiles to build a single inventory of what configuration exists across the account.',
      content:
        '# Inventory AppConfig\n\nBuild a unified view of all AppConfig resources.\n\n## Steps\n1. List every application and capture its ID, name, and description.\n2. For each application, list its environments and configuration profiles.\n3. Note the profile type (freeform vs feature flags) and where each profile is stored.\n4. Assemble the results into a single structured inventory.\n\n## Output\nAn inventory of applications with their environments and configuration profiles, suitable for writing to a tracking table.',
    },
  ],
} as const satisfies BlockMeta
