import type {
  AuthenticatedDriver,
  SemanticReadiness,
  SettingsPlane,
  SuccessfulResponse,
} from '../navigation/contracts'

export type SidebarState = 'visible' | 'hidden' | 'locked' | 'absent-shell'

export interface SidebarExpectation {
  state: SidebarState
  label?: string
  existingProofId?: string
}

export type AccessOutcome =
  | {
      kind: 'render'
      heading: string
      readiness: SemanticReadiness
      readinessState?: 'enabled' | 'disabled'
      successfulResponse?: SuccessfulResponse
    }
  | { kind: 'not-found' }
  | { kind: 'workspace-access-denied' }
  | { kind: 'organization-unavailable'; title: 'Settings unavailable' }
  | { kind: 'organization-plan-unavailable'; title: 'Setting unavailable' }
  | {
      kind: 'locked-render'
      heading: string
      headingLevel?: 1 | 3
      readiness: SemanticReadiness
      readinessState?: 'enabled' | 'disabled'
    }

export interface AccessGateCase {
  caseId: string
  plane: SettingsPlane
  pathTemplate: string
  driver: AuthenticatedDriver
  sidebar: SidebarExpectation
  outcome: AccessOutcome
}

export type AuthorizationReadiness = SemanticReadiness | { kind: 'text-pattern'; source: string }

export type ControlExpectation = 'enabled' | 'disabled' | 'absent' | 'present'

export type ControlScope =
  | { kind: 'page' }
  | { kind: 'dialog'; name: string }
  | { kind: 'section'; name: string }
  | { kind: 'row'; name: string }

export type SemanticControl =
  | { kind: 'button'; name: string }
  | { kind: 'textbox'; name: string }
  | { kind: 'switch'; name: string }
  | { kind: 'radio'; name: string }

export interface MutationControlProbe {
  probeId: string
  control: SemanticControl
  scope: ControlScope
  expectation: ControlExpectation
}

export interface MutationControlCase {
  caseId: string
  pathTemplate: string
  driver: AuthenticatedDriver
  readiness: AuthorizationReadiness
  openDialogWith?: { kind: 'button'; name: string }
  arrangement?: 'archived-workflow'
  controls: readonly MutationControlProbe[]
}

export interface ExistingNavigationProof {
  proofId: string
  source: 'section-contract' | 'route-case' | 'visibility-case'
  referenceId: string
  owns: string
}

const invoiceResponse = {
  path: '/api/billing/invoices',
  expectedJson: { success: true, invoices: [], hasMore: false },
} as const satisfies SuccessfulResponse

export const existingNavigationProofs = [
  {
    proofId: 'step3-organization-non-member-boundary',
    source: 'route-case',
    referenceId: 'organization-non-member-layout-unavailable',
    owns: 'non-member organization layout denial',
  },
  {
    proofId: 'step3-organization-member-billing-denial',
    source: 'route-case',
    referenceId: 'organization-member-section-unavailable',
    owns: 'organization member Billing denial',
  },
  {
    proofId: 'step3-account-platform-admin-positive',
    source: 'visibility-case',
    referenceId: 'account-platform-admin',
    owns: 'platform-admin account Admin and Mothership visibility',
  },
  {
    proofId: 'step3-workspace-platform-admin-positive',
    source: 'visibility-case',
    referenceId: 'workspace-platform-admin',
    owns: 'platform-admin workspace Admin and Mothership visibility',
  },
  {
    proofId: 'step3-max-inbox-positive',
    source: 'section-contract',
    referenceId: 'workspace-inbox',
    owns: 'Max workspace enabled Inbox render',
  },
  {
    proofId: 'step3-enterprise-organization-positive',
    source: 'visibility-case',
    referenceId: 'organization-enterprise-admin',
    owns: 'Enterprise organization canonical section visibility',
  },
  {
    proofId: 'step3-enterprise-workspace-positive',
    source: 'visibility-case',
    referenceId: 'workspace-enterprise-admin',
    owns: 'Enterprise workspace Organization and Enterprise section visibility',
  },
  {
    proofId: 'step3-permission-group-sidebar',
    source: 'visibility-case',
    referenceId: 'workspace-permission-group-restricted',
    owns: 'permission-group restricted sidebar visibility',
  },
] as const satisfies readonly ExistingNavigationProof[]

