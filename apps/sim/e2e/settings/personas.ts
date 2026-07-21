import { createScenarioNamespace, type ScenarioNamespace } from '../fixtures/namespace'
import {
  type ExpectedWorkspaceAccess,
  type PersonaWorkspaceExpectation,
  type RoleSource,
  SCENARIO_VERSION,
  type ScenarioDefinition,
  type ScenarioPersona,
  type ScenarioUser,
  type SubscriptionPlan,
} from '../fixtures/scenario'

const HOSTED_BILLING = { hosted: true, billingEnabled: true } as const

export const SETTINGS_PERSONA_KEYS = [
  'personalFreeOwner',
  'personalPaidOwner',
  'personalMaxOwner',
  'paidOrganizationOwner',
  'workspaceReadMember',
  'workspaceWriteMember',
  'workspaceAdminMember',
  'externalWorkspaceAdmin',
  'enterpriseOrganizationAdmin',
  'freeOrganizationOwner',
  'permissionGroupRestricted',
  'platformAdmin',
] as const

export type SettingsPersonaKey = (typeof SETTINGS_PERSONA_KEYS)[number]

export interface SettingsPersonaScenarios {
  primary: ScenarioDefinition
  isolationTwin: ScenarioDefinition
}

export function createSettingsPersonaScenarios(run: string): SettingsPersonaScenarios {
  return {
    primary: createPrimarySettingsScenario(createScenarioNamespace(run, 'settings-primary')),
    isolationTwin: createIsolationTwinScenario(
      createScenarioNamespace(run, 'settings-isolation-twin')
    ),
  }
}

