import type {
  ExpectedWorkspaceAccess,
  OrganizationRole,
  ResolvedPersona,
  ResolvedScenario,
  ResourceKey,
  ScenarioDefinition,
  ScenarioOrganization,
  ScenarioPermissionGroup,
  ScenarioSubscription,
  ScenarioUser,
  ScenarioWorkspace,
  ScenarioWorkspaceGrant,
} from './scenario'
import { SCENARIO_VERSION } from './scenario'
import { billingReferenceKey, isEntitledSubscription } from './scenario-billing'

export class ScenarioValidationError extends Error {
  readonly issues: readonly string[]

  constructor(issues: readonly string[]) {
    super(`Invalid E2E scenario:\n- ${issues.join('\n- ')}`)
    this.name = 'ScenarioValidationError'
    this.issues = issues
  }
}

const RESOURCE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/
const STORAGE_STATE_FILENAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/

export function validateScenario(definition: ScenarioDefinition): ResolvedScenario {
  const issues: string[] = []
  if (definition.version !== SCENARIO_VERSION) {
    issues.push(`version must be ${SCENARIO_VERSION}`)
  }
  if (!definition.namespace.run || !definition.namespace.world || !definition.namespace.prefix) {
    issues.push('namespace run, world, and prefix must be non-empty')
  }

  const usersByKey = indexByKey('user', definition.users, issues)
  const organizationsByKey = indexByKey('organization', definition.organizations, issues)
  const subscriptionsByKey = indexByKey('subscription', definition.subscriptions, issues)
  const workspacesByKey = indexByKey('workspace', definition.workspaces, issues)
  const permissionGroupsByKey = indexByKey('permission group', definition.permissionGroups, issues)
  const invitationsByKey = indexByKey('invitation', definition.invitations, issues)
  indexByKey('persona', definition.personas, issues)

  validateControllableIdentities(definition, issues)
  validateDeploymentFlags(definition, issues)
  validateMemberships(definition, usersByKey, organizationsByKey, issues)
  validateOrganizations(definition, usersByKey, issues)
  validateSubscriptions(definition, usersByKey, organizationsByKey, issues)
  validateWorkspaces(definition, usersByKey, organizationsByKey, subscriptionsByKey, issues)
  validateWorkspaceGrants(definition.workspaceGrants, usersByKey, workspacesByKey, issues)
  validatePermissionGroups(definition, usersByKey, organizationsByKey, workspacesByKey, issues)
  validateInvitations(definition, organizationsByKey, workspacesByKey, issues)

  const resolvedPersonas = new Map<ResourceKey, ResolvedPersona>()
  for (const persona of definition.personas) {
    const user = usersByKey.get(persona.userKey)
    if (!user) {
      issues.push(`persona "${persona.key}" references missing user "${persona.userKey}"`)
      continue
    }
    if (persona.workspaces.filter(({ access }) => access !== 'none').length === 0) {
      issues.push(`persona "${persona.key}" has zero accessible seeded workspaces`)
    }
    validateUniqueValues(
      `persona "${persona.key}" workspace expectation`,
      persona.workspaces.map(({ workspaceKey }) => workspaceKey),
      issues
    )
    validateUniqueValues(
      `persona "${persona.key}" permission group`,
      persona.permissionGroupKeys,
      issues
    )

    const resolvedWorkspaces: ResolvedPersona['workspaces'][number][] = []
    for (const expectation of persona.workspaces) {
      const workspace = workspacesByKey.get(expectation.workspaceKey)
      if (!workspace) {
        issues.push(
          `persona "${persona.key}" references missing workspace "${expectation.workspaceKey}"`
        )
        continue
      }
      validatePersonaWorkspaceExpectation(
        definition,
        persona.key,
        user,
        workspace,
        expectation,
        subscriptionsByKey,
        issues
      )
      resolvedWorkspaces.push({ expectation, workspace })
    }

    const routeExpectation = persona.workspaces.find(
      ({ workspaceKey }) => workspaceKey === persona.canonicalRoute.workspaceKey
    )
    if (!routeExpectation || routeExpectation.access === 'none') {
      issues.push(
        `persona "${persona.key}" canonical route must target an accessible declared workspace`
      )
    }

    const expectedGroups = groupsForUser(definition, user.key)
    if (
      !sameSet(
        persona.permissionGroupKeys,
        expectedGroups.map(({ key }) => key)
      )
    ) {
      issues.push(`persona "${persona.key}" permission-group expectations do not match its grants`)
    }
    const resolvedGroups = persona.permissionGroupKeys
      .map((key) => permissionGroupsByKey.get(key))
      .filter((group): group is ScenarioPermissionGroup => group !== undefined)

    const platformRole = user.platformRole ?? 'user'
    if (persona.expectedPlatformRole !== platformRole) {
      issues.push(`persona "${persona.key}" has an inconsistent expected platform role`)
    }
    if (persona.expectedSuperUserMode !== (user.superUserModeEnabled ?? false)) {
      issues.push(`persona "${persona.key}" has an inconsistent expected superuser setting`)
    }
    if (platformRole === 'admin' && !user.superUserModeEnabled) {
      issues.push(`platform admin user "${user.key}" must enable superuser mode`)
    }
    if (user.superUserModeEnabled && platformRole !== 'admin') {
      issues.push(`superuser user "${user.key}" must also have the platform admin role`)
    }

    resolvedPersonas.set(persona.key, {
      definition: persona,
      user,
      workspaces: resolvedWorkspaces,
      permissionGroups: resolvedGroups,
    })
  }

  if (issues.length > 0) throw new ScenarioValidationError(issues)

  return {
    definition,
    usersByKey,
    organizationsByKey,
    subscriptionsByKey,
    workspacesByKey,
    permissionGroupsByKey,
    invitationsByKey,
    personasByKey: resolvedPersonas,
  }
}

