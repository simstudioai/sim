/**
 * Real organization-owned ingestion, Postgres, API-key authentication, application
 * authorization, source ACLs, and MCP SDK transport. Only embedding vectors are
 * deterministic and storage is temporary; no provider or live credential is used.
 */
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  apiKey,
  document,
  embedding,
  knowledgeBase,
  knowledgeExternalGroup,
  knowledgeExternalGroupMember,
  member,
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  organization,
  organizationSearchIntegration,
  user,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { isPlainRecord } from '@sim/utils/object'
import { and, eq, inArray } from 'drizzle-orm'
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
import { hashOAuthToken } from '@/lib/auth/oauth-access-token'
import { OAUTH_ACCESS_TOKEN_PREFIX } from '@/lib/auth/oauth-provider'
import { resolveOrganizationBillingAttribution } from '@/lib/billing/core/billing-attribution'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { confluencePageAcl } from '@/lib/knowledge/access/confluence-permissions'
import { listKnowledgeChunks } from '@/lib/knowledge/application/chunks'
import { readKnowledgeDocument } from '@/lib/knowledge/application/documents'
import { listKnowledgeBaseCatalog } from '@/lib/knowledge/application/knowledge-bases'
import { prepareSearchSource } from '@/lib/knowledge/application/sim-search'
import { searchScopedKnowledge } from '@/lib/knowledge/application/workspace-search'
import { createContentSyncLease } from '@/lib/knowledge/connectors/sync-lock'
import { addDocument, persistDocumentAcls } from '@/lib/knowledge/connectors/sync-persistence'
import { processDocumentAsync } from '@/lib/knowledge/documents/service'
import { getSearchMcpUrl } from '@/lib/knowledge/mcp/urls'
import { DELETE, GET, POST } from '@/app/api/mcp/search/organizations/[organizationId]/route'

