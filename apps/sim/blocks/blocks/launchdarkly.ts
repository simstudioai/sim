import { LaunchDarklyIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'

export const LaunchDarklyBlock: BlockConfig = {
  type: 'launchdarkly',
  name: 'LaunchDarkly',
  description: 'Manage feature flags with LaunchDarkly.',
  longDescription:
    'Integrate LaunchDarkly into your workflow. List, create, update, toggle, and delete feature flags. Manage projects, environments, segments, members, and audit logs. Requires API Key.',
  docsLink: 'https://docs.sim.ai/tools/launchdarkly',
  category: 'tools',
  integrationType: IntegrationType.DeveloperTools,
  tags: ['feature-flags', 'ci-cd'],
  bgColor: '#191919',
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

    // Project key — needed for all except list_projects, list_members, get_audit_log
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

    // Flag key — needed for get_flag, toggle_flag, delete_flag, update_flag, get_flag_status
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

    // Environment key — optional for list_flags/get_flag, required for toggle_flag/get_flag_status/list_segments
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

    // Enabled toggle — for toggle_flag only
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

    // Create flag fields
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

    // Update flag fields
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

    // Audit log filter
    {
      id: 'spec',
      title: 'Filter',
      type: 'short-input',
      placeholder: 'resourceType:flag',
      condition: { field: 'operation', value: 'get_audit_log' },
      mode: 'advanced',
    },

    // Tag filter for list_flags
    {
      id: 'tag',
      title: 'Filter by Tag',
      type: 'short-input',
      placeholder: 'tag-name',
      condition: { field: 'operation', value: 'list_flags' },
      mode: 'advanced',
    },

    // Limit — for list operations and audit log
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
    on: { type: 'boolean', description: 'Whether the flag is on in the environment' },
    deleted: { type: 'boolean', description: 'Whether the flag was deleted' },
    projects: { type: 'json', description: 'List of projects' },
    environments: { type: 'json', description: 'List of environments' },
    segments: { type: 'json', description: 'List of segments' },
    members: { type: 'json', description: 'List of members' },
    entries: { type: 'json', description: 'List of audit log entries' },
    lastRequested: { type: 'string', description: 'Last time the flag was evaluated' },
  },
}
