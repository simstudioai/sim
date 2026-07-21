import { randomBytes } from 'node:crypto'
import { db } from '@sim/db'
import {
  invitation,
  invitationWorkspaceGrant,
  member,
  permissions,
  subscription,
  user,
  userStats,
} from '@sim/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import {
  buildScenarioManifest,
  createWorldRecords,
  type E2EWorld,
  PERSONA_MANIFEST_VERSION,
  type PersonaCredentials,
  writeJsonAtomic,
} from '../fixtures/e2e-world'
import { arrangeSubscription, lapseOrganizationSubscription } from '../fixtures/factories/billing'
import { arrangePendingInvitation } from '../fixtures/factories/invitations'
import {
  addOrganizationMember,
  createAdminClient,
  createOrganization,
} from '../fixtures/factories/organizations'
import {
  addPermissionGroupMember,
  createPermissionGroup,
} from '../fixtures/factories/permission-groups'
import { arrangeEffectivePlatformAdmin } from '../fixtures/factories/platform'
import {
  createAuthenticatedClient,
  createSyntheticUser,
  type SyntheticLogin,
} from '../fixtures/factories/users'
import { createWorkspace, grantWorkspacePermission } from '../fixtures/factories/workspaces'
import { E2eHttpClient } from '../fixtures/http-client'
import type { ResolvedScenario, ScenarioSubscription } from '../fixtures/scenario'
import { validateScenario, validateScenarioSet } from '../fixtures/validate-scenario'
import { createSettingsPersonaScenarios } from '../settings/personas'
import { writeSyntheticSecretCanary } from '../support/leak-canary'
import { assertSafeSeedEnvironment } from '../support/seed-safety'

const requiredEnvSchema = z.object({
  E2E_RUN_ID: z.string().min(1),
  E2E_ORCHESTRATED: z.literal('1'),
  E2E_PROFILE: z.string().min(1),
  E2E_BASE_URL: z.string().url(),
  ADMIN_API_KEY: z.string().min(1),
  DATABASE_URL: z.string().url(),
  E2E_MANIFEST_PATH: z.string().min(1),
  E2E_CREDENTIALS_PATH: z.string().min(1),
  E2E_CANARY_SECRETS_PATH: z.string().min(1),
})

async function main(): Promise<void> {
  const env = requiredEnvSchema.parse(process.env)
  assertSafeSeedEnvironment(env)
  const definitions = createSettingsPersonaScenarios(env.E2E_RUN_ID)
  const scenarios = [
    validateScenario(definitions.primary),
    validateScenario(definitions.isolationTwin),
  ]
  validateScenarioSet(scenarios)
  const adminClient = createAdminClient(env.E2E_BASE_URL, env.ADMIN_API_KEY)
  const attemptCounts = new Map<string, number>()
  const worlds: E2EWorld[] = []
  const loginsByWorldAndUser = buildSyntheticLogins(scenarios)
  const ownerClients = new Map<string, E2eHttpClient>()
  writeSyntheticSecretCanary(env.E2E_CANARY_SECRETS_PATH, env.E2E_RUN_ID, [
    ...[...loginsByWorldAndUser.values()].map(({ password }) => password),
    ...scenarios.flatMap(({ definition }) => definition.invitations.map(({ token }) => token)),
  ])
  writeJsonAtomic(
    env.E2E_CREDENTIALS_PATH,
    buildPersonaCredentials(env.E2E_RUN_ID, scenarios, loginsByWorldAndUser)
  )

  for (const scenario of scenarios) {
    const world: E2EWorld = { scenario, records: createWorldRecords() }
    await createUsers(world, env.E2E_BASE_URL, attemptCounts, loginsByWorldAndUser)
    await createOrganizationsAndSubscriptions(world, adminClient)
    await addMemberships(world, adminClient)
    await createScenarioWorkspaces(
      world,
      env.E2E_BASE_URL,
      loginsByWorldAndUser,
      ownerClients,
      attemptCounts
    )
    await lapsePlannedSubscriptions(world)
    await createGrantsAndPermissionGroups(world, adminClient, ownerClients)
    await arrangePlatformAdminsAndInvitations(world)
    await recordProductionPermissionIds(world)
    await assertTrustedWorldInvariants(world)
    worlds.push(world)
  }

  await assertSecondOrganizationIsRejected(worlds, adminClient)
  const manifest = buildScenarioManifest(env.E2E_RUN_ID, worlds)
  writeJsonAtomic(env.E2E_MANIFEST_PATH, manifest)

  console.info(
    `Seeded ${Object.keys(manifest.personas).length} personas across ${worlds.length} isolated worlds`
  )
  console.info(
    `Auth attempts: ${[...attemptCounts.entries()]
      .map(([operation, count]) => `${operation}=${count}`)
      .join(', ')}`
  )
}

