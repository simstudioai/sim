import { db } from '@sim/db'
import {
  knowledgeBase,
  knowledgeConnector,
  member,
  organization,
  organizationSearchIntegration,
  user,
  workspace,
} from '@sim/db/schema'
import { deleteWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import {
  createPersonalApiKeyPrincipal,
  createWorkspaceApiKeyPrincipal,
} from '@sim/testing/factories/principal.factory'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@/connectors/registry.server', async () => {
  const { gitlabConnectorMeta } = await import('@/connectors/gitlab/meta')
  return {
    CONNECTOR_REGISTRY: {
      gitlab: {
        ...gitlabConnectorMeta,
        configFields: [],
        validateConfig: async (_token: string, config: Record<string, unknown>) =>
          config.project === 'invalid'
            ? { valid: false, error: 'Project not accessible' }
            : { valid: true },
      },
    },
  }
})

import { seedKnowledgeAclFixture } from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import {
  createManagedSearchSource,
  deleteManagedSearchSource,
  listManagedSearchSources,
  readManagedSearchSource,
  updateManagedSearchSource,
} from '@/lib/knowledge/application/manage-search-sources'
import { prepareSearchSource } from '@/lib/knowledge/application/sim-search'

describe('organization Search source administration', () => {
  const owners: Awaited<ReturnType<typeof seedKnowledgeAclFixture>>[] = []
  beforeAll(async () => {
    for (let i = 0; i < 2; i++) {
      const owner = await seedKnowledgeAclFixture()
      owners.push(owner)
      await db.insert(member).values([
        {
          id: generateId(),
          organizationId: owner.organizationId,
          userId: owner.aliceId,
          role: 'owner',
        },
        {
          id: generateId(),
          organizationId: owner.organizationId,
          userId: owner.bobId,
          role: 'member',
        },
      ])
      await db
        .update(knowledgeBase)
        .set({ workspaceId: null, organizationId: owner.organizationId, isSearchIndex: true })
        .where(eq(knowledgeBase.id, owner.knowledgeBaseId))
    }
  })
  afterAll(async () => {
    for (const owner of owners) {
      await deleteWorkspaceFixture(db, eq(workspace.id, owner.workspaceId))
      await db.delete(organization).where(eq(organization.id, owner.organizationId))
      await db.delete(user).where(inArray(user.id, [owner.aliceId, owner.bobId]))
    }
    await db.$client.end()
  })

  it('denies members, workspace keys, foreign sources, and ordinary knowledge bases', async () => {
    const owner = owners[0]
    const input = { organizationId: owner.organizationId, sourceId: owner.connectorId }
    for (const principal of [
      createPersonalApiKeyPrincipal({ userId: owner.bobId }),
      createWorkspaceApiKeyPrincipal({ workspaceId: owner.workspaceId }),
    ]) {
      for (const action of [
        () => readManagedSearchSource.execute({ principal, input }),
        () =>
          listManagedSearchSources.execute({
            principal,
            input: { organizationId: input.organizationId, limit: 10 },
          }),
        () =>
          updateManagedSearchSource.execute({
            principal,
            input: { ...input, updates: { status: 'paused' } },
          }),
        () => deleteManagedSearchSource.execute({ principal, input }),
        () =>
          createManagedSearchSource.execute({
            principal,
            input: {
              organizationId: input.organizationId,
              connectorType: 'gitlab',
              accessMode: 'admin',
              apiKey: 'fixture-token',
              sourceConfig: { host: 'gitlab.example.com', project: '123' },
            },
          }),
        () =>
          prepareSearchSource.execute({
            principal,
            input: {
              organizationId: input.organizationId,
              connectorType: 'gitlab',
              accessMode: 'admin',
            },
          }),
      ])
        await expect(action()).rejects.toMatchObject(
          principal.kind === 'workspace_api_key'
            ? {
                code: 'forbidden',
                detailCode: expect.stringMatching(
                  /^(WORKSPACE_KEY_OPERATION_NOT_PERMITTED|PRINCIPAL_KIND_NOT_PERMITTED)$/
                ),
              }
            : { name: 'ForbiddenOperationError' }
        )
    }
    const principal = createPersonalApiKeyPrincipal({ userId: owner.aliceId })
    await expect(
      readManagedSearchSource.execute({
        principal,
        input: { ...input, sourceId: owners[1].connectorId },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    await db
      .update(knowledgeBase)
      .set({ isSearchIndex: false, organizationId: null, workspaceId: owner.workspaceId })
      .where(eq(knowledgeBase.id, owner.knowledgeBaseId))
    try {
      await expect(
        updateManagedSearchSource.execute({
          principal,
          input: { ...input, updates: { status: 'paused' } },
        })
      ).rejects.toMatchObject({ code: 'not_found' })
    } finally {
      await db
        .update(knowledgeBase)
        .set({ isSearchIndex: true, organizationId: owner.organizationId, workspaceId: null })
        .where(eq(knowledgeBase.id, owner.knowledgeBaseId))
    }
    const [unchanged] = await db
      .select()
      .from(knowledgeConnector)
      .where(eq(knowledgeConnector.id, owner.connectorId))
    expect(unchanged.status).toBe('syncing')
  })

  it('initializes one canonical organization Search index on concurrent first use', async () => {
    const owner = owners[1]
    await db
      .update(knowledgeBase)
      .set({ organizationId: null, workspaceId: owner.workspaceId, isSearchIndex: false })
      .where(eq(knowledgeBase.id, owner.knowledgeBaseId))
    const input = {
      organizationId: owner.organizationId,
      connectorType: 'gitlab',
      accessMode: 'admin' as const,
    }
    const principal = createPersonalApiKeyPrincipal({ userId: owner.aliceId })
    await expect(
      createManagedSearchSource.execute({
        principal,
        input: {
          ...input,
          apiKey: 'fixture-token',
          sourceConfig: { host: 'gitlab.example.com', project: '123' },
        },
      })
    ).rejects.toMatchObject({ code: 'conflict' })
    const prepared = await Promise.all(
      [1, 2].map(() => prepareSearchSource.execute({ principal, input }))
    )
    expect(prepared[0].knowledgeBaseId).not.toBe(owner.knowledgeBaseId)
    expect(prepared[1].knowledgeBaseId).toBe(prepared[0].knowledgeBaseId)
    const indexes = await db
      .select()
      .from(knowledgeBase)
      .where(eq(knowledgeBase.organizationId, owner.organizationId))
    expect(indexes).toHaveLength(1)
  })

  it('reuses preparation, validates creation, and preserves source identity through pause and deletion', async () => {
    const owner = owners[0]
    const principal = createPersonalApiKeyPrincipal({ userId: owner.aliceId })
    const preparation = {
      organizationId: owner.organizationId,
      connectorType: 'gitlab',
      accessMode: 'admin' as const,
    }
    const prepared = await Promise.all(
      [1, 2].map(() => prepareSearchSource.execute({ principal, input: preparation }))
    )
    expect(prepared.map((result) => result.knowledgeBaseId)).toEqual([
      owner.knowledgeBaseId,
      owner.knowledgeBaseId,
    ])
    const input = {
      ...preparation,
      apiKey: 'fixture-pat-not-a-real-secret',
      sourceConfig: { host: 'gitlab.example.com', project: 'invalid' },
    }
    await expect(createManagedSearchSource.execute({ principal, input })).rejects.toThrow(
      'Project not accessible'
    )
    const before = await listManagedSearchSources.execute({
      principal,
      input: { organizationId: owner.organizationId, limit: 100 },
    })
    expect(before.connectors).toHaveLength(1)
    await db
      .insert(organizationSearchIntegration)
      .values({ organizationId: owner.organizationId, connectorType: 'gitlab', approved: false })
    const created = await createManagedSearchSource.execute({
      principal,
      input: { ...input, sourceConfig: { ...input.sourceConfig, project: '123' } },
    })
    expect(created.connector.approved).toBe(false)
    expect(created.connector).not.toHaveProperty('encryptedApiKey')
    const [stored] = await db
      .select()
      .from(knowledgeConnector)
      .where(eq(knowledgeConnector.id, created.connector.id))
    expect(stored.encryptedApiKey).toBeTruthy()
    expect(stored.encryptedApiKey).not.toBe(input.apiKey)
    const target = { organizationId: owner.organizationId, sourceId: created.connector.id }
    for (const status of ['paused', 'active'] as const) {
      const updated = await updateManagedSearchSource.execute({
        principal,
        input: { ...target, updates: { status } },
      })
      expect(updated.connector).toMatchObject({ id: target.sourceId, status, approved: false })
    }
    await deleteManagedSearchSource.execute({ principal, input: target })
    await expect(
      readManagedSearchSource.execute({ principal, input: target })
    ).rejects.toMatchObject({ code: 'not_found' })
  })
})
