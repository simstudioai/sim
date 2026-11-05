import { db } from '@sim/db'
import {
  account,
  copilotChats,
  credential,
  credentialGroup,
  credentialGroupEnrollment,
  member,
  organization,
  organizationSearchIntegration,
  permissionGroup,
  permissionGroupMember,
  permissions,
  project,
  resourcePolicy,
  simLink,
  subscription,
  user,
  userStats,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { hashPassword } from 'better-auth/crypto'
import { inArray } from 'drizzle-orm'
import { getCredentialGroupProviderAdapter } from '@/lib/credential-groups/provider-registry'
import { encryptManagedOAuthTokenSet } from '@/lib/credentials/managed-oauth'

/**
 * Seeds the one organization `platform/checks/live/**` runs against, from the `PLATFORM_LIVE_*`
 * environment `.github/scripts/http-e2e.sh` exports. Ids are stable and a rerun starts over, so a
 * failed run can be repeated against the same database.
 */
function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} must be set`)
  return value
}

const databaseName = new URL(required('DATABASE_URL')).pathname
if (!/test/i.test(databaseName)) throw new Error('Seed only a dedicated test database')

const ORGANIZATION_ID = required('PLATFORM_LIVE_ORGANIZATION_ID')
const OUTSIDE_ORGANIZATION_ID = `${ORGANIZATION_ID}-outside`
const PASSWORD = required('PLATFORM_LIVE_PASSWORD')

const PEOPLE = [
  {
    key: 'owner',
    email: required('PLATFORM_LIVE_OWNER_EMAIL'),
    name: 'Olive Owner',
    role: 'owner',
  },
  { key: 'admin', email: required('PLATFORM_LIVE_EMAIL'), name: 'Ada Admin', role: 'admin' },
  {
    key: 'member',
    email: required('PLATFORM_LIVE_MEMBER_EMAIL'),
    name: 'Mia Member',
    role: 'member',
  },
  {
    key: 'connected',
    email: required('PLATFORM_LIVE_CONNECTED_EMAIL'),
    name: 'Cory Connected',
    role: 'member',
  },
  {
    key: 'role-target',
    email: required('PLATFORM_LIVE_ROLE_TARGET_EMAIL'),
    name: 'Rae Role',
    role: 'member',
  },
  {
    key: 'removable',
    email: required('PLATFORM_LIVE_REMOVABLE_EMAIL'),
    name: 'Remy Removable',
    role: 'member',
  },
  {
    key: 'no-directory',
    email: required('PLATFORM_LIVE_NO_DIRECTORY_EMAIL'),
    name: 'Noor Nodirectory',
    role: 'member',
  },
] as const

const userId = (key: string) => `platform-live-user-${key}`
const OUTSIDER_ID = userId('outsider')
const OUTSIDER_EMAIL = required('PLATFORM_LIVE_REFUSED_INVITE_EMAIL')
const allUserIds = [...PEOPLE.map(({ key }) => userId(key)), OUTSIDER_ID]
const WORKSPACES = [
  { id: 'platform-live-workspace-main', name: 'Operations' },
  { id: 'platform-live-workspace-second', name: 'Marketing' },
] as const
const CHATS = [
  { id: '11111111-1111-4111-8111-111111111111', title: 'Quarterly review', deleted: false },
  { id: '22222222-2222-4222-8222-222222222222', title: 'Vendor renewals', deleted: false },
  { id: '33333333-3333-4333-8333-333333333333', title: 'Retired plan', deleted: true },
] as const
const GROUP_ID = 'platform-live-credential-group'
const GRANTS = [
  { option: 'gmail', providerId: 'google-email' },
  { option: 'google-calendar', providerId: 'google-calendar' },
] as const

const now = new Date()
const passwordHash = await hashPassword(PASSWORD)

await db.transaction(async (tx) => {
  await tx.delete(workspace).where(inArray(workspace.ownerId, allUserIds))
  await tx.delete(project).where(inArray(project.ownerId, allUserIds))
  await tx
    .delete(organization)
    .where(inArray(organization.id, [ORGANIZATION_ID, OUTSIDE_ORGANIZATION_ID]))
  await tx.delete(user).where(inArray(user.id, allUserIds))

  const everyone = [
    ...PEOPLE.map(({ key, email, name }) => ({ id: userId(key), email, name })),
    { id: OUTSIDER_ID, email: OUTSIDER_EMAIL, name: 'Otto Outsider' },
  ]
  await tx.insert(user).values(
    everyone.map(({ id, email, name }) => ({
      id,
      email,
      name,
      normalizedEmail: email.toLowerCase(),
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    }))
  )
  await tx.insert(userStats).values(everyone.map(({ id }) => ({ id: `${id}-stats`, userId: id })))
  await tx.insert(account).values(
    everyone.map(({ id }) => ({
      id: `${id}-credential`,
      accountId: id,
      providerId: 'credential',
      userId: id,
      password: passwordHash,
      createdAt: now,
      updatedAt: now,
    }))
  )

  await tx.insert(organization).values([
    {
      id: ORGANIZATION_ID,
      name: required('PLATFORM_LIVE_ORGANIZATION_NAME'),
      slug: 'platform-live',
      createdAt: now,
    },
    { id: OUTSIDE_ORGANIZATION_ID, name: 'Outside', slug: 'platform-live-outside', createdAt: now },
  ])
  await tx.insert(member).values([
    ...PEOPLE.map(({ key, role }) => ({
      id: `platform-live-member-${key}`,
      userId: userId(key),
      organizationId: ORGANIZATION_ID,
      role,
    })),
    {
      id: 'platform-live-member-outsider',
      userId: OUTSIDER_ID,
      organizationId: OUTSIDE_ORGANIZATION_ID,
      role: 'owner',
    },
  ])
  await tx.insert(subscription).values({
    id: 'platform-live-subscription',
    plan: 'enterprise',
    referenceId: ORGANIZATION_ID,
    status: 'active',
    seats: 50,
    metadata: { plan: 'enterprise', referenceId: ORGANIZATION_ID, seats: 50, monthlyPrice: 100 },
    periodStart: now,
    periodEnd: new Date(now.getTime() + 30 * 86_400_000),
  })

  const ownerId = userId('owner')
  for (const { id, name } of WORKSPACES) {
    await tx.insert(project).values({ id, name, ownerId, organizationId: ORGANIZATION_ID })
    await tx.insert(workspace).values({
      id,
      projectId: id,
      name,
      ownerId,
      billedAccountUserId: ownerId,
      organizationId: ORGANIZATION_ID,
    })
    await tx.insert(permissions).values(
      PEOPLE.map(({ key, role }) => ({
        id: `${id}-${key}`,
        userId: userId(key),
        entityType: 'workspace' as const,
        entityId: id,
        permissionType: role === 'member' ? ('write' as const) : ('admin' as const),
      }))
    )
  }

  await tx.insert(copilotChats).values(
    CHATS.map(({ id, title, deleted }) => ({
      id,
      userId: userId('admin'),
      organizationId: ORGANIZATION_ID,
      type: 'mothership' as const,
      title,
      deletedAt: deleted ? now : null,
    }))
  )

  await tx.insert(permissionGroup).values({
    id: 'platform-live-no-directory',
    organizationId: ORGANIZATION_ID,
    name: 'No directory',
    config: { hideOrgMemberDirectory: true },
    createdBy: ownerId,
    createdAt: now,
    updatedAt: now,
  })
  await tx.insert(permissionGroupMember).values({
    id: 'platform-live-no-directory-member',
    permissionGroupId: 'platform-live-no-directory',
    organizationId: ORGANIZATION_ID,
    userId: userId('no-directory'),
    assignedBy: ownerId,
  })

  await tx.insert(simLink).values({
    id: 'platform-live-link',
    organizationId: ORGANIZATION_ID,
    name: 'handbook',
    normalizedName: 'handbook',
    url: 'https://example.com/handbook',
    description: 'The company handbook',
    createdBy: ownerId,
    createdAt: now,
    updatedAt: now,
  })

  const policies = {
    gmail: await getCredentialGroupProviderAdapter('gmail').getPolicy(undefined, {}),
    'google-calendar': await getCredentialGroupProviderAdapter('google-calendar').getPolicy(
      undefined,
      {}
    ),
    outlook: await getCredentialGroupProviderAdapter('outlook').getPolicy(undefined, {}),
  }
  await tx.insert(credentialGroup).values({
    id: GROUP_ID,
    organizationId: ORGANIZATION_ID,
    publicId: generateId(),
    name: 'Connected accounts',
    options: (['gmail', 'google-calendar', 'outlook'] as const).map((provider) => ({
      id: provider,
      provider,
      label: provider,
      authorizationAppId: policies[provider].authorizationAppId,
      requiredScopes: policies[provider].requiredScopes,
      scopeVersion: policies[provider].scopeVersion,
      required: false,
      status: 'active' as const,
    })),
  })
  await tx.insert(resourcePolicy).values({
    id: 'platform-live-credential-group-policy',
    organizationId: ORGANIZATION_ID,
    resourceType: 'credential_group',
    resourceId: GROUP_ID,
    document: { version: 2, resource: { type: 'credential_group', id: GROUP_ID }, statements: [] },
  })
  await tx.insert(organizationSearchIntegration).values(
    ['gmail', 'google_calendar', 'outlook'].map((connectorType) => ({
      organizationId: ORGANIZATION_ID,
      connectorType,
      approved: true,
    }))
  )

  const connected = userId('connected')
  const enrollmentId = 'platform-live-enrollment'
  await tx.insert(credentialGroupEnrollment).values({
    id: enrollmentId,
    userId: connected,
    credentialGroupId: GROUP_ID,
    email: required('PLATFORM_LIVE_CONNECTED_EMAIL'),
    status: 'completed',
    invitationTokenHash: generateId().replaceAll('-', '').repeat(2),
    invitationExpiresAt: new Date(now.getTime() + 86_400_000),
    invitedAt: now,
  })
  for (const { option, providerId } of GRANTS) {
    const policy = policies[option]
    await tx.insert(credential).values({
      id: `platform-live-grant-${option}`,
      createdBy: connected,
      credentialGroupEnrollmentId: enrollmentId,
      credentialGroupOptionId: option,
      organizationId: ORGANIZATION_ID,
      type: 'managed_oauth',
      displayName: required('PLATFORM_LIVE_CONNECTED_EMAIL'),
      providerId,
      managedOauthStatus: 'active',
      managedOauthScopeVersion: policy.scopeVersion,
      grantedScopes: policy.requiredScopes,
      providerSubjectId: `platform-live-${option}`,
      authorizationAppId: policy.authorizationAppId,
      encryptedOauthTokenSet: await encryptManagedOAuthTokenSet({
        accessToken: `platform-live-token-${option}`,
      }),
      accessTokenExpiresAt: new Date(now.getTime() + 3_600_000),
      grantedAt: now,
    })
  }
})

process.stdout.write(`Seeded ${PEOPLE.length} members of ${ORGANIZATION_ID}\n`)
process.exit(0)