async function createUsers(
  world: E2EWorld,
  baseUrl: string,
  attemptCounts: Map<string, number>,
  logins: Map<string, SyntheticLogin>
): Promise<void> {
  for (const user of world.scenario.definition.users) {
    const login = required(logins, worldUserKey(world.scenario, user.key), 'synthetic login')
    const created = await createSyntheticUser(
      new E2eHttpClient({
        baseUrl,
        onAttempt: ({ path }) => increment(attemptCounts, `signup:${path}`),
      }),
      login
    )
    if (created.email !== user.email || created.name !== user.name) {
      throw new Error(`Production signup returned an unexpected identity for ${user.key}`)
    }
    world.records.users.set(user.key, created)
  }
}

async function createOrganizationsAndSubscriptions(
  world: E2EWorld,
  adminClient: E2eHttpClient
): Promise<void> {
  for (const organization of world.scenario.definition.organizations) {
    const owner = required(world.records.users, organization.ownerUserKey, 'organization owner')
    const created = await createOrganization(adminClient, {
      name: organization.name,
      slug: organization.slug,
      ownerId: owner.id,
    })
    if (created.name !== organization.name || created.slug !== organization.slug) {
      throw new Error(`Production organization identity mismatch for ${organization.key}`)
    }
    world.records.organizations.set(organization.key, {
      id: created.id,
      memberId: created.memberId,
      name: created.name,
      slug: created.slug,
    })
    world.records.organizationMembers.set(
      `${organization.key}:${organization.ownerUserKey}`,
      created.memberId
    )
  }

  for (const subscription of world.scenario.definition.subscriptions) {
    const referenceId = resolveBillingReference(world, subscription)
    const organizationKey =
      subscription.billingReference.kind === 'organization'
        ? subscription.billingReference.organizationKey
        : undefined
    const memberUserIds = organizationKey
      ? world.scenario.definition.organizationMemberships
          .filter((membership) => membership.organizationKey === organizationKey)
          .map(({ userKey }) => required(world.records.users, userKey, 'subscription member').id)
      : undefined
    const created = await arrangeSubscription({
      referenceId,
      plan: subscription.plan,
      status: subscription.status === 'lapsed' ? 'active' : subscription.status,
      seats: subscription.seats,
      memberUserIds,
      enterprise: subscription.enterprise
        ? { monthlyPrice: subscription.enterprise.monthlyPrice }
        : undefined,
    })
    world.records.subscriptions.set(subscription.key, created.id)
  }
}

async function addMemberships(world: E2EWorld, adminClient: E2eHttpClient): Promise<void> {
  for (const membership of world.scenario.definition.organizationMemberships) {
    if (membership.role === 'owner') continue
    const organization = required(
      world.records.organizations,
      membership.organizationKey,
      'organization'
    )
    const user = required(world.records.users, membership.userKey, 'organization member')
    const created = await addOrganizationMember(adminClient, organization.id, {
      userId: user.id,
      role: membership.role,
    })
    world.records.organizationMembers.set(
      `${membership.organizationKey}:${membership.userKey}`,
      created.id
    )
  }
}

