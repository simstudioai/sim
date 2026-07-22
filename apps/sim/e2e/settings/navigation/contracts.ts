import type { SettingsPersonaKey } from '../personas'

export type SettingsPlane = 'account' | 'organization' | 'workspace'
export type WorldKey = 'settings-primary'

export interface DynamicResourceBinding {
  worldKey: WorldKey
  resourceKind: 'organization' | 'workspace'
  resourceKey: string
}

export interface AuthenticatedDriver {
  personaKey: SettingsPersonaKey
  binding?: DynamicResourceBinding
}

export type SemanticReadiness =
  | { kind: 'button'; name: string }
  | { kind: 'link'; name: string }
  | { kind: 'radio'; name: string }
  | { kind: 'textbox'; name: string }
  | { kind: 'switch'; name: string }
  | { kind: 'tab'; name: string }
  | { kind: 'text'; value: string }

export interface SuccessfulResponse {
  path: string
  expectedJson?: unknown
}

export interface SectionContract {
  contractId: string
  plane: SettingsPlane
  sectionId: string
  group: string
  label: string
  pathTemplate: string
  heading: string
  description: string
  readiness: SemanticReadiness
  successfulResponse?: SuccessfulResponse
  driver: AuthenticatedDriver
  activeSidebarItem: boolean
}

export type RouteOutcome =
  | {
      kind: 'render'
      heading: string
      description: string
      preserveInputUrl: boolean
      successfulResponse?: SuccessfulResponse
      readiness?: SemanticReadiness
    }
  | {
      kind: 'redirect'
      pathTemplate: string
      successfulResponse?: SuccessfulResponse
      readiness?: SemanticReadiness
    }
  | { kind: 'login-redirect' }
  | { kind: 'not-found' }
  | { kind: 'organization-unavailable'; presentation: 'layout' | 'embedded'; title: string }

export interface RouteCase {
  caseId: string
  pathTemplate: string
  driver: AuthenticatedDriver | 'unauthenticated'
  outcome: RouteOutcome
}

export interface PersonaVisibilityCase {
  caseId: string
  plane: SettingsPlane
  driver: AuthenticatedDriver
  expectedVisibleSectionIds: readonly string[]
  expectedVisibleLabels: readonly string[]
  importantHiddenSectionIds: readonly string[]
  importantHiddenLabels: readonly string[]
  representativeSectionId: string
  representativeLabel: string
}

const primaryWorkspace = (
  personaKey: SettingsPersonaKey,
  resourceKey: string
): AuthenticatedDriver => ({
  personaKey,
  binding: {
    worldKey: 'settings-primary',
    resourceKind: 'workspace',
    resourceKey,
  },
})

const primaryOrganization = (
  personaKey: SettingsPersonaKey,
  resourceKey: string
): AuthenticatedDriver => ({
  personaKey,
  binding: {
    worldKey: 'settings-primary',
    resourceKind: 'organization',
    resourceKey,
  },
})

const platformAccount = { personaKey: 'platformAdmin' } as const satisfies AuthenticatedDriver
const platformWorkspace = primaryWorkspace('platformAdmin', 'platform-admin-workspace')
const maxWorkspace = primaryWorkspace('personalMaxOwner', 'personal-max-workspace')
const enterpriseWorkspace = primaryWorkspace('enterpriseOrganizationAdmin', 'enterprise-workspace')
const enterpriseOrganization = primaryOrganization(
  'enterpriseOrganizationAdmin',
  'enterprise-organization'
)
const lapsedOrganization = primaryOrganization('freeOrganizationOwner', 'lapsed-organization')
const foreignEnterpriseOrganization = primaryOrganization(
  'personalFreeOwner',
  'enterprise-organization'
)
const teamOrganizationMember = primaryOrganization('workspaceReadMember', 'team-organization')

