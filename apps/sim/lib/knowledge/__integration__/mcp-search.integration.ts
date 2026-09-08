/** Real MCP SDK, API-key authentication, ingestion, Postgres, application authorization, and ACLs. */
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { db } from '@sim/db'
import {
  apiKey,
  document,
  embedding,
  embeddingSecretProvenance,
  knowledgeBase,
  knowledgeExternalGroupMember,
  organization,
  permissionGroup,
  permissionGroupWorkspace,
  rateLimitBucket,
  user,
  workspace,
} from '@sim/db/schema'
import { sha256Hex } from '@sim/security/hash'
import { generateId } from '@sim/utils/id'
import { isPlainRecord } from '@sim/utils/object'
import { and, eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const fixtures = vi.hoisted(() => ({ storageRoot: '' }))
vi.mock('@/lib/uploads/core/setup.server', () => ({
  get UPLOAD_DIR_SERVER() {
    return fixtures.storageRoot
  },
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

import { hashApiKey } from '@/lib/api-key/crypto'
import { resolveBillingAttribution } from '@/lib/billing/core/billing-attribution'
import { encryptSecret } from '@/lib/core/security/encryption'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { confluencePageAcl } from '@/lib/knowledge/access/confluence-permissions'
import { createContentSyncLease } from '@/lib/knowledge/connectors/sync-lock'
import { addDocument, persistDocumentAcls } from '@/lib/knowledge/connectors/sync-persistence'
import { processDocumentAsync } from '@/lib/knowledge/documents/service'
import { replaceKnowledgeEmbeddingSecretProvenanceInTx } from '@/lib/knowledge/secret-provenance'
import { DELETE, GET, POST } from '@/app/api/mcp/search/[workspaceId]/route'

describe('native Search MCP over real HTTP and application boundaries', () => {
  const ids = createKnowledgeAclFixtureIds()
  const other = createKnowledgeAclFixtureIds()
  const { aliceId, bobId, workspaceId, knowledgeBaseId, connectorId, lockId, groupIds } = ids
  const tokens = {
    alice: generateId(),
    bob: generateId(),
    workspace: generateId(),
    expired: generateId(),
  }
  const clients: Client[] = []
  const orgId = generateId()
  let documentId: string
  let alice: Client
  let bob: Client
  let workspaceClient: Client
  const content = Array.from(
    { length: 80 },
    (_, index) =>
      `Orion section ${index}: the release readiness checklist records engineers approving the customer migration plan and documenting operational dependencies. `
  ).join('\n\n')

  async function request(
    body: unknown,
    token?: string,
    options: {
      workspaceId?: string
      method?: string
      headers?: Record<string, string>
      raw?: string
    } = {}
  ) {
    const target = options.workspaceId ?? workspaceId
    const method = options.method ?? 'POST'
    const req = new NextRequest(`http://localhost:3000/api/mcp/search/${target}`, {
      method,
      headers: {
        'x-forwarded-for': '127.0.0.1',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(token ? { 'x-api-key': token } : {}),
        ...options.headers,
      },
      ...(method === 'POST' ? { body: options.raw ?? JSON.stringify(body) } : {}),
    })
    const context = { params: Promise.resolve({ workspaceId: target }) }
    return method === 'GET'
      ? GET(req, context)
      : method === 'DELETE'
        ? DELETE(req, context)
        : POST(req, context)
  }

  async function connect(token: string, target = workspaceId, bearer = false) {
    const client = new Client({ name: 'ACL fixture', version: '1.0.0' })
    clients.push(client)
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://localhost:3000/api/mcp/search/${target}`),
      {
        requestInit: {
          headers: bearer ? { authorization: `Bearer ${token}` } : { 'x-api-key': token },
        },
        fetch: async (url, init) => {
          const req = new NextRequest(url instanceof Request ? url : String(url), {
            ...init,
            signal: init?.signal ?? undefined,
          })
          req.headers.set('x-forwarded-for', '127.0.0.1')
          const context = { params: Promise.resolve({ workspaceId: target }) }
          return req.method === 'GET'
            ? GET(req, context)
            : req.method === 'DELETE'
              ? DELETE(req, context)
              : POST(req, context)
        },
      }
    )
    await client.connect(transport)
    return client
  }

  async function call(client: Client, name: string, args: Record<string, unknown>) {
    return CallToolResultSchema.parse(await client.callTool({ name, arguments: args }))
  }

  async function value(client: Client, name: string, args: Record<string, unknown>) {
    const result = await call(client, name, args)
    expect(result.isError).not.toBe(true)
    const first = result.content[0]
    if (first.type !== 'text') throw new Error('Expected JSON text tool result')
    const parsed: unknown = JSON.parse(first.text)
    if (!isPlainRecord(parsed)) throw new Error('Expected JSON object tool result')
    return parsed
  }

  async function search(client: Client) {
    const result = await value(client, 'search_documents', { query: 'Orion', topK: 50 })
    expect(Array.isArray(result.results)).toBe(true)
    return result.results as Array<Record<string, unknown>>
  }

  beforeAll(async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('Unexpected outbound fixture request')
    })
    fixtures.storageRoot = mkdtempSync(path.join(tmpdir(), 'sim-mcp-integration-'))
    await seedKnowledgeAclFixture(ids)
    await seedKnowledgeAclFixture(other)
    await db
      .update(knowledgeBase)
      .set({ isSearchIndex: true, name: 'Renamed enterprise index' })
      .where(eq(knowledgeBase.id, knowledgeBaseId))
    await db.insert(apiKey).values(
      Object.entries(tokens).map(([name, token]) => ({
        id: generateId(),
        userId: name === 'bob' ? bobId : aliceId,
        name,
        key: `fixture-${generateId()}`,
        keyHash: hashApiKey(token),
        type: name === 'workspace' ? 'workspace' : 'personal',
        workspaceId: name === 'workspace' ? workspaceId : null,
        expiresAt: name === 'expired' ? new Date(0) : null,
      }))
    )
    const doc = await addDocument(
      knowledgeBaseId,
      connectorId,
      'confluence',
      {
        externalId: 'mcp-page',
        mimeType: 'text/plain',
        title: 'Orion project',
        content,
        contentHash: 'fixture-mcp-orion',
        sourceUrl: 'https://fixture.atlassian.net/wiki/pages/mcp',
      },
      { userId: aliceId, workspaceId },
      undefined,
      'admin',
      createContentSyncLease(connectorId, lockId)
    )
    documentId = doc.documentId
    await processDocumentAsync(
      knowledgeBaseId,
      documentId,
      doc,
      {},
      await resolveBillingAttribution({ actorUserId: aliceId, workspaceId })
    )
    const [persisted] = await db
      .select({ status: document.processingStatus })
      .from(document)
      .where(eq(document.id, documentId))
    expect(persisted.status).toBe('completed')
    await persistDocumentAcls(
      connectorId,
      new Map([
        [
          'mcp-page',
          confluencePageAcl({
            providerId: 'confluence',
            tenantId: 'fixture-tenant',
            spacePrincipals: [{ kind: 'group', id: 'space' }],
            restrictionChain: [[{ kind: 'group', id: 'page' }], [{ kind: 'group', id: 'parent' }]],
          }),
        ],
      ])
    )
    alice = await connect(tokens.alice)
    bob = await connect(tokens.bob, workspaceId, true)
    workspaceClient = await connect(tokens.workspace)
  })

  afterAll(async () => {
    await Promise.all(clients.map((client) => client.close()))
    await db.delete(organization).where(eq(organization.id, orgId))
    for (const fixture of [ids, other]) {
      await db.delete(workspace).where(eq(workspace.id, fixture.workspaceId))
      await db.delete(user).where(eq(user.id, fixture.aliceId))
      await db.delete(user).where(eq(user.id, fixture.bobId))
    }
    await rm(fixtures.storageRoot, { recursive: true, force: true })
    await db.$client.end()
    vi.unstubAllGlobals()
  })

  it('initializes, lists only three read tools, and finds the renamed canonical index', async () => {
    const listed = await alice.listTools()
    expect(listed.tools.map((tool) => tool.name)).toEqual([
      'search_documents',
      'read_document',
      'list_document_chunks',
    ])
    expect(listed.tools.every((tool) => tool.annotations?.readOnlyHint)).toBe(true)
    const rows = await search(alice)
    expect(rows.length).toBeGreaterThan(1)
    expect(
      rows.every((row) => row.documentId === documentId && row.knowledgeBaseId === knowledgeBaseId)
    ).toBe(true)
    expect(rows[0]).not.toHaveProperty('embeddingId')
    expect(rows[0]).not.toHaveProperty('metadata')
    expect(await value(alice, 'read_document', { knowledgeBaseId, documentId })).toMatchObject({
      title: 'Orion project',
      sourceUrl: 'https://fixture.atlassian.net/wiki/pages/mcp',
    })
  })

  it('denies direct document and chunk access as well as search for a person missing one inherited permission and for an actorless key', async () => {
    for (const client of [bob, workspaceClient]) {
      expect(await search(client)).toEqual([])
      for (const name of ['read_document', 'list_document_chunks']) {
        expect(await call(client, name, { knowledgeBaseId, documentId })).toMatchObject({
          isError: true,
          content: [{ type: 'text', text: 'Document not found' }],
        })
      }
    }
  })

  it('grants and revokes source membership immediately across existing MCP clients', async () => {
    const membership = { groupId: groupIds[2], subjectToken: `u:${bobId}@fixture.test` }
    await db.insert(knowledgeExternalGroupMember).values(membership)
    expect((await search(bob)).length).toBeGreaterThan(0)
    expect(await value(bob, 'read_document', { knowledgeBaseId, documentId })).toHaveProperty(
      'documentId',
      documentId
    )
    expect(
      await value(bob, 'list_document_chunks', { knowledgeBaseId, documentId })
    ).toHaveProperty('chunks')
    await db
      .delete(knowledgeExternalGroupMember)
      .where(
        and(
          eq(knowledgeExternalGroupMember.groupId, membership.groupId),
          eq(knowledgeExternalGroupMember.subjectToken, membership.subjectToken)
        )
      )
    expect(await search(bob)).toEqual([])
    expect((await call(bob, 'read_document', { knowledgeBaseId, documentId })).isError).toBe(true)
    expect((await call(bob, 'list_document_chunks', { knowledgeBaseId, documentId })).isError).toBe(
      true
    )
  })

  it('paginates enabled chunks in order and safely handles concurrent stateless calls', async () => {
    const first = await value(alice, 'list_document_chunks', {
      knowledgeBaseId,
      documentId,
      limit: 1,
    })
    const second = await value(alice, 'list_document_chunks', {
      knowledgeBaseId,
      documentId,
      limit: 1,
      offset: 1,
    })
    expect(first.pagination).toMatchObject({ limit: 1, offset: 0, hasMore: true })
    expect(first.chunks).not.toEqual(second.chunks)
    const [head] = await db
      .select({ id: embedding.id })
      .from(embedding)
      .where(eq(embedding.documentId, documentId))
      .orderBy(embedding.chunkIndex)
      .limit(1)
    await db.update(embedding).set({ enabled: false }).where(eq(embedding.id, head.id))
    const enabled = await value(alice, 'list_document_chunks', {
      knowledgeBaseId,
      documentId,
      limit: 1,
    })
    expect(enabled.chunks).toEqual(second.chunks)
    await db.update(embedding).set({ enabled: true }).where(eq(embedding.id, head.id))
    const concurrent = await Promise.all([search(alice), search(bob), search(workspaceClient)])
    expect(concurrent[0].length).toBeGreaterThan(0)
    expect(concurrent[1]).toEqual([])
    expect(concurrent[2]).toEqual([])
  })

  it('allows public source content to an actorless key without impersonating its owner', async () => {
    const [previous] = await db
      .select({ acl: document.acl, aclRequirements: document.aclRequirements })
      .from(document)
      .where(eq(document.id, documentId))
    await db
      .update(document)
      .set({ acl: ['pub'], aclRequirements: [] })
      .where(eq(document.id, documentId))
    expect((await search(workspaceClient)).length).toBeGreaterThan(0)
    expect(
      await value(workspaceClient, 'read_document', { knowledgeBaseId, documentId })
    ).toHaveProperty('documentId', documentId)
    expect(
      await value(workspaceClient, 'list_document_chunks', { knowledgeBaseId, documentId })
    ).toHaveProperty('chunks')
    await db.update(document).set(previous).where(eq(document.id, documentId))
    expect(await search(workspaceClient)).toEqual([])
  })

  it('authenticates before initialization, listing, unknown methods, malformed bodies and unsupported HTTP methods', async () => {
    for (const method of ['initialize', 'tools/list', 'unknown']) {
      for (const token of [undefined, 'invalid-fixture-key', tokens.expired]) {
        expect((await request({ jsonrpc: '2.0', id: 1, method }, token)).status).toBe(401)
      }
    }
    expect((await request(null, undefined, { raw: '{' })).status).toBe(401)
    expect((await request(null, undefined, { method: 'GET' })).status).toBe(401)
    expect((await request(null, tokens.alice, { method: 'GET' })).status).toBe(405)
    expect((await request(null, tokens.alice, { method: 'DELETE' })).status).toBe(405)
    expect(
      (await request({}, tokens.alice, { headers: { authorization: `Bearer ${tokens.bob}` } }))
        .status
    ).toBe(401)
    expect(
      (await request({}, tokens.alice, { headers: { origin: 'https://untrusted.example' } })).status
    ).toBe(403)
  })

  it('rejects cross-workspace keys and explicit knowledge bases and has no mutation tools', async () => {
    const list = { jsonrpc: '2.0', id: 1, method: 'tools/list' }
    expect((await request(list, tokens.workspace, { workspaceId: other.workspaceId })).status).toBe(
      403
    )
    expect((await request(list, tokens.alice, { workspaceId: other.workspaceId })).status).toBe(403)
    expect(
      (
        await call(alice, 'search_documents', {
          query: 'Orion',
          knowledgeBaseIds: [other.knowledgeBaseId],
        })
      ).isError
    ).toBe(true)
    expect(
      (await call(alice, 'read_document', { knowledgeBaseId: other.knowledgeBaseId, documentId }))
        .isError
    ).toBe(true)
    expect((await call(alice, 'delete_document', { knowledgeBaseId, documentId })).isError).toBe(
      true
    )
    expect(
      (
        await call(alice, 'search_documents', {
          query: 'Orion',
          knowledgeBaseIds: Array<string>(21).fill(knowledgeBaseId),
        })
      ).isError
    ).toBe(true)
    expect(
      (await call(alice, 'list_document_chunks', { knowledgeBaseId, documentId, limit: 51 }))
        .isError
    ).toBe(true)
  })

  it('returns an actionable empty default without creating an index and still accepts explicit authorized knowledge bases', async () => {
    await db
      .update(knowledgeBase)
      .set({ isSearchIndex: false })
      .where(eq(knowledgeBase.id, knowledgeBaseId))
    const empty = await value(alice, 'search_documents', { query: 'Orion' })
    expect(empty.results).toEqual([])
    expect(empty.message).toContain('No Search index')
    const explicit = await value(alice, 'search_documents', {
      query: 'Orion',
      knowledgeBaseIds: [knowledgeBaseId],
    })
    expect(explicit.results).not.toEqual([])
    await db
      .update(knowledgeBase)
      .set({ isSearchIndex: true })
      .where(eq(knowledgeBase.id, knowledgeBaseId))
  })

  it('rejects oversized protocol bodies before dispatch', async () => {
    expect(
      (
        await request(
          { jsonrpc: '2.0', id: 1, method: 'tools/list', ignored: 'x'.repeat(64 * 1024) },
          tokens.alice
        )
      ).status
    ).toBe(413)
  })

  it('rate limits discovery and each tool operation through the existing shared buckets', async () => {
    const metadataBucket = `v2:knowledge.search.index.read:user:${aliceId}`
    const searchBucket = `v2:knowledge.search:user:${aliceId}`
    await db
      .update(rateLimitBucket)
      .set({ tokens: '0', lastRefillAt: new Date() })
      .where(eq(rateLimitBucket.key, metadataBucket))
    const denied = await request({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, tokens.alice)
    expect(denied.status).toBe(429)
    expect(denied.headers.get('retry-after')).not.toBeNull()
    await db.delete(rateLimitBucket).where(eq(rateLimitBucket.key, metadataBucket))
    await db
      .update(rateLimitBucket)
      .set({ tokens: '0', lastRefillAt: new Date() })
      .where(eq(rateLimitBucket.key, searchBucket))
    expect((await call(alice, 'search_documents', { query: 'Orion' })).isError).toBe(true)
    expect((await alice.listTools()).tools).toHaveLength(3)
    await db.delete(rateLimitBucket).where(eq(rateLimitBucket.key, searchBucket))
    expect((await search(alice)).length).toBeGreaterThan(0)
  })

  it('bounds returned text and redacts source secrets without exposing their owner’s secret names', async () => {
    const [original] = await db
      .select({
        id: embedding.id,
        content: embedding.content,
        chunkHash: embedding.chunkHash,
        secretProvenanceVersion: embedding.secretProvenanceVersion,
      })
      .from(embedding)
      .where(eq(embedding.documentId, documentId))
      .orderBy(embedding.chunkIndex)
      .limit(1)
    const [sidecar] = await db
      .select()
      .from(embeddingSecretProvenance)
      .where(eq(embeddingSecretProvenance.embeddingId, original.id))
    try {
      await db
        .update(embedding)
        .set({ content: 'Orion '.repeat(180_000), secretProvenanceVersion: null })
        .where(eq(embedding.id, original.id))
      const oversized = await call(alice, 'list_document_chunks', {
        knowledgeBaseId,
        documentId,
        limit: 1,
      })
      expect(oversized.isError).toBe(true)
      expect(JSON.stringify(oversized).length).toBeLessThan(1024)

      const secret = `fixture-secret-${generateId()}`
      const text = `Orion source secret: ${secret}`
      const encrypted = await encryptSecret(secret)
      await db.transaction(async (tx) => {
        await tx
          .update(embedding)
          .set({ content: text, chunkHash: sha256Hex(text) })
          .where(eq(embedding.id, original.id))
        await replaceKnowledgeEmbeddingSecretProvenanceInTx(tx, original.id, text, {
          status: 'exact',
          entries: [
            {
              encryptedValue: encrypted.encrypted,
              name: 'FIXTURE_PRIVATE_SECRET_NAME',
              sourceUserId: aliceId,
              sourceWorkspaceId: workspaceId,
            },
          ],
        })
      })
      for (const result of [
        await value(alice, 'list_document_chunks', { knowledgeBaseId, documentId, limit: 1 }),
        await value(alice, 'search_documents', { query: 'Orion' }),
      ]) {
        expect(JSON.stringify(result)).not.toContain(secret)
        expect(JSON.stringify(result)).not.toContain('FIXTURE_PRIVATE_SECRET_NAME')
      }
      await db
        .update(embeddingSecretProvenance)
        .set({ entries: [{ encryptedValue: 'invalid-fixture-cipher', sourceUserId: aliceId }] })
        .where(eq(embeddingSecretProvenance.embeddingId, original.id))
      expect(
        (await call(alice, 'list_document_chunks', { knowledgeBaseId, documentId, limit: 1 }))
          .isError
      ).toBe(true)
    } finally {
      await db
        .update(embedding)
        .set({
          content: original.content,
          chunkHash: original.chunkHash,
          secretProvenanceVersion: original.secretProvenanceVersion,
        })
        .where(eq(embedding.id, original.id))
      if (sidecar)
        await db
          .insert(embeddingSecretProvenance)
          .values(sidecar)
          .onConflictDoUpdate({ target: embeddingSecretProvenance.embeddingId, set: sidecar })
      else
        await db
          .delete(embeddingSecretProvenance)
          .where(eq(embeddingSecretProvenance.embeddingId, original.id))
    }
  })

  it('handles client cancellation without retaining or poisoning a session', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      alice.callTool({ name: 'search_documents', arguments: { query: 'Orion' } }, undefined, {
        signal: controller.signal,
      })
    ).rejects.toThrow()
    expect((await search(alice)).length).toBeGreaterThan(0)
  })

  it('enforces an organization capability restriction before tool discovery', async () => {
    await db
      .insert(organization)
      .values({ id: orgId, name: 'MCP restriction fixture', slug: orgId, createdAt: new Date() })
    await db.update(workspace).set({ organizationId: orgId }).where(eq(workspace.id, workspaceId))
    const groupId = generateId()
    await db.insert(permissionGroup).values({
      id: groupId,
      organizationId: orgId,
      name: 'No knowledge',
      createdBy: aliceId,
      config: { hideKnowledgeBaseTab: true },
    })
    await db
      .insert(permissionGroupWorkspace)
      .values({ id: generateId(), permissionGroupId: groupId, organizationId: orgId, workspaceId })
    for (const token of [tokens.alice, tokens.bob]) {
      expect((await request({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, token)).status).toBe(
        403
      )
    }
    expect(
      (await request({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, tokens.workspace)).status
    ).toBe(200)
    await db.update(workspace).set({ organizationId: null }).where(eq(workspace.id, workspaceId))
  })
})