async function createScenarioWorkspaces(
  world: E2EWorld,
  baseUrl: string,
  logins: Map<string, SyntheticLogin>,
  ownerClients: Map<string, E2eHttpClient>,
  attemptCounts: Map<string, number>
): Promise<void> {
  for (const workspace of world.scenario.definition.workspaces) {
    const login = required(
      logins,
      worldUserKey(world.scenario, workspace.ownerUserKey),
      'owner login'
    )
    const clientKey = worldUserKey(world.scenario, workspace.ownerUserKey)
    let client = ownerClients.get(clientKey)
    if (!client) {
      client = await createAuthenticatedClient(baseUrl, login, ({ path }) =>
        increment(attemptCounts, `signin:${path}`)
      )
      ownerClients.set(clientKey, client)
    }
    const created = await createWorkspace(client, { name: workspace.name })
    assertCreatedWorkspace(world, workspace, created)
    world.records.workspaces.set(workspace.key, { id: created.id, name: created.name })
  }
}

async function lapsePlannedSubscriptions(world: E2EWorld): Promise<void> {
  for (const subscription of world.scenario.definition.subscriptions) {
    if (subscription.status !== 'lapsed' || subscription.billingReference.kind !== 'organization') {
      continue
    }
    const organizationKey = subscription.billingReference.organizationKey
    const organizationId = required(
      world.records.organizations,
      organizationKey,
      'lapsed organization'
    ).id
    const memberUserIds = world.scenario.definition.organizationMemberships
      .filter((membership) => membership.organizationKey === organizationKey)
      .map(({ userKey }) => required(world.records.users, userKey, 'lapsed member').id)
    await lapseOrganizationSubscription({
      subscriptionId: required(world.records.subscriptions, subscription.key, 'subscription'),
      organizationId,
      memberUserIds,
    })
  }
}

async function createGrantsAndPermissionGroups(
  world: E2EWorld,
  adminClient: E2eHttpClient,
  ownerClients: Map<string, E2eHttpClient>
): Promise<void> {
  for (const grant of world.scenario.definition.workspaceGrants) {
    const created = await grantWorkspacePermission(
      adminClient,
      required(world.records.workspaces, grant.workspaceKey, 'workspace').id,
      {
        userId: required(world.records.users, grant.userKey, 'permission user').id,
        permissions: grant.access,
      }
    )
    world.records.permissions.set(`${grant.workspaceKey}:${grant.userKey}`, created.id)
  }

  for (const group of world.scenario.definition.permissionGroups) {
    const organization = required(
      world.records.organizations,
      group.organizationKey,
      'permission group organization'
    )
    const ownerKey = required(
      world.scenario.organizationsByKey,
      group.organizationKey,
      'permission group organization definition'
    ).ownerUserKey
    const ownerClient = required(
      ownerClients,
      worldUserKey(world.scenario, ownerKey),
      'permission group owner session'
    )
    const created = await createPermissionGroup(ownerClient, organization.id, {
      name: group.name,
      workspaceIds: group.workspaceKeys.map(
        (key) => required(world.records.workspaces, key, 'permission group workspace').id
      ),
      config: {
        hideSecretsTab: group.restrictions.hiddenSettings.includes('secrets'),
        hideApiKeysTab: group.restrictions.hiddenSettings.includes('api-keys'),
        hideInboxTab: group.restrictions.hiddenSettings.includes('inbox'),
        disableMcpTools: group.restrictions.disabledFeatures.includes('mcp'),
        disableCustomTools: group.restrictions.disabledFeatures.includes('custom-tools'),
      },
      isDefault: false,
    })
    if (created.isDefault) {
      throw new Error(`Permission-group default state does not match scenario: ${group.key}`)
    }
    world.records.permissionGroups.set(group.key, created.id)
    for (const userKey of group.memberUserKeys) {
      const memberId = await addPermissionGroupMember(
        ownerClient,
        organization.id,
        created.id,
        required(world.records.users, userKey, 'permission group member').id
      )
      world.records.permissionGroupMembers.set(`${group.key}:${userKey}`, memberId)
    }
  }
}