export function validateScenarioSet(scenarios: readonly ResolvedScenario[]): void {
  const issues: string[] = []
  validateUniqueValues(
    'world namespace',
    scenarios.map(({ definition }) => definition.namespace.world),
    issues
  )
  validateUniqueValues(
    'world namespace prefix',
    scenarios.map(({ definition }) => definition.namespace.prefix),
    issues
  )
  validateUniqueValues(
    'cross-world email',
    scenarios.flatMap(({ definition }) => [
      ...definition.users.map(({ email }) => email.toLowerCase()),
      ...definition.invitations.map(({ email }) => email.toLowerCase()),
    ]),
    issues
  )
  validateUniqueValues(
    'cross-world organization slug',
    scenarios.flatMap(({ definition }) =>
      definition.organizations.map(({ slug }) => slug.toLowerCase())
    ),
    issues
  )
  validateUniqueValues(
    'cross-world persona key',
    scenarios.flatMap(({ definition }) => definition.personas.map(({ key }) => key)),
    issues
  )
  validateUniqueValues(
    'cross-world storage-state filename',
    scenarios.flatMap(({ definition }) =>
      definition.personas.map(({ storageStateFilename }) => storageStateFilename)
    ),
    issues
  )
  if (issues.length > 0) throw new ScenarioValidationError(issues)
}

function indexByKey<T extends { key: ResourceKey }>(
  label: string,
  values: readonly T[],
  issues: string[]
): Map<ResourceKey, T> {
  const result = new Map<ResourceKey, T>()
  for (const value of values) {
    if (!value.key.trim()) {
      issues.push(`${label} key must be non-empty`)
    } else if (!RESOURCE_KEY_PATTERN.test(value.key)) {
      issues.push(`${label} key "${value.key}" must be a safe identifier`)
    } else if (result.has(value.key)) {
      issues.push(`duplicate ${label} key "${value.key}"`)
    } else {
      result.set(value.key, value)
    }
  }
  return result
}

