/** Real application authorization and invitation persistence; no external provider calls. */
import { createHash } from 'node:crypto'
import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  type CredentialGroupOptionConfig,
  credential,
  credentialGroup,
  credentialGroupEnrollment,
  knowledgeBase,
  knowledgeConnector,
  knowledgeConnectorMember,
  permissions,
  resourcePolicy,
  user,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { startKnowledgeConnectorMemberEnrollment } from '@/lib/knowledge/application/connector-access'
import { listWorkspaceMemberConnectors } from '@/lib/knowledge/application/connectors'

describe('Confluence mirrored-identity self-enrollment', () => {
  const ids = createKnowledgeAclFixtureIds()
  const foreign = createKnowledgeAclFixtureIds()
  const groupId = generateId()
  const option: CredentialGroupOptionConfig = {
    id: generateId(),
    provider: 'confluence',
    label: 'Confluence',
    required: false,
    status: 'active',
    authorizationAppId: 'fixture-confluence-app',
    requiredScopes: ['read:confluence-content.all'],
    scopeVersion: 1,
  }
  const bob: Principal = {
    kind: 'session',
    userId: ids.bobId,
    sessionId: 'fixture-self-enrollment',
  }
  const source = { knowledgeBaseId: ids.knowledgeBaseId, connectorId: ids.connectorId }

  beforeAll(async () => {
    await seedKnowledgeAclFixture(ids)
    await seedKnowledgeAclFixture(foreign)
    await db
      .update(knowledgeBase)
      .set({ isSearchIndex: true, name: 'Renamed search index' })
      .where(eq(knowledgeBase.id, ids.knowledgeBaseId))
    await db.insert(credentialGroup).values({
      id: groupId,
      workspaceId: ids.workspaceId,
      publicId: generateId(),
      name: 'Connected accounts',
      options: [option],
      createdBy: ids.aliceId,
    })
  })

  beforeEach(async () => {
    await db
      .delete(credentialGroupEnrollment)
      .where(eq(credentialGroupEnrollment.credentialGroupId, groupId))
    await db
      .update(credentialGroup)
      .set({ options: [option], status: 'active' })
      .where(eq(credentialGroup.id, groupId))
    await db.update(user).set({ emailVerified: true }).where(eq(user.id, ids.bobId))
    await db
      .update(knowledgeConnector)
      .set({
        connectorType: 'confluence',
        accessMode: 'admin',
        status: 'paused',
        sourceConfig: { domain: 'fixture.atlassian.net', spaceId: 'fixture-space' },
        syncLockToken: null,
        credentialGroupId: null,
        credentialGroupOptionId: null,
      })
      .where(eq(knowledgeConnector.id, ids.connectorId))
  })

  afterAll(async () => {
    for (const fixture of [ids, foreign]) {
      await db.delete(workspace).where(eq(workspace.id, fixture.workspaceId))
      await db.delete(user).where(eq(user.id, fixture.aliceId))
      await db.delete(user).where(eq(user.id, fixture.bobId))
    }
    await db.$client.end()
  })

  function discover(principal = bob, workspaceId = ids.workspaceId) {
    return listWorkspaceMemberConnectors.execute({ principal, input: { workspaceId } })
  }

  function enroll(principal = bob) {
    return startKnowledgeConnectorMemberEnrollment.execute({ principal, input: source })
  }

  function enrollments() {
    return db
      .select()
      .from(credentialGroupEnrollment)
      .where(eq(credentialGroupEnrollment.credentialGroupId, groupId))
  }

  async function crawlerAuthority() {
    const [connectors, members, credentials, policies, roles] = await Promise.all([
      db
        .select()
        .from(knowledgeConnector)
        .where(eq(knowledgeConnector.knowledgeBaseId, ids.knowledgeBaseId)),
      db
        .select()
        .from(knowledgeConnectorMember)
        .where(eq(knowledgeConnectorMember.workspaceId, ids.workspaceId)),
      db.select().from(credential).where(eq(credential.workspaceId, ids.workspaceId)),
      db.select().from(resourcePolicy).where(eq(resourcePolicy.workspaceId, ids.workspaceId)),
      db
        .select()
        .from(permissions)
        .where(
          and(eq(permissions.entityType, 'workspace'), eq(permissions.entityId, ids.workspaceId))
        ),
    ])
    return { connectors, members, credentials, policies, roles }
  }

  it('lets a read-only member discover a paused source and obtain only their own identity invitation', async () => {
    const before = await crawlerAuthority()
    expect(before.members).toEqual([])
    expect(before.credentials).toEqual([])
    expect(before.policies).toHaveLength(1)
    expect(before.roles.find((role) => role.userId === ids.bobId)?.permissionType).toBe('read')
    await expect(discover()).resolves.toMatchObject({
      connectors: [
        {
          connectorId: ids.connectorId,
          knowledgeBaseIsSearchIndex: true,
          knowledgeBaseName: 'Renamed search index',
          connectorType: 'confluence',
          viewerMembership: 'not_enrolled',
          memberSyncStatus: 'idle',
        },
      ],
    })

    const { url } = await enroll()
    const link = new URL(url)
    expect(link.origin).toBe('http://localhost:3000')
    expect(link.pathname.startsWith('/credential-groups/enroll/')).toBe(true)
    const token = link.pathname.split('/').at(-1)!
    const pending = await enrollments()
    expect(pending).toHaveLength(1)
    expect(pending[0]).toMatchObject({
      credentialGroupId: groupId,
      email: `${ids.bobId}@fixture.test`,
      status: 'invited',
      createdBy: null,
      sentAt: null,
      invitationTokenHash: createHash('sha256').update(token).digest('hex'),
    })
    expect(pending[0]!.invitationExpiresAt!.getTime()).toBeGreaterThan(Date.now())
    await expect(discover()).resolves.toMatchObject({
      connectors: [{ connectorId: ids.connectorId, viewerMembership: 'invited' }],
    })
    expect(await crawlerAuthority()).toEqual(before)
  })

  it.each(['missing', 'disabled', 'ambiguous', 'disabled-group'] as const)(
    'refuses enrollment when the canonical Confluence option is %s',
    async (state) => {
      const options =
        state === 'missing'
          ? []
          : state === 'disabled'
            ? [{ ...option, status: 'disabled' as const }]
            : state === 'ambiguous'
              ? [option, { ...option, id: generateId() }]
              : [option]
      await db
        .update(credentialGroup)
        .set({ options, status: state === 'disabled-group' ? 'disabled' : 'active' })
        .where(eq(credentialGroup.id, groupId))
      const before = await crawlerAuthority()
      await expect(discover()).resolves.toEqual({ connectors: [] })
      await expect(enroll()).rejects.toMatchObject({ code: 'validation' })
      expect(await enrollments()).toEqual([])
      expect(await crawlerAuthority()).toEqual(before)
    }
  )

  it('preserves an administrator-revoked enrollment and its invitation instead of reactivating it', async () => {
    await enroll()
    await db
      .update(credentialGroupEnrollment)
      .set({ status: 'revoked', revokedAt: new Date() })
      .where(eq(credentialGroupEnrollment.credentialGroupId, groupId))
    const revoked = await enrollments()
    const before = await crawlerAuthority()
    await expect(discover()).resolves.toMatchObject({
      connectors: [{ connectorId: ids.connectorId, viewerMembership: 'revoked' }],
    })
    await expect(enroll()).rejects.toMatchObject({ code: 'forbidden' })
    expect(await enrollments()).toEqual(revoked)
    expect(await crawlerAuthority()).toEqual(before)
  })

  it('requires the actor to verify their own email before issuing an invitation', async () => {
    await db.update(user).set({ emailVerified: false }).where(eq(user.id, ids.bobId))
    await expect(discover()).resolves.toMatchObject({
      connectors: [{ connectorId: ids.connectorId, viewerMembership: 'unverified_email' }],
    })
    const before = await crawlerAuthority()
    await expect(enroll()).rejects.toThrow('Verify your email address')
    expect(await enrollments()).toEqual([])
    expect(await crawlerAuthority()).toEqual(before)
  })

  it.each([
    { connectorType: 'confluence', accessMode: 'workspace' },
    { connectorType: 'google_drive', accessMode: 'admin' },
    { connectorType: 'asana', accessMode: 'admin' },
  ])(
    'does not offer identity enrollment for $connectorType in $accessMode mode',
    async (source) => {
      await db
        .update(knowledgeConnector)
        .set(source)
        .where(eq(knowledgeConnector.id, ids.connectorId))
      const before = await crawlerAuthority()
      await expect(discover()).resolves.toEqual({ connectors: [] })
      await expect(enroll()).rejects.toMatchObject({ code: 'validation' })
      expect(await enrollments()).toEqual([])
      expect(await crawlerAuthority()).toEqual(before)
    }
  )

  it('rejects another workspace actor and an asserted foreign workspace without changing grants', async () => {
    const outsider: Principal = { ...bob, userId: foreign.bobId }
    const before = await crawlerAuthority()
    await expect(discover(outsider)).rejects.toThrow('Insufficient workspace permissions')
    await expect(enroll(outsider)).rejects.toThrow('Insufficient workspace permissions')
    await expect(
      startKnowledgeConnectorMemberEnrollment.execute({
        principal: bob,
        input: { ...source, assertedWorkspaceId: foreign.workspaceId },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(await enrollments()).toEqual([])
    expect(await crawlerAuthority()).toEqual(before)
  })
})