async function arrangePlatformAdminsAndInvitations(world: E2EWorld): Promise<void> {
  for (const user of world.scenario.definition.users) {
    if (user.platformRole === 'admin' && user.superUserModeEnabled) {
      await arrangeEffectivePlatformAdmin(
        required(world.records.users, user.key, 'platform admin').id
      )
    }
  }
  for (const invitation of world.scenario.definition.invitations) {
    const organization = required(
      world.records.organizations,
      invitation.organizationKey,
      'invitation organization'
    )
    const organizationDefinition = required(
      world.scenario.organizationsByKey,
      invitation.organizationKey,
      'invitation organization definition'
    )
    const created = await arrangePendingInvitation({
      email: invitation.email,
      token: invitation.token,
      inviterId: required(world.records.users, organizationDefinition.ownerUserKey, 'inviter').id,
      organizationId: organization.id,
      role: invitation.role,
      expiresAt: new Date(invitation.expiresAt),
      workspaceGrants: invitation.workspaceGrants.map((grant) => ({
        workspaceId: required(world.records.workspaces, grant.workspaceKey, 'invited workspace').id,
        permission: grant.access,
      })),
    })
    world.records.invitations.set(invitation.key, created.invitationId)
    invitation.workspaceGrants.forEach((grant, index) => {
      world.records.invitationGrants.set(
        `${invitation.key}:${grant.workspaceKey}`,
        created.grantIds[index]
      )
    })
  }
}

async function recordProductionPermissionIds(world: E2EWorld): Promise<void> {
  for (const [workspaceKey, workspaceRecord] of world.records.workspaces) {
    const rows = await db
      .select({ id: permissions.id, userId: permissions.userId })
      .from(permissions)
      .where(
        and(eq(permissions.entityType, 'workspace'), eq(permissions.entityId, workspaceRecord.id))
      )
    for (const row of rows) {
      const userKey = [...world.records.users].find(([, user]) => user.id === row.userId)?.[0]
      if (userKey) world.records.permissions.set(`${workspaceKey}:${userKey}`, row.id)
    }
  }
}