export const accessGateCases: readonly AccessGateCase[] = [
  {
    caseId: 'account-personal-paid-billing',
    plane: 'account',
    pathTemplate: '/account/settings/billing',
    driver: { personaKey: 'personalPaidOwner' },
    sidebar: { state: 'visible', label: 'Billing' },
    outcome: {
      kind: 'render',
      heading: 'Billing',
      readiness: { kind: 'button', name: 'Manage in Stripe' },
      readinessState: 'enabled',
      successfulResponse: invoiceResponse,
    },
  },
  {
    caseId: 'account-non-platform-admin-denied',
    plane: 'account',
    pathTemplate: '/account/settings/admin',
    driver: { personaKey: 'personalPaidOwner' },
    sidebar: { state: 'hidden', label: 'Admin' },
    outcome: { kind: 'not-found' },
  },
  {
    caseId: 'account-non-platform-mothership-denied',
    plane: 'account',
    pathTemplate: '/account/settings/mothership',
    driver: { personaKey: 'personalPaidOwner' },
    sidebar: { state: 'hidden', label: 'Mothership' },
    outcome: { kind: 'not-found' },
  },
  {
    caseId: 'organization-read-member-access-control-denied',
    plane: 'organization',
    pathTemplate: '/organization/{organizationId}/settings/access-control',
    driver: {
      personaKey: 'workspaceReadMember',
      binding: {
        worldKey: 'settings-primary',
        resourceKind: 'organization',
        resourceKey: 'team-organization',
      },
    },
    sidebar: { state: 'hidden', label: 'Access control' },
    outcome: { kind: 'organization-unavailable', title: 'Settings unavailable' },
  },
  {
    caseId: 'organization-read-member-audit-logs-denied',
    plane: 'organization',
    pathTemplate: '/organization/{organizationId}/settings/audit-logs',
    driver: {
      personaKey: 'workspaceReadMember',
      binding: {
        worldKey: 'settings-primary',
        resourceKind: 'organization',
        resourceKey: 'team-organization',
      },
    },
    sidebar: { state: 'hidden', label: 'Audit logs' },
    outcome: { kind: 'organization-unavailable', title: 'Settings unavailable' },
  },
  {
    caseId: 'organization-read-member-sso-denied',
    plane: 'organization',
    pathTemplate: '/organization/{organizationId}/settings/sso',
    driver: {
      personaKey: 'workspaceReadMember',
      binding: {
        worldKey: 'settings-primary',
        resourceKind: 'organization',
        resourceKey: 'team-organization',
      },
    },
    sidebar: { state: 'hidden', label: 'Single sign-on' },
    outcome: { kind: 'organization-unavailable', title: 'Settings unavailable' },
  },
  {
    caseId: 'organization-read-member-data-retention-denied',
    plane: 'organization',
    pathTemplate: '/organization/{organizationId}/settings/data-retention',
    driver: {
      personaKey: 'workspaceReadMember',
      binding: {
        worldKey: 'settings-primary',
        resourceKind: 'organization',
        resourceKey: 'team-organization',
      },
    },
    sidebar: { state: 'hidden', label: 'Data retention' },
    outcome: { kind: 'organization-unavailable', title: 'Settings unavailable' },
  },
  {
    caseId: 'organization-read-member-data-drains-denied',
    plane: 'organization',
    pathTemplate: '/organization/{organizationId}/settings/data-drains',
    driver: {
      personaKey: 'workspaceReadMember',
      binding: {
        worldKey: 'settings-primary',
        resourceKind: 'organization',
        resourceKey: 'team-organization',
      },
    },
    sidebar: { state: 'hidden', label: 'Data drains' },
    outcome: { kind: 'organization-unavailable', title: 'Settings unavailable' },
  },
  {
    caseId: 'organization-read-member-whitelabeling-denied',
    plane: 'organization',
    pathTemplate: '/organization/{organizationId}/settings/whitelabeling',
    driver: {
      personaKey: 'workspaceReadMember',
      binding: {
        worldKey: 'settings-primary',
        resourceKind: 'organization',
        resourceKey: 'team-organization',
      },
    },
    sidebar: { state: 'hidden', label: 'Whitelabeling' },
    outcome: { kind: 'organization-unavailable', title: 'Settings unavailable' },
  },
  {
    caseId: 'organization-lapsed-owner-members',
    plane: 'organization',
    pathTemplate: '/organization/{organizationId}/settings/members',
    driver: {
      personaKey: 'freeOrganizationOwner',
      binding: {
        worldKey: 'settings-primary',
        resourceKind: 'organization',
        resourceKey: 'lapsed-organization',
      },
    },
    sidebar: { state: 'visible', label: 'Members' },
    outcome: {
      kind: 'render',
      heading: 'Members',
      readiness: { kind: 'button', name: 'Invite' },
    },
  },
  {
    caseId: 'organization-lapsed-owner-billing',
    plane: 'organization',
    pathTemplate: '/organization/{organizationId}/settings/billing',
    driver: {
      personaKey: 'freeOrganizationOwner',
      binding: {
        worldKey: 'settings-primary',
        resourceKind: 'organization',
        resourceKey: 'lapsed-organization',
      },
    },
    sidebar: { state: 'visible', label: 'Billing' },
    outcome: {
      kind: 'render',
      heading: 'Billing',
      readiness: { kind: 'button', name: 'Explore organization plans' },
      readinessState: 'disabled',
      successfulResponse: invoiceResponse,
    },
  },
  {
    caseId: 'organization-team-owner-billing',
    plane: 'organization',
    pathTemplate: '/organization/{organizationId}/settings/billing',
    driver: {
      personaKey: 'paidOrganizationOwner',
      binding: {
        worldKey: 'settings-primary',
        resourceKind: 'organization',
        resourceKey: 'team-organization',
      },
    },
    sidebar: { state: 'visible', label: 'Billing' },
    outcome: {
      kind: 'render',
      heading: 'Billing',
      readiness: { kind: 'button', name: 'Manage in Stripe' },
      readinessState: 'enabled',
      successfulResponse: invoiceResponse,
    },
  },
  ...[
    ['access-control', 'Access control'],
    ['audit-logs', 'Audit logs'],
    ['sso', 'Single sign-on'],
    ['data-retention', 'Data retention'],
    ['data-drains', 'Data drains'],
    ['whitelabeling', 'Whitelabeling'],
  ].map(
    ([section, label]) =>
      ({
        caseId: `organization-lapsed-owner-${section}-plan-denied`,
        plane: 'organization',
        pathTemplate: `/organization/{organizationId}/settings/${section}`,
        driver: {
          personaKey: 'freeOrganizationOwner',
          binding: {
            worldKey: 'settings-primary',
            resourceKind: 'organization',
            resourceKey: 'lapsed-organization',
          },
        },
        sidebar: { state: 'hidden', label },
        outcome: { kind: 'organization-plan-unavailable', title: 'Setting unavailable' },
      }) as AccessGateCase
  ),
  {
    caseId: 'workspace-foreign-access-denied',
    plane: 'workspace',
    pathTemplate: '/workspace/{workspaceId}/settings/general',
    driver: {
      personaKey: 'personalFreeOwner',
      binding: {
        worldKey: 'settings-primary',
        resourceKind: 'workspace',
        resourceKey: 'team-workspace',
      },
    },
    sidebar: { state: 'absent-shell' },
    outcome: { kind: 'workspace-access-denied' },
  },
  ...[
    ['organization', 'Organization'],
    ['billing', 'Billing'],
    ['access-control', 'Access control'],
    ['audit-logs', 'Audit logs'],
    ['sso', 'Single sign-on'],
    ['data-retention', 'Data retention'],
    ['data-drains', 'Data drains'],
    ['whitelabeling', 'Whitelabeling'],
  ].map(
    ([section, label]) =>
      ({
        caseId: `workspace-member-${section}-denied`,
        plane: 'workspace',
        pathTemplate: `/workspace/{workspaceId}/settings/${section}`,
        driver: {
          personaKey: 'workspaceAdminMember',
          binding: {
            worldKey: 'settings-primary',
            resourceKind: 'workspace',
            resourceKey: 'team-workspace',
          },
        },
        sidebar: { state: 'hidden', label },
        outcome: { kind: 'not-found' },
      }) as AccessGateCase
  ),
  {
    caseId: 'workspace-external-admin-organization-denied',
    plane: 'workspace',
    pathTemplate: '/workspace/{workspaceId}/settings/organization',
    driver: {
      personaKey: 'externalWorkspaceAdmin',
      binding: {
        worldKey: 'settings-primary',
        resourceKind: 'workspace',
        resourceKey: 'team-workspace',
      },
    },
    sidebar: { state: 'hidden', label: 'Organization' },
    outcome: { kind: 'not-found' },
  },
  {
    caseId: 'workspace-external-admin-billing-denied',
    plane: 'workspace',
    pathTemplate: '/workspace/{workspaceId}/settings/billing',
    driver: {
      personaKey: 'externalWorkspaceAdmin',
      binding: {
        worldKey: 'settings-primary',
        resourceKind: 'workspace',
        resourceKey: 'team-workspace',
      },
    },
    sidebar: { state: 'hidden', label: 'Billing' },
    outcome: { kind: 'not-found' },
  },
  {
    caseId: 'workspace-enterprise-billing',
    plane: 'workspace',
    pathTemplate: '/workspace/{workspaceId}/settings/billing',
    driver: {
      personaKey: 'enterpriseOrganizationAdmin',
      binding: {
        worldKey: 'settings-primary',
        resourceKind: 'workspace',
        resourceKey: 'enterprise-workspace',
      },
    },
    sidebar: { state: 'visible', label: 'Billing' },
    outcome: {
      kind: 'render',
      heading: 'Billing',
      readiness: { kind: 'button', name: 'Manage in Stripe' },
      readinessState: 'disabled',
      successfulResponse: invoiceResponse,
    },
  },
  ...[
    ['access-control', 'Access control'],
    ['audit-logs', 'Audit logs'],
    ['sso', 'Single sign-on'],
    ['data-retention', 'Data retention'],
    ['data-drains', 'Data drains'],
    ['whitelabeling', 'Whitelabeling'],
    ['forks', 'Workspace Forks'],
    ['custom-blocks', 'Custom blocks'],
  ].map(
    ([section, label]) =>
      ({
        caseId: `workspace-team-owner-${section}-denied`,
        plane: 'workspace',
        pathTemplate: `/workspace/{workspaceId}/settings/${section}`,
        driver: {
          personaKey: 'paidOrganizationOwner',
          binding: {
            worldKey: 'settings-primary',
            resourceKind: 'workspace',
            resourceKey: 'team-workspace',
          },
        },
        sidebar: { state: 'hidden', label },
        outcome: { kind: 'not-found' },
      }) as AccessGateCase
  ),
  ...[
    ['secrets', 'Secrets'],
    ['apikeys', 'Sim API keys'],
    ['inbox', 'Sim mailer'],
    ['mcp', 'MCP tools'],
    ['custom-tools', 'Custom tools'],
  ].map(
    ([section, label]) =>
      ({
        caseId: `workspace-permission-group-${section}-denied`,
        plane: 'workspace',
        pathTemplate: `/workspace/{workspaceId}/settings/${section}`,
        driver: {
          personaKey: 'permissionGroupRestricted',
          binding: {
            worldKey: 'settings-primary',
            resourceKind: 'workspace',
            resourceKey: 'enterprise-workspace',
          },
        },
        sidebar: {
          state: 'hidden',
          label,
          existingProofId: 'step3-permission-group-sidebar',
        },
        outcome: { kind: 'not-found' },
      }) as AccessGateCase
  ),
  {
    caseId: 'workspace-personal-paid-inbox-locked',
    plane: 'workspace',
    pathTemplate: '/workspace/{workspaceId}/settings/inbox',
    driver: {
      personaKey: 'personalPaidOwner',
      binding: {
        worldKey: 'settings-primary',
        resourceKind: 'workspace',
        resourceKey: 'personal-paid-workspace',
      },
    },
    sidebar: { state: 'locked', label: 'Sim mailer' },
    outcome: {
      kind: 'locked-render',
      heading: 'Sim Mailer requires an active Max plan',
      headingLevel: 3,
      readiness: { kind: 'button', name: 'Upgrade to Max' },
      readinessState: 'enabled',
    },
  },
  {
    caseId: 'workspace-personal-paid-billing',
    plane: 'workspace',
    pathTemplate: '/workspace/{workspaceId}/settings/billing',
    driver: {
      personaKey: 'personalPaidOwner',
      binding: {
        worldKey: 'settings-primary',
        resourceKind: 'workspace',
        resourceKey: 'personal-paid-workspace',
      },
    },
    sidebar: { state: 'visible', label: 'Billing' },
    outcome: {
      kind: 'render',
      heading: 'Billing',
      readiness: { kind: 'button', name: 'Manage in Stripe' },
      readinessState: 'enabled',
      successfulResponse: invoiceResponse,
    },
  },
  {
    caseId: 'workspace-non-platform-admin-denied',
    plane: 'workspace',
    pathTemplate: '/workspace/{workspaceId}/settings/admin',
    driver: {
      personaKey: 'personalPaidOwner',
      binding: {
        worldKey: 'settings-primary',
        resourceKind: 'workspace',
        resourceKey: 'personal-paid-workspace',
      },
    },
    sidebar: { state: 'hidden', label: 'Admin' },
    outcome: { kind: 'not-found' },
  },
  {
    caseId: 'workspace-non-platform-mothership-denied',
    plane: 'workspace',
    pathTemplate: '/workspace/{workspaceId}/settings/mothership',
    driver: {
      personaKey: 'personalPaidOwner',
      binding: {
        worldKey: 'settings-primary',
        resourceKind: 'workspace',
        resourceKey: 'personal-paid-workspace',
      },
    },
    sidebar: { state: 'hidden', label: 'Mothership' },
    outcome: { kind: 'not-found' },
  },
] as const