export const sectionContracts = [
  {
    contractId: 'account-general',
    plane: 'account',
    sectionId: 'general',
    group: 'account',
    label: 'General',
    pathTemplate: '/account/settings/general',
    heading: 'General',
    description: 'Manage your profile, appearance, and preferences.',
    readiness: { kind: 'button', name: 'Change profile picture' },
    driver: platformAccount,
    activeSidebarItem: true,
  },
  {
    contractId: 'account-billing',
    plane: 'account',
    sectionId: 'billing',
    group: 'account',
    label: 'Billing',
    pathTemplate: '/account/settings/billing',
    heading: 'Billing',
    description: 'Manage your personal plan, usage, and invoices.',
    readiness: { kind: 'link', name: 'Explore personal plans' },
    driver: platformAccount,
    activeSidebarItem: true,
  },
  {
    contractId: 'account-api-keys',
    plane: 'account',
    sectionId: 'api-keys',
    group: 'developer',
    label: 'Sim API keys',
    pathTemplate: '/account/settings/api-keys',
    heading: 'Sim API keys',
    description: 'Create and manage your personal Sim API keys.',
    readiness: { kind: 'button', name: 'Create API key' },
    driver: platformAccount,
    activeSidebarItem: true,
  },
  {
    contractId: 'account-copilot',
    plane: 'account',
    sectionId: 'copilot',
    group: 'developer',
    label: 'Chat keys',
    pathTemplate: '/account/settings/copilot',
    heading: 'Chat keys',
    description: 'Manage the model-provider keys that power Chat.',
    readiness: { kind: 'button', name: 'Create API key' },
    driver: platformAccount,
    activeSidebarItem: true,
  },
  {
    contractId: 'account-admin',
    plane: 'account',
    sectionId: 'admin',
    group: 'platform',
    label: 'Admin',
    pathTemplate: '/account/settings/admin',
    heading: 'Admin',
    description: 'Superuser administration and workspace tools.',
    readiness: { kind: 'switch', name: 'Super admin mode' },
    driver: platformAccount,
    activeSidebarItem: true,
  },
  {
    contractId: 'account-mothership',
    plane: 'account',
    sectionId: 'mothership',
    group: 'platform',
    label: 'Mothership',
    pathTemplate: '/account/settings/mothership',
    heading: 'Mothership',
    description: 'Internal Sim operations and license management.',
    readiness: { kind: 'radio', name: 'Overview' },
    driver: platformAccount,
    activeSidebarItem: true,
  },
  {
    contractId: 'organization-members',
    plane: 'organization',
    sectionId: 'members',
    group: 'organization',
    label: 'Members',
    pathTemplate: '/organization/{organizationId}/settings/members',
    heading: 'Members',
    description: 'Manage organization members, roles, and seats.',
    readiness: { kind: 'button', name: 'Invite' },
    driver: enterpriseOrganization,
    activeSidebarItem: true,
  },
  {
    contractId: 'organization-billing',
    plane: 'organization',
    sectionId: 'billing',
    group: 'organization',
    label: 'Billing',
    pathTemplate: '/organization/{organizationId}/settings/billing',
    heading: 'Billing',
    description: 'Manage the organization plan, usage, and invoices.',
    readiness: { kind: 'button', name: 'Explore organization plans' },
    successfulResponse: {
      path: '/api/billing/invoices',
      expectedJson: { success: true, invoices: [], hasMore: false },
    },
    driver: lapsedOrganization,
    activeSidebarItem: true,
  },
  {
    contractId: 'organization-access-control',
    plane: 'organization',
    sectionId: 'access-control',
    group: 'security',
    label: 'Access control',
    pathTemplate: '/organization/{organizationId}/settings/access-control',
    heading: 'Access control',
    description: 'Manage permission groups across your organization.',
    readiness: { kind: 'button', name: 'Create group' },
    driver: enterpriseOrganization,
    activeSidebarItem: true,
  },
  {
    contractId: 'organization-audit-logs',
    plane: 'organization',
    sectionId: 'audit-logs',
    group: 'security',
    label: 'Audit logs',
    pathTemplate: '/organization/{organizationId}/settings/audit-logs',
    heading: 'Audit logs',
    description: 'Review activity and changes across your organization.',
    readiness: { kind: 'textbox', name: 'Search audit logs...' },
    driver: enterpriseOrganization,
    activeSidebarItem: true,
  },
  {
    contractId: 'organization-sso',
    plane: 'organization',
    sectionId: 'sso',
    group: 'security',
    label: 'Single sign-on',
    pathTemplate: '/organization/{organizationId}/settings/sso',
    heading: 'Single sign-on',
    description: 'Configure single sign-on for your organization.',
    readiness: { kind: 'text', value: 'Provider Type' },
    driver: enterpriseOrganization,
    activeSidebarItem: true,
  },
  {
    contractId: 'organization-data-retention',
    plane: 'organization',
    sectionId: 'data-retention',
    group: 'enterprise',
    label: 'Data retention',
    pathTemplate: '/organization/{organizationId}/settings/data-retention',
    heading: 'Data retention',
    description:
      'Control data retention windows and PII redaction. Workspaces without an override inherit the organization defaults.',
    readiness: { kind: 'button', name: 'Add override' },
    driver: enterpriseOrganization,
    activeSidebarItem: true,
  },
  {
    contractId: 'organization-data-drains',
    plane: 'organization',
    sectionId: 'data-drains',
    group: 'enterprise',
    label: 'Data drains',
    pathTemplate: '/organization/{organizationId}/settings/data-drains',
    heading: 'Data drains',
    description: 'Stream your logs and events to external destinations.',
    readiness: { kind: 'button', name: 'New drain' },
    driver: enterpriseOrganization,
    activeSidebarItem: true,
  },
  {
    contractId: 'organization-whitelabeling',
    plane: 'organization',
    sectionId: 'whitelabeling',
    group: 'enterprise',
    label: 'Whitelabeling',
    pathTemplate: '/organization/{organizationId}/settings/whitelabeling',
    heading: 'Whitelabeling',
    description: 'Customize your workspace branding and appearance.',
    readiness: { kind: 'text', value: 'Brand Identity' },
    driver: enterpriseOrganization,
    activeSidebarItem: true,
  },
  ...[
    [
      'workspace-general',
      'general',
      'account',
      'General',
      'Manage your profile, appearance, and preferences.',
      { kind: 'button', name: 'Change profile picture' },
      platformWorkspace,
    ],
    [
      'workspace-secrets',
      'secrets',
      'account',
      'Secrets',
      'Store environment variables for your workflows.',
      { kind: 'textbox', name: 'Search secrets...' },
      platformWorkspace,
    ],
    [
      'workspace-access-control',
      'access-control',
      'enterprise',
      'Access control',
      'Manage permission groups across your organization.',
      { kind: 'button', name: 'Create group' },
      enterpriseWorkspace,
    ],
    [
      'workspace-custom-blocks',
      'custom-blocks',
      'enterprise',
      'Custom blocks',
      'Publish workflows as reusable blocks for your organization.',
      { kind: 'textbox', name: 'Search custom blocks...' },
      enterpriseWorkspace,
      {
        path: '/api/custom-blocks',
        expectedJson: { enabled: true, customBlocks: [] },
      },
    ],
    [
      'workspace-audit-logs',
      'audit-logs',
      'enterprise',
      'Audit logs',
      'Review activity and changes across your organization.',
      { kind: 'textbox', name: 'Search audit logs...' },
      enterpriseWorkspace,
    ],
    [
      'workspace-apikeys',
      'apikeys',
      'system',
      'Sim API keys',
      'Create and manage API keys for the Sim API.',
      { kind: 'button', name: 'Create API key' },
      platformWorkspace,
    ],
    [
      'workspace-byok',
      'byok',
      'system',
      'BYOK',
      'Bring your own model-provider API keys.',
      { kind: 'textbox', name: 'Search providers' },
      platformWorkspace,
    ],
    [
      'workspace-billing',
      'billing',
      'subscription',
      'Billing',
      'Manage your plan, pricing, and invoices.',
      { kind: 'link', name: 'Explore personal plans' },
      platformWorkspace,
    ],
    [
      'workspace-teammates',
      'teammates',
      'subscription',
      'Teammates',
      'Manage your teammates in this workspace.',
      { kind: 'textbox', name: 'Search teammates...' },
      platformWorkspace,
    ],
    [
      'workspace-organization',
      'organization',
      'subscription',
      'Organization',
      "Manage your organization's members and seats.",
      { kind: 'button', name: 'Invite' },
      enterpriseWorkspace,
    ],
    [
      'workspace-sso',
      'sso',
      'enterprise',
      'Single sign-on',
      'Configure single sign-on for your organization.',
      { kind: 'text', value: 'Provider Type' },
      enterpriseWorkspace,
    ],
    [
      'workspace-whitelabeling',
      'whitelabeling',
      'enterprise',
      'Whitelabeling',
      'Customize your workspace branding and appearance.',
      { kind: 'text', value: 'Brand Identity' },
      enterpriseWorkspace,
    ],
    [
      'workspace-copilot',
      'copilot',
      'system',
      'Chat keys',
      'Manage the model-provider keys that power Chat.',
      { kind: 'button', name: 'Create API key' },
      platformWorkspace,
    ],
    [
      'workspace-forks',
      'forks',
      'enterprise',
      'Workspace Forks',
      'Fork this workspace and sync changes with its parent.',
      { kind: 'textbox', name: 'Search forks...' },
      enterpriseWorkspace,
    ],
    [
      'workspace-mcp',
      'mcp',
      'tools',
      'MCP tools',
      'Connect MCP servers and use their tools in workflows.',
      { kind: 'button', name: 'Add server' },
      platformWorkspace,
    ],
    [
      'workspace-custom-tools',
      'custom-tools',
      'tools',
      'Custom tools',
      'Create and manage custom tools for your agents.',
      { kind: 'button', name: 'Add tool' },
      platformWorkspace,
    ],
    [
      'workspace-workflow-mcp-servers',
      'workflow-mcp-servers',
      'tools',
      'MCP servers',
      'Expose your workflows as tools on an MCP server.',
      { kind: 'button', name: 'Add server' },
      platformWorkspace,
    ],
    [
      'workspace-inbox',
      'inbox',
      'system',
      'Sim mailer',
      'Trigger and process workflows from incoming email.',
      { kind: 'switch', name: 'Enable email inbox' },
      maxWorkspace,
    ],
    [
      'workspace-admin',
      'admin',
      'superuser',
      'Admin',
      'Superuser administration and workspace tools.',
      { kind: 'switch', name: 'Super admin mode' },
      platformWorkspace,
    ],
    [
      'workspace-data-retention',
      'data-retention',
      'enterprise',
      'Data retention',
      'Control data retention windows and PII redaction. Workspaces without an override inherit the organization defaults.',
      { kind: 'button', name: 'Add override' },
      enterpriseWorkspace,
    ],
    [
      'workspace-data-drains',
      'data-drains',
      'enterprise',
      'Data drains',
      'Stream your logs and events to external destinations.',
      { kind: 'button', name: 'New drain' },
      enterpriseWorkspace,
    ],
    [
      'workspace-mothership',
      'mothership',
      'superuser',
      'Mothership',
      'Internal Sim operations and license management.',
      { kind: 'radio', name: 'Overview' },
      platformWorkspace,
    ],
    [
      'workspace-recently-deleted',
      'recently-deleted',
      'system',
      'Recently deleted',
      'Restore items deleted in the last 30 days.',
      { kind: 'textbox', name: 'Search deleted items...' },
      platformWorkspace,
    ],
  ].map(
    ([contractId, sectionId, group, label, description, readiness, driver, successfulResponse]) =>
      ({
        contractId,
        plane: 'workspace',
        sectionId,
        group,
        label,
        pathTemplate: `/workspace/{workspaceId}/settings/${sectionId}`,
        heading: label,
        description,
        readiness,
        successfulResponse,
        driver,
        activeSidebarItem: true,
      }) as SectionContract
  ),
] as const satisfies readonly SectionContract[]