async function assertTrustedWorldInvariants(world: E2EWorld): Promise<void> {
  for (const persona of world.scenario.definition.personas) {
    const userId = required(world.records.users, persona.userKey, 'invariant user').id
    for (const expectation of persona.workspaces) {
      if (expectation.access === 'none') continue
      const workspaceDefinition = required(
        world.scenario.workspacesByKey,
        expectation.workspaceKey,
        'invariant workspace definition'
      )
      const workspaceId = required(
        world.records.workspaces,
        expectation.workspaceKey,
        'invariant workspace'
      ).id
      if (expectation.roleSource === 'org-admin') {
        const explicitRows = await db
          .select({ id: permissions.id })
          .from(permissions)
          .where(
            and(
              eq(permissions.entityType, 'workspace'),
              eq(permissions.entityId, workspaceId),
              eq(permissions.userId, userId)
            )
          )
        if (explicitRows.length !== 0) {
          throw new Error(
            `Organization-derived admin unexpectedly received an explicit grant: ${persona.key}/${expectation.workspaceKey}`
          )
        }
      }
      if (
        expectation.hostContext.hostMembership === 'external' &&
        workspaceDefinition.organizationKey
      ) {
        const organizationId = required(
          world.records.organizations,
          workspaceDefinition.organizationKey,
          'external host organization'
        ).id
        const memberships = await db
          .select({ id: member.id })
          .from(member)
          .where(and(eq(member.userId, userId), eq(member.organizationId, organizationId)))
        if (memberships.length !== 0) {
          throw new Error(
            `External workspace persona unexpectedly received host membership: ${persona.key}`
          )
        }
      }
    }
  }

  const userIds = [...world.records.users.values()].map(({ id }) => id)
  const persistedUsers = await db
    .select({
      id: user.id,
      stripeCustomerId: user.stripeCustomerId,
      currentUsageLimit: userStats.currentUsageLimit,
      billingBlocked: userStats.billingBlocked,
      billingBlockedReason: userStats.billingBlockedReason,
    })
    .from(user)
    .innerJoin(userStats, eq(userStats.userId, user.id))
    .where(inArray(user.id, userIds))
  if (persistedUsers.length !== userIds.length) {
    throw new Error('Every synthetic user must retain exactly one user_stats row')
  }
  for (const definition of world.scenario.definition.users) {
    const userId = required(world.records.users, definition.key, 'persisted user').id
    const row = persistedUsers.find((candidate) => candidate.id === userId)
    if (
      !row?.stripeCustomerId?.startsWith('cus_e2e_') ||
      row.currentUsageLimit !== expectedUsageLimit(world.scenario, definition.key) ||
      row.billingBlocked ||
      row.billingBlockedReason !== null
    ) {
      throw new Error(`Persisted user billing state does not match scenario: ${definition.key}`)
    }
  }

  const organizationIds = [...world.records.organizations.values()].map(({ id }) => id)
  if (organizationIds.length > 0) {
    const persistedMemberships = await db
      .select({
        organizationId: member.organizationId,
        userId: member.userId,
        role: member.role,
      })
      .from(member)
      .where(inArray(member.organizationId, organizationIds))
    const expectedMemberships = world.scenario.definition.organizationMemberships
      .map((definition) => ({
        organizationId: required(
          world.records.organizations,
          definition.organizationKey,
          'membership organization'
        ).id,
        userId: required(world.records.users, definition.userKey, 'membership user').id,
        role: definition.role,
      }))
      .sort(byMembership)
    if (
      JSON.stringify(persistedMemberships.sort(byMembership)) !==
      JSON.stringify(expectedMemberships)
    ) {
      throw new Error('Persisted organization membership set does not match scenario')
    }
  }

  const subscriptionIds = [...world.records.subscriptions.values()]
  if (subscriptionIds.length > 0) {
    const rows = await db
      .select({
        id: subscription.id,
        plan: subscription.plan,
        status: subscription.status,
        referenceId: subscription.referenceId,
        stripeCustomerId: subscription.stripeCustomerId,
        stripeSubscriptionId: subscription.stripeSubscriptionId,
        periodStart: subscription.periodStart,
        periodEnd: subscription.periodEnd,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        canceledAt: subscription.canceledAt,
        endedAt: subscription.endedAt,
        seats: subscription.seats,
        metadata: subscription.metadata,
      })
      .from(subscription)
      .where(inArray(subscription.id, subscriptionIds))
    if (rows.length !== subscriptionIds.length) {
      throw new Error('Seeded subscription registry does not match persisted rows')
    }
    for (const definition of world.scenario.definition.subscriptions) {
      const id = required(world.records.subscriptions, definition.key, 'subscription')
      const row = rows.find((candidate) => candidate.id === id)
      if (
        !row ||
        row.plan !== definition.plan ||
        row.referenceId !== resolveBillingReference(world, definition) ||
        row.status !== (definition.status === 'lapsed' ? 'canceled' : definition.status) ||
        !row.stripeCustomerId?.startsWith('cus_e2e_') ||
        row.stripeSubscriptionId !== null ||
        !row.periodStart ||
        !row.periodEnd ||
        row.cancelAtPeriodEnd ||
        row.seats !== (definition.seats ?? null) ||
        (definition.status === 'lapsed'
          ? !row.canceledAt || !row.endedAt
          : row.canceledAt !== null || row.endedAt !== null) ||
        !matchesEnterpriseMetadata(row.metadata, definition, row.referenceId)
      ) {
        throw new Error(`Persisted subscription does not match scenario: ${definition.key}`)
      }
    }
  }

  for (const definition of world.scenario.definition.invitations) {
    const invitationId = required(world.records.invitations, definition.key, 'invitation')
    const [row] = await db
      .select({
        kind: invitation.kind,
        email: invitation.email,
        inviterId: invitation.inviterId,
        organizationId: invitation.organizationId,
        membershipIntent: invitation.membershipIntent,
        role: invitation.role,
        status: invitation.status,
        expiresAt: invitation.expiresAt,
        token: invitation.token,
      })
      .from(invitation)
      .where(eq(invitation.id, invitationId))
      .limit(1)
    if (
      !row ||
      row.kind !== 'organization' ||
      row.email !== definition.email ||
      row.inviterId !==
        required(
          world.records.users,
          required(
            world.scenario.organizationsByKey,
            definition.organizationKey,
            'invitation organization definition'
          ).ownerUserKey,
          'invitation inviter'
        ).id ||
      row.organizationId !==
        required(world.records.organizations, definition.organizationKey, 'invitation organization')
          .id ||
      row.role !== definition.role ||
      row.status !== 'pending' ||
      row.membershipIntent !== 'internal' ||
      row.token !== definition.token ||
      row.expiresAt.toISOString() !== new Date(definition.expiresAt).toISOString()
    ) {
      throw new Error(`Persisted invitation does not match scenario: ${definition.key}`)
    }
    const grants = await db
      .select({
        id: invitationWorkspaceGrant.id,
        workspaceId: invitationWorkspaceGrant.workspaceId,
        permission: invitationWorkspaceGrant.permission,
      })
      .from(invitationWorkspaceGrant)
      .where(eq(invitationWorkspaceGrant.invitationId, invitationId))
    const expectedGrants = definition.workspaceGrants.map((grant) => ({
      id: required(
        world.records.invitationGrants,
        `${definition.key}:${grant.workspaceKey}`,
        'invitation grant'
      ),
      workspaceId: required(world.records.workspaces, grant.workspaceKey, 'invited workspace').id,
      permission: grant.access,
    }))
    if (JSON.stringify(grants.sort(byId)) !== JSON.stringify(expectedGrants.sort(byId))) {
      throw new Error(`Persisted invitation grants do not match scenario: ${definition.key}`)
    }
  }
}