describe('organization Search MCP with real ingestion and current access', () => {
  const ids = createKnowledgeAclFixtureIds()
  const {
    aliceId,
    bobId,
    workspaceId,
    organizationId,
    knowledgeBaseId,
    connectorId,
    lockId,
    groupIds,
  } = ids
  const otherOrganizationId = generateId()
  const workspaceKnowledgeBaseId = generateId()
  const outsiderId = generateId()
  const otherAdminId = generateId()
  const bobMembershipId = generateId()
  const tokens = {
    alice: generateId(),
    bob: generateId(),
    outsider: generateId(),
    workspace: generateId(),
  }
  const oauthClientId = generateId()
  const oauthTokens = { alice: generateId(), bob: generateId() }
  const clients: Client[] = []
  const alicePrincipal: Principal = { kind: 'session', userId: aliceId, sessionId: generateId() }
  const bobPrincipal: Principal = { kind: 'session', userId: bobId, sessionId: generateId() }
  const otherAdminPrincipal: Principal = {
    kind: 'session',
    userId: otherAdminId,
    sessionId: generateId(),
  }
  const bobSourceMembership = {
    groupId: groupIds[2],
    subjectToken: `u:${bobId}@fixture.test`,
  }
  let otherKnowledgeBaseId: string
  let documentId: string
  let alice: Client
  let bob: Client
  let aliceOAuth: Client
  let bobOAuth: Client

  async function request(token: string, target = organizationId) {
    return POST(
      new NextRequest(`http://localhost:3000/api/mcp/search/organizations/${target}`, {
        method: 'POST',
        headers: {
          'x-forwarded-for': '127.0.0.1',
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'x-api-key': token,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      }),
      { params: Promise.resolve({ organizationId: target }) }
    )
  }

  async function connect(token: string, bearer = false) {
    const client = new Client({ name: 'Organization ACL fixture', version: '1.0.0' })
    clients.push(client)
    await client.connect(
      new StreamableHTTPClientTransport(
        new URL(`http://localhost:3000/api/mcp/search/organizations/${organizationId}`),
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
            const context = { params: Promise.resolve({ organizationId }) }
            return req.method === 'GET'
              ? GET(req, context)
              : req.method === 'DELETE'
                ? DELETE(req, context)
                : POST(req, context)
          },
        }
      )
    )
    return client
  }

  async function call(client: Client, name: string, args: Record<string, unknown>) {
    return CallToolResultSchema.parse(await client.callTool({ name, arguments: args }))
  }

  async function value(client: Client, name: string, args: Record<string, unknown>) {
    const result = await call(client, name, args)
    expect(result.isError).not.toBe(true)
    const first = result.content[0]
    if (first?.type !== 'text') throw new Error('Expected JSON text tool result')
    const parsed: unknown = JSON.parse(first.text)
    if (!isPlainRecord(parsed)) throw new Error('Expected JSON object tool result')
    return parsed
  }

  async function search(client: Client) {
    const result = await value(client, 'search_documents', { query: 'Orion', topK: 50 })
    if (!Array.isArray(result.results) || !result.results.every(isPlainRecord)) {
      throw new Error('Expected search result objects')
    }
    return result.results
  }

  async function applicationSearch(principal: Principal) {
    const result = await searchScopedKnowledge.execute({
      principal,
      input: { organizationId, query: 'Orion', searchMode: 'hybrid', topK: 50 },
    })
    return result.results
  }

  async function expectDocumentHidden(client: Client) {
    expect(await search(client)).toEqual([])
    for (const name of ['read_document', 'list_document_chunks']) {
      expect(await call(client, name, { knowledgeBaseId, documentId })).toMatchObject({
        isError: true,
        content: [{ type: 'text', text: 'Document not found' }],
      })
    }
  }

  async function revokeBobSourceAccess() {
    await db
      .delete(knowledgeExternalGroupMember)
      .where(
        and(
          eq(knowledgeExternalGroupMember.groupId, bobSourceMembership.groupId),
          eq(knowledgeExternalGroupMember.subjectToken, bobSourceMembership.subjectToken)
        )
      )
  }

  beforeAll(async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('Unexpected outbound organization MCP fixture request')
    })
    fixtures.storageRoot = mkdtempSync(path.join(tmpdir(), 'sim-organization-mcp-integration-'))
    await seedKnowledgeAclFixture(ids)
    await db.insert(user).values(
      [outsiderId, otherAdminId].map((id) => ({
        id,
        name: 'Other organization fixture',
        email: `${id}@fixture.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }))
    )
    await db.insert(organization).values({
      id: otherOrganizationId,
      name: 'Other organization MCP fixture',
      slug: otherOrganizationId,
      createdAt: new Date(),
    })
    await db.insert(member).values([
      { id: generateId(), userId: aliceId, organizationId, role: 'owner' },
      { id: bobMembershipId, userId: bobId, organizationId, role: 'member' },
      { id: generateId(), userId: outsiderId, organizationId: otherOrganizationId, role: 'owner' },
      {
        id: generateId(),
        userId: otherAdminId,
        organizationId: otherOrganizationId,
        role: 'admin',
      },
    ])
    /** Reuse source identities, but establish exclusive organization ownership before ingestion. */
    await db
      .update(knowledgeBase)
      .set({
        workspaceId: null,
        organizationId,
        isSearchIndex: true,
        name: 'Renamed org index',
        chunkingConfig: { maxSize: 256, minSize: 1, overlap: 20 },
      })
      .where(eq(knowledgeBase.id, knowledgeBaseId))
    await db
      .update(knowledgeExternalGroup)
      .set({ workspaceId: null, organizationId })
      .where(inArray(knowledgeExternalGroup.id, groupIds))
    const prepared = await prepareSearchSource.execute({
      principal: otherAdminPrincipal,
      input: { organizationId: otherOrganizationId, connectorType: 'gitlab' },
    })
    otherKnowledgeBaseId = prepared.knowledgeBaseId
    await db.insert(knowledgeBase).values({
      id: workspaceKnowledgeBaseId,
      userId: bobId,
      workspaceId,
      name: 'Workspace documents',
    })
    await db.insert(organizationSearchIntegration).values({
      organizationId,
      connectorType: 'confluence',
      approved: true,
    })
    await db.insert(apiKey).values(
      Object.entries(tokens).map(([name, token]) => ({
        id: generateId(),
        userId: name === 'bob' ? bobId : name === 'outsider' ? outsiderId : aliceId,
        name,
        key: `fixture-${generateId()}`,
        keyHash: hashApiKey(token),
        type: name === 'workspace' ? 'workspace' : 'personal',
        workspaceId: name === 'workspace' ? workspaceId : null,
      }))
    )
    await db.insert(oauthClient).values({
      id: oauthClientId,
      clientId: oauthClientId,
      name: 'Search MCP OAuth fixture',
      public: true,
      requirePKCE: true,
      redirectUris: ['http://127.0.0.1/callback'],
      tokenEndpointAuthMethod: 'none',
      scopes: ['search:read'],
      grantTypes: ['authorization_code'],
      responseTypes: ['code'],
    })
    for (const [userId, token] of [
      [aliceId, oauthTokens.alice],
      [bobId, oauthTokens.bob],
    ]) {
      await db.insert(oauthConsent).values({
        id: generateId(),
        clientId: oauthClientId,
        userId,
        scopes: ['search:read'],
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      await db.insert(oauthAccessToken).values({
        id: generateId(),
        clientId: oauthClientId,
        userId,
        token: hashOAuthToken(token),
        scopes: ['search:read'],
        resource: getSearchMcpUrl('organization', organizationId),
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 3600_000),
      })
    }
    const doc = await addDocument(
      knowledgeBaseId,
      connectorId,
      'confluence',
      {
        externalId: 'organization-mcp-page',
        mimeType: 'text/plain',
        title: 'Orion organization project',
        content: Array.from(
          { length: 30 },
          (_, index) =>
            `Orion section ${index}: engineers approved the release checklist and documented the customer migration dependencies.`
        ).join('\n\n'),
        contentHash: 'fixture-organization-orion',
        sourceUrl: 'https://fixture.atlassian.net/wiki/pages/organization-mcp',
      },
      { userId: aliceId, workspaceId: null, organizationId },
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
      await resolveOrganizationBillingAttribution({ actorUserId: aliceId, organizationId })
    )
    const [persisted] = await db
      .select({ status: document.processingStatus, error: document.processingError })
      .from(document)
      .where(eq(document.id, documentId))
    expect(persisted).toEqual({ status: 'completed', error: null })
    await persistDocumentAcls(
      connectorId,
      new Map([
        [
          'organization-mcp-page',
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
    bob = await connect(tokens.bob, true)
    aliceOAuth = await connect(OAUTH_ACCESS_TOKEN_PREFIX + oauthTokens.alice, true)
    bobOAuth = await connect(OAUTH_ACCESS_TOKEN_PREFIX + oauthTokens.bob, true)
  })

  afterAll(async () => {
    await Promise.all(clients.map((client) => client.close()))
    await db.delete(oauthClient).where(eq(oauthClient.clientId, oauthClientId))
    await db
      .delete(organization)
      .where(inArray(organization.id, [organizationId, otherOrganizationId]))
    await db.delete(workspace).where(eq(workspace.id, workspaceId))
    await db.delete(user).where(inArray(user.id, [aliceId, bobId, outsiderId, otherAdminId]))
    if (fixtures.storageRoot) await rm(fixtures.storageRoot, { recursive: true, force: true })
    await db.$client.end()
    vi.unstubAllGlobals()
  })

  it('creates an organization-only index, keeps it out of the workspace catalog, and separates actor from payer', async () => {
    const input = { organizationId: otherOrganizationId, connectorType: 'gitlab' }
    const results = await Promise.all([
      prepareSearchSource.execute({ principal: otherAdminPrincipal, input }),
      prepareSearchSource.execute({ principal: otherAdminPrincipal, input }),
    ])
    expect(results.map((result) => result.knowledgeBaseId)).toEqual([
      otherKnowledgeBaseId,
      otherKnowledgeBaseId,
    ])
    const indexes = await db
      .select()
      .from(knowledgeBase)
      .where(eq(knowledgeBase.organizationId, otherOrganizationId))
    expect(indexes).toEqual([
      expect.objectContaining({
        id: otherKnowledgeBaseId,
        workspaceId: null,
        organizationId: otherOrganizationId,
        isSearchIndex: true,
        userId: otherAdminId,
      }),
    ])
    const catalog = await listKnowledgeBaseCatalog.execute({
      principal: alicePrincipal,
      input: { workspaceId },
    })
    expect(catalog.knowledgeBases.map(({ knowledgeBase }) => knowledgeBase.id)).toEqual([
      workspaceKnowledgeBaseId,
    ])
    await expect(
      resolveOrganizationBillingAttribution({
        actorUserId: otherAdminId,
        organizationId: otherOrganizationId,
      })
    ).resolves.toMatchObject({
      actorUserId: otherAdminId,
      workspaceId: null,
      organizationId: otherOrganizationId,
      billedAccountUserId: outsiderId,
      billingEntity: { type: 'organization', id: otherOrganizationId },
    })
  })

  it('finds the canonical org-owned index and applies each current member’s source ACL to all tools', async () => {
    const [owner] = await db
      .select({
        workspaceId: knowledgeBase.workspaceId,
        organizationId: knowledgeBase.organizationId,
      })
      .from(knowledgeBase)
      .where(eq(knowledgeBase.id, knowledgeBaseId))
    expect(owner).toEqual({ workspaceId: null, organizationId })
    expect((await alice.listTools()).tools.map((tool) => tool.name)).toEqual([
      'search_documents',
      'read_document',
      'list_document_chunks',
    ])
    const rows = await search(alice)
    expect(rows.length).toBeGreaterThan(1)
    expect(
      rows.every((row) => row.knowledgeBaseId === knowledgeBaseId && row.documentId === documentId)
    ).toBe(true)
    expect((await applicationSearch(alicePrincipal)).map((row) => row.documentId)).toEqual(
      rows.map((row) => row.documentId)
    )
    expect(await value(alice, 'read_document', { knowledgeBaseId, documentId })).toMatchObject({
      title: 'Orion organization project',
      documentId,
    })
    const page = await value(alice, 'list_document_chunks', {
      knowledgeBaseId,
      documentId,
      limit: 1,
    })
    expect(page.chunks).toEqual([
      expect.objectContaining({ chunkIndex: 0, content: expect.stringContaining('Orion') }),
    ])
    expect(page.pagination).toMatchObject({ limit: 1, offset: 0, hasMore: true })
    const nextPage = await value(alice, 'list_document_chunks', {
      knowledgeBaseId,
      documentId,
      limit: 1,
      offset: 1,
    })
    expect(nextPage.chunks).toEqual([expect.objectContaining({ chunkIndex: 1 })])
    expect(nextPage.chunks).not.toEqual(page.chunks)
    expect(nextPage.pagination).toMatchObject({ limit: 1, offset: 1 })
    await expectDocumentHidden(bob)
    expect(await applicationSearch(bobPrincipal)).toEqual([])
  })

  it('enforces current document and organization access on Search OAuth clients', async () => {
    expect((await aliceOAuth.listTools()).tools).toHaveLength(3)
    expect(await search(aliceOAuth)).toEqual(await search(alice))
    expect(
      await value(aliceOAuth, 'read_document', { knowledgeBaseId, documentId })
    ).toHaveProperty('documentId', documentId)
    expect(
      await value(aliceOAuth, 'list_document_chunks', { knowledgeBaseId, documentId })
    ).toHaveProperty('chunks')
    await expectDocumentHidden(bobOAuth)
    await db.insert(knowledgeExternalGroupMember).values(bobSourceMembership)
    try {
      expect((await search(bobOAuth)).length).toBeGreaterThan(0)
      await db.delete(member).where(eq(member.id, bobMembershipId))
      await expect(bobOAuth.listTools()).rejects.toThrow()
      await expect(search(bobOAuth)).rejects.toThrow()
    } finally {
      await db
        .insert(member)
        .values({ id: bobMembershipId, userId: bobId, organizationId, role: 'member' })
        .onConflictDoNothing()
      await revokeBobSourceAccess()
    }
    await expectDocumentHidden(bobOAuth)
    await db
      .delete(oauthAccessToken)
      .where(eq(oauthAccessToken.token, hashOAuthToken(oauthTokens.bob)))
    await expect(bobOAuth.listTools()).rejects.toThrow()
  })

  it('denies nonmembers, other organizations and same-organization workspace keys before discovery', async () => {
    expect((await request(tokens.outsider)).status).toBe(404)
    expect((await request(tokens.alice, otherOrganizationId)).status).toBe(404)
    expect((await request(tokens.workspace)).status).toBe(403)
    expect(
      (
        await call(alice, 'search_documents', {
          query: 'Orion',
          knowledgeBaseIds: [otherKnowledgeBaseId],
        })
      ).isError
    ).toBe(true)
    for (const name of ['read_document', 'list_document_chunks']) {
      expect(
        (await call(alice, name, { knowledgeBaseId: otherKnowledgeBaseId, documentId })).isError
      ).toBe(true)
    }
  })

  it('grants and revokes source ACL membership on existing clients', async () => {
    await db.insert(knowledgeExternalGroupMember).values(bobSourceMembership)
    try {
      expect((await search(bob)).length).toBeGreaterThan(0)
      expect(await value(bob, 'read_document', { knowledgeBaseId, documentId })).toHaveProperty(
        'documentId',
        documentId
      )
      expect(
        await value(bob, 'list_document_chunks', { knowledgeBaseId, documentId })
      ).toHaveProperty('chunks')
    } finally {
      await revokeBobSourceAccess()
    }
    await expectDocumentHidden(bob)
  })

  it('hides source content immediately when organization approval is disabled', async () => {
    const approval = and(
      eq(organizationSearchIntegration.organizationId, organizationId),
      eq(organizationSearchIntegration.connectorType, 'confluence')
    )
    await db.update(organizationSearchIntegration).set({ approved: false }).where(approval)
    try {
      await expectDocumentHidden(alice)
      expect(await applicationSearch(alicePrincipal)).toEqual([])
    } finally {
      await db.update(organizationSearchIntegration).set({ approved: true }).where(approval)
    }
    expect((await search(alice)).length).toBeGreaterThan(0)
  })

  it('excludes disabled documents from Search and MCP while preserving admin management previews', async () => {
    const chunks = await db
      .select({ enabled: embedding.enabled })
      .from(embedding)
      .where(eq(embedding.documentId, documentId))
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((chunk) => chunk.enabled)).toBe(true)
    await db.update(document).set({ enabled: false }).where(eq(document.id, documentId))
    try {
      await expectDocumentHidden(alice)
      expect(await applicationSearch(alicePrincipal)).toEqual([])
      const input = { knowledgeBaseId, documentId, assertedOrganizationId: organizationId }
      const metadata = await readKnowledgeDocument.execute({ principal: alicePrincipal, input })
      expect(metadata.document.enabled).toBe(false)
      const preview = await listKnowledgeChunks.execute({ principal: alicePrincipal, input })
      expect(preview.chunks.length).toBeGreaterThan(0)
    } finally {
      await db.update(document).set({ enabled: true }).where(eq(document.id, documentId))
    }
    expect((await search(alice)).length).toBeGreaterThan(0)
  })

  it('revokes an existing client after current organization membership is removed despite retained source grants', async () => {
    await db.insert(knowledgeExternalGroupMember).values(bobSourceMembership)
    try {
      expect((await search(bob)).length).toBeGreaterThan(0)
      await db.delete(member).where(eq(member.id, bobMembershipId))
      expect((await request(tokens.bob)).status).toBe(404)
      await expect(bob.listTools()).rejects.toThrow()
      await expect(search(bob)).rejects.toThrow()
      for (const name of ['read_document', 'list_document_chunks']) {
        await expect(call(bob, name, { knowledgeBaseId, documentId })).rejects.toThrow()
      }
      await expect(applicationSearch(bobPrincipal)).rejects.toMatchObject({ code: 'not_found' })
    } finally {
      await db
        .insert(member)
        .values({ id: bobMembershipId, userId: bobId, organizationId, role: 'member' })
        .onConflictDoNothing()
      await revokeBobSourceAccess()
    }
    await expectDocumentHidden(bob)
  })
})
