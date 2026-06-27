import { LaunchDarklyIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { type BlockMeta, IntegrationType } from '@/blocks/types'

export const LaunchDarklyBlockDisplay = {
  type: 'launchdarkly',
  name: 'LaunchDarkly',
  description: 'Manage feature flags with LaunchDarkly.',
  category: 'tools',
  bgColor: '#191919',
  icon: LaunchDarklyIcon,
  iconColor: '#405BFF',
  longDescription:
    'Integrate LaunchDarkly into your workflow. List, create, update, toggle, and delete feature flags. Manage projects, environments, segments, members, and audit logs. Requires API Key.',
  docsLink: 'https://docs.sim.ai/integrations/launchdarkly',
  integrationType: IntegrationType.DevOps,
} satisfies BlockDisplay

export const LaunchDarklyBlockMeta = {
  tags: ['feature-flags', 'ci-cd'],
  url: 'https://launchdarkly.com',
  templates: [
    {
      icon: LaunchDarklyIcon,
      title: 'LaunchDarkly flag-flip auditor',
      prompt:
        'Build a scheduled workflow that reads the LaunchDarkly audit log, captures who flipped which flag and when, and writes the audit trail to a tracking table with diff context.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'monitoring'],
    },
    {
      icon: LaunchDarklyIcon,
      title: 'LaunchDarkly stale-flag sweeper',
      prompt:
        'Create a scheduled workflow that identifies LaunchDarkly flags inactive for 60 days, opens Linear tickets to remove them, and writes the cleanup queue to a dashboard table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'automation'],
      alsoIntegrations: ['linear'],
    },
    {
      icon: LaunchDarklyIcon,
      title: 'LaunchDarkly rollout digest',
      prompt:
        'Build a scheduled weekly workflow that lists LaunchDarkly flags with their current status and rollout percentage per environment, summarizes what changed since last week, and posts a digest to the product Slack channel.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['product', 'analysis'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: LaunchDarklyIcon,
      title: 'LaunchDarkly flag-flip safety gate',
      prompt:
        'Create a scheduled workflow that reads the LaunchDarkly audit log for recent production flag flips, checks Sentry error rate and Datadog SLO burn against each, toggles the flag back off on regression, and posts to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['sentry', 'datadog', 'slack'],
    },
    {
      icon: LaunchDarklyIcon,
      title: 'LaunchDarkly targeted rollout assistant',
      prompt:
        'Build a workflow that takes a LaunchDarkly flag and a rollout plan, advances the rollout percentage on a schedule while watching health metrics, pausing on degradation.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'automation'],
      alsoIntegrations: ['datadog'],
    },
    {
      icon: LaunchDarklyIcon,
      title: 'LaunchDarkly + Linear release planner',
      prompt:
        'Create a workflow that watches Linear releases marked behind a LaunchDarkly flag, validates the flag exists, posts the rollout plan to Slack, and tracks rollout progress on the release ticket.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['engineering', 'automation'],
      alsoIntegrations: ['linear', 'slack'],
    },
    {
      icon: LaunchDarklyIcon,
      title: 'LaunchDarkly customer-segment toggler',
      prompt:
        'Build a workflow that turns a HubSpot segment into a LaunchDarkly targeting rule, keeping the rule in sync with the segment, and writes the sync log to a tracking table.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'crm', 'sync'],
      alsoIntegrations: ['hubspot'],
    },
  ],
  skills: [
    {
      name: 'toggle-flag-in-environment',
      description: 'Turn a LaunchDarkly feature flag on or off in a specific environment safely.',
      content:
        '# Toggle a Flag in an Environment\n\nFlip a feature flag for a target environment with a confirmation step.\n\n## Steps\n1. Identify the project and the environment (e.g. production, staging) and the flag key.\n2. Get the current flag status to confirm its present state.\n3. Toggle the flag to the desired on/off state in that environment.\n4. Re-check the status to confirm the change took effect.\n\n## Output\nReturn the flag key, environment, previous state, and new state. Confirm the toggle was applied.',
    },
    {
      name: 'create-feature-flag',
      description:
        'Create a new LaunchDarkly feature flag in a project with a clear key and description.',
      content:
        '# Create a Feature Flag\n\nStand up a new feature flag for an upcoming release.\n\n## Steps\n1. Choose the project and define a descriptive flag key and human-readable name.\n2. Set a description explaining what the flag controls and whether it is temporary or permanent.\n3. Create the flag, defaulting it to off so it can be rolled out deliberately.\n\n## Output\nReturn the flag key, name, project, and initial state. Confirm the flag starts disabled.',
    },
    {
      name: 'flag-rollout-audit',
      description:
        'Report on a flag state across environments and recent changes from the audit log.',
      content:
        '# Flag Rollout Audit\n\nUnderstand where a flag stands and who changed it recently.\n\n## Steps\n1. Get the flag and list environments for the project.\n2. For each environment, capture the flag on/off state and targeting.\n3. Pull the audit log entries for the flag to see recent changes and who made them.\n\n## Output\nReturn a per-environment state table for the flag and a short changelog of recent modifications with actor and timestamp.',
    },
    {
      name: 'emergency-flag-kill-switch',
      description:
        'Instantly disable a feature flag in production during an incident and confirm it is off.',
      content:
        '# Emergency Flag Kill-Switch\n\nKill a misbehaving feature in production immediately.\n\n## Steps\n1. Identify the project, the production environment key, and the flag key to disable.\n2. Toggle the flag off in that environment.\n3. Get the flag status to confirm it is now off and no longer being served.\n\n## Output\nReturn the flag key, environment, and confirmation that the flag is off, with the timestamp of the change.',
    },
    {
      name: 'stale-flag-cleanup',
      description: 'Find temporary or long-untouched feature flags and surface them for removal.',
      content:
        '# Stale Flag Cleanup\n\nKeep flag debt under control by surfacing flags that have outlived their purpose.\n\n## Steps\n1. List the flags in the project, noting which are marked temporary and their creation dates.\n2. Cross-reference the audit log to find flags with no recent changes.\n3. Compile the candidates that are temporary and inactive into a cleanup list.\n\n## Output\nReturn a list of stale flag keys with their age, temporary status, and last-change date so an owner can decide whether to archive or delete them.',
    },
  ],
} as const satisfies BlockMeta
