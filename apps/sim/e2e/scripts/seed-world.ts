import { randomBytes } from 'node:crypto'
import { db } from '@sim/db'
import { member, permissions, subscription } from '@sim/db/schema'
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
import {
  createWorkspace,
  grantWorkspacePermission,
} from '../fixtures/factories/workspaces'
import { E2eHttpClient } from '../fixtures/http-client'
import type { ResolvedScenario, ScenarioSubscription } from '../fixtures/scenario'
import { validateScenario } from '../fixtures/validate-scenario'
import { createSettingsPersonaScenarios } from '../settings/personas'

const requiredEnvSchema = z.object({
  E2E_RUN_ID: z.string().min(1),
  E2E_BASE_URL: z.string().url(),
  ADMIN_API_KEY: z.string().min(1),
  DATABASE_URL: z.string().url(),
  E2E_MANIFEST_PATH: z.string().min(1),
  E2E_CREDENTIALS_PATH: z.string().min(1),
})

async function main(): Promise<void> {
  const env = requiredEnvSchema.parse(process.env)
  const definitions = createSettingsPersonaScenarios(env.E2E_RUN_ID)
  const scenarios = [validateScenario(definitions.primary), validateScenario(definitions.isolationTwin)]
  const adminClient = createAdminClient(env.E2E_BASE_URL, env.ADMIN_API_KEY)
  const attemptCounts = new Map<string, number>()
  const worlds: E2EWorld[] = []
  const loginsByWorldAndUser = new Map<string, SyntheticLogin>()
  const ownerClients = new Map<string, E2eHttpClient>()

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
  const credentials = buildPersonaCredentials(env.E2E_RUN_ID, worlds, loginsByWorldAndUser)
  writeJsonAtomic(env.E2E_MANIFEST_PATH, manifest)
  writeJsonAtomic(env.E2E_CREDENTIALS_PATH, credentials)

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
    const login = {
      name: user.name,
      email: user.email,
      password: randomBytes(24).toString('base64url'),
    }
    const created = await createSyntheticUser(
      new E2eHttpClient({
        baseUrl,
        onAttempt: ({ path }) => increment(attemptCounts, `signup:${path}`),
      }),
      login
    )
    world.records.users.set(user.key, created)
    logins.set(worldUserKey(world.scenario, user.key), login)
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
    })
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
    for (const grant of invitation.workspaceGrants) {
      const created = await arrangePendingInvitation({
        email: invitation.email,
        token: invitation.token,
        inviterId: required(
          world.records.users,
          organizationDefinition.ownerUserKey,
          'inviter'
        ).id,
        organizationId: organization.id,
        workspaceId: required(world.records.workspaces, grant.workspaceKey, 'invited workspace').id,
        role: invitation.role,
        permission: grant.access,
      })
      world.records.invitations.set(invitation.key, created.invitationId)
      world.records.invitationGrants.set(
        `${invitation.key}:${grant.workspaceKey}`,
        created.grantId
      )
    }
  }
}

async function recordProductionPermissionIds(world: E2EWorld): Promise<void> {
  for (const [workspaceKey, workspaceRecord] of world.records.workspaces) {
    const rows = await db
      .select({ id: permissions.id, userId: permissions.userId })
      .from(permissions)
      .where(
        and(
          eq(permissions.entityType, 'workspace'),
          eq(permissions.entityId, workspaceRecord.id)
        )
      )
    for (const row of rows) {
      const userKey = [...world.records.users].find(([, user]) => user.id === row.userId)?.[0]
      if (userKey) world.records.permissions.set(`${workspaceKey}:${userKey}`, row.id)
    }
  }
}

async function assertTrustedWorldInvariants(world: E2EWorld): Promise<void> {
  const adminUser = world.records.users.get('enterprise-organization-admin')
  const enterpriseWorkspace = world.records.workspaces.get('enterprise-workspace')
  if (adminUser && enterpriseWorkspace) {
    const explicitAdminRows = await db
      .select({ id: permissions.id })
      .from(permissions)
      .where(
        and(
          eq(permissions.entityType, 'workspace'),
          eq(permissions.entityId, enterpriseWorkspace.id),
          eq(permissions.userId, adminUser.id)
        )
      )
    if (explicitAdminRows.length !== 0) {
      throw new Error('Enterprise organization admin unexpectedly received an explicit grant')
    }
  }

  const externalUser = world.records.users.get('external-workspace-admin')
  if (externalUser) {
    const memberships = await db
      .select({ id: member.id })
      .from(member)
      .where(eq(member.userId, externalUser.id))
    if (memberships.length !== 0) {
      throw new Error('External workspace admin unexpectedly received organization membership')
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
        row.status !== (definition.status === 'lapsed' ? 'canceled' : definition.status)
      ) {
        throw new Error(`Persisted subscription does not match scenario: ${definition.key}`)
      }
    }
  }
}

async function assertSecondOrganizationIsRejected(
  worlds: E2EWorld[],
  adminClient: E2eHttpClient
): Promise<void> {
  const primary = worlds[0]
  const teamMember = required(primary.records.users, 'workspace-read-member', 'constraint user')
  const enterprise = required(
    primary.records.organizations,
    'enterprise-organization',
    'constraint organization'
  )
  await adminClient.request({
    method: 'POST',
    path: `/api/v1/admin/organizations/${enterprise.id}/members`,
    body: { userId: teamMember.id, role: 'member' },
    schema: z.object({ error: z.unknown() }),
    expectedStatus: 400,
  })
}

function buildPersonaCredentials(
  runId: string,
  worlds: E2EWorld[],
  logins: Map<string, SyntheticLogin>
): PersonaCredentials {
  const credentials: PersonaCredentials = {
    schemaVersion: PERSONA_MANIFEST_VERSION,
    runId,
    personas: {},
  }
  for (const world of worlds) {
    for (const persona of world.scenario.definition.personas) {
      const login = required(
        logins,
        worldUserKey(world.scenario, persona.userKey),
        'persona login'
      )
      credentials.personas[persona.key] = { email: login.email, password: login.password }
    }
  }
  return credentials
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

function assertCreatedWorkspace(
  world: E2EWorld,
  expected: (typeof world.scenario.definition.workspaces)[number],
  created: {
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

function required<K, V>(values: ReadonlyMap<K, V>, key: K, label: string): V {
  const value = values.get(key)
  if (!value) throw new Error(`Missing ${label}: ${String(key)}`)
  return value
}

await main()
