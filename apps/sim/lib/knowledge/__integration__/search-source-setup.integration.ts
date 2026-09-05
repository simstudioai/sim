/** Real source selection, PostgreSQL creation locks, and credential-policy grant cleanup. */
import { db } from '@sim/db'
import {
  credentialGroup,
  knowledgeBase,
  knowledgeConnector,
  mcpServers,
  resourcePolicy,
  user,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, isNull } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ dispatch: vi.fn() }))
vi.mock('@/lib/credential-groups/provider-registry', () => ({
  getCredentialGroupProviderAdapter: (provider: string) => ({
    getPolicy: async () => ({
      provider,
      providerId: provider === 'gmail' ? 'google-email' : provider,
      authorizationAppId: `fixture-app:${provider}`,
      scopeVersion: 1,
      requiredScopes: ['https://www.googleapis.com/auth/drive', `${provider}:read`],
    }),
    hasRequiredScopes: (granted: string[], required: string[]) =>
      required.every((scope) => granted.includes(scope)),
  }),
}))
vi.mock('@/lib/knowledge/connectors/member-queue', () => ({ dispatchMemberSync: fixture.dispatch }))
vi.mock('@/lib/knowledge/application/connector-access', () => ({
  startKnowledgeConnectorMemberEnrollment: {
    execute: async ({ input }: { input: { connectorId: string } }) => ({
      url: `https://fixture.test/enroll/${input.connectorId}`,
    }),
  },
}))
vi.mock('@/connectors/registry.server', () => ({
  CONNECTOR_REGISTRY: {
    google_drive: {
      name: 'Google Drive',
      auth: { mode: 'oauth', provider: 'google-drive' },
      configFields: [{ id: 'folderId', type: 'short-input', title: 'Folder' }],
      permissionScopedListing: { capFieldIds: [] },
    },
  },
}))

import { resolveBillingAttribution } from '@/lib/billing/core/billing-attribution'
import { ensureWorkspaceAccounts } from '@/lib/credential-groups/application/manage-groups'
import {
  compileCredentialGroupWorkflowAccessPolicy,
  decodeCredentialGroupKnowledgeConnectorAccess,
} from '@/lib/credential-groups/application/workflow-access-policy'
import { ensureWorkspaceAccountsGroup } from '@/lib/credential-groups/service'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
  seedKnowledgeMemberFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { createKnowledgeConnector } from '@/lib/knowledge/application/connectors'
import {
  connectSimSearchConnector,
  prepareSearchSource,
  readSearchIndex,
} from '@/lib/knowledge/application/sim-search'
import { performCreateKnowledgeConnector } from '@/lib/knowledge/orchestration/connectors'
import { createWorkspaceInTransaction } from '@/lib/workspaces/create'