function validateControllableIdentities(definition: ScenarioDefinition, issues: string[]): void {
  validateUniqueValues(
    'email',
    [
      ...definition.users.map(({ email }) => email.toLowerCase()),
      ...definition.invitations.map(({ email }) => email.toLowerCase()),
    ],
    issues
  )
  validateUniqueValues(
    'user name',
    definition.users.map(({ name }) => name),
    issues
  )
  validateUniqueValues(
    'organization name',
    definition.organizations.map(({ name }) => name),
    issues
  )
  validateUniqueValues(
    'organization slug',
    definition.organizations.map(({ slug }) => slug.toLowerCase()),
    issues
  )
  validateUniqueValues(
    'workspace name',
    definition.workspaces.map(({ name }) => name),
    issues
  )
  validateUniqueValues(
    'permission-group name',
    definition.permissionGroups.map(
      ({ organizationKey, name }) => `${organizationKey}\0${name.toLowerCase()}`
    ),
    issues
  )
  validateUniqueValues(
    'invitation token',
    definition.invitations.map(({ token }) => token),
    issues
  )
  validateUniqueValues(
    'storage-state filename',
    definition.personas.map(({ storageStateFilename }) => storageStateFilename),
    issues
  )
  for (const { storageStateFilename } of definition.personas) {
    if (
      !STORAGE_STATE_FILENAME_PATTERN.test(storageStateFilename) ||
      storageStateFilename.includes('..')
    ) {
      issues.push(
        `storage-state filename "${storageStateFilename}" must be a separator-free JSON basename`
      )
    }
  }
}

function validateUniqueValues(label: string, values: readonly string[], issues: string[]): void {
  const seen = new Set<string>()
  for (const value of values) {
    if (!value.trim()) {
      issues.push(`${label} must be non-empty`)
    } else if (seen.has(value)) {
      issues.push(`duplicate ${label} "${value.replace('\0', '/')}"`)
    } else {
      seen.add(value)
    }
  }
}

function validateDeploymentFlags(definition: ScenarioDefinition, issues: string[]): void {
  const resources = [
    ...definition.users.map((resource) => ({ kind: 'user', resource })),
    ...definition.organizations.map((resource) => ({ kind: 'organization', resource })),
    ...definition.subscriptions.map((resource) => ({ kind: 'subscription', resource })),
    ...definition.workspaces.map((resource) => ({ kind: 'workspace', resource })),
  ]
  for (const { kind, resource } of resources) {
    if (resource.hosted !== definition.deployment.hosted) {
      issues.push(`${kind} "${resource.key}" has an inconsistent hosted flag`)
    }
    if (resource.billingEnabled !== definition.deployment.billingEnabled) {
      issues.push(`${kind} "${resource.key}" has an inconsistent billing flag`)
    }
  }
  if (!definition.deployment.billingEnabled && definition.subscriptions.length > 0) {
    issues.push('billing-disabled scenarios cannot contain subscriptions')
  }
}

function validateMemberships(
  definition: ScenarioDefinition,
  usersByKey: ReadonlyMap<ResourceKey, ScenarioUser>,
  organizationsByKey: ReadonlyMap<ResourceKey, ScenarioOrganization>,
  issues: string[]
): void {
  const pairs = new Set<string>()
  const organizationByUser = new Map<ResourceKey, ResourceKey>()
  for (const membership of definition.organizationMemberships) {
    const pair = `${membership.organizationKey}\0${membership.userKey}`
    if (pairs.has(pair)) {
      issues.push(
        `duplicate organization membership "${membership.organizationKey}/${membership.userKey}"`
      )
    }
    pairs.add(pair)
    if (!organizationsByKey.has(membership.organizationKey)) {
      issues.push(`membership references missing organization "${membership.organizationKey}"`)
    }
    if (!usersByKey.has(membership.userKey)) {
      issues.push(`membership references missing user "${membership.userKey}"`)
    }
    const previousOrganization = organizationByUser.get(membership.userKey)
    if (previousOrganization && previousOrganization !== membership.organizationKey) {
      issues.push(`user "${membership.userKey}" cannot belong to more than one organization`)
    }
    organizationByUser.set(membership.userKey, membership.organizationKey)
  }
}