export const mutationControlCases: readonly MutationControlCase[] = [
  ...[
    ['workspaceReadMember', 'absent'],
    ['workspaceWriteMember', 'present'],
    ['workspaceAdminMember', 'present'],
  ].map(
    ([personaKey, expectation]) =>
      ({
        caseId: `workspace-secrets-${personaKey}`,
        pathTemplate: '/workspace/{workspaceId}/settings/secrets',
        driver: {
          personaKey,
          binding: {
            worldKey: 'settings-primary',
            resourceKind: 'workspace',
            resourceKey: 'team-workspace',
          },
        },
        readiness: { kind: 'text', value: 'Personal' },
        controls: [
          {
            probeId: 'new-workspace-secret-name',
            control: { kind: 'textbox', name: 'New workspace secret name' },
            scope: { kind: 'section', name: 'Workspace' },
            expectation,
          },
          {
            probeId: 'new-workspace-secret-value',
            control: { kind: 'textbox', name: 'New workspace secret value' },
            scope: { kind: 'section', name: 'Workspace' },
            expectation,
          },
        ],
      }) as MutationControlCase
  ),
  ...[
    ['custom-tools', 'Add tool', 'workspaceReadMember', 'absent', 'No custom tools configured'],
    [
      'custom-tools',
      'Add tool',
      'workspaceWriteMember',
      'present',
      'Click "Add tool" above to get started',
    ],
    [
      'custom-tools',
      'Add tool',
      'workspaceAdminMember',
      'present',
      'Click "Add tool" above to get started',
    ],
    ['mcp', 'Add server', 'workspaceReadMember', 'absent', 'No MCP servers configured'],
    [
      'mcp',
      'Add server',
      'workspaceWriteMember',
      'present',
      'Click "Add server" above to get started',
    ],
    [
      'mcp',
      'Add server',
      'workspaceAdminMember',
      'present',
      'Click "Add server" above to get started',
    ],
    [
      'workflow-mcp-servers',
      'Add server',
      'workspaceReadMember',
      'absent',
      'No MCP servers configured',
    ],
    [
      'workflow-mcp-servers',
      'Add server',
      'workspaceWriteMember',
      'present',
      'Click "Add server" above to get started',
    ],
    [
      'workflow-mcp-servers',
      'Add server',
      'workspaceAdminMember',
      'present',
      'Click "Add server" above to get started',
    ],
  ].map(
    ([section, button, personaKey, expectation, readiness]) =>
      ({
        caseId: `workspace-${section}-${personaKey}`,
        pathTemplate: `/workspace/{workspaceId}/settings/${section}`,
        driver: {
          personaKey,
          binding: {
            worldKey: 'settings-primary',
            resourceKind: 'workspace',
            resourceKey: 'team-workspace',
          },
        },
        readiness: { kind: 'text', value: readiness },
        controls: [
          {
            probeId: `${section}-primary-action`,
            control: { kind: 'button', name: button },
            scope: { kind: 'page' },
            expectation,
          },
        ],
      }) as MutationControlCase
  ),
  ...[
    ['workspaceReadMember', 'absent'],
    ['workspaceWriteMember', 'absent'],
    ['workspaceAdminMember', 'present'],
  ].map(
    ([personaKey, expectation]) =>
      ({
        caseId: `workspace-teammates-${personaKey}`,
        pathTemplate: '/workspace/{workspaceId}/settings/teammates',
        driver: {
          personaKey,
          binding: {
            worldKey: 'settings-primary',
            resourceKind: 'workspace',
            resourceKey: 'team-workspace',
          },
        },
        readiness: { kind: 'text-pattern', source: '^Teammates \\(\\d+\\)$' },
        controls: [
          {
            probeId: 'teammates-invite',
            control: { kind: 'button', name: 'Invite' },
            scope: { kind: 'page' },
            expectation,
          },
        ],
      }) as MutationControlCase
  ),
  ...[
    ['workspaceReadMember', 'absent'],
    ['workspaceWriteMember', 'absent'],
    ['workspaceAdminMember', 'present'],
  ].map(
    ([personaKey, expectation]) =>
      ({
        caseId: `workspace-byok-${personaKey}`,
        pathTemplate: '/workspace/{workspaceId}/settings/byok',
        driver: {
          personaKey,
          binding: {
            worldKey: 'settings-primary',
            resourceKind: 'workspace',
            resourceKey: 'team-workspace',
          },
        },
        readiness: { kind: 'text', value: 'OpenAI' },
        controls: [
          {
            probeId: 'openai-add-key',
            control: { kind: 'button', name: 'Add Key' },
            scope: { kind: 'row', name: 'OpenAI' },
            expectation,
          },
        ],
      }) as MutationControlCase
  ),
  ...[
    ['workspaceReadMember', 'absent'],
    ['workspaceWriteMember', 'present'],
    ['workspaceAdminMember', 'present'],
  ].map(
    ([personaKey, expectation]) =>
      ({
        caseId: `workspace-recently-deleted-${personaKey}`,
        pathTemplate: '/workspace/{workspaceId}/settings/recently-deleted',
        driver: {
          personaKey,
          binding: {
            worldKey: 'settings-primary',
            resourceKind: 'workspace',
            resourceKey: 'team-workspace',
          },
        },
        readiness: { kind: 'textbox', name: 'Search deleted items...' },
        arrangement: 'archived-workflow',
        controls: [
          {
            probeId: 'archived-workflow-restore',
            control: { kind: 'button', name: 'Restore' },
            scope: { kind: 'row', name: '{archivedWorkflowName}' },
            expectation,
          },
        ],
      }) as MutationControlCase
  ),
  ...[
    ['workspaceReadMember', 'absent', 'absent', 'absent'],
    ['workspaceWriteMember', 'absent', 'absent', 'absent'],
    ['workspaceAdminMember', 'present', 'present', 'present'],
  ].map(
    ([personaKey, radioExpectation, workspaceRadioExpectation, policyExpectation]) =>
      ({
        caseId: `workspace-api-keys-${personaKey}`,
        pathTemplate: '/workspace/{workspaceId}/settings/apikeys',
        driver: {
          personaKey,
          binding: {
            worldKey: 'settings-primary',
            resourceKind: 'workspace',
            resourceKey: 'team-workspace',
          },
        },
        readiness: { kind: 'button', name: 'Create API key' },
        openDialogWith: { kind: 'button', name: 'Create API key' },
        controls: [
          {
            probeId: 'personal-key-create',
            control: { kind: 'button', name: 'Create API key' },
            scope: { kind: 'page' },
            expectation: 'enabled',
          },
          {
            probeId: 'personal-key-radio',
            control: { kind: 'radio', name: 'Personal' },
            scope: { kind: 'dialog', name: 'Create new API key' },
            expectation: radioExpectation,
          },
          {
            probeId: 'workspace-key-radio',
            control: { kind: 'radio', name: 'Workspace' },
            scope: { kind: 'dialog', name: 'Create new API key' },
            expectation: workspaceRadioExpectation,
          },
          {
            probeId: 'allow-personal-api-keys',
            control: { kind: 'switch', name: 'Allow personal API keys' },
            scope: { kind: 'section', name: 'Permissions' },
            expectation: policyExpectation,
          },
        ],
      }) as MutationControlCase
  ),
  {
    caseId: 'workspace-paid-non-max-inbox-upgrade',
    pathTemplate: '/workspace/{workspaceId}/settings/inbox',
    driver: {
      personaKey: 'personalPaidOwner',
      binding: {
        worldKey: 'settings-primary',
        resourceKind: 'workspace',
        resourceKey: 'personal-paid-workspace',
      },
    },
    readiness: { kind: 'text', value: 'Sim Mailer requires an active Max plan' },
    controls: [
      {
        probeId: 'inbox-upgrade',
        control: { kind: 'button', name: 'Upgrade to Max' },
        scope: { kind: 'page' },
        expectation: 'present',
      },
    ],
  },
  {
    caseId: 'workspace-enterprise-forks-create',
    pathTemplate: '/workspace/{workspaceId}/settings/forks',
    driver: {
      personaKey: 'enterpriseOrganizationAdmin',
      binding: {
        worldKey: 'settings-primary',
        resourceKind: 'workspace',
        resourceKey: 'enterprise-workspace',
      },
    },
    readiness: { kind: 'textbox', name: 'Search forks...' },
    controls: [
      {
        probeId: 'forks-create',
        control: { kind: 'button', name: 'Create fork' },
        scope: { kind: 'page' },
        expectation: 'present',
      },
    ],
  },
  {
    caseId: 'workspace-enterprise-read-custom-blocks',
    pathTemplate: '/workspace/{workspaceId}/settings/custom-blocks',
    driver: {
      personaKey: 'permissionGroupRestricted',
      binding: {
        worldKey: 'settings-primary',
        resourceKind: 'workspace',
        resourceKey: 'enterprise-workspace',
      },
    },
    readiness: { kind: 'textbox', name: 'Search custom blocks...' },
    controls: [
      {
        probeId: 'custom-block-create',
        control: { kind: 'button', name: 'Create block' },
        scope: { kind: 'page' },
        expectation: 'absent',
      },
    ],
  },
  {
    caseId: 'workspace-enterprise-admin-custom-blocks',
    pathTemplate: '/workspace/{workspaceId}/settings/custom-blocks',
    driver: {
      personaKey: 'enterpriseOrganizationAdmin',
      binding: {
        worldKey: 'settings-primary',
        resourceKind: 'workspace',
        resourceKey: 'enterprise-workspace',
      },
    },
    readiness: { kind: 'textbox', name: 'Search custom blocks...' },
    controls: [
      {
        probeId: 'custom-block-create',
        control: { kind: 'button', name: 'Create block' },
        scope: { kind: 'page' },
        expectation: 'present',
      },
    ],
  },
  {
    caseId: 'organization-member-members-controls',
    pathTemplate: '/organization/{organizationId}/settings/members',
    driver: {
      personaKey: 'workspaceReadMember',
      binding: {
        worldKey: 'settings-primary',
        resourceKind: 'organization',
        resourceKey: 'team-organization',
      },
    },
    readiness: { kind: 'text-pattern', source: '^Members \\(\\d+\\)$' },
    controls: [
      {
        probeId: 'organization-members-invite',
        control: { kind: 'button', name: 'Invite' },
        scope: { kind: 'page' },
        expectation: 'absent',
      },
    ],
  },
  {
    caseId: 'organization-admin-members-controls',
    pathTemplate: '/organization/{organizationId}/settings/members',
    driver: {
      personaKey: 'enterpriseOrganizationAdmin',
      binding: {
        worldKey: 'settings-primary',
        resourceKind: 'organization',
        resourceKey: 'enterprise-organization',
      },
    },
    readiness: { kind: 'text-pattern', source: '^Members \\(\\d+\\)$' },
    controls: [
      {
        probeId: 'organization-members-invite',
        control: { kind: 'button', name: 'Invite' },
        scope: { kind: 'page' },
        expectation: 'present',
      },
    ],
  },
  {
    caseId: 'organization-enterprise-access-control-create',
    pathTemplate: '/organization/{organizationId}/settings/access-control',
    driver: {
      personaKey: 'enterpriseOrganizationAdmin',
      binding: {
        worldKey: 'settings-primary',
        resourceKind: 'organization',
        resourceKey: 'enterprise-organization',
      },
    },
    readiness: { kind: 'textbox', name: 'Search permission groups...' },
    controls: [
      {
        probeId: 'organization-access-control-create',
        control: { kind: 'button', name: 'Create group' },
        scope: { kind: 'page' },
        expectation: 'present',
      },
    ],
  },
] as const