async function assertSecondOrganizationIsRejected(
  worlds: E2EWorld[],
  adminClient: E2eHttpClient
): Promise<void> {
  for (const world of worlds) {
    for (const membership of world.scenario.definition.organizationMemberships) {
      const target = world.scenario.definition.organizations.find(
        (organization) =>
          organization.key !== membership.organizationKey &&
          !world.scenario.definition.organizationMemberships.some(
            (candidate) =>
              candidate.organizationKey === organization.key &&
              candidate.userKey === membership.userKey
          )
      )
      if (!target) continue
      const user = required(world.records.users, membership.userKey, 'constraint user')
      const organization = required(
        world.records.organizations,
        target.key,
        'constraint organization'
      )
      await adminClient.request({
        method: 'POST',
        path: `/api/v1/admin/organizations/${organization.id}/members`,
        body: { userId: user.id, role: 'member' },
        schema: z.object({
          error: z.object({
            code: z.literal('BAD_REQUEST'),
            message: z.string().min(1),
          }),
        }),
        expectedStatus: 400,
      })
      const unexpectedMembership = await db
        .select({ id: member.id })
        .from(member)
        .where(and(eq(member.organizationId, organization.id), eq(member.userId, user.id)))
        .limit(1)
      if (unexpectedMembership.length > 0) {
        throw new Error('Rejected second-organization request still created a membership')
      }
      return
    }
  }
  throw new Error('Scenario does not contain a cross-organization membership constraint probe')
}

function buildPersonaCredentials(
  runId: string,
  scenarios: ResolvedScenario[],
  logins: Map<string, SyntheticLogin>
): PersonaCredentials {
  const credentials: PersonaCredentials = {
    schemaVersion: PERSONA_MANIFEST_VERSION,
    runId,
    personas: {},
  }
  for (const scenario of scenarios) {
    for (const persona of scenario.definition.personas) {
      const login = required(logins, worldUserKey(scenario, persona.userKey), 'persona login')
      credentials.personas[persona.key] = { email: login.email, password: login.password }
    }
  }
  return credentials
}