export const routeCases = [
  {
    caseId: 'account-base',
    pathTemplate: '/account/settings',
    driver: platformAccount,
    outcome: { kind: 'redirect', pathTemplate: '/account/settings/general' },
  },
  {
    caseId: 'organization-base',
    pathTemplate: '/organization/{organizationId}/settings',
    driver: enterpriseOrganization,
    outcome: {
      kind: 'redirect',
      pathTemplate: '/organization/{organizationId}/settings/members',
    },
  },
  {
    caseId: 'workspace-base',
    pathTemplate: '/workspace/{workspaceId}/settings',
    driver: platformWorkspace,
    outcome: {
      kind: 'redirect',
      pathTemplate: '/workspace/{workspaceId}/settings/general',
    },
  },
  {
    caseId: 'account-api-keys-alias',
    pathTemplate: '/account/settings/apikeys',
    driver: platformAccount,
    outcome: {
      kind: 'render',
      heading: 'Sim API keys',
      description: 'Create and manage your personal Sim API keys.',
      preserveInputUrl: true,
    },
  },
  {
    caseId: 'organization-members-alias',
    pathTemplate: '/organization/{organizationId}/settings/organization',
    driver: enterpriseOrganization,
    outcome: {
      kind: 'render',
      heading: 'Members',
      description: 'Manage organization members, roles, and seats.',
      preserveInputUrl: true,
    },
  },
  {
    caseId: 'workspace-billing-alias',
    pathTemplate: '/workspace/{workspaceId}/settings/subscription',
    driver: platformWorkspace,
    outcome: {
      kind: 'render',
      heading: 'Billing',
      description: 'Manage your plan, pricing, and invoices.',
      preserveInputUrl: true,
    },
  },
  {
    caseId: 'workspace-organization-alias',
    pathTemplate: '/workspace/{workspaceId}/settings/team',
    driver: enterpriseWorkspace,
    outcome: {
      kind: 'render',
      heading: 'Organization',
      description: "Manage your organization's members and seats.",
      preserveInputUrl: true,
    },
  },
  {
    caseId: 'workspace-api-keys-alias',
    pathTemplate: '/workspace/{workspaceId}/settings/api-keys',
    driver: platformWorkspace,
    outcome: {
      kind: 'render',
      heading: 'Sim API keys',
      description: 'Create and manage API keys for the Sim API.',
      preserveInputUrl: true,
    },
  },
  {
    caseId: 'workspace-integrations-redirect',
    pathTemplate: '/workspace/{workspaceId}/settings/integrations',
    driver: platformWorkspace,
    outcome: {
      kind: 'redirect',
      pathTemplate: '/workspace/{workspaceId}/integrations',
      successfulResponse: {
        path: '/api/credentials',
        expectedJson: { credentials: [] },
      },
      readiness: { kind: 'textbox', name: 'Search integrations...' },
    },
  },
  {
    caseId: 'workspace-skills-redirect',
    pathTemplate: '/workspace/{workspaceId}/settings/skills',
    driver: platformWorkspace,
    outcome: {
      kind: 'redirect',
      pathTemplate: '/workspace/{workspaceId}/skills',
      successfulResponse: {
        path: '/api/skills',
      },
      readiness: { kind: 'text', value: 'connect-integration' },
    },
  },
  {
    caseId: 'account-credit-usage',
    pathTemplate: '/account/settings/billing/credit-usage',
    driver: platformAccount,
    outcome: {
      kind: 'render',
      heading: 'Credit usage',
      description: 'Every credit-consuming event behind your usage.',
      preserveInputUrl: true,
      successfulResponse: { path: '/api/users/me/usage-logs' },
      readiness: { kind: 'text', value: 'No credit usage in this period.' },
    },
  },
  {
    caseId: 'workspace-credit-usage',
    pathTemplate: '/workspace/{workspaceId}/settings/billing/credit-usage',
    driver: platformWorkspace,
    outcome: {
      kind: 'render',
      heading: 'Credit usage',
      description: 'Every credit-consuming event behind your usage.',
      preserveInputUrl: true,
      successfulResponse: { path: '/api/users/me/usage-logs' },
      readiness: { kind: 'text', value: 'No credit usage in this period.' },
    },
  },
  {
    caseId: 'organization-non-member-layout-unavailable',
    pathTemplate: '/organization/{organizationId}/settings/members',
    driver: foreignEnterpriseOrganization,
    outcome: {
      kind: 'organization-unavailable',
      presentation: 'layout',
      title: 'Settings unavailable',
    },
  },
  {
    caseId: 'organization-member-section-unavailable',
    pathTemplate: '/organization/{organizationId}/settings/billing',
    driver: teamOrganizationMember,
    outcome: {
      kind: 'organization-unavailable',
      presentation: 'embedded',
      title: 'Settings unavailable',
    },
  },
  {
    caseId: 'organization-explicit-unavailable',
    pathTemplate: '/organization/{organizationId}/settings/unavailable',
    driver: teamOrganizationMember,
    outcome: {
      kind: 'organization-unavailable',
      presentation: 'embedded',
      title: 'Settings unavailable',
    },
  },
  {
    caseId: 'unauthenticated-account',
    pathTemplate: '/account/settings/general',
    driver: 'unauthenticated',
    outcome: { kind: 'login-redirect' },
  },
  {
    caseId: 'unauthenticated-organization',
    pathTemplate: '/organization/unauthenticated-organization/settings/members',
    driver: 'unauthenticated',
    outcome: { kind: 'login-redirect' },
  },
  {
    caseId: 'unauthenticated-workspace',
    pathTemplate: '/workspace/unauthenticated-workspace/settings/general',
    driver: 'unauthenticated',
    outcome: { kind: 'login-redirect' },
  },
  ...(['account', 'organization', 'workspace'] as const).map((plane) => {
    const driver =
      plane === 'account'
        ? platformAccount
        : plane === 'organization'
          ? teamOrganizationMember
          : platformWorkspace
    const pathTemplate =
      plane === 'account'
        ? '/account/settings/not-a-section'
        : plane === 'organization'
          ? '/organization/{organizationId}/settings/not-a-section'
          : '/workspace/{workspaceId}/settings/not-a-section'
    return {
      caseId: `${plane}-unknown-section`,
      pathTemplate,
      driver,
      outcome: { kind: 'not-found' },
    } satisfies RouteCase
  }),
] as const satisfies readonly RouteCase[]

