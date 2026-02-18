import { VercelIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'

export const VercelBlock: BlockConfig = {
  type: 'vercel',
  name: 'Vercel',
  description: 'Manage Vercel deployments, projects, and infrastructure',
  longDescription:
    'Integrate with Vercel to manage deployments, projects, domains, DNS records, environment variables, aliases, edge configs, teams, and more.',
  docsLink: 'https://docs.sim.ai/tools/vercel',
  category: 'tools',
  bgColor: '#171717',
  icon: VercelIcon,
  authMode: AuthMode.ApiKey,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        // Deployments
        { label: 'List Deployments', id: 'list_deployments' },
        { label: 'Get Deployment', id: 'get_deployment' },
        { label: 'Create Deployment', id: 'create_deployment' },
        { label: 'Cancel Deployment', id: 'cancel_deployment' },
        { label: 'Delete Deployment', id: 'delete_deployment' },
        { label: 'Get Deployment Logs', id: 'get_deployment_events' },
        { label: 'List Deployment Files', id: 'list_deployment_files' },
        // Projects
        { label: 'List Projects', id: 'list_projects' },
        { label: 'Get Project', id: 'get_project' },
        { label: 'Create Project', id: 'create_project' },
        { label: 'Update Project', id: 'update_project' },
        { label: 'Delete Project', id: 'delete_project' },
        { label: 'Pause Project', id: 'pause_project' },
        { label: 'Unpause Project', id: 'unpause_project' },
        // Project Domains
        { label: 'List Project Domains', id: 'list_project_domains' },
        { label: 'Add Project Domain', id: 'add_project_domain' },
        { label: 'Remove Project Domain', id: 'remove_project_domain' },
        // Environment Variables
        { label: 'Get Environment Variables', id: 'get_env_vars' },
        { label: 'Create Environment Variable', id: 'create_env_var' },
        { label: 'Update Environment Variable', id: 'update_env_var' },
        { label: 'Delete Environment Variable', id: 'delete_env_var' },
        // Domains
        { label: 'List Domains', id: 'list_domains' },
        { label: 'Get Domain', id: 'get_domain' },
        { label: 'Add Domain', id: 'add_domain' },
        { label: 'Delete Domain', id: 'delete_domain' },
        { label: 'Get Domain Config', id: 'get_domain_config' },
        // DNS
        { label: 'List DNS Records', id: 'list_dns_records' },
        { label: 'Create DNS Record', id: 'create_dns_record' },
        { label: 'Delete DNS Record', id: 'delete_dns_record' },
        // Aliases
        { label: 'List Aliases', id: 'list_aliases' },
        { label: 'Get Alias', id: 'get_alias' },
        { label: 'Create Alias', id: 'create_alias' },
        { label: 'Delete Alias', id: 'delete_alias' },
        // Edge Config
        { label: 'List Edge Configs', id: 'list_edge_configs' },
        { label: 'Get Edge Config', id: 'get_edge_config' },
        { label: 'Create Edge Config', id: 'create_edge_config' },
        { label: 'Get Edge Config Items', id: 'get_edge_config_items' },
        { label: 'Update Edge Config Items', id: 'update_edge_config_items' },
        // Teams & User
        { label: 'List Teams', id: 'list_teams' },
        { label: 'Get Team', id: 'get_team' },
        { label: 'List Team Members', id: 'list_team_members' },
        { label: 'Get User', id: 'get_user' },
      ],
      value: () => 'list_deployments',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter Vercel Access Token',
      required: true,
      password: true,
    },

    // === Deployment fields ===
    {
      id: 'projectId',
      title: 'Project ID',
      type: 'short-input',
      placeholder: 'Filter by project ID or name (optional)',
      condition: { field: 'operation', value: 'list_deployments' },
    },
    {
      id: 'target',
      title: 'Target',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'Production', id: 'production' },
        { label: 'Staging', id: 'staging' },
      ],
      condition: { field: 'operation', value: 'list_deployments' },
    },
    {
      id: 'state',
      title: 'State',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'Ready', id: 'READY' },
        { label: 'Building', id: 'BUILDING' },
        { label: 'Error', id: 'ERROR' },
        { label: 'Queued', id: 'QUEUED' },
        { label: 'Canceled', id: 'CANCELED' },
      ],
      condition: { field: 'operation', value: 'list_deployments' },
    },
    {
      id: 'deploymentId',
      title: 'Deployment ID',
      type: 'short-input',
      placeholder: 'Enter deployment ID or hostname',
      condition: {
        field: 'operation',
        value: [
          'get_deployment',
          'cancel_deployment',
          'delete_deployment',
          'get_deployment_events',
          'list_deployment_files',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'get_deployment',
          'cancel_deployment',
          'delete_deployment',
          'get_deployment_events',
          'list_deployment_files',
        ],
      },
    },
    // Create Deployment
    {
      id: 'name',
      title: 'Project Name',
      type: 'short-input',
      placeholder: 'Project name for the deployment',
      condition: { field: 'operation', value: 'create_deployment' },
      required: { field: 'operation', value: 'create_deployment' },
    },
    {
      id: 'project',
      title: 'Project ID',
      type: 'short-input',
      placeholder: 'Project ID (optional, overrides name)',
      condition: { field: 'operation', value: 'create_deployment' },
    },
    {
      id: 'redeployId',
      title: 'Redeploy From',
      type: 'short-input',
      placeholder: 'Existing deployment ID to redeploy (optional)',
      condition: { field: 'operation', value: 'create_deployment' },
    },
    {
      id: 'deployTarget',
      title: 'Target',
      type: 'dropdown',
      options: [
        { label: 'Preview', id: '' },
        { label: 'Production', id: 'production' },
        { label: 'Staging', id: 'staging' },
      ],
      condition: { field: 'operation', value: 'create_deployment' },
    },

    // === Project fields ===
    {
      id: 'search',
      title: 'Search',
      type: 'short-input',
      placeholder: 'Search projects by name (optional)',
      condition: { field: 'operation', value: 'list_projects' },
    },
    {
      id: 'projectId',
      title: 'Project ID',
      type: 'short-input',
      placeholder: 'Enter project ID or name',
      condition: {
        field: 'operation',
        value: [
          'get_project',
          'update_project',
          'delete_project',
          'pause_project',
          'unpause_project',
          'list_project_domains',
          'add_project_domain',
          'remove_project_domain',
          'get_env_vars',
          'create_env_var',
          'update_env_var',
          'delete_env_var',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'get_project',
          'update_project',
          'delete_project',
          'pause_project',
          'unpause_project',
          'list_project_domains',
          'add_project_domain',
          'remove_project_domain',
          'get_env_vars',
          'create_env_var',
          'update_env_var',
          'delete_env_var',
        ],
      },
    },
    // Create Project
    {
      id: 'projectName',
      title: 'Project Name',
      type: 'short-input',
      placeholder: 'Name for the new project',
      condition: { field: 'operation', value: 'create_project' },
      required: { field: 'operation', value: 'create_project' },
    },
    {
      id: 'framework',
      title: 'Framework',
      type: 'dropdown',
      options: [
        { label: 'Auto-detect', id: '' },
        { label: 'Next.js', id: 'nextjs' },
        { label: 'Remix', id: 'remix' },
        { label: 'Vite', id: 'vite' },
        { label: 'Nuxt', id: 'nuxtjs' },
        { label: 'SvelteKit', id: 'sveltekit' },
        { label: 'Astro', id: 'astro' },
        { label: 'Gatsby', id: 'gatsby' },
        { label: 'Other', id: 'other' },
      ],
      condition: { field: 'operation', value: ['create_project', 'update_project'] },
    },
    {
      id: 'buildCommand',
      title: 'Build Command',
      type: 'short-input',
      placeholder: 'Custom build command (optional)',
      condition: { field: 'operation', value: ['create_project', 'update_project'] },
    },
    {
      id: 'outputDirectory',
      title: 'Output Directory',
      type: 'short-input',
      placeholder: 'Output directory (optional)',
      condition: { field: 'operation', value: ['create_project', 'update_project'] },
    },
    {
      id: 'installCommand',
      title: 'Install Command',
      type: 'short-input',
      placeholder: 'Install command (optional)',
      condition: { field: 'operation', value: ['create_project', 'update_project'] },
    },

    // === Project Domain fields ===
    {
      id: 'domainName',
      title: 'Domain',
      type: 'short-input',
      placeholder: 'Enter domain name (e.g., example.com)',
      condition: {
        field: 'operation',
        value: [
          'add_project_domain',
          'remove_project_domain',
          'get_domain',
          'delete_domain',
          'get_domain_config',
          'list_dns_records',
          'create_dns_record',
          'delete_dns_record',
          'add_domain',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'add_project_domain',
          'remove_project_domain',
          'get_domain',
          'delete_domain',
          'get_domain_config',
          'list_dns_records',
          'create_dns_record',
          'delete_dns_record',
          'add_domain',
        ],
      },
    },

    // === Environment Variable fields ===
    {
      id: 'envId',
      title: 'Env Variable ID',
      type: 'short-input',
      placeholder: 'Environment variable ID',
      condition: { field: 'operation', value: ['update_env_var', 'delete_env_var'] },
      required: { field: 'operation', value: ['update_env_var', 'delete_env_var'] },
    },
    {
      id: 'envKey',
      title: 'Key',
      type: 'short-input',
      placeholder: 'Variable name (e.g., DATABASE_URL)',
      condition: { field: 'operation', value: ['create_env_var', 'update_env_var'] },
      required: { field: 'operation', value: 'create_env_var' },
    },
    {
      id: 'envValue',
      title: 'Value',
      type: 'short-input',
      placeholder: 'Variable value',
      condition: { field: 'operation', value: ['create_env_var', 'update_env_var'] },
      required: { field: 'operation', value: 'create_env_var' },
    },
    {
      id: 'envTarget',
      title: 'Target Environments',
      type: 'short-input',
      placeholder: 'production,preview,development',
      condition: { field: 'operation', value: ['create_env_var', 'update_env_var'] },
      required: { field: 'operation', value: 'create_env_var' },
    },
    {
      id: 'envType',
      title: 'Variable Type',
      type: 'dropdown',
      options: [
        { label: 'Plain', id: 'plain' },
        { label: 'Secret', id: 'secret' },
        { label: 'Encrypted', id: 'encrypted' },
        { label: 'Sensitive', id: 'sensitive' },
      ],
      condition: { field: 'operation', value: ['create_env_var', 'update_env_var'] },
    },

    // === DNS fields ===
    {
      id: 'recordName',
      title: 'Record Name',
      type: 'short-input',
      placeholder: 'Subdomain (e.g., www)',
      condition: { field: 'operation', value: 'create_dns_record' },
      required: { field: 'operation', value: 'create_dns_record' },
    },
    {
      id: 'recordType',
      title: 'Record Type',
      type: 'dropdown',
      options: [
        { label: 'A', id: 'A' },
        { label: 'AAAA', id: 'AAAA' },
        { label: 'CNAME', id: 'CNAME' },
        { label: 'TXT', id: 'TXT' },
        { label: 'MX', id: 'MX' },
        { label: 'NS', id: 'NS' },
        { label: 'ALIAS', id: 'ALIAS' },
        { label: 'SRV', id: 'SRV' },
        { label: 'CAA', id: 'CAA' },
      ],
      condition: { field: 'operation', value: 'create_dns_record' },
      required: { field: 'operation', value: 'create_dns_record' },
    },
    {
      id: 'recordValue',
      title: 'Value',
      type: 'short-input',
      placeholder: 'Record value (e.g., IP address)',
      condition: { field: 'operation', value: 'create_dns_record' },
      required: { field: 'operation', value: 'create_dns_record' },
    },
    {
      id: 'recordId',
      title: 'Record ID',
      type: 'short-input',
      placeholder: 'DNS record ID',
      condition: { field: 'operation', value: 'delete_dns_record' },
      required: { field: 'operation', value: 'delete_dns_record' },
    },

    // === Alias fields ===
    {
      id: 'aliasId',
      title: 'Alias ID',
      type: 'short-input',
      placeholder: 'Alias ID or hostname',
      condition: { field: 'operation', value: ['get_alias', 'delete_alias'] },
      required: { field: 'operation', value: ['get_alias', 'delete_alias'] },
    },
    {
      id: 'aliasDeploymentId',
      title: 'Deployment ID',
      type: 'short-input',
      placeholder: 'Deployment ID to assign alias to',
      condition: { field: 'operation', value: 'create_alias' },
      required: { field: 'operation', value: 'create_alias' },
    },
    {
      id: 'aliasName',
      title: 'Alias',
      type: 'short-input',
      placeholder: 'Domain or subdomain to assign (e.g., my-app.vercel.app)',
      condition: { field: 'operation', value: 'create_alias' },
      required: { field: 'operation', value: 'create_alias' },
    },

    // === Edge Config fields ===
    {
      id: 'edgeConfigId',
      title: 'Edge Config ID',
      type: 'short-input',
      placeholder: 'Edge Config ID',
      condition: {
        field: 'operation',
        value: ['get_edge_config', 'get_edge_config_items', 'update_edge_config_items'],
      },
      required: {
        field: 'operation',
        value: ['get_edge_config', 'get_edge_config_items', 'update_edge_config_items'],
      },
    },
    {
      id: 'edgeConfigSlug',
      title: 'Slug',
      type: 'short-input',
      placeholder: 'Name/slug for the Edge Config',
      condition: { field: 'operation', value: 'create_edge_config' },
      required: { field: 'operation', value: 'create_edge_config' },
    },
    {
      id: 'edgeConfigItems',
      title: 'Items',
      type: 'code',
      placeholder: '[{"operation":"upsert","key":"my-key","value":"my-value"}]',
      condition: { field: 'operation', value: 'update_edge_config_items' },
      required: { field: 'operation', value: 'update_edge_config_items' },
    },

    // === Team fields ===
    {
      id: 'teamIdParam',
      title: 'Team ID',
      type: 'short-input',
      placeholder: 'Team ID',
      condition: { field: 'operation', value: ['get_team', 'list_team_members'] },
      required: { field: 'operation', value: ['get_team', 'list_team_members'] },
    },
    {
      id: 'memberRole',
      title: 'Role Filter',
      type: 'dropdown',
      options: [
        { label: 'All', id: '' },
        { label: 'Owner', id: 'OWNER' },
        { label: 'Member', id: 'MEMBER' },
        { label: 'Developer', id: 'DEVELOPER' },
        { label: 'Viewer', id: 'VIEWER' },
        { label: 'Billing', id: 'BILLING' },
      ],
      condition: { field: 'operation', value: 'list_team_members' },
    },

    // === Shared optional Team ID (for scoping requests) ===
    {
      id: 'teamId',
      title: 'Team ID (Scope)',
      type: 'short-input',
      placeholder: 'Team ID to scope request (optional)',
      condition: {
        field: 'operation',
        value: ['get_team', 'list_team_members', 'get_user'],
        not: true,
      },
    },
  ],
  tools: {
    access: [
      // Deployments
      'vercel_list_deployments',
      'vercel_get_deployment',
      'vercel_create_deployment',
      'vercel_cancel_deployment',
      'vercel_delete_deployment',
      'vercel_get_deployment_events',
      'vercel_list_deployment_files',
      // Projects
      'vercel_list_projects',
      'vercel_get_project',
      'vercel_create_project',
      'vercel_update_project',
      'vercel_delete_project',
      'vercel_pause_project',
      'vercel_unpause_project',
      'vercel_list_project_domains',
      'vercel_add_project_domain',
      'vercel_remove_project_domain',
      // Environment Variables
      'vercel_get_env_vars',
      'vercel_create_env_var',
      'vercel_update_env_var',
      'vercel_delete_env_var',
      // Domains
      'vercel_list_domains',
      'vercel_get_domain',
      'vercel_add_domain',
      'vercel_delete_domain',
      'vercel_get_domain_config',
      // DNS
      'vercel_list_dns_records',
      'vercel_create_dns_record',
      'vercel_delete_dns_record',
      // Aliases
      'vercel_list_aliases',
      'vercel_get_alias',
      'vercel_create_alias',
      'vercel_delete_alias',
      // Edge Config
      'vercel_list_edge_configs',
      'vercel_get_edge_config',
      'vercel_create_edge_config',
      'vercel_get_edge_config_items',
      'vercel_update_edge_config_items',
      // Teams & User
      'vercel_list_teams',
      'vercel_get_team',
      'vercel_list_team_members',
      'vercel_get_user',
    ],
    config: {
      tool: (params) => `vercel_${params.operation}`,
      params: (params) => {
        const {
          apiKey,
          operation,
          redeployId,
          deployTarget,
          projectName,
          domainName,
          envKey,
          envValue,
          envTarget,
          envType,
          recordName,
          recordType,
          recordValue,
          recordId,
          aliasId,
          aliasDeploymentId,
          aliasName,
          edgeConfigId,
          edgeConfigSlug,
          edgeConfigItems,
          teamIdParam,
          memberRole,
          ...rest
        } = params

        const base = { ...rest, apiKey }

        switch (operation) {
          case 'create_deployment':
            return {
              ...base,
              ...(redeployId ? { deploymentId: redeployId } : {}),
              ...(deployTarget ? { target: deployTarget } : {}),
            }
          case 'create_project':
            return { ...base, name: projectName }
          case 'update_project':
            return base
          case 'add_project_domain':
          case 'remove_project_domain':
            return { ...base, domain: domainName }
          case 'get_domain':
          case 'delete_domain':
          case 'get_domain_config':
            return { ...base, domain: domainName }
          case 'add_domain':
            return { ...base, name: domainName }
          case 'list_dns_records':
            return { ...base, domain: domainName }
          case 'create_dns_record':
            return { ...base, domain: domainName, recordName, recordType, value: recordValue }
          case 'delete_dns_record':
            return { ...base, domain: domainName, recordId }
          case 'create_env_var':
            return { ...base, key: envKey, value: envValue, target: envTarget, type: envType }
          case 'update_env_var':
            return {
              ...base,
              ...(envKey ? { key: envKey } : {}),
              ...(envValue ? { value: envValue } : {}),
              ...(envTarget ? { target: envTarget } : {}),
              ...(envType ? { type: envType } : {}),
            }
          case 'get_alias':
          case 'delete_alias':
            return { ...base, aliasId }
          case 'create_alias':
            return { ...base, deploymentId: aliasDeploymentId, alias: aliasName }
          case 'get_edge_config':
          case 'get_edge_config_items':
            return { ...base, edgeConfigId }
          case 'create_edge_config':
            return { ...base, slug: edgeConfigSlug }
          case 'update_edge_config_items':
            return { ...base, edgeConfigId, items: edgeConfigItems }
          case 'get_team':
            return { ...base, teamId: teamIdParam }
          case 'list_team_members':
            return { ...base, teamId: teamIdParam, ...(memberRole ? { role: memberRole } : {}) }
          default:
            return base
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Vercel access token' },
    projectId: { type: 'string', description: 'Project ID or name' },
    deploymentId: { type: 'string', description: 'Deployment ID or hostname' },
    name: { type: 'string', description: 'Project name' },
    projectName: { type: 'string', description: 'New project name' },
    project: { type: 'string', description: 'Project ID override' },
    redeployId: { type: 'string', description: 'Deployment ID to redeploy' },
    target: { type: 'string', description: 'Target environment filter' },
    deployTarget: { type: 'string', description: 'Deployment target environment' },
    state: { type: 'string', description: 'Deployment state filter' },
    search: { type: 'string', description: 'Project search query' },
    framework: { type: 'string', description: 'Project framework' },
    buildCommand: { type: 'string', description: 'Build command' },
    outputDirectory: { type: 'string', description: 'Output directory' },
    installCommand: { type: 'string', description: 'Install command' },
    domainName: { type: 'string', description: 'Domain name' },
    envId: { type: 'string', description: 'Environment variable ID' },
    envKey: { type: 'string', description: 'Environment variable key' },
    envValue: { type: 'string', description: 'Environment variable value' },
    envTarget: { type: 'string', description: 'Target environments' },
    envType: { type: 'string', description: 'Variable type' },
    recordName: { type: 'string', description: 'DNS record name' },
    recordType: { type: 'string', description: 'DNS record type' },
    recordValue: { type: 'string', description: 'DNS record value' },
    recordId: { type: 'string', description: 'DNS record ID' },
    aliasId: { type: 'string', description: 'Alias ID' },
    aliasDeploymentId: { type: 'string', description: 'Deployment ID for alias' },
    aliasName: { type: 'string', description: 'Alias domain' },
    edgeConfigId: { type: 'string', description: 'Edge Config ID' },
    edgeConfigSlug: { type: 'string', description: 'Edge Config slug' },
    edgeConfigItems: { type: 'string', description: 'Edge Config items JSON' },
    teamId: { type: 'string', description: 'Team ID for scoping' },
    teamIdParam: { type: 'string', description: 'Team ID parameter' },
    memberRole: { type: 'string', description: 'Team member role filter' },
  },
  outputs: {
    // List results
    deployments: {
      type: 'array',
      description: 'List of deployments',
      condition: { field: 'operation', value: 'list_deployments' },
    },
    projects: {
      type: 'array',
      description: 'List of projects',
      condition: { field: 'operation', value: 'list_projects' },
    },
    domains: {
      type: 'array',
      description: 'List of domains',
      condition: {
        field: 'operation',
        value: ['list_domains', 'list_project_domains'],
      },
    },
    envs: {
      type: 'array',
      description: 'List of environment variables',
      condition: { field: 'operation', value: 'get_env_vars' },
    },
    records: {
      type: 'array',
      description: 'List of DNS records',
      condition: { field: 'operation', value: 'list_dns_records' },
    },
    aliases: {
      type: 'array',
      description: 'List of aliases',
      condition: { field: 'operation', value: 'list_aliases' },
    },
    edgeConfigs: {
      type: 'array',
      description: 'List of edge configs',
      condition: { field: 'operation', value: 'list_edge_configs' },
    },
    items: {
      type: 'array',
      description: 'Edge config items',
      condition: { field: 'operation', value: 'get_edge_config_items' },
    },
    teams: {
      type: 'array',
      description: 'List of teams',
      condition: { field: 'operation', value: 'list_teams' },
    },
    members: {
      type: 'array',
      description: 'List of team members',
      condition: { field: 'operation', value: 'list_team_members' },
    },
    events: {
      type: 'array',
      description: 'Deployment build log events',
      condition: { field: 'operation', value: 'get_deployment_events' },
    },
    files: {
      type: 'array',
      description: 'Deployment file tree',
      condition: { field: 'operation', value: 'list_deployment_files' },
    },
    // Single resource outputs
    id: {
      type: 'string',
      description: 'Resource ID',
    },
    name: {
      type: 'string',
      description: 'Resource name',
    },
    url: {
      type: 'string',
      description: 'Deployment URL',
      condition: {
        field: 'operation',
        value: ['get_deployment', 'create_deployment', 'cancel_deployment'],
      },
    },
    state: {
      type: 'string',
      description: 'Deployment state',
      condition: {
        field: 'operation',
        value: ['get_deployment', 'create_deployment', 'cancel_deployment', 'delete_deployment'],
      },
    },
    deleted: {
      type: 'boolean',
      description: 'Whether the resource was deleted',
      condition: {
        field: 'operation',
        value: [
          'delete_deployment',
          'delete_project',
          'remove_project_domain',
          'delete_domain',
          'delete_dns_record',
          'delete_alias',
          'delete_env_var',
        ],
      },
    },
    count: {
      type: 'number',
      description: 'Number of items returned',
    },
    hasMore: {
      type: 'boolean',
      description: 'Whether more results are available',
    },
  },
}
