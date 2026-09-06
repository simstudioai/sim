/**
 * Fixture-backed Gmail HTTP and embeddings; PostgreSQL, managed token resolution,
 * member sync, document storage, ACL materialization, and application reads are real.
 * Fixtures follow users.threads.list/get and users.labels.list, not a live mailbox.
 */
import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  credential,
  credentialGroup,
  credentialGroupEnrollment,
  document,
  embedding,
  knowledgeBase,
  knowledgeConnector,
  knowledgeConnectorMember,
  knowledgeDocumentObservation,
  resourcePolicy,
  user,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const counters = vi.hoisted(() => ({ embeddedTexts: 0 }))
vi.mock('@/lib/embeddings', async () => ({
  ...(await import('@/lib/embeddings/client')),
  assertKnowledgeEmbeddingCapacity: async () => {},
  embedKnowledge: async (texts: string[]) => {
    counters.embeddedTexts += texts.length
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
import { env } from '@/lib/core/config/env'
import { compileCredentialGroupWorkflowAccessPolicy } from '@/lib/credential-groups/application/workflow-access-policy'
import { getCredentialGroupProviderAdapter } from '@/lib/credential-groups/provider-registry'
import { encryptManagedOAuthTokenSet } from '@/lib/credentials/managed-oauth'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
  seedKnowledgeMemberFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { listKnowledgeChunks } from '@/lib/knowledge/application/chunks'
import { readKnowledgeDocument } from '@/lib/knowledge/application/documents'
import { searchKnowledge } from '@/lib/knowledge/application/search'
import { grantKnowledgeConnectorCredentialAccess } from '@/lib/knowledge/connectors/member-access'
import { executeMemberSync } from '@/lib/knowledge/connectors/member-sync-engine'
import { deleteFile } from '@/lib/uploads/core/storage-service'
import { downloadFileFromUrl } from '@/lib/uploads/utils/file-utils.server'

interface ThreadFixture {
  id: string
  historyId: string
  text: string
}

interface MailboxFixture {
  token: string
  refreshToken: string
  threads: ThreadFixture[]
  rejectToken: boolean
  failSecondPage: boolean
}

describe('Gmail member ingestion and ACLs in PostgreSQL (provider fixtures)', () => {
  let ids: ReturnType<typeof createKnowledgeAclFixtureIds>
  let fixture: Awaited<ReturnType<typeof seedKnowledgeMemberFixture>>
  let billing: Awaited<ReturnType<typeof resolveBillingAttribution>>
  let mailboxes: MailboxFixture[]
  const requests: { member: number; path: string; format: string | null; cursor: string | null }[] =
    []
  const storageKeys = new Set<string>()
  const previousClient = { id: env.GOOGLE_CLIENT_ID, secret: env.GOOGLE_CLIENT_SECRET }
  const actor = (userId: string): Principal => ({
    kind: 'session',
    userId,
    sessionId: 'gmail-fixture',
  })

  function providerFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const url = new URL(input instanceof Request ? input.url : input)
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined)
    )
    if (url.origin === 'https://oauth2.googleapis.com' && url.pathname === '/token') {
      const body = new URLSearchParams(String(init?.body))
      const mailbox = mailboxes.find((item) => item.refreshToken === body.get('refresh_token'))
      if (!mailbox || !mailbox.rejectToken) throw new Error('Unexpected fixture OAuth refresh')
      return Promise.resolve(Response.json({ error: 'invalid_grant' }, { status: 400 }))
    }
    if (url.origin !== 'https://gmail.googleapis.com') {
      throw new Error(`Unexpected outbound request: ${url.origin}${url.pathname}`)
    }
    const member = mailboxes.findIndex(
      (item) => `Bearer ${item.token}` === headers.get('authorization')
    )
    if (member === -1) throw new Error('Gmail fixture received an unknown credential')
    const mailbox = mailboxes[member]
    const cursor = url.searchParams.get('pageToken')
    const format = url.searchParams.get('format')
    requests.push({ member, path: url.pathname, format, cursor })
    if (mailbox.rejectToken) {
      return Promise.resolve(
        Response.json({ error: { code: 401, message: 'Invalid Credentials' } }, { status: 401 })
      )
    }
    if (url.pathname === '/gmail/v1/users/me/labels') {
      return Promise.resolve(
        Response.json({ labels: [{ id: 'INBOX', name: 'INBOX', type: 'system' }] })
      )
    }
    if (url.pathname === '/gmail/v1/users/me/threads') {
      expect(url.searchParams.get('maxResults')).toBe('100')
      if (cursor === 'empty' && mailbox.failSecondPage) {
        return Promise.resolve(
          Response.json(
            { error: { code: 400, message: 'Fixture page unavailable' } },
            { status: 400 }
          )
        )
      }
      /** An empty intermediate page must not reconcile absent documents before EOF. */
      if (cursor === 'empty') return Promise.resolve(Response.json({ nextPageToken: 'last' }))
      const threads = cursor === 'last' ? mailbox.threads.slice(1) : mailbox.threads.slice(0, 1)
      return Promise.resolve(
        Response.json({
          threads: threads.map((thread) => ({ id: thread.id, snippet: 'Orion mailbox fixture' })),
          ...(!cursor ? { nextPageToken: 'empty' } : {}),
        })
      )
    }
    const threadId = url.pathname.match(/^\/gmail\/v1\/users\/me\/threads\/([^/]+)$/)?.[1]
    const thread = mailbox.threads.find((item) => item.id === threadId)
    if (!thread) return Promise.resolve(Response.json({ error: { code: 404 } }, { status: 404 }))
    const metadata = {
      id: thread.id,
      historyId: thread.historyId,
      snippet: 'Orion mailbox fixture',
    }
    if (format === 'minimal') return Promise.resolve(Response.json(metadata))
    expect(format).toBe('full')
    return Promise.resolve(
      Response.json({
        ...metadata,
        messages: [
          {
            id: `message-${thread.id}`,
            threadId: thread.id,
            internalDate: '1700000000000',
            labelIds: ['INBOX'],
            payload: {
              mimeType: 'text/plain',
              headers: [
                { name: 'Subject', value: `Orion ${thread.id}` },
                { name: 'From', value: 'sender@example.com' },
              ],
              body: {
                data: Buffer.from(thread.text).toString('base64url'),
                size: Buffer.byteLength(thread.text),
              },
            },
          },
        ],
      })
    )
  }

  beforeAll(() => {
    Object.assign(env, {
      GOOGLE_CLIENT_ID: 'gmail-fixture-client',
      GOOGLE_CLIENT_SECRET: 'gmail-fixture-secret',
    })
    vi.stubGlobal('fetch', providerFetch)
  })

  beforeEach(async () => {
    ids = createKnowledgeAclFixtureIds()
    await seedKnowledgeAclFixture(ids)
    fixture = await seedKnowledgeMemberFixture(ids)
    mailboxes = ['Alice', 'Bob'].map((name, index) => ({
      token: `fixture-gmail-${index}`,
      refreshToken: `fixture-refresh-${index}`,
      threads: [
        {
          id: 'shared-thread-id',
          historyId: '100',
          text: `Orion ${name} private reply. Only ${name} can read this mailbox content.`,
        },
        {
          id: `private-${index}`,
          historyId: '200',
          text: `Orion ${name} separate thread with confidential mailbox details.`,
        },
      ],
      rejectToken: false,
      failSecondPage: false,
    }))
    requests.length = 0
    counters.embeddedTexts = 0
    const policy = await getCredentialGroupProviderAdapter('gmail').getPolicy(undefined, {
      workspaceId: ids.workspaceId,
      credentialGroupId: fixture.groupId,
      credentialGroupOptionId: fixture.optionId,
    })
    await db
      .update(knowledgeBase)
      .set({ isSearchIndex: true })
      .where(eq(knowledgeBase.id, ids.knowledgeBaseId))
    await db
      .update(credentialGroup)
      .set({
        options: [
          {
            id: fixture.optionId,
            provider: 'gmail',
            label: 'Gmail fixture',
            authorizationAppId: policy.authorizationAppId,
            requiredScopes: policy.requiredScopes,
            scopeVersion: policy.scopeVersion,
            required: false,
            status: 'active',
          },
        ],
      })
      .where(eq(credentialGroup.id, fixture.groupId))
    await db
      .update(knowledgeConnector)
      .set({
        connectorType: 'gmail',
        sourceConfig: { maxThreads: 0 },
        status: 'active',
        memberSyncStatus: 'idle',
        memberSyncLockToken: null,
      })
      .where(eq(knowledgeConnector.id, fixture.connectorId))
    for (const [index, member] of fixture.members.entries()) {
      member.subjectToken = `s:google-email:fixture-domain:${member.userId}`
      await db
        .update(credential)
        .set({
          providerId: 'google-email',
          authorizationAppId: policy.authorizationAppId,
          managedOauthScopeVersion: policy.scopeVersion,
          grantedScopes: policy.requiredScopes,
          encryptedOauthTokenSet: await encryptManagedOAuthTokenSet({
            accessToken: mailboxes[index].token,
            refreshToken: mailboxes[index].refreshToken,
          }),
          accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        })
        .where(eq(credential.id, member.credentialId))
      await db
        .update(knowledgeConnectorMember)
        .set({ subjectToken: member.subjectToken })
        .where(eq(knowledgeConnectorMember.id, member.id))
    }
    await db
      .insert(resourcePolicy)
      .values({
        id: generateId(),
        workspaceId: ids.workspaceId,
        resourceType: 'credential_group',
        resourceId: fixture.groupId,
        document: compileCredentialGroupWorkflowAccessPolicy({
          credentialGroupId: fixture.groupId,
          allowedWorkflowIds: [],
        }),
        createdBy: ids.aliceId,
        updatedBy: ids.aliceId,
      })
      .onConflictDoNothing()
    await grantKnowledgeConnectorCredentialAccess(
      {
        workspaceId: ids.workspaceId,
        credentialGroupId: fixture.groupId,
        credentialGroupOptionId: fixture.optionId,
        connectorId: fixture.connectorId,
      },
      ids.aliceId
    )
    billing = await resolveBillingAttribution({
      actorUserId: ids.aliceId,
      workspaceId: ids.workspaceId,
    })
  })

  afterEach(async () => {
    if (!ids) return
    if (fixture) await stored()
    try {
      for (const key of storageKeys) {
        await deleteFile({ key, context: 'knowledge-base' }).catch((error: unknown) => {
          if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
        })
      }
    } finally {
      storageKeys.clear()
      await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
      await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
    }
  })

  afterAll(async () => {
    Object.assign(env, {
      GOOGLE_CLIENT_ID: previousClient.id,
      GOOGLE_CLIENT_SECRET: previousClient.secret,
    })
    vi.unstubAllGlobals()
    await db.$client.end()
  })

  async function stored() {
    const rows = await db
      .select()
      .from(document)
      .where(eq(document.connectorId, fixture.connectorId))
    for (const row of rows) if (row.storageKey) storageKeys.add(row.storageKey)
    return rows
  }

  async function vectors() {
    return db
      .select({ id: embedding.id, documentId: embedding.documentId, content: embedding.content })
      .from(embedding)
      .innerJoin(document, eq(document.id, embedding.documentId))
      .where(eq(document.connectorId, fixture.connectorId))
      .orderBy(embedding.id)
  }

  async function sync(healthy = true) {
    await db
      .update(knowledgeConnectorMember)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(knowledgeConnectorMember.connectorId, fixture.connectorId))
    const result = await executeMemberSync(fixture.connectorId, { billingAttribution: billing })
    expect(result.error).toBeUndefined()
    expect(result.skipReason).toBeUndefined()
    if (healthy) {
      expect(result.membersFailed).toBe(0)
      expect(result.docsFailed).toBe(0)
      expect(result.membersRemaining).toBe(false)
    }
    await stored()
    return result
  }

  async function search(principal: Principal, searchMode: 'hybrid' | 'vector' = 'hybrid') {
    return (
      await searchKnowledge.execute({
        principal,
        input: {
          workspaceId: ids.workspaceId,
          knowledgeBaseIds: [ids.knowledgeBaseId],
          query: 'Orion',
          topK: 100,
          searchMode,
        },
      })
    ).results
  }

  async function assertReadable(
    memberIndex: number,
    row: typeof document.$inferSelect,
    allowed: boolean
  ) {
    const member = fixture.members[memberIndex]
    const input = { knowledgeBaseId: ids.knowledgeBaseId, documentId: row.id }
    const principal = actor(member.userId)
    if (allowed) {
      expect((await readKnowledgeDocument.execute({ principal, input })).document.id).toBe(row.id)
      expect(
        (await listKnowledgeChunks.execute({ principal, input })).chunks.length
      ).toBeGreaterThan(0)
      expect(
        (await downloadFileFromUrl(row.fileUrl, { userId: member.userId, knowledgeAccess: 'user' }))
          .length
      ).toBeGreaterThan(0)
    } else {
      await expect(readKnowledgeDocument.execute({ principal, input })).rejects.toThrow(
        'Document not found'
      )
      await expect(listKnowledgeChunks.execute({ principal, input })).rejects.toThrow(
        'Document not found'
      )
      await expect(
        downloadFileFromUrl(row.fileUrl, { userId: member.userId, knowledgeAccess: 'user' })
      ).rejects.toThrow('Access denied')
    }
  }

  it('persists separate mailbox content, observations, and ACLs for identical provider thread IDs', async () => {
    expect((await sync()).membersCompleted).toBe(2)
    const rows = await stored()
    expect(rows).toHaveLength(4)
    expect(rows.every((row) => row.processingStatus === 'completed')).toBe(true)
    for (const [index, member] of fixture.members.entries()) {
      const own = rows.filter((row) => row.externalId?.startsWith(`member:${member.id}:`))
      expect(new Set(own.map((row) => row.externalId))).toEqual(
        new Set([`member:${member.id}:shared-thread-id`, `member:${member.id}:private-${index}`])
      )
      for (const row of own) expect(row.acl).toEqual([member.subjectToken])
      const observations = await db
        .select()
        .from(knowledgeDocumentObservation)
        .where(eq(knowledgeDocumentObservation.memberId, member.id))
      expect(new Set(observations.map((row) => row.documentId))).toEqual(
        new Set(own.map((row) => row.id))
      )
      for (const mode of ['hybrid', 'vector'] as const) {
        const results = await search(actor(member.userId), mode)
        expect(new Set(results.map((row) => row.documentId))).toEqual(
          new Set(own.map((row) => row.id))
        )
        expect(results.map((row) => row.content).join('\n')).toContain(
          index === 0 ? 'Alice private reply' : 'Bob private reply'
        )
        expect(results.map((row) => row.content).join('\n')).not.toContain(
          index === 0 ? 'Bob private reply' : 'Alice private reply'
        )
      }
      for (const row of rows)
        await assertReadable(
          index,
          row,
          own.some((item) => item.id === row.id)
        )
      expect(
        requests.some((request) => request.member === index && request.cursor === 'last')
      ).toBe(true)
      expect(
        requests.some((request) => request.member === index && request.format === 'minimal')
      ).toBe(true)
    }
    expect(
      await search({ kind: 'workspace_api_key', workspaceId: ids.workspaceId, keyId: 'fixture' })
    ).toEqual([])
  })

  it('keeps unchanged embeddings and replaces only the changed member’s revision', async () => {
    await sync()
    const before = await vectors()
    const calls = counters.embeddedTexts
    await sync()
    expect(await vectors()).toEqual(before)
    expect(counters.embeddedTexts).toBe(calls)
    mailboxes[0].threads[0] = {
      ...mailboxes[0].threads[0],
      historyId: '101',
      text: 'Orion Alice updated reply after editing the mailbox.',
    }
    await sync()
    const rows = await stored()
    const alice = rows.find(
      (row) => row.externalId === `member:${fixture.members[0].id}:shared-thread-id`
    )!
    expect(alice.contentHash).toBe('gmail:shared-thread-id:101')
    const after = await vectors()
    expect(after.filter((row) => row.documentId !== alice.id)).toEqual(
      before.filter((row) => row.documentId !== alice.id)
    )
    expect(
      after
        .filter((row) => row.documentId === alice.id)
        .map((row) => row.content)
        .join('\n')
    ).toContain('Alice updated reply')
    expect(
      after
        .filter((row) => row.documentId === alice.id)
        .map((row) => row.content)
        .join('\n')
    ).not.toContain('Alice private reply')
  })

  it('removes only the deleting mailbox’s grant after complete pagination', async () => {
    await sync()
    const rows = await stored()
    const removed = rows.find(
      (row) => row.externalId === `member:${fixture.members[0].id}:shared-thread-id`
    )!
    mailboxes[0].threads.shift()
    await sync()
    expect(
      await db
        .select()
        .from(knowledgeDocumentObservation)
        .where(eq(knowledgeDocumentObservation.documentId, removed.id))
    ).toEqual([])
    expect((await search(actor(ids.aliceId))).some((row) => row.documentId === removed.id)).toBe(
      false
    )
    await assertReadable(0, removed, false)
    const bobCopy = rows.find(
      (row) => row.externalId === `member:${fixture.members[1].id}:shared-thread-id`
    )!
    await assertReadable(1, bobCopy, true)
    expect((await search(actor(ids.bobId))).map((row) => row.content).join('\n')).toContain(
      'Bob private reply'
    )
  })

  it('preserves grants through a failed continuation and reconciles only after resuming to EOF', async () => {
    await sync()
    const alice = fixture.members[0]
    const old = (await stored()).find((row) => row.externalId === `member:${alice.id}:private-0`)!
    mailboxes[0].threads.pop()
    mailboxes[0].failSecondPage = true
    expect((await sync(false)).membersFailed).toBe(1)
    expect(
      await db
        .select()
        .from(knowledgeDocumentObservation)
        .where(eq(knowledgeDocumentObservation.documentId, old.id))
    ).toHaveLength(1)
    await assertReadable(0, old, true)
    const [pending] = await db
      .select()
      .from(knowledgeConnectorMember)
      .where(eq(knowledgeConnectorMember.id, alice.id))
    expect(pending.listingCheckpoint).toMatchObject({ cursor: expect.any(String), complete: false })
    mailboxes[0].failSecondPage = false
    requests.length = 0
    await sync()
    expect(
      requests.find((request) => request.member === 0 && request.path.endsWith('/threads'))?.cursor
    ).toBe('empty')
    expect(
      await db
        .select()
        .from(knowledgeDocumentObservation)
        .where(eq(knowledgeDocumentObservation.documentId, old.id))
    ).toEqual([])
    await assertReadable(0, old, false)
  })

  it('fails closed on provider rejection and restores the member after replacement credentials are saved', async () => {
    await sync()
    const alice = fixture.members[0]
    const own = (await stored()).filter((row) => row.externalId?.startsWith(`member:${alice.id}:`))
    mailboxes[0].rejectToken = true
    expect((await sync(false)).membersFailed).toBe(1)
    const [rejected] = await db
      .select()
      .from(credential)
      .where(eq(credential.id, alice.credentialId))
    expect(rejected.managedOauthStatus).toBe('needs_reauth')
    expect(await search(actor(ids.aliceId))).toEqual([])
    for (const row of own) await assertReadable(0, row, false)
    expect(await search(actor(ids.bobId))).toHaveLength(2)
    mailboxes[0].rejectToken = false
    mailboxes[0].token = 'fixture-reconnected-gmail'
    /** The provider callback is outside this fixture; persist its encrypted token replacement. */
    await db
      .update(credential)
      .set({
        managedOauthStatus: 'active',
        encryptedOauthTokenSet: await encryptManagedOAuthTokenSet({
          accessToken: mailboxes[0].token,
          refreshToken: mailboxes[0].refreshToken,
        }),
        accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        grantedAt: new Date(),
      })
      .where(eq(credential.id, alice.credentialId))
    await sync()
    expect(new Set((await search(actor(ids.aliceId))).map((row) => row.documentId))).toEqual(
      new Set(own.map((row) => row.id))
    )
    for (const row of own) await assertReadable(0, row, true)
  })

  it('denies revoked enrollment immediately and keeps the other mailbox accessible', async () => {
    await sync()
    const bob = fixture.members[1]
    const own = (await stored()).filter((row) => row.externalId?.startsWith(`member:${bob.id}:`))
    await db
      .update(credentialGroupEnrollment)
      .set({ status: 'revoked', revokedAt: new Date() })
      .where(eq(credentialGroupEnrollment.id, bob.enrollmentId))
    expect(await search(actor(ids.bobId))).toEqual([])
    for (const row of own) await assertReadable(1, row, false)
    await sync()
    const [suspended] = await db
      .select()
      .from(knowledgeConnectorMember)
      .where(eq(knowledgeConnectorMember.id, bob.id))
    expect(suspended.status).toBe('suspended')
    expect(
      (await stored())
        .filter((row) => own.some((item) => item.id === row.id))
        .every((row) => row.acl.length === 0)
    ).toBe(true)
    expect(await search(actor(ids.aliceId))).toHaveLength(2)
  })

  it('denies stale mailbox observations until a fresh sync renews access without re-embedding', async () => {
    await sync()
    const alice = fixture.members[0]
    const own = (await stored()).filter((row) => row.externalId?.startsWith(`member:${alice.id}:`))
    const before = await vectors()
    const expiredAt = new Date(Date.now() - 25 * 60 * 60 * 1000)
    await db
      .update(knowledgeConnectorMember)
      .set({ memberSyncedThrough: expiredAt })
      .where(eq(knowledgeConnectorMember.id, alice.id))
    await db
      .update(knowledgeDocumentObservation)
      .set({ lastSeenAt: expiredAt })
      .where(eq(knowledgeDocumentObservation.memberId, alice.id))
    expect(await search(actor(ids.aliceId))).toEqual([])
    for (const row of own) await assertReadable(0, row, false)
    expect(await search(actor(ids.bobId))).toHaveLength(2)
    const embeddingCalls = counters.embeddedTexts
    await sync()
    expect(await vectors()).toEqual(before)
    expect(counters.embeddedTexts).toBe(embeddingCalls)
    expect(new Set((await search(actor(ids.aliceId))).map((row) => row.documentId))).toEqual(
      new Set(own.map((row) => row.id))
    )
    for (const row of own) await assertReadable(0, row, true)
  })
})
