/** Real sync workers, PostgreSQL, file storage, PDF parsing, indexing, member observations and application authorization; Drive and embedding responses are synthetic. */
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { db } from '@sim/db'
import {
  document,
  embedding,
  knowledgeConnector,
  knowledgeConnectorMember,
  organization,
  user,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray } from 'drizzle-orm'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ storageRoot: '', embeddingCalls: 0 }))
vi.mock('@/lib/uploads/core/setup.server', () => ({
  get UPLOAD_DIR_SERVER() {
    return fixture.storageRoot
  },
}))
vi.mock('@/lib/embeddings', async () => ({
  ...(await import('@/lib/embeddings/client')),
  assertKnowledgeEmbeddingCapacity: async () => {},
  embedKnowledge: async (texts: string[]) => {
    fixture.embeddingCalls++
    return {
      embeddings: texts.map(() => [1, ...Array<number>(1535).fill(0)]),
      totalTokens: texts.length,
      billableTokens: 0,
      isBYOK: true,
      modelName: 'text-embedding-3-small',
      pricingId: 'text-embedding-3-small',
    }
  },
}))

import { resolveBillingAttribution } from '@/lib/billing/core/billing-attribution'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
  seedKnowledgeMemberFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { listKnowledgeChunks } from '@/lib/knowledge/application/chunks'
import { readKnowledgeDocument } from '@/lib/knowledge/application/documents'
import { searchKnowledge } from '@/lib/knowledge/application/search'
import * as connectorTokens from '@/lib/knowledge/connectors/access-token'
import * as memberAccess from '@/lib/knowledge/connectors/member-access'
import { executeMemberSync } from '@/lib/knowledge/connectors/member-sync-engine'
import { executeSync } from '@/lib/knowledge/connectors/sync-engine'
import { downloadFileFromUrl } from '@/lib/uploads/utils/file-utils.server'

const json = (body: unknown) => Response.json(body)
const denied = () => Response.json({ error: { errors: [{ reason: 'notFound' }] } }, { status: 404 })

