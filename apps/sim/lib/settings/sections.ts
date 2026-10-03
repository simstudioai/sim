import type { MothershipSettingsScope } from '@/lib/api/contracts/mothership-settings'

export interface SettingsSection {
  id: string
  label: string
  uiSection?: string
  cli?: string[]
  userSetup?: string
}

/** Navigation hints are not grants. Each selected operation rechecks its actual role and entitlement. */
export const settingsSections: Record<MothershipSettingsScope, readonly SettingsSection[]> = {
  account: [
    { id: 'profile', label: 'Profile', uiSection: 'general' },
    { id: 'preferences', label: 'Preferences', uiSection: 'general' },
    {
      id: 'billing',
      label: 'Subscription and payments',
      uiSection: 'billing',
      cli: ['billing status', 'billing logs'],
      userSetup:
        'Spending caps are available here. Subscription and payment changes use the billing UI.',
    },
    {
      id: 'api-keys',
      label: 'Personal API keys',
      uiSection: 'api-keys',
      userSetup: 'Key creation and secure one-time display use the API key UI.',
    },
    {
      id: 'security',
      label: 'Password, authorized apps and account deletion',
      uiSection: 'general',
      userSetup: 'Account security and deletion require the existing authenticated user flow.',
    },
  ],
  organization: [
    { id: 'general', label: 'Organization identity', uiSection: 'members' },
    { id: 'members', label: 'Members and invitations', uiSection: 'members' },
    { id: 'billing', label: 'Organization billing', uiSection: 'billing' },
    { id: 'usage', label: 'Usage tracking', uiSection: 'usage' },
    {
      id: 'byok',
      label: 'Organization provider keys',
      userSetup:
        'Organization provider secrets are configured from an accessible workspace’s BYOK settings by selecting Organization scope. Use settings open for that explicit workspace; there is no separate organization BYOK page.',
    },
    { id: 'whitelabeling', label: 'Branding', uiSection: 'whitelabeling' },
    {
      id: 'audit-logs',
      label: 'Audit logs',
      uiSection: 'audit-logs',
      cli: ['audit-logs list', 'audit-logs get'],
    },
    { id: 'access-control', label: 'Permission groups', uiSection: 'access-control' },
    {
      id: 'sso',
      label: 'Single sign-on and provisioning',
      uiSection: 'sso',
      userSetup:
        'Domain metadata, claims, verification checks and removal are available here. DNS challenges, provider credentials and provisioning tokens use the SSO setup UI.',
    },
    {
      id: 'security',
      label: 'Session policy',
      uiSection: 'security',
      userSetup:
        'Revoking sessions uses the authenticated Settings flow so it can preserve your current browser session.',
    },
    { id: 'data-retention', label: 'Retention policies', uiSection: 'data-retention' },
    {
      id: 'data-drains',
      label: 'Data drains',
      uiSection: 'data-drains',
      userSetup:
        'Create drains and change destination credentials in the secure Settings form. Existing drains support status, scheduling, testing, runs and deletion here.',
    },
    {
      id: 'connected-accounts',
      label: 'Connected account groups',
      uiSection: 'connected-accounts',
    },
    { id: 'integrations', label: 'Search sources', uiSection: 'integrations' },
    {
      id: 'search-mcp',
      label: 'Search MCP',
      uiSection: 'search-mcp',
      userSetup: 'Use the existing Search MCP connection UI to authorize a client.',
    },
    {
      id: 'search-slack',
      label: 'Search in Slack',
      uiSection: 'search-slack',
      userSetup: 'Slack installation requires its OAuth setup UI.',
    },
    {
      id: 'recently-deleted',
      label: 'Recently deleted organization chats',
      uiSection: 'recently-deleted',
    },
  ],
  workspace: [
    { id: 'teammates', label: 'Teammates', uiSection: 'teammates', cli: ['workspaces members'] },
    {
      id: 'secrets',
      label: 'Environment variables',
      uiSection: 'secrets',
      cli: ['secrets list', 'secrets set', 'secrets delete'],
    },
    {
      id: 'byok',
      label: 'Provider API keys',
      uiSection: 'byok',
      userSetup: 'Secret values are collected by the provider-key setup UI.',
    },
    {
      id: 'sandboxes',
      label: 'Sandboxes',
      uiSection: 'sandboxes',
      cli: [
        'sandboxes list',
        'sandboxes get',
        'sandboxes create',
        'sandboxes update',
        'sandboxes delete',
      ],
    },
    {
      id: 'custom-tools',
      label: 'Custom tools',
      uiSection: 'custom-tools',
      cli: [
        'custom-tools list',
        'custom-tools get',
        'custom-tools create',
        'custom-tools update',
        'custom-tools delete',
      ],
    },
    {
      id: 'mcp',
      label: 'MCP connections',
      uiSection: 'mcp',
      cli: [
        'mcp-servers list',
        'mcp-servers get',
        'mcp-servers create',
        'mcp-servers update',
        'mcp-servers delete',
      ],
    },
    {
      id: 'workflow-mcp-servers',
      label: 'Workflow MCP servers',
      uiSection: 'workflow-mcp-servers',
      cli: [
        'workflow-mcp-servers list',
        'workflow-mcp-servers get',
        'workflow-mcp-servers create',
        'workflow-mcp-servers update',
        'workflow-mcp-servers delete',
      ],
    },
    {
      id: 'api-keys',
      label: 'Workspace API keys',
      uiSection: 'api-keys',
      userSetup:
        'Use generate_api_key to create a workspace key with its existing secure one-time display. This section lists, renames and revokes keys.',
    },
    { id: 'inbox', label: 'Email inbox', uiSection: 'inbox' },
    {
      id: 'recently-deleted',
      label: 'Recently deleted resources',
      uiSection: 'recently-deleted',
      cli: [
        'workflows list',
        'workflows restore',
        'files list',
        'files restore',
        'knowledge list',
        'knowledge restore',
        'tables list',
        'tables restore',
        'files folders restore',
        'tables folders restore',
      ],
      userSetup:
        'Chat listing and restoration are available here. For other resource families, read their CLI reference, list with scope archived, then restore the selected ID in the explicit workspace.',
    },
    {
      id: 'forks',
      label: 'Workspace forks',
      uiSection: 'forks',
      cli: ['workspaces lineage', 'workspaces fork', 'workspaces pull', 'workspaces push'],
    },
    { id: 'custom-blocks', label: 'Custom blocks', uiSection: 'custom-blocks' },
    {
      id: 'self-host',
      label: 'Self-hosting',
      uiSection: 'self-host',
      userSetup: 'Managed deployment changes use the existing setup UI.',
    },
  ],
}