function validateOrganizations(
  definition: ScenarioDefinition,
  usersByKey: ReadonlyMap<ResourceKey, ScenarioUser>,
  issues: string[]
): void {
  for (const organization of definition.organizations) {
    if (!usersByKey.has(organization.ownerUserKey)) {
      issues.push(
        `organization "${organization.key}" references missing owner "${organization.ownerUserKey}"`
      )
    }
    const ownerMemberships = definition.organizationMemberships.filter(
      (membership) =>
        membership.organizationKey === organization.key &&
        membership.userKey === organization.ownerUserKey &&
        membership.role === 'owner'
    )
    if (ownerMemberships.length !== 1) {
      issues.push(`organization "${organization.key}" must have exactly one owner membership`)
    }
    const otherOwners = definition.organizationMemberships.filter(
      (membership) =>
        membership.organizationKey === organization.key &&
        membership.role === 'owner' &&
        membership.userKey !== organization.ownerUserKey
    )
    if (otherOwners.length > 0) {
      issues.push(`organization "${organization.key}" cannot have a second owner membership`)
    }
  }
}

function validateSubscriptions(
  definition: ScenarioDefinition,
  usersByKey: ReadonlyMap<ResourceKey, ScenarioUser>,
  organizationsByKey: ReadonlyMap<ResourceKey, ScenarioOrganization>,
  issues: string[]
): void {
  const entitledBillingReferences = new Set<string>()
  for (const subscription of definition.subscriptions) {
    const reference = billingReferenceKey(subscription)
    if (subscription.billingReference.kind === 'user') {
      if (!usersByKey.has(subscription.billingReference.userKey)) {
        issues.push(
          `subscription "${subscription.key}" references missing user "${subscription.billingReference.userKey}"`
        )
      }
      if (subscription.plan.startsWith('team_') || subscription.plan === 'enterprise') {
        issues.push(`subscription "${subscription.key}" has an invalid plan for a user payer`)
      }
      if (subscription.status === 'lapsed') {
        issues.push(
          `subscription "${subscription.key}" uses unsupported lapsed status for a user payer`
        )
      }
    } else {
      const organizationKey = subscription.billingReference.organizationKey
      if (!organizationsByKey.has(organizationKey)) {
        issues.push(
          `subscription "${subscription.key}" references missing organization "${organizationKey}"`
        )
      }
      if (subscription.plan === 'pro_6000' || subscription.plan === 'pro_25000') {
        issues.push(
          `subscription "${subscription.key}" has an invalid plan for an organization payer`
        )
      }
      const memberCount = definition.organizationMemberships.filter(
        (membership) => membership.organizationKey === organizationKey
      ).length
      if (!subscription.seats || subscription.seats < memberCount) {
        issues.push(`subscription "${subscription.key}" seats do not cover organization members`)
      }
    }

    if (isEntitledSubscription(subscription)) {
      if (entitledBillingReferences.has(reference)) {
        issues.push(`billing reference "${reference}" has duplicate entitled subscriptions`)
      }
      entitledBillingReferences.add(reference)
    }

    if (subscription.plan === 'enterprise') {
      const metadata = subscription.enterprise
      if (
        !metadata ||
        metadata.plan !== 'enterprise' ||
        !Number.isFinite(metadata.monthlyPrice) ||
        metadata.monthlyPrice <= 0 ||
        !Number.isInteger(metadata.seats) ||
        metadata.seats < 1 ||
        metadata.seats !== subscription.seats
      ) {
        issues.push(`subscription "${subscription.key}" has invalid Enterprise metadata`)
      }
    } else if (subscription.enterprise) {
      issues.push(`non-Enterprise subscription "${subscription.key}" has Enterprise metadata`)
    }
  }
}