describe('Search source identity and concurrent creation', () => {
  const ids = createKnowledgeAclFixtureIds()
  const other = createKnowledgeAclFixtureIds()
  let member: Awaited<ReturnType<typeof seedKnowledgeMemberFixture>>
  const sourceIds: string[] = []
  let searchGroupId: string

  beforeAll(async () => {
    await seedKnowledgeAclFixture(ids)
    await seedKnowledgeAclFixture(other)
    member = await seedKnowledgeMemberFixture(ids)
    await db
      .update(credentialGroup)
      .set({
        options: [
          {
            id: member.optionId,
            provider: 'google-drive',
            label: 'Google Drive',
            authorizationAppId: 'fixture-app:google-drive',
            requiredScopes: ['https://www.googleapis.com/auth/drive', 'google-drive:read'],
            scopeVersion: 1,
            required: false,
            status: 'active',
          },
        ],
      })
      .where(eq(credentialGroup.id, member.groupId))
    await db
      .update(knowledgeBase)
      .set({ isSearchIndex: true, name: 'Renamed company index' })
      .where(eq(knowledgeBase.id, ids.knowledgeBaseId))
    fixture.dispatch.mockResolvedValue({ queued: true })
  })

  afterAll(async () => {
    await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
    await db.delete(workspace).where(eq(workspace.id, other.workspaceId))
    for (const id of [ids.aliceId, ids.bobId, other.aliceId, other.bobId]) {
      await db.delete(user).where(eq(user.id, id))
    }
  })

  async function createSource(folderId: string) {
    return performCreateKnowledgeConnector({
      knowledgeBase: {
        id: ids.knowledgeBaseId,
        name: 'Renamed company index',
        workspaceId: ids.workspaceId,
      },
      connectorType: 'google_drive',
      sourceConfig: { folderId },
      syncIntervalMinutes: 60,
      accessMode: 'members',
      reuseSearchSource: true,
      membersBinding: {
        credentialGroupId: member.groupId,
        credentialGroupOptionId: member.optionId,
      },
      userId: ids.aliceId,
      source: 'ui',
      resolveBillingAttribution: () =>
        resolveBillingAttribution({
          actorUserId: ids.aliceId,
          workspaceId: ids.workspaceId,
        }),
      resolveAccessToken: async () => {
        throw new Error('Member setup must not contact an OAuth provider')
      },
    })
  }

  it('creates connected accounts and its policy atomically with a new workspace', async () => {
    const created = await db.transaction((tx) =>
      createWorkspaceInTransaction(tx, {
        userId: ids.aliceId,
        observedOrganizationId: null,
        governingPermissionGroupOrganizationId: null,
        name: 'Connected accounts atomic fixture',
        skipDefaultWorkflow: true,
        organizationId: null,
        workspaceMode: 'personal',
        billedAccountUserId: ids.aliceId,
      })
    )
    try {
      const groups = await db
        .select()
        .from(credentialGroup)
        .where(eq(credentialGroup.workspaceId, created.id))
      expect(groups).toHaveLength(1)
      expect(groups[0]).toMatchObject({
        name: 'Connected accounts',
        options: [],
        createdBy: ids.aliceId,
      })
      const [policy] = await db
        .select()
        .from(resourcePolicy)
        .where(eq(resourcePolicy.resourceId, groups[0]!.id))
      expect(policy!.document).toEqual(
        compileCredentialGroupWorkflowAccessPolicy({
          credentialGroupId: groups[0]!.id,
          allowedWorkflowIds: [],
        })
      )
    } finally {
      await db.delete(workspace).where(eq(workspace.id, created.id))
    }
  })

  it('rolls back the workspace, account container, and policy together', async () => {
    let workspaceId = ''
    let groupId = ''
    await expect(
      db.transaction(async (tx) => {
        const created = await createWorkspaceInTransaction(tx, {
          userId: ids.aliceId,
          observedOrganizationId: null,
          governingPermissionGroupOrganizationId: null,
          name: 'Connected accounts rollback fixture',
          skipDefaultWorkflow: true,
          organizationId: null,
          workspaceMode: 'personal',
          billedAccountUserId: ids.aliceId,
        })
        workspaceId = created.id
        const [group] = await tx
          .select()
          .from(credentialGroup)
          .where(eq(credentialGroup.workspaceId, created.id))
        groupId = group!.id
        const policies = await tx
          .select()
          .from(resourcePolicy)
          .where(eq(resourcePolicy.resourceId, groupId))
        expect(policies).toHaveLength(1)
        throw new Error('Abort workspace creation fixture')
      })
    ).rejects.toThrow('Abort workspace creation fixture')
    expect(workspaceId).not.toBe('')
    expect(await db.select().from(workspace).where(eq(workspace.id, workspaceId))).toHaveLength(0)
    expect(
      await db.select().from(credentialGroup).where(eq(credentialGroup.id, groupId))
    ).toHaveLength(0)
    expect(
      await db.select().from(resourcePolicy).where(eq(resourcePolicy.resourceId, groupId))
    ).toHaveLength(0)
  })

  it('adopts a legacy index only during admin setup and persists its canonical identity', async () => {
    await db
      .update(knowledgeBase)
      .set({ name: 'Sim Search' })
      .where(eq(knowledgeBase.id, other.knowledgeBaseId))
    const input = { workspaceId: other.workspaceId, connectorType: 'gitlab' }
    const reader = {
      kind: 'session' as const,
      userId: other.bobId,
      sessionId: 'fixture-reader',
    }
    await expect(readSearchIndex.execute({ principal: reader, input })).resolves.toMatchObject({
      knowledgeBaseId: null,
    })
    await expect(prepareSearchSource.execute({ principal: reader, input })).rejects.toMatchObject({
      code: 'forbidden',
    })
    const prepare = () =>
      prepareSearchSource.execute({
        principal: { kind: 'session', userId: other.aliceId, sessionId: 'fixture-admin' },
        input,
      })
    const results = await Promise.all([prepare(), prepare()])
    expect(results.map((result) => result.knowledgeBaseId)).toEqual([
      other.knowledgeBaseId,
      other.knowledgeBaseId,
    ])
    await db
      .update(knowledgeBase)
      .set({ name: 'Renamed adopted index' })
      .where(eq(knowledgeBase.id, other.knowledgeBaseId))
    await expect(readSearchIndex.execute({ principal: reader, input })).resolves.toMatchObject({
      knowledgeBaseId: other.knowledgeBaseId,
    })
  })

  it('serializes matching creates across independent database transactions and keeps one grant', async () => {
    const results = await Promise.all([createSource('same-folder'), createSource('same-folder')])
    expect(results.every((result) => result.success)).toBe(true)
    const successful = results.filter((result) => result.success)
    expect(new Set(successful.map((result) => result.connector.id)).size).toBe(1)
    expect(successful.filter((result) => result.reused)).toHaveLength(1)
    expect(fixture.dispatch).toHaveBeenCalledTimes(1)
    sourceIds.push(successful[0]!.connector.id)
    const [policy] = await db
      .select()
      .from(resourcePolicy)
      .where(eq(resourcePolicy.resourceId, member.groupId))
    const grants = decodeCredentialGroupKnowledgeConnectorAccess(policy!.document, member.groupId)
    expect(grants.flatMap((grant) => grant.connectorIds)).toEqual([sourceIds[0]])
    const rows = await db
      .select()
      .from(knowledgeConnector)
      .where(
        and(
          eq(knowledgeConnector.knowledgeBaseId, ids.knowledgeBaseId),
          eq(knowledgeConnector.connectorType, 'google_drive'),
          isNull(knowledgeConnector.deletedAt)
        )
      )
    expect(rows.filter((row) => row.id !== member.connectorId)).toHaveLength(1)
  })

  it('keeps distinct source settings separate and allows readers to select the exact source', async () => {
    const second = await createSource('other-folder')
    expect(second.success).toBe(true)
    if (!second.success) throw new Error(second.error)
    sourceIds.push(second.connector.id)
    expect(second.connector.id).not.toBe(sourceIds[0])
    const result = await connectSimSearchConnector.execute({
      principal: { kind: 'session', userId: ids.bobId, sessionId: 'fixture-reader' },
      input: {
        workspaceId: ids.workspaceId,
        connectorType: 'google_drive',
        connectorId: second.connector.id,
      },
    })
    expect(result.connectorId).toBe(second.connector.id)
    expect(result.knowledgeBaseId).toBe(ids.knowledgeBaseId)
  })

  it('rejects stale settings, different providers, foreign sources, and noncanonical knowledge bases', async () => {
    const noncanonical = generateId()
    const extraSource = generateId()
    await db.insert(knowledgeBase).values({
      id: noncanonical,
      name: 'Ordinary base',
      userId: ids.aliceId,
      workspaceId: ids.workspaceId,
    })
    await db.insert(knowledgeConnector).values({
      id: extraSource,
      knowledgeBaseId: noncanonical,
      connectorType: 'google_drive',
      sourceConfig: {},
      accessMode: 'members',
    })
    for (const input of [
      {
        connectorType: 'google_drive',
        connectorId: sourceIds[0],
        sourceConfig: { folderId: 'changed-folder' },
      },
      { connectorType: 'confluence', connectorId: sourceIds[0] },
      { connectorType: 'google_drive', connectorId: other.connectorId },
      { connectorType: 'google_drive', connectorId: extraSource },
    ]) {
      await expect(
        connectSimSearchConnector.execute({
          principal: { kind: 'session', userId: ids.bobId, sessionId: 'fixture-reader' },
          input: { workspaceId: ids.workspaceId, ...input },
        })
      ).rejects.toMatchObject({ code: 'not_found' })
    }
  })
  it('provisions one workspace container with optional provider options under concurrent setup', async () => {
    const [previousPolicy] = await db
      .select()
      .from(resourcePolicy)
      .where(eq(resourcePolicy.resourceId, member.groupId))
    const results = await Promise.all([
      ensureWorkspaceAccountsGroup(ids.workspaceId, ids.aliceId, {
        provider: 'google-drive',
        label: 'Google Drive',
        required: true,
      }),
      ensureWorkspaceAccountsGroup(ids.workspaceId, ids.aliceId, {
        provider: 'gmail',
        label: 'Gmail',
        required: true,
      }),
      ensureWorkspaceAccountsGroup(ids.workspaceId, ids.aliceId, {
        provider: 'google-drive',
        label: 'Google Drive',
        required: true,
      }),
    ])
    expect(new Set(results.map((result) => result.id)).size).toBe(1)
    expect(results.filter((result) => result.created)).toHaveLength(0)
    expect(results[0]!.id).toBe(member.groupId)
    searchGroupId = results[0]!.id
    const [group] = await db
      .select()
      .from(credentialGroup)
      .where(eq(credentialGroup.id, searchGroupId))
    expect(group!.name).toBe('Connected accounts')
    expect(group!.options.map((option) => option.provider).sort()).toEqual([
      'gmail',
      'google-drive',
    ])
    expect(group!.options.every((option) => option.required === false)).toBe(true)
    const [policy] = await db
      .select()
      .from(resourcePolicy)
      .where(eq(resourcePolicy.resourceId, searchGroupId))
    expect(policy!.document).toEqual(previousPolicy!.document)
    expect(policy!.revision).toBe(previousPolicy!.revision)
    const prepared = await prepareSearchSource.execute({
      principal: { kind: 'session', userId: ids.aliceId, sessionId: 'fixture-admin' },
      input: { workspaceId: ids.workspaceId, connectorType: 'slack', accessMode: 'members' },
    })
    expect(prepared.credentialGroupId).toBe(searchGroupId)
  })

  it('authorizes account setup and creates one singleton across concurrent application calls', async () => {
    await expect(
      ensureWorkspaceAccounts.execute({
        principal: { kind: 'session', userId: other.bobId, sessionId: 'fixture-reader' },
        input: { workspaceId: other.workspaceId },
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
    const singletonRows = () =>
      db.select().from(credentialGroup).where(eq(credentialGroup.workspaceId, other.workspaceId))
    expect(await singletonRows()).toHaveLength(0)
    const ensure = () =>
      ensureWorkspaceAccounts.execute({
        principal: { kind: 'session', userId: other.aliceId, sessionId: 'fixture-admin' },
        input: { workspaceId: other.workspaceId },
      })
    const results = await Promise.all([ensure(), ensure()])
    expect(results.filter((result) => result.created)).toHaveLength(1)
    expect(new Set(results.map((result) => result.credentialGroup.id)).size).toBe(1)
    const reused = await ensure()
    expect(reused.created).toBe(false)
    expect(reused.credentialGroup.id).toBe(results[0]!.credentialGroup.id)
    const rows = await singletonRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      createdBy: other.aliceId,
      name: 'Connected accounts',
      options: [],
    })
  })

  it('uses the workspace singleton for implicit bindings on an ordinary knowledge base', async () => {
    const ordinaryBaseId = generateId()
    await db.insert(knowledgeBase).values({
      id: ordinaryBaseId,
      name: 'Ordinary documents',
      userId: other.aliceId,
      workspaceId: other.workspaceId,
    })
    const [accounts] = await db
      .select()
      .from(credentialGroup)
      .where(eq(credentialGroup.workspaceId, other.workspaceId))
    const created = await createKnowledgeConnector.execute({
      principal: { kind: 'session', userId: other.aliceId, sessionId: 'fixture-admin' },
      input: {
        knowledgeBaseId: ordinaryBaseId,
        assertedWorkspaceId: other.workspaceId,
        connectorType: 'google_drive',
        accessMode: 'members',
        sourceConfig: { folderId: 'ordinary-folder' },
        syncIntervalMinutes: 60,
      },
    })
    const [source] = await db
      .select()
      .from(knowledgeConnector)
      .where(eq(knowledgeConnector.id, created.connector.id))
    expect(source).toMatchObject({
      knowledgeBaseId: ordinaryBaseId,
      credentialGroupId: accounts!.id,
      accessMode: 'members',
    })
    const groups = await db
      .select()
      .from(credentialGroup)
      .where(eq(credentialGroup.workspaceId, other.workspaceId))
    expect(groups).toHaveLength(1)
    expect(groups[0]!.options).toHaveLength(1)
    expect(groups[0]!.options[0]).toMatchObject({
      id: source.credentialGroupOptionId,
      provider: 'google-drive',
      required: false,
    })
  })

  it('uses the same accounts option through actual first-source application setup', async () => {
    const results = await Promise.all(
      [1, 2].map(() =>
        connectSimSearchConnector.execute({
          principal: { kind: 'session', userId: ids.aliceId, sessionId: 'fixture-admin' },
          input: {
            workspaceId: ids.workspaceId,
            connectorType: 'google_drive',
            sourceConfig: { folderId: 'search-account-folder' },
          },
        })
      )
    )
    expect(results[0]!.connectorId).toBe(results[1]!.connectorId)
    const [source] = await db
      .select()
      .from(knowledgeConnector)
      .where(eq(knowledgeConnector.id, results[0]!.connectorId))
    expect(source!.credentialGroupId).toBe(searchGroupId)
    const groups = await db
      .select()
      .from(credentialGroup)
      .where(eq(credentialGroup.workspaceId, ids.workspaceId))
    expect(groups).toHaveLength(1)
  })

  it('refuses automatic provider expansion when a concurrent workflow grant commits first', async () => {
    let releaseGrant!: () => void
    let acquiredLock!: () => void
    const locked = new Promise<void>((resolve) => {
      acquiredLock = resolve
    })
    const release = new Promise<void>((resolve) => {
      releaseGrant = resolve
    })
    const grant = db.transaction(async (tx) => {
      await tx
        .select()
        .from(resourcePolicy)
        .where(eq(resourcePolicy.resourceId, searchGroupId))
        .for('update')
      acquiredLock()
      await release
      await tx
        .update(resourcePolicy)
        .set({
          document: compileCredentialGroupWorkflowAccessPolicy({
            credentialGroupId: searchGroupId,
            allowedWorkflowIds: ['fixture-workflow'],
          }),
        })
        .where(eq(resourcePolicy.resourceId, searchGroupId))
    })
    await locked
    const append = ensureWorkspaceAccountsGroup(ids.workspaceId, ids.aliceId, {
      provider: 'jira',
      label: 'Jira',
      required: false,
    })
    releaseGrant()
    await grant
    await expect(append).rejects.toThrow('has workflow access')
    const existing = await ensureWorkspaceAccountsGroup(ids.workspaceId, ids.aliceId, {
      provider: 'google-drive',
      label: 'Google Drive',
      required: false,
    })
    expect(existing.id).toBe(searchGroupId)
    const [group] = await db
      .select()
      .from(credentialGroup)
      .where(eq(credentialGroup.id, searchGroupId))
    expect(group!.options).toHaveLength(2)
    await db
      .update(resourcePolicy)
      .set({
        document: compileCredentialGroupWorkflowAccessPolicy({
          credentialGroupId: searchGroupId,
          allowedWorkflowIds: [],
        }),
      })
      .where(eq(resourcePolicy.resourceId, searchGroupId))
  })

  it('requires an active option with the same application and scope policy', async () => {
    const [group] = await db
      .select()
      .from(credentialGroup)
      .where(eq(credentialGroup.id, searchGroupId))
    const options = group!.options
    const current = options.find((option) => option.provider === 'google-drive')!
    const changedOptions = [
      { ...current, status: 'disabled' as const },
      { ...current, authorizationAppId: 'another-app' },
      { ...current, requiredScopes: [] },
    ]
    for (const changed of changedOptions) {
      await db
        .update(credentialGroup)
        .set({ options: options.map((option) => (option.id === current.id ? changed : option)) })
        .where(eq(credentialGroup.id, searchGroupId))
      await expect(
        ensureWorkspaceAccountsGroup(ids.workspaceId, ids.aliceId, {
          provider: 'google-drive',
          label: 'Google Drive',
          required: false,
        })
      ).rejects.toThrow('Update Google Drive in Connected accounts')
    }
    await db.update(credentialGroup).set({ options }).where(eq(credentialGroup.id, searchGroupId))
  })

  it('refuses provider expansion under a managed MCP grant and never replaces a disabled container', async () => {
    const serverId = generateId()
    await db.insert(mcpServers).values({
      id: serverId,
      workspaceId: ids.workspaceId,
      credentialGroupId: searchGroupId,
      managedConnectorId: 'fireflies',
      name: 'Fixture managed MCP',
      transport: 'streamable-http',
      url: 'https://fixture.test/mcp',
      authType: 'oauth',
      createdBy: ids.aliceId,
    })
    await expect(
      ensureWorkspaceAccountsGroup(ids.workspaceId, ids.aliceId, {
        provider: 'jira',
        label: 'Jira',
        required: false,
      })
    ).rejects.toThrow('has MCP access')
    await db.delete(mcpServers).where(eq(mcpServers.id, serverId))
    await db
      .update(credentialGroup)
      .set({ status: 'disabled' })
      .where(eq(credentialGroup.id, searchGroupId))
    await expect(ensureWorkspaceAccountsGroup(ids.workspaceId, ids.aliceId)).rejects.toThrow(
      'disabled'
    )
    const groups = await db
      .select()
      .from(credentialGroup)
      .where(eq(credentialGroup.workspaceId, ids.workspaceId))
    expect(groups).toHaveLength(1)
    expect(groups[0]!.id).toBe(searchGroupId)
  })
})