export function createPrimarySettingsScenario(namespace: ScenarioNamespace): ScenarioDefinition {
  const userKeys = [
    'personal-free-owner',
    'personal-paid-owner',
    'personal-max-owner',
    'paid-organization-owner',
    'workspace-read-member',
    'workspace-write-member',
    'workspace-admin-member',
    'external-workspace-admin',
    'enterprise-organization-owner',
    'enterprise-organization-admin',
    'free-organization-owner',
    'permission-group-restricted',
    'platform-admin',
  ] as const
  const users: ScenarioUser[] = userKeys.map((key) => user(namespace, key))
  const platformAdmin = users.find(({ key }) => key === 'platform-admin')
  if (!platformAdmin) throw new Error('Platform admin declaration is missing')
  platformAdmin.platformRole = 'admin'
  platformAdmin.superUserModeEnabled = true

  const organizations = [
    {
      key: 'team-organization',
      name: namespace.name('team-organization'),
      slug: namespace.slug('team-organization'),
      ownerUserKey: 'paid-organization-owner',
      ...HOSTED_BILLING,
    },
    {
      key: 'enterprise-organization',
      name: namespace.name('enterprise-organization'),
      slug: namespace.slug('enterprise-organization'),
      ownerUserKey: 'enterprise-organization-owner',
      ...HOSTED_BILLING,
    },
    {
      key: 'lapsed-organization',
      name: namespace.name('lapsed-organization'),
      slug: namespace.slug('lapsed-organization'),
      ownerUserKey: 'free-organization-owner',
      ...HOSTED_BILLING,
    },
  ] as const

  const organizationMemberships = [
    membership('team-organization', 'paid-organization-owner', 'owner'),
    membership('team-organization', 'workspace-read-member', 'member'),
    membership('team-organization', 'workspace-write-member', 'member'),
    membership('team-organization', 'workspace-admin-member', 'member'),
    membership('enterprise-organization', 'enterprise-organization-owner', 'owner'),
    membership('enterprise-organization', 'enterprise-organization-admin', 'admin'),
    membership('enterprise-organization', 'permission-group-restricted', 'member'),
    membership('lapsed-organization', 'free-organization-owner', 'owner'),
  ] as const

  const subscriptions = [
    {
      key: 'personal-paid-subscription',
      plan: 'pro_6000',
      status: 'active',
      billingReference: { kind: 'user', userKey: 'personal-paid-owner' },
      ...HOSTED_BILLING,
    },
    {
      key: 'personal-max-subscription',
      plan: 'pro_25000',
      status: 'active',
      billingReference: { kind: 'user', userKey: 'personal-max-owner' },
      ...HOSTED_BILLING,
    },
    {
      key: 'team-subscription',
      plan: 'team_6000',
      status: 'active',
      billingReference: { kind: 'organization', organizationKey: 'team-organization' },
      seats: 4,
      ...HOSTED_BILLING,
    },
    {
      key: 'enterprise-subscription',
      plan: 'enterprise',
      status: 'active',
      billingReference: {
        kind: 'organization',
        organizationKey: 'enterprise-organization',
      },
      seats: 3,
      enterprise: {
        plan: 'enterprise',
        monthlyPrice: 12_000,
        seats: 3,
      },
      ...HOSTED_BILLING,
    },
    {
      key: 'lapsed-team-subscription',
      plan: 'team_6000',
      status: 'lapsed',
      billingReference: { kind: 'organization', organizationKey: 'lapsed-organization' },
      seats: 1,
      ...HOSTED_BILLING,
    },
  ] as const

  const workspaces = [
    personalWorkspace(namespace, 'personal-free-workspace', 'personal-free-owner'),
    personalWorkspace(
      namespace,
      'personal-paid-workspace',
      'personal-paid-owner',
      'personal-paid-subscription'
    ),
    personalWorkspace(
      namespace,
      'personal-max-workspace',
      'personal-max-owner',
      'personal-max-subscription'
    ),
    {
      key: 'team-workspace',
      name: namespace.name('team-workspace'),
      ownerUserKey: 'paid-organization-owner',
      organizationKey: 'team-organization',
      payer: { kind: 'organization', organizationKey: 'team-organization' },
      subscriptionKey: 'team-subscription',
      ...HOSTED_BILLING,
    },
    {
      key: 'team-invitation-workspace',
      name: namespace.name('team-invitation-workspace'),
      ownerUserKey: 'paid-organization-owner',
      organizationKey: 'team-organization',
      payer: { kind: 'organization', organizationKey: 'team-organization' },
      subscriptionKey: 'team-subscription',
      ...HOSTED_BILLING,
    },
    {
      key: 'enterprise-workspace',
      name: namespace.name('enterprise-workspace'),
      ownerUserKey: 'enterprise-organization-owner',
      organizationKey: 'enterprise-organization',
      payer: { kind: 'organization', organizationKey: 'enterprise-organization' },
      subscriptionKey: 'enterprise-subscription',
      ...HOSTED_BILLING,
    },
    {
      key: 'lapsed-organization-workspace',
      name: namespace.name('lapsed-organization-workspace'),
      ownerUserKey: 'free-organization-owner',
      organizationKey: 'lapsed-organization',
      payer: { kind: 'organization', organizationKey: 'lapsed-organization' },
      subscriptionKey: 'lapsed-team-subscription',
      ...HOSTED_BILLING,
    },
    personalWorkspace(namespace, 'platform-admin-workspace', 'platform-admin'),
  ] as const

  const workspaceGrants = [
    grant('team-workspace', 'workspace-read-member', 'read'),
    grant('team-workspace', 'workspace-write-member', 'write'),
    grant('team-workspace', 'workspace-admin-member', 'admin'),
    grant('team-workspace', 'external-workspace-admin', 'admin'),
    grant('enterprise-workspace', 'permission-group-restricted', 'read'),
  ] as const

  const permissionGroups = [
    {
      key: 'restricted-enterprise-group',
      name: namespace.name('restricted-enterprise-group'),
      organizationKey: 'enterprise-organization',
      workspaceKeys: ['enterprise-workspace'],
      memberUserKeys: ['permission-group-restricted'],
      restrictions: {
        hiddenSettings: ['secrets', 'api-keys', 'inbox'],
        disabledFeatures: ['mcp', 'custom-tools'],
      },
    },
  ] as const

  const invitations = [
    {
      key: 'pending-team-invitation',
      organizationKey: 'team-organization',
      email: namespace.email('pending-team-invitee'),
      token: namespace.invitationToken('pending-team-invitation'),
      role: 'member',
      expiresAt: '2099-01-01T00:00:00.000Z',
      workspaceGrants: [
        { workspaceKey: 'team-workspace', access: 'read' },
        { workspaceKey: 'team-invitation-workspace', access: 'write' },
      ],
    },
  ] as const

  const personas: ScenarioPersona[] = [
    persona(namespace, 'personalFreeOwner', 'personal-free-owner', [
      expected('personal-free-workspace', 'admin', 'owner', 'owner', 'user', 'free', true),
      expected('team-workspace', 'none', 'none', 'external', 'organization', 'team_6000', false),
    ]),
    persona(namespace, 'personalPaidOwner', 'personal-paid-owner', [
      expected('personal-paid-workspace', 'admin', 'owner', 'owner', 'user', 'pro_6000', true),
    ]),
    persona(namespace, 'personalMaxOwner', 'personal-max-owner', [
      expected('personal-max-workspace', 'admin', 'owner', 'owner', 'user', 'pro_25000', true),
    ]),
    persona(namespace, 'paidOrganizationOwner', 'paid-organization-owner', [
      expected('team-workspace', 'admin', 'owner', 'owner', 'organization', 'team_6000', true),
      expected(
        'team-invitation-workspace',
        'admin',
        'owner',
        'owner',
        'organization',
        'team_6000',
        true
      ),
    ]),
    persona(namespace, 'workspaceReadMember', 'workspace-read-member', [
      expected('team-workspace', 'read', 'explicit', 'member', 'organization', 'team_6000', false),
    ]),
    persona(namespace, 'workspaceWriteMember', 'workspace-write-member', [
      expected('team-workspace', 'write', 'explicit', 'member', 'organization', 'team_6000', false),
    ]),
    persona(namespace, 'workspaceAdminMember', 'workspace-admin-member', [
      expected('team-workspace', 'admin', 'explicit', 'member', 'organization', 'team_6000', false),
    ]),
    persona(namespace, 'externalWorkspaceAdmin', 'external-workspace-admin', [
      expected(
        'team-workspace',
        'admin',
        'explicit',
        'external',
        'organization',
        'team_6000',
        false
      ),
    ]),
    persona(namespace, 'enterpriseOrganizationAdmin', 'enterprise-organization-admin', [
      expected(
        'enterprise-workspace',
        'admin',
        'org-admin',
        'member',
        'organization',
        'enterprise',
        false
      ),
    ]),
    persona(namespace, 'freeOrganizationOwner', 'free-organization-owner', [
      expected(
        'lapsed-organization-workspace',
        'admin',
        'owner',
        'owner',
        'organization',
        'free',
        true
      ),
    ]),
    persona(
      namespace,
      'permissionGroupRestricted',
      'permission-group-restricted',
      [
        expected(
          'enterprise-workspace',
          'read',
          'explicit',
          'member',
          'organization',
          'enterprise',
          false
        ),
      ],
      ['restricted-enterprise-group']
    ),
    persona(
      namespace,
      'platformAdmin',
      'platform-admin',
      [expected('platform-admin-workspace', 'admin', 'owner', 'owner', 'user', 'free', true)],
      [],
      'admin',
      true
    ),
  ]

  return {
    version: SCENARIO_VERSION,
    namespace: namespaceDescriptor(namespace),
    deployment: HOSTED_BILLING,
    users,
    organizations,
    organizationMemberships,
    subscriptions,
    workspaces,
    workspaceGrants,
    permissionGroups,
    invitations,
    personas,
  }
}

