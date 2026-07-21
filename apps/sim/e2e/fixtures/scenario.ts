export const SCENARIO_VERSION = 1 as const

export type ScenarioVersion = typeof SCENARIO_VERSION
export type ResourceKey = string
export type WorkspaceAccess = 'read' | 'write' | 'admin'
export type ExpectedWorkspaceAccess = WorkspaceAccess | 'none'
export type RoleSource = 'owner' | 'explicit' | 'org-admin' | 'none'
export type OrganizationRole = 'owner' | 'admin' | 'member'
export type SubscriptionPlan = 'pro_6000' | 'pro_25000' | 'team_6000' | 'team_25000' | 'enterprise'
export type SubscriptionStatus = 'active' | 'past_due' | 'lapsed'
export type SettingsSection = 'general' | 'secrets' | 'api-keys' | 'inbox' | 'mcp' | 'custom-tools'

export interface ScenarioNamespaceDescriptor {
  run: string
  world: string
  prefix: string
}

export interface ScenarioDeployment {
  hosted: boolean
  billingEnabled: boolean
}

export interface ScenarioUser {
  key: ResourceKey
  email: string
  name: string
  hosted: boolean
  billingEnabled: boolean
  platformRole?: 'user' | 'admin'
  superUserModeEnabled?: boolean
}

export interface ScenarioOrganization {
  key: ResourceKey
  name: string
  slug: string
  ownerUserKey: ResourceKey
  hosted: boolean
  billingEnabled: boolean
}

export interface ScenarioOrganizationMembership {
  organizationKey: ResourceKey
  userKey: ResourceKey
  role: OrganizationRole
}

export interface EnterpriseSubscriptionMetadata {
  plan: 'enterprise'
  monthlyPrice: number
  seats: number
}

export interface ScenarioSubscription {
  key: ResourceKey
  plan: SubscriptionPlan
  status: SubscriptionStatus
  billingReference:
    | { kind: 'user'; userKey: ResourceKey }
    | { kind: 'organization'; organizationKey: ResourceKey }
  hosted: boolean
  billingEnabled: boolean
  seats?: number
  enterprise?: EnterpriseSubscriptionMetadata
}

export interface ScenarioWorkspace {
  key: ResourceKey
  name: string
  ownerUserKey: ResourceKey
  organizationKey?: ResourceKey
  payer:
    | { kind: 'user'; userKey: ResourceKey }
    | { kind: 'organization'; organizationKey: ResourceKey }
  subscriptionKey?: ResourceKey
  hosted: boolean
  billingEnabled: boolean
}

export interface ScenarioWorkspaceGrant {
  workspaceKey: ResourceKey
  userKey: ResourceKey
  access: WorkspaceAccess
}

export interface PermissionGroupRestrictions {
  hiddenSettings: readonly SettingsSection[]
  disabledFeatures: readonly ('mcp' | 'custom-tools')[]
}

export interface ScenarioPermissionGroup {
  key: ResourceKey
  name: string
  organizationKey: ResourceKey
  workspaceKeys: readonly ResourceKey[]
  memberUserKeys: readonly ResourceKey[]
  restrictions: PermissionGroupRestrictions
}

export interface ScenarioInvitation {
  key: ResourceKey
  organizationKey: ResourceKey
  email: string
  token: string
  role: Exclude<OrganizationRole, 'owner'>
  expiresAt: string
  workspaceGrants: readonly {
    workspaceKey: ResourceKey
    access: WorkspaceAccess
  }[]
}

export interface PersonaWorkspaceExpectation {
  workspaceKey: ResourceKey
  access: ExpectedWorkspaceAccess
  roleSource: RoleSource
  hostContext: {
    isOwner: boolean
    hostMembership: 'owner' | 'member' | 'external'
    payerScope: 'user' | 'organization'
    plan: 'free' | SubscriptionPlan
    hosted: boolean
    billingEnabled: boolean
  }
}

export interface ScenarioPersona {
  key: ResourceKey
  userKey: ResourceKey
  storageStateFilename: string
  workspaces: readonly PersonaWorkspaceExpectation[]
  permissionGroupKeys: readonly ResourceKey[]
  canonicalRoute: {
    workspaceKey: ResourceKey
    settingsSection: SettingsSection
  }
  expectedPlatformRole: 'user' | 'admin'
  expectedSuperUserMode: boolean
}

/**
 * Pure declaration consumed by later factories. Keys are graph-local references, never production IDs.
 * Factories must record API-generated IDs separately and keep them opaque.
 */
export interface ScenarioDefinition {
  version: ScenarioVersion
  namespace: ScenarioNamespaceDescriptor
  deployment: ScenarioDeployment
  users: readonly ScenarioUser[]
  organizations: readonly ScenarioOrganization[]
  organizationMemberships: readonly ScenarioOrganizationMembership[]
  subscriptions: readonly ScenarioSubscription[]
  workspaces: readonly ScenarioWorkspace[]
  workspaceGrants: readonly ScenarioWorkspaceGrant[]
  permissionGroups: readonly ScenarioPermissionGroup[]
  invitations: readonly ScenarioInvitation[]
  personas: readonly ScenarioPersona[]
}

export interface ResolvedPersona {
  definition: ScenarioPersona
  user: ScenarioUser
  workspaces: readonly {
    expectation: PersonaWorkspaceExpectation
    workspace: ScenarioWorkspace
  }[]
  permissionGroups: readonly ScenarioPermissionGroup[]
}

export interface ResolvedScenario {
  definition: ScenarioDefinition
  usersByKey: ReadonlyMap<ResourceKey, ScenarioUser>
  organizationsByKey: ReadonlyMap<ResourceKey, ScenarioOrganization>
  subscriptionsByKey: ReadonlyMap<ResourceKey, ScenarioSubscription>
  workspacesByKey: ReadonlyMap<ResourceKey, ScenarioWorkspace>
  permissionGroupsByKey: ReadonlyMap<ResourceKey, ScenarioPermissionGroup>
  invitationsByKey: ReadonlyMap<ResourceKey, ScenarioInvitation>
  personasByKey: ReadonlyMap<ResourceKey, ResolvedPersona>
}

export function canonicalSettingsRoute(workspaceId: string, section: SettingsSection): string {
  return `/workspace/${encodeURIComponent(workspaceId)}/settings/${section}`
}
