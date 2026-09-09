import { createHash } from 'node:crypto'
import { db } from '@sim/db'
import {
  credential,
  credentialGroup,
  credentialGroupEnrollment,
  knowledgeBase,
  knowledgeBaseTagDefinitions,
  knowledgeConnector,
  knowledgeConnectorMember,
  knowledgeExternalGroup,
  knowledgeExternalGroupMember,
  organization,
  permissions,
  user,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq } from 'drizzle-orm'

/** Reusable fixture identities for isolated API, browser, and application integration tests. */
export function createKnowledgeAclFixtureIds() {
  const groups = ['space', 'parent', 'page']
  return {
    aliceId: generateId(),
    bobId: generateId(),
    workspaceId: generateId(),
    organizationId: generateId(),
    knowledgeBaseId: generateId(),
    connectorId: generateId(),
    lockId: generateId(),
    groups,
    groupIds: groups.map(() => generateId()),
  }
}

/** Inserts only unique fixture rows, and refuses the developer's ordinary database. */
export async function seedKnowledgeAclFixture(ids = createKnowledgeAclFixtureIds()) {
  const target = new URL(process.env.DATABASE_URL ?? '')
  if (
    !['localhost', '127.0.0.1'].includes(target.hostname) ||
    (!target.pathname.startsWith('/sim_acl_test') && target.pathname !== '/sim_auth_scim')
  ) {
    throw new Error('Knowledge fixture seeding requires a local disposable test database')
  }
  const { aliceId, bobId, workspaceId, knowledgeBaseId, connectorId, lockId, groups, groupIds } =
    ids
  const now = new Date()
  await db.insert(user).values([
    {
      id: aliceId,
      name: 'Alice fixture',
      email: `${aliceId}@fixture.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: bobId,
      name: 'Bob fixture',
      email: `${bobId}@fixture.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    },
  ])
  await db.insert(organization).values({
    id: ids.organizationId,
    name: 'ACL integration organization',
    slug: ids.organizationId,
  })
  await db.insert(workspace).values({
    id: workspaceId,
    organizationId: ids.organizationId,
    name: 'ACL integration fixture',
    ownerId: aliceId,
    billedAccountUserId: aliceId,
  })
  await db.insert(permissions).values([
    {
      id: generateId(),
      userId: aliceId,
      entityType: 'workspace',
      entityId: workspaceId,
      permissionType: 'admin',
    },
    {
      id: generateId(),
      userId: bobId,
      entityType: 'workspace',
      entityId: workspaceId,
      permissionType: 'read',
    },
  ])
  await db.insert(knowledgeBase).values({
    id: knowledgeBaseId,
    userId: aliceId,
    workspaceId,
    name: 'Search fixture',
    chunkingConfig: { maxSize: 1024, minSize: 1, overlap: 20 },
  })
  await db.insert(knowledgeBaseTagDefinitions).values({
    id: generateId(),
    knowledgeBaseId,
    tagSlot: 'tag1',
    displayName: 'Fixture',
    fieldType: 'text',
  })
  await db.insert(knowledgeConnector).values({
    id: connectorId,
    knowledgeBaseId,
    connectorType: 'confluence',
    sourceConfig: {},
    accessMode: 'admin',
    status: 'syncing',
    syncLockToken: lockId,
  })
  await db.insert(knowledgeExternalGroup).values(
    groups.map((name, index) => ({
      id: groupIds[index],
      workspaceId,
      providerId: 'confluence',
      tenantId: 'fixture-tenant',
      externalGroupId: name,
      lastSyncedAt: now,
    }))
  )
  await db
    .insert(knowledgeExternalGroupMember)
    .values([
      ...groupIds.map((groupId) => ({ groupId, subjectToken: `u:${aliceId}@fixture.test` })),
      ...groupIds
        .slice(0, 2)
        .map((groupId) => ({ groupId, subjectToken: `u:${bobId}@fixture.test` })),
    ])
  return ids
}