export const personaVisibilityCases = [
  {
    caseId: 'account-personal-paid-owner',
    plane: 'account',
    driver: { personaKey: 'personalPaidOwner' },
    expectedVisibleSectionIds: ['general', 'billing', 'api-keys', 'copilot'],
    expectedVisibleLabels: ['General', 'Billing', 'Sim API keys', 'Chat keys'],
    importantHiddenSectionIds: ['admin', 'mothership'],
    importantHiddenLabels: ['Admin', 'Mothership'],
    representativeSectionId: 'api-keys',
    representativeLabel: 'Sim API keys',
  },
  {
    caseId: 'account-platform-admin',
    plane: 'account',
    driver: platformAccount,
    expectedVisibleSectionIds: ['general', 'billing', 'api-keys', 'copilot', 'admin', 'mothership'],
    expectedVisibleLabels: [
      'General',
      'Billing',
      'Sim API keys',
      'Chat keys',
      'Admin',
      'Mothership',
    ],
    importantHiddenSectionIds: [],
    importantHiddenLabels: [],
    representativeSectionId: 'api-keys',
    representativeLabel: 'Sim API keys',
  },
  {
    caseId: 'organization-enterprise-admin',
    plane: 'organization',
    driver: enterpriseOrganization,
    expectedVisibleSectionIds: [
      'members',
      'billing',
      'access-control',
      'audit-logs',
      'sso',
      'data-retention',
      'data-drains',
      'whitelabeling',
    ],
    expectedVisibleLabels: [
      'Members',
      'Billing',
      'Access control',
      'Audit logs',
      'Single sign-on',
      'Data retention',
      'Data drains',
      'Whitelabeling',
    ],
    importantHiddenSectionIds: [],
    importantHiddenLabels: [],
    representativeSectionId: 'access-control',
    representativeLabel: 'Access control',
  },
  {
    caseId: 'organization-free-owner',
    plane: 'organization',
    driver: lapsedOrganization,
    expectedVisibleSectionIds: ['members', 'billing'],
    expectedVisibleLabels: ['Members', 'Billing'],
    importantHiddenSectionIds: ['access-control', 'audit-logs', 'sso', 'data-retention'],
    importantHiddenLabels: ['Access control', 'Audit logs', 'Single sign-on', 'Data retention'],
    representativeSectionId: 'members',
    representativeLabel: 'Members',
  },
  {
    caseId: 'organization-read-member',
    plane: 'organization',
    driver: teamOrganizationMember,
    expectedVisibleSectionIds: ['members'],
    expectedVisibleLabels: ['Members'],
    importantHiddenSectionIds: ['billing', 'access-control', 'audit-logs'],
    importantHiddenLabels: ['Billing', 'Access control', 'Audit logs'],
    representativeSectionId: 'members',
    representativeLabel: 'Members',
  },
  {
    caseId: 'workspace-personal-paid-owner',
    plane: 'workspace',
    driver: primaryWorkspace('personalPaidOwner', 'personal-paid-workspace'),
    expectedVisibleSectionIds: [
      'general',
      'secrets',
      'custom-tools',
      'mcp',
      'billing',
      'teammates',
      'apikeys',
      'workflow-mcp-servers',
      'byok',
      'copilot',
      'inbox',
      'recently-deleted',
    ],
    expectedVisibleLabels: [
      'General',
      'Secrets',
      'Custom tools',
      'MCP tools',
      'Billing',
      'Teammates',
      'Sim API keys',
      'MCP servers',
      'BYOK',
      'Chat keys',
      'Sim mailer',
      'Recently deleted',
    ],
    importantHiddenSectionIds: ['organization', 'access-control', 'admin'],
    importantHiddenLabels: ['Organization', 'Access control', 'Admin'],
    representativeSectionId: 'secrets',
    representativeLabel: 'Secrets',
  },
  {
    caseId: 'workspace-enterprise-admin',
    plane: 'workspace',
    driver: enterpriseWorkspace,
    expectedVisibleSectionIds: [
      'general',
      'secrets',
      'custom-tools',
      'mcp',
      'billing',
      'teammates',
      'organization',
      'apikeys',
      'workflow-mcp-servers',
      'byok',
      'copilot',
      'inbox',
      'recently-deleted',
      'access-control',
      'audit-logs',
      'forks',
      'sso',
      'data-retention',
      'data-drains',
      'whitelabeling',
      'custom-blocks',
    ],
    expectedVisibleLabels: [
      'General',
      'Secrets',
      'Custom tools',
      'MCP tools',
      'Billing',
      'Teammates',
      'Organization',
      'Sim API keys',
      'MCP servers',
      'BYOK',
      'Chat keys',
      'Sim mailer',
      'Recently deleted',
      'Access control',
      'Audit logs',
      'Workspace Forks',
      'Single sign-on',
      'Data retention',
      'Data drains',
      'Whitelabeling',
      'Custom blocks',
    ],
    importantHiddenSectionIds: ['admin', 'mothership'],
    importantHiddenLabels: ['Admin', 'Mothership'],
    representativeSectionId: 'access-control',
    representativeLabel: 'Access control',
  },
  {
    caseId: 'workspace-free-organization-owner',
    plane: 'workspace',
    driver: primaryWorkspace('freeOrganizationOwner', 'lapsed-organization-workspace'),
    expectedVisibleSectionIds: [
      'general',
      'secrets',
      'custom-tools',
      'mcp',
      'billing',
      'teammates',
      'apikeys',
      'workflow-mcp-servers',
      'byok',
      'copilot',
      'inbox',
      'recently-deleted',
    ],
    expectedVisibleLabels: [
      'General',
      'Secrets',
      'Custom tools',
      'MCP tools',
      'Billing',
      'Teammates',
      'Sim API keys',
      'MCP servers',
      'BYOK',
      'Chat keys',
      'Sim mailer',
      'Recently deleted',
    ],
    importantHiddenSectionIds: ['organization', 'access-control', 'admin'],
    importantHiddenLabels: ['Organization', 'Access control', 'Admin'],
    representativeSectionId: 'secrets',
    representativeLabel: 'Secrets',
  },
  {
    caseId: 'workspace-read-member',
    plane: 'workspace',
    driver: primaryWorkspace('workspaceReadMember', 'team-workspace'),
    expectedVisibleSectionIds: [
      'general',
      'secrets',
      'custom-tools',
      'mcp',
      'teammates',
      'apikeys',
      'workflow-mcp-servers',
      'byok',
      'copilot',
      'inbox',
      'recently-deleted',
    ],
    expectedVisibleLabels: [
      'General',
      'Secrets',
      'Custom tools',
      'MCP tools',
      'Teammates',
      'Sim API keys',
      'MCP servers',
      'BYOK',
      'Chat keys',
      'Sim mailer',
      'Recently deleted',
    ],
    importantHiddenSectionIds: ['billing', 'organization', 'access-control', 'forks'],
    importantHiddenLabels: ['Billing', 'Organization', 'Access control', 'Workspace Forks'],
    representativeSectionId: 'secrets',
    representativeLabel: 'Secrets',
  },
  {
    caseId: 'workspace-permission-group-restricted',
    plane: 'workspace',
    driver: primaryWorkspace('permissionGroupRestricted', 'enterprise-workspace'),
    expectedVisibleSectionIds: [
      'general',
      'teammates',
      'workflow-mcp-servers',
      'byok',
      'copilot',
      'recently-deleted',
      'custom-blocks',
    ],
    expectedVisibleLabels: [
      'General',
      'Teammates',
      'MCP servers',
      'BYOK',
      'Chat keys',
      'Recently deleted',
      'Custom blocks',
    ],
    importantHiddenSectionIds: ['secrets', 'custom-tools', 'mcp', 'apikeys', 'inbox'],
    importantHiddenLabels: ['Secrets', 'Custom tools', 'MCP tools', 'Sim API keys', 'Sim mailer'],
    representativeSectionId: 'teammates',
    representativeLabel: 'Teammates',
  },
  {
    caseId: 'workspace-platform-admin',
    plane: 'workspace',
    driver: platformWorkspace,
    expectedVisibleSectionIds: [
      'general',
      'secrets',
      'custom-tools',
      'mcp',
      'billing',
      'teammates',
      'apikeys',
      'workflow-mcp-servers',
      'byok',
      'copilot',
      'inbox',
      'recently-deleted',
      'admin',
      'mothership',
    ],
    expectedVisibleLabels: [
      'General',
      'Secrets',
      'Custom tools',
      'MCP tools',
      'Billing',
      'Teammates',
      'Sim API keys',
      'MCP servers',
      'BYOK',
      'Chat keys',
      'Sim mailer',
      'Recently deleted',
      'Admin',
      'Mothership',
    ],
    importantHiddenSectionIds: ['organization', 'access-control', 'custom-blocks'],
    importantHiddenLabels: ['Organization', 'Access control', 'Custom blocks'],
    representativeSectionId: 'admin',
    representativeLabel: 'Admin',
  },
] as const satisfies readonly PersonaVisibilityCase[]
