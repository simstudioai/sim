import { db } from '@sim/db'
import {
  account,
  copilotChats,
  copilotMessages,
  credential,
  credentialGroup,
  credentialGroupEnrollment,
  member,
  organization,
  organizationSearchHistory,
  organizationSearchIntegration,
  permissionGroup,
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
const OFF_ORGANIZATION_ID = required('PLATFORM_LIVE_OFF_ORGANIZATION_ID')
const OFF_EMAIL = required('PLATFORM_LIVE_OFF_EMAIL')
const PASSWORD = required('PLATFORM_LIVE_PASSWORD')
const CONNECTED_EMAIL = required('PLATFORM_LIVE_CONNECTED_EMAIL')
/** An organization whose permission group withholds Chat from everyone in it, admins included. */
const NO_CHAT_ORGANIZATION_ID = `${ORGANIZATION_ID}-no-chat`
const NO_CHAT_EMAIL = required('PLATFORM_LIVE_NO_CHAT_EMAIL')

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
    email: CONNECTED_EMAIL,
    name: 'Cory Connected',
    role: 'admin',
  },
  {
    key: 'role-target',
    email: required('PLATFORM_LIVE_ROLE_TARGET_EMAIL'),
    name: 'Rae Role',
    role: 'member',
  },
] as const

