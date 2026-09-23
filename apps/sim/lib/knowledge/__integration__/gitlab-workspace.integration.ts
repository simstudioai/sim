/** Real PAT storage, creation, sync, indexing, and workspace authorization with fixture GitLab replies. */
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { db } from '@sim/db'
import {
  document,
  environment,
  knowledgeBase,
  knowledgeConnector,
  knowledgeConnectorPermissionSnapshot,
  organization,
  permissions,
  user,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ root: '', fetch: vi.fn() }))
vi.mock('@/lib/uploads/core/setup.server', () => ({
  get UPLOAD_DIR_SERVER() {
    return fixture.root
  },
}))
vi.mock('@/lib/knowledge/documents/secure-fetch.server', () => ({
  secureFetchWithRetry: fixture.fetch,
}))
vi.mock('@/lib/embeddings', async () => ({
  ...(await import('@/lib/embeddings/client')),
  assertKnowledgeEmbeddingCapacity: async () => {},
  embedKnowledge: async (texts: string[]) => ({
    embeddings: texts.map(() => [1, ...Array<number>(1535).fill(0)]),
    totalTokens: texts.length,
    billableTokens: 0,
    isBYOK: true,
    modelName: 'text-embedding-3-small',
    pricingId: 'text-embedding-3-small',
  }),
}))

import { decryptApiKey } from '@/lib/api-key/crypto'
import { encryptSecret } from '@/lib/core/security/encryption'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import {
  createKnowledgeConnector,
  updateKnowledgeConnector,
} from '@/lib/knowledge/application/connectors'
import { readKnowledgeDocument } from '@/lib/knowledge/application/documents'
import { searchKnowledge } from '@/lib/knowledge/application/search'

const ids = createKnowledgeAclFixtureIds()
const sourceConfig = {
  host: 'gitlab.example.com',
  project: 'group/project',
  contentTypes: 'repo',
}
const principal = { kind: 'session' as const, userId: ids.aliceId, sessionId: generateId() }
const input = {
  knowledgeBaseId: ids.knowledgeBaseId,
  assertedWorkspaceId: ids.workspaceId,
  connectorType: 'gitlab',
  apiKey: 'fixture-read-only-pat',
  sourceConfig,
  syncIntervalMinutes: 1440,
}

beforeAll(async () => {
  fixture.root = mkdtempSync(path.join(tmpdir(), 'sim-gitlab-workspace-'))
  await seedKnowledgeAclFixture(ids)
  await db.insert(environment).values({
    id: ids.aliceId,
    userId: ids.aliceId,
    variables: { GITLAB_PAT: (await encryptSecret(input.apiKey)).encrypted },
  })
  await db
    .update(permissions)
    .set({ permissionType: 'write' })
    .where(and(eq(permissions.entityId, ids.workspaceId), eq(permissions.userId, ids.aliceId)))
  fixture.fetch.mockImplementation(async (raw: string, init: RequestInit) => {
    const url = new URL(raw)
    expect(url.origin).toBe('https://gitlab.example.com')
    expect(init.method ?? 'GET').toBe('GET')
    expect(new Headers(init.headers).get('PRIVATE-TOKEN')).toBe(input.apiKey)
    const project = '/api/v4/projects/group%2Fproject'
    if (url.pathname === project)
      return Response.json({
        id: 42,
        path_with_namespace: 'group/project',
        default_branch: 'master',
      })
    if (url.pathname === `${project}/repository/commits/master`)
      return Response.json({ id: 'commit-v1' })
    expect(url.searchParams.get('ref')).toBe('master')
    if (url.pathname === `${project}/repository/tree`)
      return Response.json([{ id: 'blob-v1', name: 'orion.md', path: 'orion.md', type: 'blob' }])
    if (url.pathname === `${project}/repository/files/orion.md`)
      return Response.json({
        file_path: 'orion.md',
        blob_id: 'blob-v1',
        encoding: 'base64',
        content: Buffer.from('Orion firmware connector fixture.').toString('base64'),
      })
    throw new Error(`Unexpected GitLab API endpoint: ${url.pathname}`)
  })
})

afterAll(async () => {
  vi.restoreAllMocks()
  await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
  await db.delete(organization).where(eq(organization.id, ids.organizationId))
  await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
  await rm(fixture.root, { recursive: true, force: true })
  await db.$client.end()
})

