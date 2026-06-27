import { RailwayIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const RailwayBlockDisplay = {
  type: 'railway',
  name: 'Railway',
  description: 'Manage Railway projects, services, deployments, and variables',
  category: 'tools',
  bgColor: '#000000',
  icon: RailwayIcon,
  longDescription:
    'Integrate Railway into workflows to list projects, manage services and environments, monitor deployments, trigger and roll back service deployments, and manage environment variables.',
  docsLink: 'https://docs.sim.ai/integrations/railway',
  integrationType: IntegrationType.DevOps,
} satisfies BlockDisplay

export const RailwayBlockMeta = {
  tags: ['cloud', 'ci-cd'],
  url: 'https://railway.com',
  templates: [
    {
      icon: RailwayIcon,
      title: 'Railway deployment monitor',
      prompt:
        'Build a scheduled workflow that lists the latest Railway deployments across my services every few minutes, detects failed or crashed deployments, summarizes the failure with an agent, and posts an actionable Slack alert with a link to the service.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring', 'engineering'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: RailwayIcon,
      title: 'Railway deploy on merge',
      prompt:
        'Create a workflow that watches GitHub for merges to the main branch, triggers a Railway service deployment for the matching environment, and posts the deployment status back as a Slack notification.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'ci-cd', 'automation'],
      alsoIntegrations: ['github', 'slack'],
    },
    {
      icon: RailwayIcon,
      title: 'Railway environment variable auditor',
      prompt:
        'Build a scheduled weekly workflow that lists environment variables across every Railway project, compares them to a reference list in a table, flags drift and missing keys, and emails a remediation report to the platform team.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'enterprise', 'monitoring'],
    },
    {
      icon: RailwayIcon,
      title: 'Railway project inventory',
      prompt:
        'Create a scheduled workflow that lists every Railway project, its services, and environments weekly, logs them into a tracking table, and Slacks a diff of any added or removed resources so infrastructure changes never go unnoticed.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring', 'infrastructure'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: RailwayIcon,
      title: 'Railway config sync',
      prompt:
        'Build a workflow that reads service configuration from a table and upserts the matching Railway environment variables for each service, then posts a Slack summary of every variable that was created or changed.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: RailwayIcon,
      title: 'Railway preview environment provisioner',
      prompt:
        'Create a workflow that watches GitHub for new pull requests, creates a fresh Railway environment for the branch, upserts the required environment variables, deploys the service, and comments the live preview URL back on the PR.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'ci-cd', 'automation'],
      alsoIntegrations: ['github'],
    },
    {
      icon: RailwayIcon,
      title: 'Railway project onboarding kit',
      prompt:
        'Build a workflow that takes a new service name, creates a Railway project, sets up staging and production environments, seeds baseline environment variables from a table, and posts the project members and access summary to Slack for the team.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'automation', 'infrastructure'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'monitor-failed-deployments',
      description: 'List recent Railway deployments, detect failures, and alert with a summary.',
      content:
        '# Monitor Failed Deployments\n\nWatch Railway deployments and surface failures fast.\n\n## Steps\n1. Run list_deployments for the target project, service, and environment.\n2. Identify deployments with a failed or crashed status from the returned list.\n3. For each failure, run get_deployment_logs to pull the runtime logs and determine the likely cause.\n4. Summarize each failure: service, environment, status, and the diagnosed cause.\n5. Post an actionable alert (for example to Slack) with a link to the affected service.\n\n## Output\nReturn the count of failed deployments and a concise summary of each. If all healthy, report a clean status.',
    },
    {
      name: 'deploy-service',
      description: 'Trigger a Railway service deployment for a given environment and commit.',
      content:
        '# Deploy Service\n\nTrigger a deployment of a Railway service.\n\n## Steps\n1. Identify the service id and environment id to deploy (use get_project to look them up if needed).\n2. Run deploy_service, optionally pinning a specific commitSha.\n3. Capture the returned deploymentId.\n4. Optionally poll list_deployments to confirm the deployment reaches a success state.\n\n## Output\nReport the deploymentId, target environment, and final status.',
    },
    {
      name: 'sync-environment-variables',
      description:
        'Upsert Railway environment variables from a reference source and report changes.',
      content:
        '# Sync Environment Variables\n\nKeep Railway environment variables aligned with a reference list.\n\n## Steps\n1. Read the desired variable set (for example from a table) for each service.\n2. Run list_variables to capture the current state for the project, environment, and service.\n3. For each variable that is missing or differs, run upsert_variable. Use skipDeploys when batching multiple changes.\n4. Trigger a single deploy at the end if needed.\n\n## Output\nReturn a summary of every variable created or changed, grouped by service.',
    },
    {
      name: 'provision-preview-environment',
      description: 'Create an ephemeral Railway environment, seed variables, and deploy it.',
      content:
        '# Provision Preview Environment\n\nSpin up a fresh Railway environment for a branch or pull request.\n\n## Steps\n1. Run create_environment for the project, optionally cloning from a source environment and marking it ephemeral.\n2. Upsert the required environment variables for the new environment.\n3. Run deploy_service to bring the preview online.\n4. Capture the deployment status and the preview URL.\n\n## Output\nReturn the new environment id and the live preview URL so it can be shared on the PR.',
    },
    {
      name: 'audit-project-inventory',
      description: 'List every Railway project with services and environments for tracking.',
      content:
        '# Audit Project Inventory\n\nBuild a current inventory of Railway resources.\n\n## Steps\n1. Run list_projects, paginating with first and after until complete.\n2. For each project, run get_project to capture its services and environments.\n3. Optionally run list_project_members to record access.\n4. Compare against a prior snapshot to detect added or removed resources.\n\n## Output\nReturn the full inventory and a diff of any changes since the last run.',
    },
    {
      name: 'rollback-failed-deployment',
      description: 'Detect a bad Railway deployment and roll back or restart to recover.',
      content:
        '# Roll Back Failed Deployment\n\nRecover a Railway service automatically when a deployment goes bad.\n\n## Steps\n1. Run list_deployments for the service and environment to find the most recent deployment and its status.\n2. If the latest deployment failed or crashed, optionally run get_deployment_logs to confirm and capture the cause.\n3. To revert: pick the most recent healthy deployment with canRollback true (from list_deployments) and run rollback_deployment with its id.\n4. To recover a locked-up but otherwise healthy deployment instead, run restart_deployment with the deployment id.\n5. Run get_deployment on the resulting deployment to confirm it reaches a healthy status.\n\n## Output\nReport whether a rollback or restart was performed, the target deployment id, and the final status.',
    },
  ],
} as const satisfies BlockMeta
