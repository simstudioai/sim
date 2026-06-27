import { AppConfigIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const AppConfigBlockDisplay = {
  type: 'appconfig',
  name: 'AWS AppConfig',
  description: 'Manage and retrieve configuration with AWS AppConfig',
  category: 'tools',
  bgColor: 'linear-gradient(45deg, #B0084D 0%, #FF4F8B 100%)',
  icon: AppConfigIcon,
  longDescription:
    'Integrate AWS AppConfig into workflows. Manage applications, environments, and configuration profiles, create and read hosted configuration versions, run and inspect deployments, and retrieve the latest deployed configuration at runtime. Requires AWS access key and secret access key.',
  docsLink: 'https://docs.sim.ai/integrations/appconfig',
  integrationType: IntegrationType.DevOps,
} satisfies BlockDisplay

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
