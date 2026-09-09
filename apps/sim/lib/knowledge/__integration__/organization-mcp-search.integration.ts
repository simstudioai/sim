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
  embeddingSecretProvenance,
  knowledgeBase,
  knowledgeExternalGroup,
  knowledgeExternalGroupMember,
  member,
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  organization,
  organizationSearchIntegration,
  rateLimitBucket,
  user,
  workspace,
} from '@sim/db/schema'
import { sha256Hex } from '@sim/security/hash'
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
import { encryptSecret } from '@/lib/core/security/encryption'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { confluencePageAcl } from '@/lib/knowledge/access/confluence-permissions'
import { listKnowledgeChunks } from '@/lib/knowledge/application/chunks'
import { readKnowledgeDocument } from '@/lib/knowledge/application/documents'
import { listKnowledgeBaseCatalog } from '@/lib/knowledge/application/knowledge-bases'
import { readIndexedKnowledgeDocument } from '@/lib/knowledge/application/read-indexed-document'
import { prepareSearchSource } from '@/lib/knowledge/application/sim-search'
import { searchScopedKnowledge } from '@/lib/knowledge/application/workspace-search'
import { createContentSyncLease } from '@/lib/knowledge/connectors/sync-lock'
import { addDocument, persistDocumentAcls } from '@/lib/knowledge/connectors/sync-persistence'
import { processDocumentAsync } from '@/lib/knowledge/documents/service'
import { getSearchMcpUrl } from '@/lib/knowledge/mcp/urls'
import { replaceKnowledgeEmbeddingSecretProvenanceInTx } from '@/lib/knowledge/secret-provenance'
import { DELETE, GET, POST } from '@/app/api/mcp/search/organizations/[organizationId]/route'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

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
    expired: generateId(),
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

  async function request(
    token?: string,
    target = organizationId,
    options: {
      method?: 'GET' | 'POST' | 'DELETE'
      body?: unknown
      raw?: string
      headers?: Record<string, string>
    } = {}
  ) {
    const method = options.method ?? 'POST'
    return { GET, POST, DELETE }[method](
      new NextRequest(`http://localhost:3000/api/mcp/search/organizations/${target}`, {
        method,
        headers: {
          'x-forwarded-for': '127.0.0.1',
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          ...(token ? { 'x-api-key': token } : {}),
          ...options.headers,
        },
        ...(method === 'POST'
          ? {
              body:
                options.raw ??
                JSON.stringify(options.body ?? { jsonrpc: '2.0', id: 1, method: 'tools/list' }),
            }
          : {}),
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
    const result = await value(client, 'search', { query: 'Orion', topK: 50 })
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
    expect(await call(client, 'read_document', { documentId })).toMatchObject({
      isError: true,
      content: [{ type: 'text', text: 'Document not found' }],
    })
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
        expiresAt: name === 'expired' ? new Date(0) : null,
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
        resource: getSearchMcpUrl(organizationId),
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
      'search',
      'read_document',
      'chat',
    ])
    const rows = await search(alice)
    expect(rows.length).toBeGreaterThan(1)
    expect(rows.every((row) => row.documentId === documentId && !('knowledgeBaseId' in row))).toBe(
      true
    )
    expect((await applicationSearch(alicePrincipal)).map((row) => row.documentId)).toEqual(
      rows.map((row) => row.documentId)
    )
    expect(await value(alice, 'read_document', { documentId })).toMatchObject({
      title: 'Orion organization project',
      documentId,
      chunks: expect.arrayContaining([
        expect.objectContaining({ chunkIndex: 0, content: expect.stringContaining('Orion') }),
      ]),
      pagination: expect.objectContaining({ limit: 20, offset: 0 }),
    })
    const page = await value(alice, 'read_document', {
      documentId,
      limit: 1,
    })
    expect(page.chunks).toEqual([
      expect.objectContaining({ chunkIndex: 0, content: expect.stringContaining('Orion') }),
    ])
    expect(page.pagination).toMatchObject({ limit: 1, offset: 0, hasMore: true })
    const nextPage = await value(alice, 'read_document', {
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
    expect(await value(aliceOAuth, 'read_document', { documentId })).toMatchObject({
      documentId,
      chunks: expect.arrayContaining([
        expect.objectContaining({ content: expect.stringContaining('Orion') }),
      ]),
    })
    expect(await value(aliceOAuth, 'read_document', { documentId })).toHaveProperty('chunks')
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

  it('resolves provider URLs in the organization index and focuses OAuth document reads', async () => {
    const url = 'https://fixture.atlassian.net/wiki/pages/organization-mcp'
    expect(
      await value(aliceOAuth, 'read_document', { url, aroundChunkIndex: 1, limit: 1 })
    ).toMatchObject({
      documentId,
      citationUrl: url,
      chunks: [expect.objectContaining({ chunkIndex: 1 })],
      pagination: { offset: 1, limit: 1 },
    })
    expect((await call(bob, 'read_document', { url })).isError).toBe(true)
    expect(
      (await call(alice, 'read_document', { url, knowledgeBaseId: generateId() })).isError
    ).toBe(true)
    await expect(
      readIndexedKnowledgeDocument.execute({
        principal: alicePrincipal,
        input: {
          organizationId: otherOrganizationId,
          target: { kind: 'url', url },
          limit: 20,
          resultSecretRegistry: new ResolvedSecretTraceRegistry(),
        },
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect((await call(alice, 'read_document', { url, documentId })).isError).toBe(true)
    expect(
      (await call(alice, 'read_document', { url, offset: 0, aroundChunkIndex: 1 })).isError
    ).toBe(true)
  })

  it('applies organization source, modified-date, and document filters through search', async () => {
    const [original] = await db
      .select({ sourceModifiedAt: document.sourceModifiedAt })
      .from(document)
      .where(eq(document.id, documentId))
    await db
      .update(document)
      .set({ sourceModifiedAt: new Date('2026-01-02T00:00:00Z') })
      .where(eq(document.id, documentId))
    try {
      const included = await value(alice, 'search', {
        query: 'Orion',
        source: 'confluence',
        modifiedAfter: '2026-01-01T00:00:00Z',
        documentIds: [documentId],
      })
      expect(included.results).toEqual(
        expect.arrayContaining([expect.objectContaining({ documentId })])
      )
      for (const filters of [
        { source: 'slack' },
        { modifiedAfter: '2026-01-03T00:00:00Z' },
        { documentIds: [generateId()] },
      ]) {
        expect(await value(alice, 'search', { query: 'Orion', ...filters })).toMatchObject({
          results: [],
        })
      }
    } finally {
      await db.update(document).set(original).where(eq(document.id, documentId))
    }
  })

  it('denies nonmembers, other organizations and same-organization workspace keys before discovery', async () => {
    expect((await request(tokens.outsider)).status).toBe(404)
    expect((await request(tokens.alice, otherOrganizationId)).status).toBe(404)
    expect((await request(tokens.workspace)).status).toBe(403)
    expect(
      (
        await call(alice, 'search', {
          query: 'Orion',
          knowledgeBaseIds: [otherKnowledgeBaseId],
        })
      ).isError
    ).toBe(true)
    expect(
      (await call(alice, 'read_document', { knowledgeBaseId: otherKnowledgeBaseId, documentId }))
        .isError
    ).toBe(true)
  })

  it('grants and revokes source ACL membership on existing clients', async () => {
    await db.insert(knowledgeExternalGroupMember).values(bobSourceMembership)
    try {
      expect((await search(bob)).length).toBeGreaterThan(0)
      expect(await value(bob, 'read_document', { documentId })).toHaveProperty(
        'documentId',
        documentId
      )
      expect(await value(bob, 'read_document', { documentId })).toHaveProperty('chunks')
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
      await expect(call(bob, 'read_document', { documentId })).rejects.toThrow()
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
  it('authenticates before protocol parsing and rejects unsupported or untrusted requests', async () => {
    for (const method of ['initialize', 'tools/list', 'unknown']) {
      for (const token of [undefined, 'invalid-fixture-key', tokens.expired]) {
        expect(
          (await request(token, organizationId, { body: { jsonrpc: '2.0', id: 1, method } })).status
        ).toBe(401)
      }
    }
    expect((await request(undefined, organizationId, { raw: '{' })).status).toBe(401)
    for (const method of ['GET', 'DELETE'] as const) {
      expect((await request(undefined, organizationId, { method })).status).toBe(401)
      expect((await request(tokens.alice, organizationId, { method })).status).toBe(405)
    }
    expect(
      (
        await request(tokens.alice, organizationId, {
          headers: { authorization: `Bearer ${tokens.bob}` },
        })
      ).status
    ).toBe(401)
    expect(
      (
        await request(tokens.alice, organizationId, {
          headers: { origin: 'https://untrusted.example' },
        })
      ).status
    ).toBe(403)
    expect(
      (
        await request(tokens.alice, organizationId, {
          body: { jsonrpc: '2.0', id: 1, method: 'tools/list', ignored: 'x'.repeat(64 * 1024) },
        })
      ).status
    ).toBe(413)
  })

  it('exposes no mutation tools and rejects invalid page bounds', async () => {
    expect((await call(alice, 'delete_document', { documentId })).isError).toBe(true)
    for (const page of [{ limit: 51 }, { offset: -1 }, { aroundChunkIndex: 1_000_001 }]) {
      expect((await call(alice, 'read_document', { documentId, ...page })).isError).toBe(true)
    }
    expect((await call(alice, 'search', { query: 'Orion', topK: 51 })).isError).toBe(true)
  })

  it('returns an actionable empty index without creating one or accepting an alternate knowledge base', async () => {
    await db
      .update(knowledgeBase)
      .set({ deletedAt: new Date() })
      .where(eq(knowledgeBase.id, knowledgeBaseId))
    try {
      const empty = await value(alice, 'search', { query: 'Orion' })
      expect(empty.results).toEqual([])
      expect(empty.message).toContain('No Search index')
      expect((await call(alice, 'read_document', { documentId })).isError).toBe(true)
      expect(
        (await call(alice, 'search', { query: 'Orion', knowledgeBaseIds: [knowledgeBaseId] }))
          .isError
      ).toBe(true)
    } finally {
      await db
        .update(knowledgeBase)
        .set({ deletedAt: null })
        .where(eq(knowledgeBase.id, knowledgeBaseId))
    }
  })

  it.each(['pending', 'processing', 'failed'])(
    'returns metadata without text when indexing status is %s',
    async (processingStatus) => {
      await db.update(document).set({ processingStatus }).where(eq(document.id, documentId))
      try {
        const result = await value(alice, 'read_document', { documentId })
        expect(result).toMatchObject({
          documentId,
          processingStatus,
          title: 'Orion organization project',
        })
        expect(result).not.toHaveProperty('chunks')
        expect(result).not.toHaveProperty('pagination')
        expect((await call(bob, 'read_document', { documentId })).isError).toBe(true)
      } finally {
        await db
          .update(document)
          .set({ processingStatus: 'completed' })
          .where(eq(document.id, documentId))
      }
    }
  )

  it('rate limits discovery and reads through the existing shared buckets', async () => {
    const metadataBucket = `v2:knowledge.search.index.read:user:${aliceId}`
    const searchBucket = `v2:knowledge.search:user:${aliceId}`
    await db
      .update(rateLimitBucket)
      .set({ tokens: '0', lastRefillAt: new Date() })
      .where(eq(rateLimitBucket.key, metadataBucket))
    try {
      const denied = await request(tokens.alice)
      expect(denied.status).toBe(429)
      expect(denied.headers.get('retry-after')).not.toBeNull()
    } finally {
      await db.delete(rateLimitBucket).where(eq(rateLimitBucket.key, metadataBucket))
    }
    await db
      .update(rateLimitBucket)
      .set({ tokens: '0', lastRefillAt: new Date() })
      .where(eq(rateLimitBucket.key, searchBucket))
    try {
      expect((await call(alice, 'search', { query: 'Orion' })).isError).toBe(true)
      expect((await alice.listTools()).tools).toHaveLength(3)
    } finally {
      await db.delete(rateLimitBucket).where(eq(rateLimitBucket.key, searchBucket))
    }
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
      const oversized = await call(alice, 'read_document', {
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
            },
          ],
        })
      })
      for (const result of [
        await value(alice, 'read_document', { documentId, limit: 1 }),
        await value(alice, 'search', { query: 'Orion' }),
      ]) {
        expect(JSON.stringify(result)).not.toContain(secret)
        expect(JSON.stringify(result)).not.toContain('FIXTURE_PRIVATE_SECRET_NAME')
      }
      await db
        .update(embeddingSecretProvenance)
        .set({ entries: [{ encryptedValue: 'invalid-fixture-cipher', sourceUserId: aliceId }] })
        .where(eq(embeddingSecretProvenance.embeddingId, original.id))
      expect((await call(alice, 'read_document', { documentId, limit: 1 })).isError).toBe(true)
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
      alice.callTool({ name: 'search', arguments: { query: 'Orion' } }, undefined, {
        signal: controller.signal,
      })
    ).rejects.toThrow()
    expect((await search(alice)).length).toBeGreaterThan(0)
  })
})