/** Managed identities carry placeholder secrets that are never sent to a provider. */
export async function seedKnowledgeMemberFixture(
  base: ReturnType<typeof createKnowledgeAclFixtureIds>
) {
  const [existingGroup] = await db
    .select()
    .from(credentialGroup)
    .where(eq(credentialGroup.workspaceId, base.workspaceId))
  const groupId = existingGroup?.id ?? generateId()
  const optionId =
    existingGroup?.options.find((option) => option.provider === 'google-drive')?.id ?? generateId()
  const connectorId = generateId()
  const runId = generateId()
  const now = new Date()
  const members = [base.aliceId, base.bobId].map((userId) => ({
    userId,
    id: generateId(),
    credentialId: generateId(),
    enrollmentId: generateId(),
    subjectToken: `s:google-drive:fixture-domain:${userId}`,
  }))
  if (!existingGroup) {
    await db.insert(credentialGroup).values({
      id: groupId,
      workspaceId: base.workspaceId,
      publicId: generateId(),
      name: 'Connected accounts',
      options: [
        {
          id: optionId,
          provider: 'google-drive',
          label: 'Drive fixture',
          authorizationAppId: 'fixture-app',
          requiredScopes: ['drive.readonly'],
          scopeVersion: 1,
          required: false,
          status: 'active',
        },
      ],
    })
  }
  await db.insert(knowledgeConnector).values({
    id: connectorId,
    knowledgeBaseId: base.knowledgeBaseId,
    connectorType: 'google_drive',
    sourceConfig: {},
    accessMode: 'members',
    credentialGroupId: groupId,
    credentialGroupOptionId: optionId,
    memberSyncStatus: 'running',
    memberSyncLockToken: runId,
  })
  for (const member of members) {
    const [enrollment] = await db
      .insert(credentialGroupEnrollment)
      .values({
        id: member.enrollmentId,
        credentialGroupId: groupId,
        userId: member.userId,
        email: `${member.userId}@fixture.test`,
        status: 'completed',
        invitationTokenHash: createHash('sha256').update(generateId()).digest('hex'),
        invitationExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        invitedAt: now,
      })
      .onConflictDoUpdate({
        target: [credentialGroupEnrollment.credentialGroupId, credentialGroupEnrollment.email],
        set: { userId: member.userId, status: 'completed', revokedAt: null },
      })
      .returning({ id: credentialGroupEnrollment.id })
    member.enrollmentId = enrollment!.id
    const [existingCredential] = await db
      .select()
      .from(credential)
      .where(
        and(
          eq(credential.credentialGroupEnrollmentId, member.enrollmentId),
          eq(credential.credentialGroupOptionId, optionId)
        )
      )
    if (existingCredential) {
      member.credentialId = existingCredential.id
      await db
        .update(credential)
        .set({ managedOauthStatus: 'active' })
        .where(eq(credential.id, member.credentialId))
    } else
      await db.insert(credential).values({
        id: member.credentialId,
        workspaceId: base.workspaceId,
        type: 'managed_oauth',
        displayName: 'Fixture Drive',
        providerId: 'google-drive',
        authorizationAppId: 'fixture-app',
        credentialGroupEnrollmentId: member.enrollmentId,
        credentialGroupOptionId: optionId,
        managedOauthScopeVersion: 1,
        providerSubjectId: member.userId,
        providerTenantId: 'fixture-domain',
        managedOauthStatus: 'active',
        grantedScopes: ['drive.readonly'],
        encryptedOauthTokenSet: 'fixture-not-an-oauth-token',
        grantedAt: now,
        createdBy: member.userId,
      })
    await db.insert(knowledgeConnectorMember).values({
      id: member.id,
      workspaceId: base.workspaceId,
      connectorId,
      credentialId: member.credentialId,
      subjectToken: member.subjectToken,
    })
  }
  return { connectorId, groupId, optionId, runId, members }
}
