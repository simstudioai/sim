import { NetlifyIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { getTrigger } from '@/triggers'

export const NetlifyBlock: BlockConfig = {
  type: 'netlify',
  name: 'Netlify',
  description: 'Manage Netlify sites, deploys, and environment variables',
  longDescription:
    'Trigger and inspect Netlify deploys (builds), and manage account or site-scoped environment variables. Generate a Personal Access Token at https://app.netlify.com/user/applications#personal-access-tokens.',
  docsLink: 'https://docs.sim.ai/tools/netlify',
  category: 'tools',
  integrationType: IntegrationType.DeveloperTools,
  tags: ['cloud', 'ci-cd'],
  bgColor: '#00C7B7',
  icon: NetlifyIcon,
  authMode: AuthMode.ApiKey,
  triggers: {
    enabled: true,
    available: [
      'netlify_deploy_created',
      'netlify_deploy_building',
      'netlify_deploy_succeeded',
      'netlify_deploy_failed',
      'netlify_deploy_locked',
      'netlify_deploy_unlocked',
    ],
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        // Sites
        { label: 'List Sites', id: 'list_sites' },
        // Deploys
        { label: 'List Deploys', id: 'list_deploys' },
        { label: 'Get Deploy', id: 'get_deploy' },
        { label: 'Create Deploy', id: 'create_deploy' },
        { label: 'Cancel Deploy', id: 'cancel_deploy' },
        // Environment Variables
        { label: 'List Environment Variables', id: 'list_env_vars' },
        { label: 'Create Environment Variable', id: 'create_env_var' },
        { label: 'Update Environment Variable', id: 'update_env_var' },
        { label: 'Delete Environment Variable', id: 'delete_env_var' },
      ],
      value: () => 'list_sites',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter Netlify Personal Access Token',
      required: true,
      password: true,
    },
    {
      id: 'setupInstructions',
      title: 'Setup Instructions',
      type: 'text',
      hideFromPreview: true,
      defaultValue: [
        'Sign in to <a href="https://app.netlify.com" target="_blank" rel="noreferrer">Netlify</a>.',
        'Open <strong>User settings → Applications → Personal access tokens</strong> (<a href="https://app.netlify.com/user/applications#personal-access-tokens" target="_blank" rel="noreferrer">direct link</a>).',
        'Click <strong>"New access token"</strong>, give it a description, and choose an expiration.',
        'Copy the token and paste it into the <strong>API Key</strong> field above.',
      ]
        .map(
          (instruction, index) =>
            `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
        )
        .join(''),
    },

    // === Sites filters ===
    {
      id: 'siteName',
      title: 'Name Filter',
      type: 'short-input',
      placeholder: 'Filter sites by name (optional)',
      condition: { field: 'operation', value: 'list_sites' },
      mode: 'advanced',
    },
    {
      id: 'sitesFilter',
      title: 'Scope',
      type: 'dropdown',
      options: [
        { label: 'All', id: 'all' },
        { label: 'Owner', id: 'owner' },
        { label: 'Guest', id: 'guest' },
      ],
      condition: { field: 'operation', value: 'list_sites' },
      mode: 'advanced',
    },

    // === Deploy fields ===
    {
      id: 'siteId',
      title: 'Site ID',
      type: 'short-input',
      placeholder: 'Site ID or primary domain',
      condition: { field: 'operation', value: ['list_deploys', 'create_deploy'] },
      required: { field: 'operation', value: ['list_deploys', 'create_deploy'] },
    },
    {
      id: 'deployId',
      title: 'Deploy ID',
      type: 'short-input',
      placeholder: 'Deploy ID',
      condition: { field: 'operation', value: ['get_deploy', 'cancel_deploy'] },
      required: { field: 'operation', value: ['get_deploy', 'cancel_deploy'] },
    },
    {
      id: 'branchFilter',
      title: 'Branch Filter',
      type: 'short-input',
      placeholder: 'Filter by branch (optional)',
      condition: { field: 'operation', value: 'list_deploys' },
      mode: 'advanced',
    },
    {
      id: 'stateFilter',
      title: 'State Filter',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'Ready', id: 'ready' },
        { label: 'Building', id: 'building' },
        { label: 'Enqueued', id: 'enqueued' },
        { label: 'Processing', id: 'processing' },
        { label: 'Uploading', id: 'uploading' },
        { label: 'Error', id: 'error' },
        { label: 'New', id: 'new' },
      ],
      condition: { field: 'operation', value: 'list_deploys' },
      mode: 'advanced',
    },
    {
      id: 'productionFilter',
      title: 'Production Only',
      type: 'dropdown',
      options: [
        { label: 'Any', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      condition: { field: 'operation', value: 'list_deploys' },
      mode: 'advanced',
    },
    {
      id: 'deployBranch',
      title: 'Branch',
      type: 'short-input',
      placeholder: 'Git branch to deploy (defaults to production branch)',
      condition: { field: 'operation', value: 'create_deploy' },
    },
    {
      id: 'deployTitle',
      title: 'Title',
      type: 'short-input',
      placeholder: 'Deploy label shown in logs (optional)',
      condition: { field: 'operation', value: 'create_deploy' },
      mode: 'advanced',
    },
    {
      id: 'clearCache',
      title: 'Clear Cache',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      condition: { field: 'operation', value: 'create_deploy' },
      mode: 'advanced',
    },

    // === Env var fields ===
    {
      id: 'accountId',
      title: 'Account ID',
      type: 'short-input',
      placeholder: 'Account ID or slug',
      condition: {
        field: 'operation',
        value: ['list_env_vars', 'create_env_var', 'update_env_var', 'delete_env_var'],
      },
      required: {
        field: 'operation',
        value: ['list_env_vars', 'create_env_var', 'update_env_var', 'delete_env_var'],
      },
    },
    {
      id: 'envSiteId',
      title: 'Site ID',
      type: 'short-input',
      placeholder: 'Optional site ID (omit for account-level)',
      condition: {
        field: 'operation',
        value: ['list_env_vars', 'create_env_var', 'update_env_var', 'delete_env_var'],
      },
      mode: 'advanced',
    },
    {
      id: 'envKey',
      title: 'Key',
      type: 'short-input',
      placeholder: 'Variable name (e.g., DATABASE_URL)',
      condition: {
        field: 'operation',
        value: ['create_env_var', 'update_env_var', 'delete_env_var'],
      },
      required: {
        field: 'operation',
        value: ['create_env_var', 'update_env_var', 'delete_env_var'],
      },
    },
    {
      id: 'envValue',
      title: 'Value',
      type: 'short-input',
      placeholder: 'Variable value',
      condition: { field: 'operation', value: ['create_env_var', 'update_env_var'] },
      required: { field: 'operation', value: ['create_env_var', 'update_env_var'] },
    },
    {
      id: 'envContext',
      title: 'Context',
      type: 'dropdown',
      options: [
        { label: 'All Contexts', id: 'all' },
        { label: 'Production', id: 'production' },
        { label: 'Deploy Preview', id: 'deploy-preview' },
        { label: 'Branch Deploy', id: 'branch-deploy' },
        { label: 'Dev', id: 'dev' },
      ],
      condition: { field: 'operation', value: ['create_env_var', 'update_env_var'] },
      mode: 'advanced',
    },
    {
      id: 'envScopes',
      title: 'Scopes',
      type: 'short-input',
      placeholder: 'builds,functions,runtime,post_processing',
      condition: { field: 'operation', value: ['create_env_var', 'update_env_var'] },
      mode: 'advanced',
    },
    {
      id: 'envIsSecret',
      title: 'Secret',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      condition: { field: 'operation', value: ['create_env_var', 'update_env_var'] },
      mode: 'advanced',
    },

    // === Trigger subBlocks ===
    ...getTrigger('netlify_deploy_created').subBlocks,
    ...getTrigger('netlify_deploy_building').subBlocks,
    ...getTrigger('netlify_deploy_succeeded').subBlocks,
    ...getTrigger('netlify_deploy_failed').subBlocks,
    ...getTrigger('netlify_deploy_locked').subBlocks,
    ...getTrigger('netlify_deploy_unlocked').subBlocks,
  ],
  tools: {
    access: [
      'netlify_list_sites',
      'netlify_list_deploys',
      'netlify_get_deploy',
      'netlify_create_deploy',
      'netlify_cancel_deploy',
      'netlify_list_env_vars',
      'netlify_create_env_var',
      'netlify_update_env_var',
      'netlify_delete_env_var',
    ],
    config: {
      tool: (params) => `netlify_${params.operation}`,
      params: (params) => {
        const {
          apiKey,
          operation,
          siteName,
          sitesFilter,
          branchFilter,
          stateFilter,
          productionFilter,
          deployBranch,
          deployTitle,
          clearCache,
          envSiteId,
          envKey,
          envValue,
          envContext,
          envScopes,
          envIsSecret,
          ...rest
        } = params

        const base = { ...rest, apiKey }

        switch (operation) {
          case 'list_sites':
            return {
              ...base,
              ...(siteName ? { name: siteName } : {}),
              ...(sitesFilter ? { filter: sitesFilter } : {}),
            }
          case 'list_deploys':
            return {
              ...base,
              ...(branchFilter ? { branch: branchFilter } : {}),
              ...(stateFilter ? { state: stateFilter } : {}),
              ...(productionFilter ? { production: productionFilter } : {}),
            }
          case 'create_deploy':
            return {
              ...base,
              ...(deployBranch ? { branch: deployBranch } : {}),
              ...(deployTitle ? { title: deployTitle } : {}),
              ...(clearCache ? { clearCache } : {}),
            }
          case 'list_env_vars':
            return {
              ...base,
              ...(envSiteId ? { siteId: envSiteId } : {}),
            }
          case 'create_env_var':
          case 'update_env_var':
            return {
              ...base,
              ...(envSiteId ? { siteId: envSiteId } : {}),
              key: envKey,
              value: envValue,
              ...(envContext ? { context: envContext } : {}),
              ...(envScopes ? { scopes: envScopes } : {}),
              ...(envIsSecret ? { isSecret: envIsSecret } : {}),
            }
          case 'delete_env_var':
            return {
              ...base,
              ...(envSiteId ? { siteId: envSiteId } : {}),
              key: envKey,
            }
          default:
            return base
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Netlify Personal Access Token' },
    siteId: { type: 'string', description: 'Site ID or primary domain' },
    siteName: { type: 'string', description: 'Site name filter' },
    sitesFilter: { type: 'string', description: 'Site scope filter' },
    deployId: { type: 'string', description: 'Deploy ID' },
    branchFilter: { type: 'string', description: 'Branch filter for list deploys' },
    stateFilter: { type: 'string', description: 'State filter for list deploys' },
    productionFilter: { type: 'string', description: 'Production-only filter for list deploys' },
    deployBranch: { type: 'string', description: 'Branch to build for create deploy' },
    deployTitle: { type: 'string', description: 'Deploy title shown in logs' },
    clearCache: { type: 'string', description: 'Clear build cache before deploying' },
    accountId: { type: 'string', description: 'Account ID or slug' },
    envSiteId: { type: 'string', description: 'Site ID scope for env var operations' },
    envKey: { type: 'string', description: 'Environment variable key' },
    envValue: { type: 'string', description: 'Environment variable value' },
    envContext: { type: 'string', description: 'Deploy context for the value' },
    envScopes: { type: 'string', description: 'Comma-separated scopes' },
    envIsSecret: { type: 'string', description: 'Mark the value as secret' },
  },
  outputs: {
    sites: {
      type: 'array',
      description: 'List of sites',
      condition: { field: 'operation', value: 'list_sites' },
    },
    deploys: {
      type: 'array',
      description: 'List of deploys',
      condition: { field: 'operation', value: 'list_deploys' },
    },
    envVars: {
      type: 'array',
      description: 'List of environment variables',
      condition: { field: 'operation', value: 'list_env_vars' },
    },
    envVar: {
      type: 'json',
      description: 'Environment variable',
      condition: { field: 'operation', value: ['create_env_var', 'update_env_var'] },
    },
    id: {
      type: 'string',
      description: 'Resource ID',
      condition: {
        field: 'operation',
        value: ['get_deploy', 'cancel_deploy', 'create_deploy'],
      },
    },
    state: {
      type: 'string',
      description: 'Deploy state',
      condition: { field: 'operation', value: ['get_deploy', 'cancel_deploy'] },
    },
    deployUrl: {
      type: 'string',
      description: 'Unique deploy URL',
      condition: { field: 'operation', value: ['get_deploy', 'cancel_deploy'] },
    },
    deployId: {
      type: 'string',
      description: 'Deploy ID produced by a build',
      condition: { field: 'operation', value: 'create_deploy' },
    },
    deleted: {
      type: 'boolean',
      description: 'Whether the resource was deleted',
      condition: { field: 'operation', value: 'delete_env_var' },
    },
    count: { type: 'number', description: 'Number of items returned' },
  },
}