const userId = (key: string) => `platform-live-user-${key}`
const OUTSIDER_ID = userId('outsider')
const OUTSIDER_EMAIL = required('PLATFORM_LIVE_REFUSED_INVITE_EMAIL')
const OFF_OWNER_ID = userId('off-owner')
const NO_CHAT_ID = userId('no-chat')
const EVERYONE = [
  ...PEOPLE.map(({ key, email, name }) => ({ id: userId(key), email, name })),
  { id: OUTSIDER_ID, email: OUTSIDER_EMAIL, name: 'Otto Outsider' },
  { id: OFF_OWNER_ID, email: OFF_EMAIL, name: 'Odessa Off' },
  { id: NO_CHAT_ID, email: NO_CHAT_EMAIL, name: 'Noor Nochat' },
]
const allUserIds = EVERYONE.map(({ id }) => id)
/** UUIDs, as the app mints them: the routes' contracts refuse any other workspace id. */
const WORKSPACES = [
  { id: '5e1d7c3a-0b6f-4a2e-9c41-7d8e0f1a2b01', name: 'Operations' },
  { id: '5e1d7c3a-0b6f-4a2e-9c41-7d8e0f1a2b02', name: 'Marketing' },
] as const
/** A workspace of the outside organization that no member of the seeded one can open. */
const OUTSIDE_WORKSPACE_ID = '5e1d7c3a-0b6f-4a2e-9c41-7d8e0f1a2b03'
const CHATS = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Quarterly review',
    mode: 'agent',
    seen: true,
    deleted: false,
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    title: 'Vendor renewals',
    mode: 'assistant',
    seen: false,
    deleted: false,
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    title: 'Retired plan',
    mode: 'agent',
    seen: true,
    deleted: true,
  },
] as const
const GROUP_ID = 'platform-live-credential-group'
const PROVIDERS = ['gmail', 'google-calendar', 'outlook'] as const
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
    .where(
      inArray(organization.id, [
        ORGANIZATION_ID,
        OUTSIDE_ORGANIZATION_ID,
        OFF_ORGANIZATION_ID,
        NO_CHAT_ORGANIZATION_ID,
      ])
    )
  await tx.delete(user).where(inArray(user.id, allUserIds))

  await tx.insert(user).values(
    EVERYONE.map(({ id, email, name }) => ({
      id,
      email,
      name,
      normalizedEmail: email.toLowerCase(),
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    }))
  )
  await tx.insert(userStats).values(EVERYONE.map(({ id }) => ({ id: `${id}-stats`, userId: id })))
  await tx.insert(account).values(
    EVERYONE.map(({ id }) => ({
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
      orgUsageLimit: '1000',
      createdAt: now,
    },
    { id: OUTSIDE_ORGANIZATION_ID, name: 'Outside', slug: 'platform-live-outside', createdAt: now },
    { id: OFF_ORGANIZATION_ID, name: 'Off Rollout', slug: 'platform-live-off', createdAt: now },
    { id: NO_CHAT_ORGANIZATION_ID, name: 'No Chat', slug: 'platform-live-no-chat', createdAt: now },
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
    {
      id: 'platform-live-member-off-owner',
      userId: OFF_OWNER_ID,
      organizationId: OFF_ORGANIZATION_ID,
      role: 'owner',
    },
    {
      id: 'platform-live-member-no-chat',
      userId: NO_CHAT_ID,
      organizationId: NO_CHAT_ORGANIZATION_ID,
      role: 'member',
    },
  ])
  await tx.insert(subscription).values(
    [
      { id: 'platform-live-subscription', referenceId: ORGANIZATION_ID },
      { id: 'platform-live-subscription-off', referenceId: OFF_ORGANIZATION_ID },
      { id: 'platform-live-subscription-no-chat', referenceId: NO_CHAT_ORGANIZATION_ID },
    ].map(({ id, referenceId }) => ({
      id,
      plan: 'enterprise',
      referenceId,
      status: 'active',
      seats: 50,
      metadata: { plan: 'enterprise', referenceId, seats: 50, monthlyPrice: 100 },
      periodStart: now,
      periodEnd: new Date(now.getTime() + 30 * 86_400_000),
    }))
  )

  // Organization-level capabilities read the default group alone, so Chat is withheld from the whole
  // organization; its member keeps member-scoped Search, which is where they land.
  await tx.insert(permissionGroup).values({
    id: 'platform-live-group-no-chat',
    organizationId: NO_CHAT_ORGANIZATION_ID,
    name: 'No Chat',
    config: { hideCopilot: true },
    createdBy: NO_CHAT_ID,
    isDefault: true,
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

  await tx.insert(project).values({
    id: OUTSIDE_WORKSPACE_ID,
    name: 'Outside',
    ownerId: OUTSIDER_ID,
    organizationId: OUTSIDE_ORGANIZATION_ID,
  })
  await tx.insert(workspace).values({
    id: OUTSIDE_WORKSPACE_ID,
    projectId: OUTSIDE_WORKSPACE_ID,
    name: 'Outside',
    ownerId: OUTSIDER_ID,
    billedAccountUserId: OUTSIDER_ID,
    organizationId: OUTSIDE_ORGANIZATION_ID,
  })
  await tx.insert(permissions).values({
    id: `${OUTSIDE_WORKSPACE_ID}-outsider`,
    userId: OUTSIDER_ID,
    entityType: 'workspace',
    entityId: OUTSIDE_WORKSPACE_ID,
    permissionType: 'admin',
  })

  await tx.insert(copilotChats).values(
    CHATS.map(({ id, title, deleted, mode, seen }) => ({
      id,
      userId: userId('admin'),
      organizationId: ORGANIZATION_ID,
      type: 'mothership' as const,
      title,
      config: { conversationMode: mode },
      lastSeenAt: seen ? new Date(now.getTime() + 60_000) : null,
      deletedAt: deleted ? now : null,
    }))
  )

  const message = (chatId: string, role: 'user' | 'assistant', seq: number, content: string) => ({
    chatId,
    messageId: `${chatId}-${role}`,
    role,
    seq,
    content: { id: `${chatId}-${role}`, role, content, timestamp: now.toISOString() },
  })
  await tx
    .insert(copilotMessages)
    .values(
      CHATS.flatMap(({ id, title }) => [
        message(id, 'user', 1, `About ${title}`),
        message(id, 'assistant', 2, `Here is what I found about ${title}.`),
      ])
    )

  await tx.insert(organizationSearchHistory).values({
    organizationId: ORGANIZATION_ID,
    userId: userId('admin'),
    sources: [
      {
        url: 'https://example.com/onboarding-guide',
        title: 'Onboarding guide',
        viewedAt: now.toISOString(),
      },
      {
        url: 'https://example.com/renewal-terms',
        title: 'Renewal terms',
        viewedAt: now.toISOString(),
      },
    ],
    queries: [{ query: 'renewal terms', searchedAt: now.toISOString() }],
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

  const policies = Object.fromEntries(
    await Promise.all(
      PROVIDERS.map(
        async (provider) =>
          [
            provider,
            await getCredentialGroupProviderAdapter(provider).getPolicy(undefined, {}),
          ] as const
      )
    )
  ) as Record<
    (typeof PROVIDERS)[number],
    Awaited<ReturnType<ReturnType<typeof getCredentialGroupProviderAdapter>['getPolicy']>>
  >
  await tx.insert(credentialGroup).values({
    id: GROUP_ID,
    organizationId: ORGANIZATION_ID,
    publicId: generateId(),
    name: 'Connected accounts',
    options: PROVIDERS.map((provider) => ({
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
    email: CONNECTED_EMAIL,
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
      displayName: CONNECTED_EMAIL,
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