describe('Drive shortcuts through indexing and search', () => {
  const ids = createKnowledgeAclFixtureIds()
  let billing: Awaited<ReturnType<typeof resolveBillingAttribution>>
  let pdfBytes: Buffer
  let revision = 1
  let targetMissing = false
  let denyBob = false
  const aliasPresent = true
  let permittedTargetUser: string
  let targetDownloads = 0
  let aliasDownloads = 0
  let enrolled: Awaited<ReturnType<typeof seedKnowledgeMemberFixture>>
  const principal = (userId: string) => ({
    kind: 'session' as const,
    userId,
    sessionId: 'shortcut-fixture',
  })
  const permission = (userId: string) => ({
    type: 'user',
    emailAddress: `${userId}@fixture.test`,
    role: 'reader',
  })
  const alias = () => ({
    id: 'shortcut',
    name: 'Alias.pdf',
    mimeType: 'application/vnd.google-apps.shortcut',
    modifiedTime: '2026-01-01T00:00:00Z',
    parents: ['root'],
    shortcutDetails: {
      targetId: 'target',
      targetMimeType: 'application/pdf',
      targetResourceKey: 'fixture-key',
    },
    permissions: [permission(ids.aliceId), permission(ids.bobId)],
  })
  const target = () => ({
    id: 'target',
    name: 'Current.pdf',
    mimeType: 'application/pdf',
    modifiedTime: `2026-01-0${revision}T00:00:00Z`,
    size: String(pdfBytes.length),
    permissions: [permission(permittedTargetUser)],
  })

  async function setPdf(text: string) {
    const pdf = await PDFDocument.create()
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    pdf.addPage().drawText(text, { x: 20, y: 500, size: 12, font })
    pdfBytes = Buffer.from(await pdf.save())
  }
  async function providerFetch(input: string | URL | Request, init?: RequestInit) {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    )
    const headers = new Headers(init?.headers)
    if (url.hostname === 'admin.googleapis.com') {
      if (url.pathname.endsWith('/groups')) return json({ groups: [] })
      if (url.pathname.endsWith('/domains')) return json({ domains: [] })
    }
    if (url.hostname !== 'www.googleapis.com') throw new Error('Unexpected fixture provider')
    if (url.pathname.endsWith('/changes/startPageToken')) return json({ startPageToken: 'start' })
    if (url.pathname.endsWith('/changes')) return json({ changes: [], newStartPageToken: 'resume' })
    if (url.pathname.endsWith('/files')) return json({ files: aliasPresent ? [alias()] : [] })
    if (url.pathname.endsWith('/files/shortcut')) {
      if (url.searchParams.get('alt') === 'media') {
        aliasDownloads++
        return denied()
      }
      return aliasPresent ? json(alias()) : denied()
    }
    if (url.pathname.endsWith('/files/target')) {
      expect(headers.get('X-Goog-Drive-Resource-Keys')).toBe('target/fixture-key')
      if (targetMissing || (denyBob && headers.get('Authorization') === `Bearer ${ids.bobId}`))
        return denied()
      if (url.searchParams.get('alt') === 'media') {
        targetDownloads++
        return new Response(new Uint8Array(pdfBytes))
      }
      return json(target())
    }
    throw new Error('Unexpected fixture Drive endpoint')
  }
  async function sync() {
    const result = await executeSync(ids.connectorId, {
      fullSync: true,
      billingAttribution: billing,
    })
    expect(result.error).toBeUndefined()
    expect(result.docsFailed).toBe(0)
    return result
  }
  async function row(connectorId = ids.connectorId) {
    const [value] = await db
      .select()
      .from(document)
      .where(and(eq(document.connectorId, connectorId), eq(document.externalId, 'shortcut')))
    expect(value).toBeDefined()
    return value!
  }
  async function chunks(documentId: string, userId = ids.aliceId) {
    const result = await listKnowledgeChunks.execute({
      principal: principal(userId),
      input: { knowledgeBaseId: ids.knowledgeBaseId, documentId },
    })
    return result.chunks.map((chunk) => chunk.content).join('\n')
  }
  async function search(userId: string) {
    const result = await searchKnowledge.execute({
      principal: principal(userId),
      input: {
        workspaceId: ids.workspaceId,
        knowledgeBaseIds: [ids.knowledgeBaseId],
        query: 'Orion',
        searchMode: 'hybrid',
        topK: 10,
      },
    })
    return result.results.map((result) => result.documentId)
  }
  beforeAll(async () => {
    fixture.storageRoot = mkdtempSync(path.join(tmpdir(), 'sim-drive-shortcuts-'))
    await seedKnowledgeAclFixture(ids)
    permittedTargetUser = ids.aliceId
    await setPdf('Orion shortcut original content.')
    billing = await resolveBillingAttribution({
      actorUserId: ids.aliceId,
      workspaceId: ids.workspaceId,
    })
    await db
      .update(knowledgeConnector)
      .set({
        connectorType: 'google_drive',
        sourceConfig: { folderId: 'root' },
        accessMode: 'workspace',
        status: 'active',
        syncLockToken: null,
      })
      .where(eq(knowledgeConnector.id, ids.connectorId))
    vi.spyOn(connectorTokens, 'resolveConnectorAccessToken').mockResolvedValue({
      accessToken: 'fixture-admin',
    })
    vi.stubGlobal('fetch', providerFetch)
  })
  afterAll(async () => {
    await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
    await db.delete(organization).where(eq(organization.id, ids.organizationId))
    await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
    await rm(fixture.storageRoot, { recursive: true, force: true })
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    await db.$client.end()
  })

  it('recovers a failed shortcut row, indexes the real PDF, skips unchanged bytes, refreshes target-only edits and recovers a missing target', async () => {
    const documentId = generateId()
    await db.insert(document).values({
      id: documentId,
      knowledgeBaseId: ids.knowledgeBaseId,
      connectorId: ids.connectorId,
      externalId: 'shortcut',
      filename: 'Alias.pdf',
      mimeType: 'text/plain',
      fileUrl: '',
      fileSize: 0,
      processingStatus: 'failed',
      processingError: 'Synthetic previous download failure',
    })
    expect((await sync()).docsUpdated).toBe(1)
    const original = await row()
    expect(original.id).toBe(documentId)
    expect(original.processingStatus).toBe('completed')
    expect(await chunks(documentId)).toContain('Orion shortcut original content')
    expect(await search(ids.aliceId)).toContain(documentId)
    expect(
      await downloadFileFromUrl(original.fileUrl, { userId: ids.aliceId, knowledgeAccess: 'user' })
    ).toEqual(pdfBytes)
    const downloaded = targetDownloads
    const embedded = fixture.embeddingCalls
    expect((await sync()).docsUnchanged).toBe(1)
    expect(targetDownloads).toBe(downloaded)
    expect(fixture.embeddingCalls).toBe(embedded)

    revision++
    await setPdf('Orion shortcut revised content.')
    expect((await sync()).docsUpdated).toBe(1)
    expect(await chunks(documentId)).toContain('Orion shortcut revised content')
    expect((await row()).contentHash).not.toBe(original.contentHash)
    targetMissing = true
    await sync()
    expect((await row()).processingStatus).toBe('failed')
    expect(await search(ids.aliceId)).not.toContain(documentId)
    expect(await db.select().from(embedding).where(eq(embedding.documentId, documentId))).toEqual(
      []
    )
    targetMissing = false
    await sync()
    expect((await row()).processingStatus).toBe('completed')
    expect(await chunks(documentId)).toContain('Orion shortcut revised content')
    expect(aliasDownloads).toBe(0)
  }, 60000)

  it('persists shortcut and target ACL intersection and applies target-only permission changes without reembedding', async () => {
    await db
      .update(knowledgeConnector)
      .set({
        accessMode: 'admin',
        sourceConfig: { folderId: 'root', adminEmail: 'admin@fixture.test' },
      })
      .where(eq(knowledgeConnector.id, ids.connectorId))
    const indexedBefore = await row()
    const priorEmbeddings = await db
      .select({ id: embedding.id })
      .from(embedding)
      .where(eq(embedding.documentId, indexedBefore.id))
      .orderBy(embedding.id)
    const downloaded = targetDownloads
    await sync()
    const indexed = await row()
    expect(indexed.aclRequirements).toHaveLength(2)
    expect(indexed.aclRequirements).toEqual(
      expect.arrayContaining([
        [`u:${ids.aliceId}@fixture.test`, `u:${ids.bobId}@fixture.test`].sort(),
        [`u:${ids.aliceId}@fixture.test`],
      ])
    )
    expect(await search(ids.aliceId)).toContain(indexed.id)
    expect(await search(ids.bobId)).not.toContain(indexed.id)
    await expect(
      readKnowledgeDocument.execute({
        principal: principal(ids.bobId),
        input: { knowledgeBaseId: ids.knowledgeBaseId, documentId: indexed.id },
      })
    ).rejects.toThrow()
    permittedTargetUser = ids.bobId
    await sync()
    expect(await search(ids.aliceId)).not.toContain(indexed.id)
    expect(await search(ids.bobId)).toContain(indexed.id)
    expect(
      await db
        .select({ id: embedding.id })
        .from(embedding)
        .where(eq(embedding.documentId, indexed.id))
        .orderBy(embedding.id)
    ).toEqual(priorEmbeddings)
    expect(targetDownloads).toBe(downloaded)
  }, 60000)

  it('revokes and restores member search access when only target access changes and the provider feed is empty', async () => {
    enrolled = await seedKnowledgeMemberFixture(ids)
    await db
      .update(knowledgeConnector)
      .set({ memberSyncStatus: 'idle', memberSyncLockToken: null })
      .where(eq(knowledgeConnector.id, enrolled.connectorId))
    vi.spyOn(memberAccess, 'mintKnowledgeConnectorMemberToken').mockImplementation(
      async ({ credentialId }) => ({
        accessToken: enrolled.members.find((member) => member.credentialId === credentialId)!
          .userId,
        refreshed: false,
      })
    )
    await memberAccess.grantKnowledgeConnectorCredentialAccess(
      {
        workspaceId: ids.workspaceId,
        connectorId: enrolled.connectorId,
        credentialGroupId: enrolled.groupId,
        credentialGroupOptionId: enrolled.optionId,
      },
      ids.aliceId
    )
    const syncMembers = async () => {
      await db
        .update(knowledgeConnectorMember)
        .set({ nextAttemptAt: new Date(0) })
        .where(eq(knowledgeConnectorMember.connectorId, enrolled.connectorId))
      const result = await executeMemberSync(enrolled.connectorId, { billingAttribution: billing })
      expect(result.error).toBeUndefined()
      return result
    }
    await syncMembers()
    const indexed = await row(enrolled.connectorId)
    expect(indexed.processingStatus).toBe('completed')
    expect(await search(ids.bobId)).toContain(indexed.id)
    const downloaded = targetDownloads
    denyBob = true
    await syncMembers()
    expect(await search(ids.bobId)).not.toContain(indexed.id)
    expect(await search(ids.aliceId)).toContain(indexed.id)
    expect(targetDownloads).toBe(downloaded)
    denyBob = false
    await syncMembers()
    expect(await search(ids.bobId)).toContain(indexed.id)
    expect(targetDownloads).toBe(downloaded)
    revision++
    await setPdf('Orion member shortcut target edit.')
    await syncMembers()
    expect(await chunks(indexed.id)).toContain('Orion member shortcut target edit')
    expect(targetDownloads).toBe(downloaded + 1)
  }, 60000)
})