function buildSyntheticLogins(scenarios: ResolvedScenario[]): Map<string, SyntheticLogin> {
  const logins = new Map<string, SyntheticLogin>()
  for (const scenario of scenarios) {
    for (const user of scenario.definition.users) {
      logins.set(worldUserKey(scenario, user.key), {
        name: user.name,
        email: user.email,
        password: randomBytes(24).toString('base64url'),
      })
    }
  }
  return logins
}

function resolveBillingReference(world: E2EWorld, subscription: ScenarioSubscription): string {
  return subscription.billingReference.kind === 'user'
    ? required(world.records.users, subscription.billingReference.userKey, 'subscription user').id
    : required(
        world.records.organizations,
        subscription.billingReference.organizationKey,
        'subscription organization'
      ).id
}

function expectedUsageLimit(scenario: ResolvedScenario, userKey: string): string | null {
  const membership = scenario.definition.organizationMemberships.find(
    (candidate) => candidate.userKey === userKey
  )
  if (membership) {
    const organizationSubscription = scenario.definition.subscriptions.find(
      (candidate) =>
        candidate.billingReference.kind === 'organization' &&
        candidate.billingReference.organizationKey === membership.organizationKey
    )
    if (
      organizationSubscription?.status === 'active' ||
      organizationSubscription?.status === 'past_due'
    ) {
      return null
    }
  }
  const personalSubscription = scenario.definition.subscriptions.find(
    (candidate) =>
      candidate.billingReference.kind === 'user' &&
      candidate.billingReference.userKey === userKey &&
      (candidate.status === 'active' || candidate.status === 'past_due')
  )
  if (personalSubscription?.plan.startsWith('pro_')) {
    return String(Number(personalSubscription.plan.split('_')[1]) / 200)
  }
  return '5'
}

function matchesEnterpriseMetadata(
  metadata: unknown,
  definition: ScenarioSubscription,
  referenceId: string
): boolean {
  if (definition.plan !== 'enterprise') return metadata === null
  const persisted = metadata as {
    plan?: unknown
    referenceId?: unknown
    monthlyPrice?: unknown
    seats?: unknown
  } | null
  return (
    persisted?.plan === 'enterprise' &&
    persisted.referenceId === referenceId &&
    persisted.monthlyPrice === definition.enterprise?.monthlyPrice &&
    persisted.seats === definition.enterprise?.seats
  )
}

function assertCreatedWorkspace(
  world: E2EWorld,
  expected: (typeof world.scenario.definition.workspaces)[number],
  created: {
    name: string
    organizationId: string | null
    ownerId: string
    billedAccountUserId: string
    workspaceMode: string
  }
): void {
  const ownerId = required(world.records.users, expected.ownerUserKey, 'workspace owner').id
  const organizationId = expected.organizationKey
    ? required(world.records.organizations, expected.organizationKey, 'workspace organization').id
    : null
  if (
    created.name !== expected.name ||
    created.ownerId !== ownerId ||
    created.billedAccountUserId !== ownerId ||
    created.organizationId !== organizationId ||
    created.workspaceMode !== (organizationId ? 'organization' : 'personal')
  ) {
    throw new Error(`Production workspace policy created an unexpected shape for ${expected.key}`)
  }
}

function worldUserKey(scenario: ResolvedScenario, userKey: string): string {
  return `${scenario.definition.namespace.world}:${userKey}`
}

function increment(values: Map<string, number>, key: string): void {
  values.set(key, (values.get(key) ?? 0) + 1)
}

function byId(left: { id: string }, right: { id: string }): number {
  return left.id.localeCompare(right.id)
}

function byMembership(
  left: { organizationId: string; userId: string; role: string },
  right: { organizationId: string; userId: string; role: string }
): number {
  return (
    left.organizationId.localeCompare(right.organizationId) ||
    left.userId.localeCompare(right.userId) ||
    left.role.localeCompare(right.role)
  )
}

function required<K, V>(values: ReadonlyMap<K, V>, key: K, label: string): V {
  const value = values.get(key)
  if (!value) throw new Error(`Missing ${label}: ${String(key)}`)
  return value
}

await main()