export function createIsolationTwinScenario(namespace: ScenarioNamespace): ScenarioDefinition {
  return {
    version: SCENARIO_VERSION,
    namespace: namespaceDescriptor(namespace),
    deployment: HOSTED_BILLING,
    users: [user(namespace, 'isolation-twin-owner')],
    organizations: [],
    organizationMemberships: [],
    subscriptions: [],
    workspaces: [personalWorkspace(namespace, 'isolation-twin-workspace', 'isolation-twin-owner')],
    workspaceGrants: [],
    permissionGroups: [],
    invitations: [],
    personas: [
      persona(namespace, 'isolationTwinOwner', 'isolation-twin-owner', [
        expected('isolation-twin-workspace', 'admin', 'owner', 'owner', 'user', 'free', true),
      ]),
    ],
  }
}

function user(namespace: ScenarioNamespace, key: string): ScenarioUser {
  return {
    key,
    email: namespace.email(key),
    name: namespace.name(key),
    platformRole: 'user',
    superUserModeEnabled: false,
    ...HOSTED_BILLING,
  }
}

function namespaceDescriptor(namespace: ScenarioNamespace) {
  return {
    run: namespace.run,
    world: namespace.world,
    prefix: namespace.prefix,
  }
}

function membership(organizationKey: string, userKey: string, role: 'owner' | 'admin' | 'member') {
  return { organizationKey, userKey, role } as const
}

function grant(workspaceKey: string, userKey: string, access: 'read' | 'write' | 'admin') {
  return { workspaceKey, userKey, access } as const
}

function personalWorkspace(
  namespace: ScenarioNamespace,
  key: string,
  ownerUserKey: string,
  subscriptionKey?: string
) {
  return {
    key,
    name: namespace.name(key),
    ownerUserKey,
    payer: { kind: 'user', userKey: ownerUserKey },
    ...(subscriptionKey ? { subscriptionKey } : {}),
    ...HOSTED_BILLING,
  } as const
}

function persona(
  namespace: ScenarioNamespace,
  key: string,
  userKey: string,
  workspaces: readonly PersonaWorkspaceExpectation[],
  permissionGroupKeys: readonly string[] = [],
  expectedPlatformRole: 'user' | 'admin' = 'user',
  expectedSuperUserMode = false
): ScenarioPersona {
  const canonicalWorkspace = workspaces.find(({ access }) => access !== 'none')
  if (!canonicalWorkspace) throw new Error(`Persona "${key}" needs an accessible workspace`)
  return {
    key,
    userKey,
    storageStateFilename: namespace.storageStateFilename(key),
    workspaces,
    permissionGroupKeys,
    canonicalRoute: {
      workspaceKey: canonicalWorkspace.workspaceKey,
      settingsSection: 'general',
    },
    expectedPlatformRole,
    expectedSuperUserMode,
  }
}

function expected(
  workspaceKey: string,
  access: ExpectedWorkspaceAccess,
  roleSource: RoleSource,
  hostMembership: 'owner' | 'member' | 'external',
  payerScope: 'user' | 'organization',
  plan: 'free' | SubscriptionPlan,
  isOwner: boolean
): PersonaWorkspaceExpectation {
  return {
    workspaceKey,
    access,
    roleSource,
    hostContext: {
      isOwner,
      hostMembership,
      payerScope,
      plan,
      ...HOSTED_BILLING,
    },
  }
}
