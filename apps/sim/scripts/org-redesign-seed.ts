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
  organizationSecretSource,
  permissionGroup,
  permissionGroupMember,
  permissions,
  project,
  resourcePolicy,
  session,
  simLink,
  subscription,
  user,
  userStats,
  workspace,
} from '@sim/db/schema'
import { assertDisposableTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { generateId } from '@sim/utils/id'
import { generateRandomHex } from '@sim/utils/random'
import { normalizeEmail } from '@sim/utils/string'
import { hashPassword } from 'better-auth/crypto'
import { inArray } from 'drizzle-orm'
import { getCredentialGroupProviderAdapter } from '@/lib/credential-groups/provider-registry'
import { encryptManagedOAuthTokenSet } from '@/lib/credentials/managed-oauth'
import { defaultLiveSearchPolicy } from '@/lib/sim-search/live/policy-schema'
import {
  ADMIN,
  ADMIN_CHATS,
  APPROVED_SOURCES,
  CONNECTABLE_PROVIDERS,
  CONNECTED,
  EVERYONE,
  FILLERS,
  FULL_GROUP_ID,
  GRANTS,
  IN_ORGANIZATION,
  LINK_COUNT,
  MEMBER,
  MEMBER_ADMIN_WORKSPACE,
  MEMBER_CHATS,
  MEMBER_WRITE_WORKSPACE,
  NAMED_LINKS,
  NARROW,
  NARROW_GROUP_CONFIG,
  NARROW_GROUP_ID,
  ORGANIZATION_ID,
  ORGANIZATION_NAME,
  OUTSIDE_ORGANIZATION_ID,
  OUTSIDER,
  OWNER,
  PASSWORD,
  SEEDED_SOURCE,
  STANDARD_GROUP_CONFIG,
  STANDARD_GROUP_ID,
  WORKSPACES,
} from '@/scripts/org-redesign-e2e/fixture'

/**
 * Seeds the organization `test-org-redesign-e2e.ts` runs against. Ids are stable and a rerun starts
 * over, so a failed run can be repeated against the same database.
 */
assertDisposableTestDatabaseUrl(process.env.DATABASE_URL ?? '')

const CREDENTIAL_GROUP_ID = 'org-redesign-credential-group'
const allUserIds = EVERYONE.map(({ userId }) => userId)
const now = new Date()
const passwordHash = await hashPassword(PASSWORD)

/** Workspace access per viewer: admins hold all of it, members only what they were given. */
function workspacePermissions() {
  const rows = (
    viewers: readonly (typeof MEMBER | typeof ADMIN | typeof OWNER)[],
    entityId: string,
    permissionType: 'admin' | 'write'
  ) =>
    viewers.map(({ key, userId }) => ({
      id: `${entityId}-${key}`,
      userId,
      entityType: 'workspace' as const,
      entityId,
      permissionType,
    }))
  return [
    ...WORKSPACES.flatMap(({ id }) => rows([OWNER, ADMIN], id, 'admin')),
    ...rows([MEMBER, CONNECTED], MEMBER_ADMIN_WORKSPACE.id, 'admin'),
    ...rows([MEMBER, CONNECTED], MEMBER_WRITE_WORKSPACE.id, 'write'),
  ]
}

/** The numbered rows sort after the named ones, and creators and activity vary across them. */
function syntheticLinks() {
  const named = Object.values(NAMED_LINKS).map((link) => ({
    ...link,
    normalizedName: link.name,
    defaultUrl: link.name === NAMED_LINKS.variable.name ? 'https://tickets.example.com' : null,
    unlisted: link.name === NAMED_LINKS.unlisted.name,
    restrictEdit: link.name === NAMED_LINKS.restricted.name,
    visitCount: link.name === NAMED_LINKS.mostUsed.name ? 5000 : 3,
    createdBy: link.name === NAMED_LINKS.mostUsed.name ? MEMBER.userId : ADMIN.userId,
  }))
  const numbered = Array.from({ length: LINK_COUNT - named.length }, (_, index) => {
    const label = String(index + 1).padStart(3, '0')
    return {
      name: `resource-${label}`,
      normalizedName: `resource${label}`,
      url: `https://resources.example.com/${label}`,
      description: index % 3 === 0 ? `Shared resource number ${label}` : null,
      defaultUrl: null,
      unlisted: false,
      restrictEdit: false,
      visitCount: index % 50,
      createdBy: FILLERS[index % FILLERS.length].userId,
    }
  })
  return [...named, ...numbered].map((link, index) => ({
    id: `org-redesign-link-${index}`,
    organizationId: ORGANIZATION_ID,
    ...link,
    createdAt: now,
    updatedAt: now,
  }))
}

await db.transaction(async (tx) => {
  await tx.delete(workspace).where(inArray(workspace.ownerId, allUserIds))
  await tx.delete(project).where(inArray(project.ownerId, allUserIds))
  await tx
    .delete(organization)
    .where(inArray(organization.id, [ORGANIZATION_ID, OUTSIDE_ORGANIZATION_ID]))
  await tx.delete(user).where(inArray(user.id, allUserIds))

  await tx.insert(user).values(
    EVERYONE.map(({ userId, email, name }) => ({
      id: userId,
      email,
      name,
      normalizedEmail: normalizeEmail(email),
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    }))
  )
  await tx
    .insert(userStats)
    .values(EVERYONE.map(({ userId }) => ({ id: `${userId}-stats`, userId })))
  await tx.insert(account).values(
    EVERYONE.map(({ userId }) => ({
      id: `${userId}-credential`,
      accountId: userId,
      providerId: 'credential',
      userId,
      password: passwordHash,
      createdAt: now,
      updatedAt: now,
    }))
  )

  await tx.insert(organization).values([
    {
      id: ORGANIZATION_ID,
      name: ORGANIZATION_NAME,
      slug: 'org-redesign',
      orgUsageLimit: '1000',
      metadata: {
        liveSearchPolicies: {
          coda: defaultLiveSearchPolicy('coda'),
          lucid: defaultLiveSearchPolicy('lucid'),
        },
      },
      createdAt: now,
    },
    {
      id: OUTSIDE_ORGANIZATION_ID,
      name: 'Elsewhere Inc',
      slug: 'org-redesign-outside',
      createdAt: now,
    },
  ])
  await tx.insert(member).values([
    ...IN_ORGANIZATION.map(({ key, userId, role }) => ({
      id: `org-redesign-member-${key}`,
      userId,
      organizationId: ORGANIZATION_ID,
      role,
    })),
    {
      id: 'org-redesign-member-outsider',
      userId: OUTSIDER.userId,
      organizationId: OUTSIDE_ORGANIZATION_ID,
      role: 'owner',
    },
  ])
  await tx.insert(session).values(
    EVERYONE.map(({ key, userId, sessionToken }) => ({
      id: `org-redesign-session-row-${key}`,
      token: sessionToken,
      userId,
      activeOrganizationId: key === 'outsider' ? OUTSIDE_ORGANIZATION_ID : ORGANIZATION_ID,
      expiresAt: new Date(now.getTime() + 86_400_000),
      createdAt: now,
      updatedAt: now,
    }))
  )
  await tx.insert(subscription).values({
    id: 'org-redesign-subscription',
    plan: 'enterprise',
    referenceId: ORGANIZATION_ID,
    status: 'active',
    seats: 250,
    metadata: { plan: 'enterprise', referenceId: ORGANIZATION_ID, seats: 250, monthlyPrice: 100 },
    periodStart: now,
    periodEnd: new Date(now.getTime() + 30 * 86_400_000),
  })

  await tx.insert(permissionGroup).values([
    {
      id: STANDARD_GROUP_ID,
      organizationId: ORGANIZATION_ID,
      name: 'Standard Access',
      config: STANDARD_GROUP_CONFIG,
      createdBy: OWNER.userId,
      isDefault: true,
    },
    {
      id: NARROW_GROUP_ID,
      organizationId: ORGANIZATION_ID,
      name: 'Field Crew',
      config: NARROW_GROUP_CONFIG,
      createdBy: OWNER.userId,
      membershipMode: 'explicit',
    },
    {
      id: FULL_GROUP_ID,
      organizationId: ORGANIZATION_ID,
      name: 'Administrators',
      config: {},
      createdBy: OWNER.userId,
      membershipMode: 'explicit',
    },
  ])
  await tx.insert(permissionGroupMember).values(
    (
      [
        [STANDARD_GROUP_ID, [MEMBER, CONNECTED, ...FILLERS]],
        [NARROW_GROUP_ID, [NARROW]],
        [FULL_GROUP_ID, [OWNER, ADMIN]],
      ] as const
    ).flatMap(([permissionGroupId, people]) =>
      people.map(({ key, userId }) => ({
        id: `org-redesign-group-member-${key}`,
        permissionGroupId,
        organizationId: ORGANIZATION_ID,
        userId,
      }))
    )
  )

  for (const { id, name } of WORKSPACES) {
    await tx.insert(project).values({
      id,
      name,
      ownerId: OWNER.userId,
      organizationId: ORGANIZATION_ID,
    })
    await tx.insert(workspace).values({
      id,
      projectId: id,
      name,
      ownerId: OWNER.userId,
      billedAccountUserId: OWNER.userId,
      organizationId: ORGANIZATION_ID,
    })
  }
  await tx.insert(permissions).values(workspacePermissions())

  const chats = [
    ...Object.values(MEMBER_CHATS).map((chat) => ({ ...chat, userId: MEMBER.userId })),
    ...Object.values(ADMIN_CHATS).map((chat) => ({ ...chat, userId: ADMIN.userId })),
  ]
  await tx.insert(copilotChats).values(
    chats.map(({ id, title, mode, seen, userId }) => ({
      id,
      userId,
      organizationId: ORGANIZATION_ID,
      type: 'mothership' as const,
      title,
      config: { conversationMode: mode },
      lastSeenAt: seen ? new Date(now.getTime() + 60_000) : null,
      deletedAt: id === ADMIN_CHATS.deleted.id ? now : null,
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
      chats.flatMap(({ id, title }) => [
        message(id, 'user', 1, `About ${title}`),
        message(id, 'assistant', 2, `Here is what I found about ${title}.`),
      ])
    )

  await tx.insert(organizationSearchHistory).values(
    [MEMBER, ADMIN].map(({ userId }) => ({
      organizationId: ORGANIZATION_ID,
      userId,
      sources: [
        { url: SEEDED_SOURCE.url, title: SEEDED_SOURCE.title, viewedAt: now.toISOString() },
      ],
      queries: [{ query: SEEDED_SOURCE.query, searchedAt: now.toISOString() }],
    }))
  )

  await tx.insert(simLink).values(syntheticLinks())
  await tx.insert(organizationSecretSource).values({
    id: 'org-redesign-secret-source',
    organizationId: ORGANIZATION_ID,
    mode: 'member',
  })

  const policies = Object.fromEntries(
    await Promise.all(
      CONNECTABLE_PROVIDERS.map(
        async (provider) =>
          [
            provider,
            await getCredentialGroupProviderAdapter(provider).getPolicy(undefined, {}),
          ] as const
      )
    )
  ) as Record<
    (typeof CONNECTABLE_PROVIDERS)[number],
    Awaited<ReturnType<ReturnType<typeof getCredentialGroupProviderAdapter>['getPolicy']>>
  >
  await tx.insert(credentialGroup).values({
    id: CREDENTIAL_GROUP_ID,
    organizationId: ORGANIZATION_ID,
    publicId: generateId(),
    name: 'Connected accounts',
    options: CONNECTABLE_PROVIDERS.map((provider) => ({
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
    id: 'org-redesign-credential-group-policy',
    organizationId: ORGANIZATION_ID,
    resourceType: 'credential_group',
    resourceId: CREDENTIAL_GROUP_ID,
    document: {
      version: 2,
      resource: { type: 'credential_group', id: CREDENTIAL_GROUP_ID },
      statements: [],
    },
  })
  await tx.insert(organizationSearchIntegration).values(
    APPROVED_SOURCES.map((connectorType) => ({
      organizationId: ORGANIZATION_ID,
      connectorType,
      approved: true,
    }))
  )

  const enrollmentId = 'org-redesign-enrollment-connected'
  await tx.insert(credentialGroupEnrollment).values({
    id: enrollmentId,
    userId: CONNECTED.userId,
    credentialGroupId: CREDENTIAL_GROUP_ID,
    email: CONNECTED.email,
    status: 'completed',
    invitationTokenHash: generateRandomHex(64),
    invitationExpiresAt: new Date(now.getTime() + 86_400_000),
    invitedAt: now,
  })
  for (const option of ['gmail', 'google-calendar'] as const) {
    const policy = policies[option]
    const grant = GRANTS[option]
    await tx.insert(credential).values({
      id: grant.credentialId,
      createdBy: CONNECTED.userId,
      credentialGroupEnrollmentId: enrollmentId,
      credentialGroupOptionId: option,
      organizationId: ORGANIZATION_ID,
      type: 'managed_oauth',
      displayName: CONNECTED.email,
      providerId: grant.providerId,
      managedOauthStatus: 'active',
      managedOauthScopeVersion: policy.scopeVersion,
      grantedScopes: policy.requiredScopes,
      providerSubjectId: `org-redesign-${option}`,
      authorizationAppId: policy.authorizationAppId,
      encryptedOauthTokenSet: await encryptManagedOAuthTokenSet({
        accessToken: `org-redesign-token-${option}`,
        refreshToken: `org-redesign-refresh-${option}`,
      }),
      accessTokenExpiresAt: new Date(now.getTime() + 3_600_000),
      grantedAt: now,
    })
  }
})

process.stdout.write(`Seeded ${IN_ORGANIZATION.length} members of ${ORGANIZATION_ID}\n`)
process.exit(0)
