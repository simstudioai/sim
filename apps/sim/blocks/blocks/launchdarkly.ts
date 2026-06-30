import { LaunchDarklyIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'

export const LaunchDarklyBlock: BlockConfig = {
  type: 'launchdarkly',
  name: 'LaunchDarkly',
  description: 'Manage feature flags with LaunchDarkly.',
  longDescription:
    'Integrate LaunchDarkly into your workflow. List, create, update, toggle, and delete feature flags. Manage projects, environments, segments, members, and audit logs. Requires API Key.',
  docsLink: 'https://docs.sim.ai/integrations/launchdarkly',
  category: 'tools',
  integrationType: IntegrationType.DevOps,
  bgColor: '#191919',
  iconColor: '#405BFF',
  icon: LaunchDarklyIcon,
  authMode: AuthMode.ApiKey,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Flags', id: 'list_flags' },
        { label: 'Get Flag', id: 'get_flag' },
        { label: 'Create Flag', id: 'create_flag' },
        { label: 'Update Flag', id: 'update_flag' },
        { label: 'Toggle Flag', id: 'toggle_flag' },
        { label: 'Delete Flag', id: 'delete_flag' },
        { label: 'Get Flag Status', id: 'get_flag_status' },
        { label: 'List Projects', id: 'list_projects' },
        { label: 'List Environments', id: 'list_environments' },
        { label: 'List Segments', id: 'list_segments' },
        { label: 'List Members', id: 'list_members' },
        { label: 'Get Audit Log', id: 'get_audit_log' },
      ],
      value: () => 'list_flags',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your LaunchDarkly API key',
      password: true,
      required: true,
    },

    {
      id: 'projectKey',
      title: 'Project Key',
      type: 'short-input',
      placeholder: 'my-project',
      condition: {
        field: 'operation',
        value: ['list_projects', 'list_members', 'get_audit_log'],
        not: true,
      },
      required: {
        field: 'operation',
        value: ['list_projects', 'list_members', 'get_audit_log'],
        not: true,
      },
    },

    {
      id: 'flagKey',
      title: 'Flag Key',
      type: 'short-input',
      placeholder: 'my-feature-flag',
      condition: {
        field: 'operation',
        value: ['get_flag', 'toggle_flag', 'delete_flag', 'update_flag', 'get_flag_status'],
      },
      required: {
        field: 'operation',
        value: ['get_flag', 'toggle_flag', 'delete_flag', 'update_flag', 'get_flag_status'],
      },
    },

    {
      id: 'environmentKey',
      title: 'Environment Key',
      type: 'short-input',
      placeholder: 'production',
      condition: {
        field: 'operation',
        value: ['list_flags', 'get_flag', 'toggle_flag', 'get_flag_status', 'list_segments'],
      },
      required: {
        field: 'operation',
        value: ['toggle_flag', 'get_flag_status', 'list_segments'],
      },
    },

    {
      id: 'enabled',
      title: 'Enable Flag',
      type: 'dropdown',
      options: [
        { label: 'On', id: 'true' },
        { label: 'Off', id: 'false' },
      ],
      value: () => 'true',
      condition: { field: 'operation', value: 'toggle_flag' },
    },

    {
      id: 'flagName',
      title: 'Flag Name',
      type: 'short-input',
      placeholder: 'My Feature Flag',
      condition: { field: 'operation', value: 'create_flag' },
      required: { field: 'operation', value: 'create_flag' },
    },
    {
      id: 'newFlagKey',
      title: 'Flag Key',
      type: 'short-input',
      placeholder: 'my-feature-flag',
      condition: { field: 'operation', value: 'create_flag' },
      required: { field: 'operation', value: 'create_flag' },
    },
    {
      id: 'description',
      title: 'Description',
      type: 'long-input',
      placeholder: 'Description of the feature flag',
      condition: { field: 'operation', value: 'create_flag' },
    },
    {
      id: 'tags',
      title: 'Tags',
      type: 'short-input',
      placeholder: 'tag1, tag2',
      condition: { field: 'operation', value: 'create_flag' },
      mode: 'advanced',
    },
    {
      id: 'temporary',
      title: 'Temporary',
      type: 'dropdown',
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => 'true',
      condition: { field: 'operation', value: 'create_flag' },
      mode: 'advanced',
    },

    {
      id: 'updateName',
      title: 'New Name',
      type: 'short-input',
      placeholder: 'Updated flag name',
      condition: { field: 'operation', value: 'update_flag' },
    },
    {
      id: 'updateDescription',
      title: 'New Description',
      type: 'long-input',
      placeholder: 'Updated description',
      condition: { field: 'operation', value: 'update_flag' },
    },
    {
      id: 'addTags',
      title: 'Add Tags',
      type: 'short-input',
      placeholder: 'tag1, tag2',
      condition: { field: 'operation', value: 'update_flag' },
      mode: 'advanced',
    },
    {
      id: 'removeTags',
      title: 'Remove Tags',
      type: 'short-input',
      placeholder: 'old-tag1, old-tag2',
      condition: { field: 'operation', value: 'update_flag' },
      mode: 'advanced',
    },
    {
      id: 'archive',
      title: 'Archive/Restore',
      type: 'dropdown',
      options: [
        { label: 'No Change', id: '' },
        { label: 'Archive', id: 'true' },
        { label: 'Restore', id: 'false' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'update_flag' },
      mode: 'advanced',
    },
    {
      id: 'comment',
      title: 'Comment',
      type: 'short-input',
      placeholder: 'Reason for update',
      condition: { field: 'operation', value: 'update_flag' },
      mode: 'advanced',
    },

    {
      id: 'spec',
      title: 'Filter',
      type: 'short-input',
      placeholder: 'proj/*:env/*:flag/*',
      condition: { field: 'operation', value: 'get_audit_log' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate a LaunchDarkly audit log resource specifier filter based on the user's description.

Resource specifier format: type/key:type/key:type/key, where each segment narrows the scope.
- All flag changes account-wide: proj/*:env/*:flag/*
- All changes in one project: proj/my-project
- One flag in one environment: proj/my-project:env/production:flag/my-flag
- All flags in an environment: proj/my-project:env/production:flag/*

Return ONLY the resource specifier string - no explanations, no extra text.`,
        placeholder: 'Describe what to filter (e.g. flag changes in production)',
      },
    },

    {
      id: 'tag',
      title: 'Filter by Tag',
      type: 'short-input',
      placeholder: 'tag-name',
      condition: { field: 'operation', value: 'list_flags' },
      mode: 'advanced',
    },

    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '20',
      condition: {
        field: 'operation',
        value: [
          'list_flags',
          'list_projects',
          'list_environments',
          'list_segments',
          'list_members',
          'get_audit_log',
        ],
      },
      mode: 'advanced',
    },
  ],

  tools: {
    access: [
      'launchdarkly_create_flag',
      'launchdarkly_delete_flag',
      'launchdarkly_get_audit_log',
      'launchdarkly_get_flag',
      'launchdarkly_get_flag_status',
      'launchdarkly_list_environments',
      'launchdarkly_list_flags',
      'launchdarkly_list_members',
      'launchdarkly_list_projects',
      'launchdarkly_list_segments',
      'launchdarkly_toggle_flag',
      'launchdarkly_update_flag',
    ],
    config: {
      tool: (params) => {
        const operation = params.operation || 'list_flags'
        return `launchdarkly_${operation}`
      },
      params: (params) => {
        const { operation, flagName, newFlagKey, ...rest } = params

        if (operation === 'create_flag') {
          rest.name = flagName
          rest.key = newFlagKey
        }

        if (operation === 'toggle_flag') {
          rest.enabled = rest.enabled === 'true'
        }

        if (rest.temporary !== undefined) {
          rest.temporary = rest.temporary === 'true'
        }

        if (rest.archive !== undefined) {
          if (rest.archive === 'true') rest.archive = true
          else if (rest.archive === 'false') rest.archive = false
          else rest.archive = undefined
        }

        if (rest.limit) {
          rest.limit = Number(rest.limit)
        }

        return rest
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'LaunchDarkly API key' },
    projectKey: { type: 'string', description: 'Project key' },
    flagKey: { type: 'string', description: 'Feature flag key' },
    environmentKey: { type: 'string', description: 'Environment key' },
    enabled: { type: 'string', description: 'Whether to enable or disable the flag' },
    flagName: { type: 'string', description: 'Human-readable name for the flag' },
    newFlagKey: { type: 'string', description: 'Unique key for the new flag' },
    description: { type: 'string', description: 'Flag description' },
    tags: { type: 'string', description: 'Comma-separated tags' },
    temporary: { type: 'string', description: 'Whether the flag is temporary' },
    updateName: { type: 'string', description: 'New name for update operation' },
    updateDescription: { type: 'string', description: 'New description for update operation' },
    addTags: { type: 'string', description: 'Comma-separated tags to add' },
    removeTags: { type: 'string', description: 'Comma-separated tags to remove' },
    archive: { type: 'string', description: 'Archive or restore flag' },
    comment: { type: 'string', description: 'Comment for the update' },
    spec: { type: 'string', description: 'Audit log filter expression' },
    tag: { type: 'string', description: 'Filter flags by tag' },
    limit: { type: 'string', description: 'Maximum number of results' },
  },

  outputs: {
    flags: { type: 'json', description: 'List of feature flags' },
    totalCount: { type: 'number', description: 'Total number of results' },
    key: { type: 'string', description: 'Feature flag key' },
    name: { type: 'string', description: 'Feature flag or status name' },
    kind: { type: 'string', description: 'Flag type (boolean or multivariate)' },
    description: { type: 'string', description: 'Flag description' },
    temporary: { type: 'boolean', description: 'Whether the flag is temporary' },
    archived: { type: 'boolean', description: 'Whether the flag is archived' },
    deprecated: { type: 'boolean', description: 'Whether the flag is deprecated' },
    creationDate: { type: 'number', description: 'Unix timestamp (ms) when the flag was created' },
    tags: { type: 'json', description: 'Tags applied to the flag' },
    variations: { type: 'json', description: 'Flag variations ([{value, name, description}])' },
    maintainerId: { type: 'string', description: 'ID of the member who maintains the flag' },
    maintainerEmail: { type: 'string', description: 'Email of the member who maintains the flag' },
    on: { type: 'boolean', description: 'Whether the flag is on in the environment' },
    deleted: { type: 'boolean', description: 'Whether the flag was deleted' },
    projects: { type: 'json', description: 'List of projects' },
    environments: { type: 'json', description: 'List of environments' },
    segments: { type: 'json', description: 'List of segments' },
    members: { type: 'json', description: 'List of members' },
    entries: { type: 'json', description: 'List of audit log entries' },
    lastRequested: { type: 'string', description: 'Last time the flag was evaluated' },
    defaultVal: { type: 'string', description: 'The default variation value from flag status' },
  },
}

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
