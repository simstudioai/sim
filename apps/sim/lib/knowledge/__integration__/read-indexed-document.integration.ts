/** Real scoped document resolution, ACLs, ingestion, pagination, and provenance on disposable Postgres. */
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  document,
  embedding,
  knowledgeBase,
  knowledgeExternalGroup,
  member,
  organization,
  organizationSearchIntegration,
  user,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
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

import { resolveOrganizationBillingAttribution } from '@/lib/billing/core/billing-attribution'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { confluencePageAcl } from '@/lib/knowledge/access/confluence-permissions'
import {
  type ReadIndexedKnowledgeDocumentInput,
  readIndexedKnowledgeDocument,
} from '@/lib/knowledge/application/read-indexed-document'
import { createContentSyncLease } from '@/lib/knowledge/connectors/sync-lock'
import { addDocument, persistDocumentAcls } from '@/lib/knowledge/connectors/sync-persistence'
import { processDocumentAsync } from '@/lib/knowledge/documents/service'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

describe('indexed document references', () => {
  const ids = createKnowledgeAclFixtureIds()
  const other = createKnowledgeAclFixtureIds()
  const alice: Principal = { kind: 'session', userId: ids.aliceId, sessionId: 'fixture-alice' }
  const bob: Principal = { kind: 'session', userId: ids.bobId, sessionId: 'fixture-bob' }
  const sourceUrl = 'https://fixture.atlassian.net/wiki/pages/target?view=all#section'
  const content = Array.from(
    { length: 240 },
    (_, index) =>
      `Document section ${index}: the customer setup checklist includes secure source connections, indexing, search, and citations. `
  ).join('\n\n')
  let documentId: string
  let hiddenDocumentId: string

  async function ingest(externalId: string) {
    const doc = await addDocument(
      ids.knowledgeBaseId,
      ids.connectorId,
      'confluence',
      {
        externalId,
        mimeType: 'text/plain',
        title: externalId,
        content,
        contentHash: externalId,
        sourceUrl,
      },
      { userId: ids.aliceId, workspaceId: null, organizationId: ids.organizationId },
      undefined,
      'admin',
      createContentSyncLease(ids.connectorId, ids.lockId)
    )
    await processDocumentAsync(
      ids.knowledgeBaseId,
      doc.documentId,
      doc,
      {},
      await resolveOrganizationBillingAttribution({
        actorUserId: ids.aliceId,
        organizationId: ids.organizationId,
      })
    )
    return doc.documentId
  }

  function read(principal: Principal, input: Partial<ReadIndexedKnowledgeDocumentInput> = {}) {
    return readIndexedKnowledgeDocument.execute({
      principal,
      input: {
        organizationId: ids.organizationId,
        target: { kind: 'url', url: sourceUrl },
        limit: 20,
        resultSecretRegistry: new ResolvedSecretTraceRegistry(),
        ...input,
      },
    })
  }

  beforeAll(async () => {
    fixtures.storageRoot = mkdtempSync(path.join(tmpdir(), 'sim-indexed-document-'))
    vi.stubGlobal('fetch', async () => {
      throw new Error('Indexed document reads must never fetch provider URLs')
    })
    await seedKnowledgeAclFixture(ids)
    await seedKnowledgeAclFixture(other)
    await db
      .update(knowledgeBase)
      .set({ workspaceId: null, organizationId: ids.organizationId, isSearchIndex: true })
      .where(eq(knowledgeBase.id, ids.knowledgeBaseId))
    await db.insert(member).values([
      { id: generateId(), userId: ids.aliceId, organizationId: ids.organizationId, role: 'owner' },
      { id: generateId(), userId: ids.bobId, organizationId: ids.organizationId, role: 'member' },
    ])
    await db
      .update(knowledgeExternalGroup)
      .set({ workspaceId: null, organizationId: ids.organizationId })
      .where(inArray(knowledgeExternalGroup.id, ids.groupIds))
    await db
      .insert(organizationSearchIntegration)
      .values({ organizationId: ids.organizationId, connectorType: 'confluence', approved: true })
    documentId = await ingest('visible-target')
    hiddenDocumentId = await ingest('hidden-target')
    const sourceAcl = confluencePageAcl({
      providerId: 'confluence',
      tenantId: 'fixture-tenant',
      spacePrincipals: [{ kind: 'group', id: 'space' }],
      restrictionChain: [[{ kind: 'group', id: 'page' }]],
    })
    await persistDocumentAcls(ids.connectorId, new Map([['visible-target', sourceAcl]]))
  })

  afterAll(async () => {
    for (const fixture of [ids, other]) {
      await db.delete(workspace).where(eq(workspace.id, fixture.workspaceId))
      await db.delete(organization).where(eq(organization.id, fixture.organizationId))
      await db.delete(user).where(eq(user.id, fixture.aliceId))
      await db.delete(user).where(eq(user.id, fixture.bobId))
    }
    await rm(fixtures.storageRoot, { recursive: true, force: true })
    vi.unstubAllGlobals()
    await db.$client.end()
  })

  it('reads an exact URL without treating inaccessible duplicates as ambiguous', async () => {
    const result = await read(alice)
    expect(result.documentId).toBe(documentId)
    expect(result.sourceUrl).toBe(sourceUrl)
    expect(result.chunks?.length).toBeGreaterThan(3)
    expect(result.chunks?.[0].content).toContain('Document section 0')
  })

  it('conceals URLs from a member without the provider permissions', async () => {
    await expect(read(bob)).rejects.toThrow('Document not found')
  })

  it('rejects ambiguous accessible URLs and still accepts explicit document identifiers', async () => {
    const [original] = await db.select().from(document).where(eq(document.id, documentId))
    await db
      .update(document)
      .set({
        acl: original.acl,
        aclRequirements: original.aclRequirements,
        aclVerifiedAt: original.aclVerifiedAt,
      })
      .where(eq(document.id, hiddenDocumentId))
    try {
      await expect(read(alice)).rejects.toThrow('Multiple accessible documents use this URL')
      await expect(read(alice, { target: { kind: 'id', documentId } })).resolves.toMatchObject({
        documentId,
      })
    } finally {
      await db
        .update(document)
        .set({ acl: [], aclRequirements: [] })
        .where(eq(document.id, hiddenDocumentId))
    }
  })

  it('requires the canonical organization index for both URL and ID reads', async () => {
    await db
      .update(knowledgeBase)
      .set({ deletedAt: new Date() })
      .where(eq(knowledgeBase.id, ids.knowledgeBaseId))
    try {
      await expect(read(alice)).rejects.toThrow('Document not found')
      await expect(read(alice, { target: { kind: 'id', documentId } })).rejects.toThrow(
        'Document not found'
      )
    } finally {
      await db
        .update(knowledgeBase)
        .set({ deletedAt: null })
        .where(eq(knowledgeBase.id, ids.knowledgeBaseId))
    }
  })

  it('does not resolve document URLs across organizations', async () => {
    await expect(read(alice, { organizationId: other.organizationId })).rejects.toMatchObject({
      code: 'not_found',
    })
  })

  it('rejects caller kinds and revoked owner access before resolving the URL', async () => {
    await expect(
      read({ kind: 'workspace_api_key', workspaceId: other.workspaceId, keyId: 'foreign' })
    ).rejects.toMatchObject({ code: 'forbidden' })
    await expect(
      read({ kind: 'session', userId: other.aliceId, sessionId: 'outsider' })
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  it.each([
    'javascript:alert(1)',
    'https://user:secret@source.test/doc',
    'https:source.test/doc',
    '/path',
    'https://source.test/a\nb',
  ])('rejects malformed or unsafe provider URL %s', async (url) => {
    await expect(read(alice, { target: { kind: 'url', url } })).rejects.toThrow(
      'HTTP or HTTPS document URL'
    )
  })

  it('does not rewrite provider queries or fragment identity during exact lookup', async () => {
    await expect(
      read(alice, { target: { kind: 'url', url: sourceUrl.replace('#section', '') } })
    ).rejects.toThrow('Document not found')
  })

  it.each(['enabled', 'userExcluded', 'archivedAt', 'deletedAt'] as const)(
    'omits documents when %s removes them from reading',
    async (field) => {
      const value = field === 'enabled' ? false : field === 'userExcluded' ? true : new Date()
      await db
        .update(document)
        .set({ [field]: value })
        .where(eq(document.id, documentId))
      try {
        await expect(read(alice)).rejects.toThrow('Document not found')
        const target = { kind: 'id', documentId } as const
        for (const page of [{}, { offset: 1 }, { aroundChunkIndex: 1 }]) {
          await expect(read(alice, { target, ...page })).rejects.toThrow('Document not found')
        }
      } finally {
        await db
          .update(document)
          .set({ [field]: field === 'enabled' ? true : field === 'userExcluded' ? false : null })
          .where(eq(document.id, documentId))
      }
    }
  )

  it('centers enabled context around the actual matching chunk and resumes from the returned offset', async () => {
    const all = await read(alice)
    const first = all.chunks![0]
    const target = all.chunks![4]
    await db.update(embedding).set({ enabled: false }).where(eq(embedding.id, first.id))
    try {
      const result = await read(alice, { aroundChunkIndex: target.chunkIndex, limit: 3 })
      expect(result.pagination?.offset).toBe(1)
      expect(result.chunks?.map((chunk) => chunk.id)).toEqual(
        all.chunks!.slice(2, 5).map((chunk) => chunk.id)
      )
      const next = await read(alice, {
        offset: result.pagination!.offset + result.chunks!.length,
        limit: 3,
      })
      expect(next.chunks?.[0].id).toBe(all.chunks![5].id)
      const single = await read(alice, { aroundChunkIndex: target.chunkIndex, limit: 1 })
      expect(single.chunks?.map((chunk) => chunk.id)).toEqual([target.id])
      await expect(read(alice, { aroundChunkIndex: first.chunkIndex })).rejects.toThrow(
        'Document chunk not found'
      )
      await expect(read(alice, { aroundChunkIndex: 999999 })).rejects.toThrow(
        'Document chunk not found'
      )
    } finally {
      await db.update(embedding).set({ enabled: true }).where(eq(embedding.id, first.id))
    }
  })

  it('bounds pagination and forbids ambiguous page coordinates', async () => {
    for (const input of [
      { limit: 0 },
      { limit: 51 },
      { offset: -1 },
      { offset: 1_000_001 },
      { aroundChunkIndex: -1 },
      { aroundChunkIndex: 1.5 },
    ]) {
      await expect(read(alice, input)).rejects.toThrow('Invalid document page bounds')
    }
    await expect(read(alice, { offset: 0, aroundChunkIndex: 1 })).rejects.toThrow(
      'Use offset or aroundChunkIndex, not both'
    )
  })

  it('retains metadata-only reads until indexing completes', async () => {
    await db
      .update(document)
      .set({ processingStatus: 'processing' })
      .where(eq(document.id, documentId))
    try {
      const result = await read(alice)
      expect(result.processingStatus).toBe('processing')
      expect(result).not.toHaveProperty('chunks')
      expect(result).not.toHaveProperty('pagination')
    } finally {
      await db
        .update(document)
        .set({ processingStatus: 'completed' })
        .where(eq(document.id, documentId))
    }
  })

  it('stops cancelled reads', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(read(alice, { signal: controller.signal })).rejects.toThrow()
  })
})