function validateWorkspaces(
  definition: ScenarioDefinition,
  usersByKey: ReadonlyMap<ResourceKey, ScenarioUser>,
  organizationsByKey: ReadonlyMap<ResourceKey, ScenarioOrganization>,
  subscriptionsByKey: ReadonlyMap<ResourceKey, ScenarioSubscription>,
  issues: string[]
): void {
  for (const workspace of definition.workspaces) {
    if (!usersByKey.has(workspace.ownerUserKey)) {
      issues.push(
        `workspace "${workspace.key}" references missing owner "${workspace.ownerUserKey}"`
      )
    }
    const subscription = workspace.subscriptionKey
      ? subscriptionsByKey.get(workspace.subscriptionKey)
      : undefined
    if (workspace.subscriptionKey && !subscription) {
      issues.push(
        `workspace "${workspace.key}" references missing subscription "${workspace.subscriptionKey}"`
      )
    }
    const entitledSubscription = definition.subscriptions.find(
      (candidate) =>
        isEntitledSubscription(candidate) &&
        billingReferenceKey(candidate) === payerReferenceKey(workspace)
    )
    if (entitledSubscription && subscription?.key !== entitledSubscription.key) {
      issues.push(
        `workspace "${workspace.key}" must reference its payer's current entitled subscription "${entitledSubscription.key}"`
      )
    }

    if (workspace.organizationKey) {
      if (!organizationsByKey.has(workspace.organizationKey)) {
        issues.push(
          `workspace "${workspace.key}" references missing organization "${workspace.organizationKey}"`
        )
      }
      if (
        workspace.payer.kind !== 'organization' ||
        workspace.payer.organizationKey !== workspace.organizationKey
      ) {
        issues.push(`organization workspace "${workspace.key}" has an incoherent payer`)
      }
      const ownerMembership = membershipFor(
        definition,
        workspace.organizationKey,
        workspace.ownerUserKey
      )
      const organization = organizationsByKey.get(workspace.organizationKey)
      if (
        !ownerMembership ||
        ownerMembership.role !== 'owner' ||
        organization?.ownerUserKey !== workspace.ownerUserKey
      ) {
        issues.push(
          `organization workspace "${workspace.key}" creator must be the organization owner`
        )
      }
      if (!subscription) {
        issues.push(`organization workspace "${workspace.key}" must retain its subscription record`)
      } else if (
        subscription.billingReference.kind !== 'organization' ||
        subscription.billingReference.organizationKey !== workspace.organizationKey
      ) {
        issues.push(`organization workspace "${workspace.key}" has an incoherent subscription`)
      }
      if (subscription?.status === 'past_due') {
        issues.push(
          `organization workspace "${workspace.key}" cannot be provisioned from a past-due subscription`
        )
      }
    } else {
      if (workspace.payer.kind !== 'user' || workspace.payer.userKey !== workspace.ownerUserKey) {
        issues.push(`personal workspace "${workspace.key}" has an incoherent payer/owner`)
      }
      if (
        subscription &&
        (subscription.billingReference.kind !== 'user' ||
          subscription.billingReference.userKey !== workspace.ownerUserKey)
      ) {
        issues.push(`personal workspace "${workspace.key}" has an incoherent subscription`)
      }
    }
  }
}

function validateWorkspaceGrants(
  grants: readonly ScenarioWorkspaceGrant[],
  usersByKey: ReadonlyMap<ResourceKey, ScenarioUser>,
  workspacesByKey: ReadonlyMap<ResourceKey, ScenarioWorkspace>,
  issues: string[]
): void {
  const pairs = new Set<string>()
  for (const grant of grants) {
    const pair = `${grant.workspaceKey}\0${grant.userKey}`
    if (pairs.has(pair)) {
      issues.push(`duplicate workspace grant "${grant.workspaceKey}/${grant.userKey}"`)
    }
    pairs.add(pair)
    if (!workspacesByKey.has(grant.workspaceKey)) {
      issues.push(`workspace grant references missing workspace "${grant.workspaceKey}"`)
    }
    if (!usersByKey.has(grant.userKey)) {
      issues.push(`workspace grant references missing user "${grant.userKey}"`)
    }
  }
}

