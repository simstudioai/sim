/** Real sync jobs, PostgreSQL, storage, indexing and authorized search; Slack and embedding responses are synthetic. */
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { db } from '@sim/db'
import {
  document,
  embedding,
  knowledgeConnector,
  organization,
  user,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray } from 'drizzle-orm'
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
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { searchKnowledge } from '@/lib/knowledge/application/search'
import * as connectorTokens from '@/lib/knowledge/connectors/access-token'
import { executeConnectorSyncJob } from '@/background/knowledge-connector-sync'

const TEAM = 'T0FIXTURE'
const CHANNEL = 'C0GENERAL'
const ROOT = '1700000100.000100'
const REPLY = '1700000200.000100'
const EXTERNAL_ID = `slack:v4:${TEAM}:${CHANNEL}:${ROOT}`
const EMPTY_REASON = 'Document contains no extractable text'

describe('Slack empty threads through sync jobs, indexing and search', () => {
  const ids = createKnowledgeAclFixtureIds()
  const documentId = generateId()
  let billing: Awaited<ReturnType<typeof resolveBillingAttribution>>
  let replyText = ''
  let incomplete = false
  let missingRoot = false
  const channel = { id: CHANNEL, name: 'general', is_archived: false }
  const root = () => ({ type: 'message', ts: ROOT, thread_ts: ROOT, text: '', reply_count: 1 })

  async function providerFetch(input: string | URL | Request, init?: RequestInit) {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    )
    expect(url.origin).toBe('https://slack.com')
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer fixture-slack-token')
    const method = url.pathname.split('/').at(-1)
    switch (method) {
      case 'auth.test':
        return Response.json({ ok: true, team_id: TEAM })
      case 'conversations.list':
        return Response.json({ ok: true, channels: [channel] })
      case 'conversations.info':
        return Response.json({ ok: true, channel })
      case 'conversations.history':
        return Response.json({ ok: true, messages: [root()] })
      case 'conversations.replies':
        if (missingRoot) return Response.json({ ok: true, messages: [] })
        if (!url.searchParams.has('cursor')) {
          return Response.json({
            ok: true,
            messages: [root()],
            has_more: true,
            response_metadata: { next_cursor: 'reply' },
          })
        }
        return Response.json({
          ok: true,
          messages: [{ type: 'message', ts: REPLY, thread_ts: ROOT, text: replyText }],
          is_limited: incomplete,
        })
      case 'chat.getPermalink':
        return Response.json({
          ok: true,
          permalink: `https://fixture.slack.com/archives/${CHANNEL}/p${ROOT.replace('.', '')}`,
        })
      default:
        throw new Error('Unexpected fixture Slack endpoint')
    }
  }
  async function sync() {
    return executeConnectorSyncJob({
      connectorId: ids.connectorId,
      requestId: 'slack-empty-fixture',
      fullSync: true,
      billingAttribution: billing,
    })
  }
  async function row() {
    const [stored] = await db
      .select()
      .from(document)
      .where(and(eq(document.connectorId, ids.connectorId), eq(document.externalId, EXTERNAL_ID)))
    expect(stored?.id).toBe(documentId)
    return stored!
  }
  async function vectors() {
    return db
      .select({ content: embedding.content })
      .from(embedding)
      .where(eq(embedding.documentId, documentId))
  }
  async function search() {
    const result = await searchKnowledge.execute({
      principal: { kind: 'session', userId: ids.aliceId, sessionId: 'slack-empty-fixture' },
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
    fixture.storageRoot = mkdtempSync(path.join(tmpdir(), 'sim-slack-empty-'))
    await seedKnowledgeAclFixture(ids)
    billing = await resolveBillingAttribution({
      actorUserId: ids.aliceId,
      workspaceId: ids.workspaceId,
    })
    await db
      .update(knowledgeConnector)
      .set({
        connectorType: 'slack',
        sourceConfig: { channel: CHANNEL, maxMessages: 0 },
        accessMode: 'workspace',
        status: 'active',
        syncLockToken: null,
      })
      .where(eq(knowledgeConnector.id, ids.connectorId))
    vi.spyOn(connectorTokens, 'resolveConnectorAccessToken').mockResolvedValue({
      accessToken: 'fixture-slack-token',
    })
    vi.stubGlobal('fetch', providerFetch)
    await db
      .insert(document)
      .values({
        id: documentId,
        knowledgeBaseId: ids.knowledgeBaseId,
        connectorId: ids.connectorId,
        externalId: EXTERNAL_ID,
        filename: 'Thread.txt',
        mimeType: 'text/plain',
        fileUrl: '',
        fileSize: 0,
        processingStatus: 'failed',
        processingError: 'Synthetic previous source failure',
      })
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

  it('completes empty-thread syncs, recovers reply edits and removes stale searchable text', async () => {
    expect(await sync()).toMatchObject({
      outcome: 'completed',
      docsFailed: 0,
      docsSkipped: 1,
      processingDispatch: { requested: 0, failed: 0 },
    })
    expect(await row()).toMatchObject({
      processingStatus: 'failed',
      processingError: EMPTY_REASON,
      storageKey: null,
    })
    expect(await vectors()).toEqual([])
    expect(fixture.embeddingCalls).toBe(0)
    expect(await sync()).toMatchObject({ outcome: 'completed', docsFailed: 0 })
    expect(fixture.embeddingCalls).toBe(0)

    replyText = 'Orion launch is scheduled for Friday.'
    expect(await sync()).toMatchObject({ outcome: 'completed', docsFailed: 0, docsUpdated: 1 })
    expect(await row()).toMatchObject({ processingStatus: 'completed', processingError: null })
    expect((await vectors()).map((row) => row.content).join(' ')).toContain(replyText)
    expect(await search()).toContain(documentId)
    const embedded = fixture.embeddingCalls
    expect(await sync()).toMatchObject({ outcome: 'completed', docsUnchanged: 1 })
    expect(fixture.embeddingCalls).toBe(embedded)

    replyText = ''
    expect(await sync()).toMatchObject({ outcome: 'completed', docsFailed: 0, docsSkipped: 1 })
    expect(await row()).toMatchObject({ processingError: EMPTY_REASON, storageKey: null })
    expect(await vectors()).toEqual([])
    expect(fixture.embeddingCalls).toBe(embedded)
    expect(await search()).not.toContain(documentId)

    replyText = 'Orion launch moved to Monday.'
    expect(await sync()).toMatchObject({ outcome: 'completed', docsUpdated: 1 })
    expect(await search()).toContain(documentId)
    const restored = await vectors()
    incomplete = true
    replyText = ''
    await expect(sync()).rejects.toThrow('1 source failures')
    expect(await vectors()).toEqual(restored)
    expect((await row()).storageKey).not.toBeNull()
    incomplete = false
    missingRoot = true
    await expect(sync()).rejects.toThrow('1 source failures')
    expect(await vectors()).toEqual(restored)
  }, 60000)
})