it.each([input.apiKey, '{{GITLAB_PAT}}'])(
  'creates, syncs, edits, and searches a workspace GitLab source using %s',
  async (apiKey) => {
    const { connector } = await createKnowledgeConnector.execute({
      principal,
      input: { ...input, apiKey },
    })
    expect(connector.accessMode).toBe('workspace')
    expect(JSON.stringify(connector)).not.toContain(input.apiKey)
    await expect
      .poll(
        async () => {
          const [row] = await db
            .select()
            .from(knowledgeConnector)
            .where(eq(knowledgeConnector.id, connector.id))
          return { status: row.status, error: row.lastSyncError, synced: Boolean(row.lastSyncAt) }
        },
        { timeout: 15000 }
      )
      .toEqual({ status: 'active', error: null, synced: true })
    const [stored] = await db
      .select()
      .from(knowledgeConnector)
      .where(eq(knowledgeConnector.id, connector.id))
    expect(stored.syncIntervalMinutes).toBe(1440)
    expect(stored.encryptedApiKey).not.toBe(input.apiKey)
    expect((await decryptApiKey(stored.encryptedApiKey!)).decrypted).toBe(input.apiKey)
    expect(
      await db
        .select()
        .from(knowledgeConnectorPermissionSnapshot)
        .where(eq(knowledgeConnectorPermissionSnapshot.connectorId, connector.id))
    ).toEqual([])
    const docs = await db
      .select()
      .from(document)
      .where(and(eq(document.connectorId, connector.id), isNull(document.deletedAt)))
    expect(docs).toHaveLength(1)
    expect(docs[0].externalId).toBe('file:orion.md')
    expect(docs[0].acl).toEqual(['ws'])
    await expect
      .poll(
        async () => {
          const [doc] = await db.select().from(document).where(eq(document.id, docs[0].id))
          return doc.processingStatus
        },
        { timeout: 15000 }
      )
      .toBe('completed')

    const reader = { ...principal, userId: ids.bobId }
    const results = await searchKnowledge.execute({
      principal: reader,
      input: {
        workspaceId: ids.workspaceId,
        knowledgeBaseIds: [ids.knowledgeBaseId],
        query: 'Orion',
        searchMode: 'hybrid',
        topK: 5,
      },
    })
    expect(results.results.map((result) => result.documentId)).toContain(docs[0].id)
    await expect(
      readKnowledgeDocument.execute({
        principal: reader,
        input: { knowledgeBaseId: ids.knowledgeBaseId, documentId: docs[0].id },
      })
    ).resolves.toBeDefined()
    await expect(
      readKnowledgeDocument.execute({
        principal: { ...principal, userId: generateId() },
        input: { knowledgeBaseId: ids.knowledgeBaseId, documentId: docs[0].id },
      })
    ).rejects.toBeDefined()

    await updateKnowledgeConnector.execute({
      principal,
      input: {
        connectorId: connector.id,
        updates: { sourceConfig: { ...sourceConfig, ref: 'master' } },
      },
    })
    await expect
      .poll(
        async () => {
          const [row] = await db
            .select()
            .from(knowledgeConnector)
            .where(eq(knowledgeConnector.id, connector.id))
          return {
            status: row.status,
            error: row.lastSyncError,
            synced: Boolean(row.lastSyncAt && row.lastSyncAt > stored.lastSyncAt!),
          }
        },
        { timeout: 15000 }
      )
      .toEqual({ status: 'active', error: null, synced: true })
  },
  30000
)

it('still refuses workspace access on a Search index before contacting GitLab', async () => {
  const searchId = generateId()
  await db.insert(knowledgeBase).values({
    id: searchId,
    userId: ids.aliceId,
    workspaceId: ids.workspaceId,
    name: 'Search access regression',
    isSearchIndex: true,
  })
  const requestCount = fixture.fetch.mock.calls.length
  await expect(
    createKnowledgeConnector.execute({
      principal,
      input: { ...input, knowledgeBaseId: searchId },
    })
  ).rejects.toThrow('Search sources must support per-person access or source permissions')
  expect(fixture.fetch.mock.calls).toHaveLength(requestCount)
})