function validatePermissionGroups(
  definition: ScenarioDefinition,
  usersByKey: ReadonlyMap<ResourceKey, ScenarioUser>,
  organizationsByKey: ReadonlyMap<ResourceKey, ScenarioOrganization>,
  workspacesByKey: ReadonlyMap<ResourceKey, ScenarioWorkspace>,
  issues: string[]
): void {
  for (const group of definition.permissionGroups) {
    if (!organizationsByKey.has(group.organizationKey)) {
      issues.push(
        `permission group "${group.key}" references missing organization "${group.organizationKey}"`
      )
    }
    if (group.workspaceKeys.length === 0) {
      issues.push(`permission group "${group.key}" must have Enterprise workspace scope`)
    }
    if (group.memberUserKeys.length === 0) {
      issues.push(
        `permission group "${group.key}" must name explicit members; default and all-member groups are not modeled`
      )
    }
    validateUniqueValues(
      `permission group "${group.key}" workspace scope`,
      group.workspaceKeys,
      issues
    )
    validateUniqueValues(`permission group "${group.key}" member`, group.memberUserKeys, issues)

    const enterpriseSubscription = definition.subscriptions.find(
      (subscription) =>
        subscription.billingReference.kind === 'organization' &&
        subscription.billingReference.organizationKey === group.organizationKey &&
        subscription.plan === 'enterprise' &&
        subscription.status === 'active'
    )
    if (!enterpriseSubscription) {
      issues.push(`permission group "${group.key}" requires an active Enterprise organization`)
    }
    for (const workspaceKey of group.workspaceKeys) {
      const workspace = workspacesByKey.get(workspaceKey)
      if (!workspace) {
        issues.push(
          `permission group "${group.key}" references missing workspace "${workspaceKey}"`
        )
      } else if (
        workspace.organizationKey !== group.organizationKey ||
        workspace.subscriptionKey !== enterpriseSubscription?.key
      ) {
        issues.push(
          `permission group "${group.key}" workspace "${workspaceKey}" is outside its Enterprise scope`
        )
      }
    }
    for (const userKey of group.memberUserKeys) {
      if (!usersByKey.has(userKey)) {
        issues.push(`permission group "${group.key}" references missing user "${userKey}"`)
      }
      if (!membershipFor(definition, group.organizationKey, userKey)) {
        issues.push(`permission group "${group.key}" member "${userKey}" lacks host membership`)
      }
    }
  }
}

function validateInvitations(
  definition: ScenarioDefinition,
  organizationsByKey: ReadonlyMap<ResourceKey, ScenarioOrganization>,
  workspacesByKey: ReadonlyMap<ResourceKey, ScenarioWorkspace>,
  issues: string[]
): void {
  for (const invitation of definition.invitations) {
    if (!organizationsByKey.has(invitation.organizationKey)) {
      issues.push(
        `invitation "${invitation.key}" references missing organization "${invitation.organizationKey}"`
      )
    }
    if (Number.isNaN(Date.parse(invitation.expiresAt))) {
      issues.push(`invitation "${invitation.key}" has an invalid expiry`)
    }
    validateUniqueValues(
      `invitation "${invitation.key}" workspace grant`,
      invitation.workspaceGrants.map(({ workspaceKey }) => workspaceKey),
      issues
    )
    for (const grant of invitation.workspaceGrants) {
      const workspace = workspacesByKey.get(grant.workspaceKey)
      if (!workspace) {
        issues.push(
          `invitation "${invitation.key}" references missing workspace "${grant.workspaceKey}"`
        )
      } else if (workspace.organizationKey !== invitation.organizationKey) {
        issues.push(`invitation "${invitation.key}" grants a workspace outside its organization`)
      }
    }
  }
}

function validatePersonaWorkspaceExpectation(
  definition: ScenarioDefinition,
  personaKey: ResourceKey,
  user: ScenarioUser,
  workspace: ScenarioWorkspace,
  expected: {
    access: ExpectedWorkspaceAccess
    roleSource: 'owner' | 'explicit' | 'org-admin' | 'none'
    hostContext: {
      isOwner: boolean
      hostMembership: 'owner' | 'member' | 'external'
      payerScope: 'user' | 'organization'
      plan: 'free' | ScenarioSubscription['plan']
      hosted: boolean
      billingEnabled: boolean
    }
  },
  subscriptionsByKey: ReadonlyMap<ResourceKey, ScenarioSubscription>,
  issues: string[]
): void {
  const declaredSubscription = workspace.subscriptionKey
    ? subscriptionsByKey.get(workspace.subscriptionKey)
    : undefined
  const entitledSubscription = [...subscriptionsByKey.values()].find(
    (candidate) =>
      isEntitledSubscription(candidate) &&
      billingReferenceKey(candidate) === payerReferenceKey(workspace)
  )
  const organizationWillDetach = Boolean(
    workspace.organizationKey && declaredSubscription?.status === 'lapsed' && !entitledSubscription
  )
  const actual = deriveWorkspaceAccess(definition, user.key, workspace, !organizationWillDetach)
  if (expected.access !== actual.access || expected.roleSource !== actual.roleSource) {
    issues.push(
      `persona "${personaKey}" has incoherent access/roleSource for workspace "${workspace.key}"`
    )
  }
  if (
    (actual.isOwner ||
      actual.organizationRole === 'owner' ||
      actual.organizationRole === 'admin') &&
    expected.access !== 'admin'
  ) {
    issues.push(
      `persona "${personaKey}" owner/admin expectation for "${workspace.key}" is below admin`
    )
  }
  const actualPlan = entitledSubscription?.plan ?? 'free'
  const actualMembership = actual.isOwner
    ? 'owner'
    : actual.organizationRole
      ? 'member'
      : 'external'
  const actualPayerScope = organizationWillDetach ? 'user' : workspace.payer.kind
  if (
    expected.hostContext.isOwner !== actual.isOwner ||
    expected.hostContext.hostMembership !== actualMembership ||
    expected.hostContext.payerScope !== actualPayerScope ||
    expected.hostContext.plan !== actualPlan ||
    expected.hostContext.hosted !== workspace.hosted ||
    expected.hostContext.billingEnabled !== workspace.billingEnabled
  ) {
    issues.push(`persona "${personaKey}" has an incoherent host context for "${workspace.key}"`)
  }
}

function deriveWorkspaceAccess(
  definition: ScenarioDefinition,
  userKey: ResourceKey,
  workspace: ScenarioWorkspace,
  includeOrganizationMembership = true
): {
  access: ExpectedWorkspaceAccess
  roleSource: 'owner' | 'explicit' | 'org-admin' | 'none'
  isOwner: boolean
  organizationRole?: OrganizationRole
} {
  const isOwner = workspace.ownerUserKey === userKey
  const organizationRole =
    includeOrganizationMembership && workspace.organizationKey
      ? membershipFor(definition, workspace.organizationKey, userKey)?.role
      : undefined
  if (isOwner) return { access: 'admin', roleSource: 'owner', isOwner, organizationRole }
  if (organizationRole === 'owner' || organizationRole === 'admin') {
    return { access: 'admin', roleSource: 'org-admin', isOwner, organizationRole }
  }
  const grant = definition.workspaceGrants.find(
    (candidate) => candidate.workspaceKey === workspace.key && candidate.userKey === userKey
  )
  if (grant) {
    return { access: grant.access, roleSource: 'explicit', isOwner, organizationRole }
  }
  return { access: 'none', roleSource: 'none', isOwner, organizationRole }
}

function groupsForUser(
  definition: ScenarioDefinition,
  userKey: ResourceKey
): ScenarioPermissionGroup[] {
  return definition.permissionGroups.filter((group) => group.memberUserKeys.includes(userKey))
}

function membershipFor(
  definition: ScenarioDefinition,
  organizationKey: ResourceKey,
  userKey: ResourceKey
): ScenarioDefinition['organizationMemberships'][number] | undefined {
  return definition.organizationMemberships.find(
    (membership) => membership.organizationKey === organizationKey && membership.userKey === userKey
  )
}

function payerReferenceKey(workspace: ScenarioWorkspace): string {
  return workspace.payer.kind === 'user'
    ? `user/${workspace.payer.userKey}`
    : `organization/${workspace.payer.organizationKey}`
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value))
}
