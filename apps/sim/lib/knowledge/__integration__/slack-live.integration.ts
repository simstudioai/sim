/**
 * Opt-in live Slack verification using credentials created through the normal Sim UI.
 * SLACK_LIVE_FIXTURE_FILE contains only {workspaceId, botCredentialId,
 * memberCredentialIds, publicChannelId, privateChannelId}; no tokens are exported.
 * The workspace must be the disposable ACL integration fixture. Both channels must
 * start with sim-search-e2e-. Real OAuth resolution, Slack, sync engines, storage,
 * PostgreSQL, and application authorization run; only embeddings are substituted.
 * A second distinct human grant enables multi-user private-channel parity checks.
 * SLACK_LIVE_REVOKE_MEMBER=true revokes only the first fixture grant, as the last test.
 */
import { readFile } from 'node:fs/promises'
import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  credential,
  credentialGroupEnrollment,
  document,
  embedding,
  knowledgeBase,
  knowledgeConnector,
  knowledgeConnectorMember,
  knowledgeDocumentObservation,
  permissions,
  user,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { isPlainRecord } from '@sim/utils/object'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

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

import { resolveBillingAttribution } from '@/lib/billing/core/billing-attribution'
import { loadManagedCredentialGroupBinding } from '@/lib/credential-groups/credentials'
import { listKnowledgeChunks } from '@/lib/knowledge/application/chunks'
import { readKnowledgeDocument } from '@/lib/knowledge/application/documents'
import { searchKnowledge } from '@/lib/knowledge/application/search'
import {
  grantKnowledgeConnectorCredentialAccess,
  mintKnowledgeConnectorMemberToken,
  revokeKnowledgeConnectorCredentialAccess,
} from '@/lib/knowledge/connectors/member-access'
import { executeMemberSync } from '@/lib/knowledge/connectors/member-sync-engine'
import { executeSync } from '@/lib/knowledge/connectors/sync-engine'
import { resolveCredentialTokenBundle } from '@/lib/oauth/credential-service'
import { SLACK_CUSTOM_BOT_PROVIDER_ID } from '@/lib/oauth/types'
import { deleteFile } from '@/lib/uploads/core/storage-service'
import { downloadFileFromUrl } from '@/lib/uploads/utils/file-utils.server'
import { slackConnector } from '@/connectors/slack/slack'
import type { ExternalDocument } from '@/connectors/types'

const fixtureSchema = z.object({
  workspaceId: z.string().uuid(),
  botCredentialId: z.string().uuid(),
  memberCredentialIds: z.array(z.string().uuid()).min(1).max(2),
  publicChannelId: z.string().regex(/^C[A-Z0-9]+$/),
  privateChannelId: z.string().regex(/^[CG][A-Z0-9]+$/),
})
const fixtureFile = process.env.SLACK_LIVE_FIXTURE_FILE
const revokeMember = process.env.SLACK_LIVE_REVOKE_MEMBER === 'true'

describe.skipIf(!fixtureFile)('live Slack content and human access', () => {
  let input: z.infer<typeof fixtureSchema>
  let ownerId: string
  let groupId: string
  let optionId: string
  let teamId: string
  let botToken: string
  let publicRootTs: string
  let publicReplyTs: string | undefined
  let disposableRootTs: string | undefined
  let botCanReadPrivate: boolean
  const kbId = generateId()
  const botConnectorId = generateId()
  const memberConnectorId = generateId()
  const createdUserIds: string[] = []
  const createdPermissionIds: string[] = []
  const members: Array<{ credentialId: string; userId: string; token: string; subject: string }> =
    []
  const storedKeys = new Set<string>()
  const sourceConfig = () => ({
    channel: [input.publicChannelId, input.privateChannelId],
    maxMessages: 0,
  })
  const actor = (userId: string): Principal => ({
    kind: 'session',
    userId,
    sessionId: 'slack-live',
  })
  const workspaceKey = (): Principal => ({
    kind: 'workspace_api_key',
    workspaceId: input.workspaceId,
    keyId: 'slack-live',
  })

  async function api(method: string, token: string, body: Record<string, unknown> = {}) {
    const response = await fetch(`https://slack.com/api/${method}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(Object.entries(body).map(([key, value]) => [key, String(value)])),
      signal: AbortSignal.timeout(30000),
    })
    const value: unknown = await response.json()
    if (!response.ok || !isPlainRecord(value) || value.ok !== true) {
      const code =
        isPlainRecord(value) && typeof value.error === 'string' ? value.error : 'invalid_response'
      throw new Error(`Fixture Slack ${method}: ${code} (HTTP ${response.status})`)
    }
    return value
  }
  async function list(token: string) {
    const documents: ExternalDocument[] = []
    let cursor: string | undefined
    const context = {}
    for (let page = 0; page < 20; page++) {
      const result = await slackConnector.listDocuments(token, sourceConfig(), cursor, context)
      documents.push(...result.documents)
      if (!result.hasMore) return documents
      if (!result.nextCursor) throw new Error('Live Slack omitted a continuation cursor')
      cursor = result.nextCursor
    }
    throw new Error('Disposable Slack fixture exceeded its bounded listing budget')
  }
  async function stored(connectorId = memberConnectorId) {
    const rows = await db
      .select()
      .from(document)
      .where(and(eq(document.connectorId, connectorId), isNull(document.deletedAt)))
    for (const row of rows) if (row.storageKey) storedKeys.add(row.storageKey)
    return rows
  }
  async function vectors() {
    const rows = await stored()
    return db
      .select({ id: embedding.id, content: embedding.content })
      .from(embedding)
      .where(
        inArray(
          embedding.documentId,
          rows.map((row) => row.id)
        )
      )
      .orderBy(embedding.id)
  }
  async function search(principal: Principal, connectorId = memberConnectorId) {
    const result = await searchKnowledge.execute({
      principal,
      input: {
        workspaceId: input.workspaceId,
        knowledgeBaseIds: [kbId],
        query: 'Orion',
        searchMode: 'hybrid',
        topK: 100,
      },
    })
    const ids = new Set((await stored(connectorId)).map((row) => row.id))
    return new Set(
      result.results.filter((row) => ids.has(row.documentId)).map((row) => row.documentId)
    )
  }
  async function syncMembers(expectSuccess = true) {
    await db
      .update(knowledgeConnectorMember)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(knowledgeConnectorMember.connectorId, memberConnectorId))
    const result = await executeMemberSync(memberConnectorId, {
      billingAttribution: await resolveBillingAttribution({
        actorUserId: ownerId,
        workspaceId: input.workspaceId,
      }),
      forceContentRefresh: true,
    })
    if (expectSuccess) {
      expect(result.error).toBeUndefined()
      expect(result.skipReason).toBeUndefined()
      expect(result.membersFailed).toBe(0)
      expect(result.docsFailed).toBe(0)
      expect(result.membersRemaining).toBe(false)
    }
    await stored()
    return result
  }
  async function assertParity() {
    const rows = await stored()
    for (const member of members) {
      const visible = new Set((await list(member.token)).map((row) => row.externalId))
      const expected = new Set(
        rows.filter((row) => visible.has(row.externalId!)).map((row) => row.id)
      )
      expect(await search(actor(member.userId))).toEqual(expected)
      for (const row of rows) {
        if (expected.has(row.id)) {
          expect(
            (
              await readKnowledgeDocument.execute({
                principal: actor(member.userId),
                input: { knowledgeBaseId: kbId, documentId: row.id },
              })
            ).document.id
          ).toBe(row.id)
          expect(
            (
              await listKnowledgeChunks.execute({
                principal: actor(member.userId),
                input: {
                  knowledgeBaseId: kbId,
                  documentId: row.id,
                },
              })
            ).chunks.length
          ).toBeGreaterThan(0)
          expect(
            (
              await downloadFileFromUrl(row.fileUrl, {
                userId: member.userId,
                knowledgeAccess: 'user',
              })
            ).length
          ).toBeGreaterThan(0)
        } else {
          await expect(
            readKnowledgeDocument.execute({
              principal: actor(member.userId),
              input: {
                knowledgeBaseId: kbId,
                documentId: row.id,
              },
            })
          ).rejects.toThrow('Document not found')
          await expect(
            listKnowledgeChunks.execute({
              principal: actor(member.userId),
              input: { knowledgeBaseId: kbId, documentId: row.id },
            })
          ).rejects.toThrow('Document not found')
          await expect(
            downloadFileFromUrl(row.fileUrl, {
              userId: member.userId,
              knowledgeAccess: 'user',
            })
          ).rejects.toThrow('Access denied')
        }
      }
    }
    expect(await search(workspaceKey())).toEqual(new Set())
  }

  beforeAll(async () => {
    input = fixtureSchema.parse(JSON.parse(await readFile(fixtureFile!, 'utf8')))
    const [base] = await db.select().from(workspace).where(eq(workspace.id, input.workspaceId))
    expect(base?.name).toBe('ACL integration fixture')
    ownerId = base.ownerId
    const [bot] = await db.select().from(credential).where(eq(credential.id, input.botCredentialId))
    expect(bot?.workspaceId).toBe(input.workspaceId)
    expect(bot?.displayName).toBe('Sim Search E2E')
    expect(bot?.providerId).toBe(SLACK_CUSTOM_BOT_PROVIDER_ID)
    const bundle = await resolveCredentialTokenBundle(
      input.botCredentialId,
      ownerId,
      'slack-live',
      slackConnector.auth.mode === 'oauth' ? slackConnector.auth.requiredScopes : undefined
    )
    if (!bundle?.accessToken)
      throw new Error('Connect the dedicated fixture bot in the Sim UI first')
    botToken = bundle.accessToken
    const identity = await api('auth.test', botToken)
    expect(typeof identity.team_id).toBe('string')
    teamId = String(identity.team_id)
    const publicInfo = await api('conversations.info', botToken, { channel: input.publicChannelId })
    expect(isPlainRecord(publicInfo.channel) && publicInfo.channel.name).toMatch(
      /^sim-search-e2e-public-/
    )
    await api('conversations.join', botToken, { channel: input.publicChannelId })
    await db.insert(knowledgeBase).values({
      id: kbId,
      userId: ownerId,
      workspaceId: input.workspaceId,
      name: 'Disposable Slack live verification',
      chunkingConfig: { maxSize: 1024, minSize: 1, overlap: 20 },
    })
    for (const credentialId of input.memberCredentialIds) {
      const binding = await loadManagedCredentialGroupBinding(credentialId)
      expect(binding?.workspaceId).toBe(input.workspaceId)
      expect(binding?.providerId).toBe('slack')
      if (!binding) throw new Error('Connect a fixture human account in the Sim UI first')
      if (groupId) {
        expect(binding.credentialGroupId).toBe(groupId)
        expect(binding.credentialGroupOptionId).toBe(optionId)
      } else {
        groupId = binding.credentialGroupId
        optionId = binding.credentialGroupOptionId
      }
      const [row] = await db
        .select({ credential: credential, email: credentialGroupEnrollment.email })
        .from(credential)
        .innerJoin(
          credentialGroupEnrollment,
          eq(credentialGroupEnrollment.id, credential.credentialGroupEnrollmentId)
        )
        .where(eq(credential.id, credentialId))
      expect(row.credential.providerTenantId).toBe(teamId)
      expect(row.credential.authorizationAppId).toContain(teamId)
      let [person] = await db.select().from(user).where(eq(user.email, row.email))
      if (!person) {
        const id = generateId()
        await db.insert(user).values({
          id,
          email: row.email,
          emailVerified: true,
          name: 'Slack live fixture',
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        createdUserIds.push(id)
        ;[person] = await db.select().from(user).where(eq(user.id, id))
      }
      const existing = await db
        .select()
        .from(permissions)
        .where(
          and(
            eq(permissions.userId, person.id),
            eq(permissions.entityId, input.workspaceId),
            eq(permissions.entityType, 'workspace')
          )
        )
      if (!existing.length) {
        const id = generateId()
        await db.insert(permissions).values({
          id,
          userId: person.id,
          entityId: input.workspaceId,
          entityType: 'workspace',
          permissionType: 'read',
        })
        createdPermissionIds.push(id)
      }
      members.push({
        credentialId,
        userId: person.id,
        token: '',
        subject: row.credential.providerSubjectId!,
      })
    }
    expect(new Set(members.map((member) => member.subject)).size).toBe(members.length)
    await db.insert(knowledgeConnector).values([
      {
        id: botConnectorId,
        knowledgeBaseId: kbId,
        connectorType: 'slack',
        sourceConfig: sourceConfig(),
        accessMode: 'workspace',
        credentialId: input.botCredentialId,
        status: 'active',
      },
      {
        id: memberConnectorId,
        knowledgeBaseId: kbId,
        connectorType: 'slack',
        sourceConfig: sourceConfig(),
        accessMode: 'members',
        credentialGroupId: groupId,
        credentialGroupOptionId: optionId,
        status: 'active',
        memberSyncStatus: 'idle',
      },
    ])
    await grantKnowledgeConnectorCredentialAccess(
      {
        workspaceId: input.workspaceId,
        credentialGroupId: groupId,
        credentialGroupOptionId: optionId,
        connectorId: memberConnectorId,
      },
      ownerId
    )
    for (const member of members) {
      member.token = (
        await mintKnowledgeConnectorMemberToken({
          connectorId: memberConnectorId,
          workspaceId: input.workspaceId,
          credentialId: member.credentialId,
          expectedProviderId: 'slack',
          requiredScopes:
            slackConnector.auth.mode === 'oauth' ? (slackConnector.auth.requiredScopes ?? []) : [],
          runId: 'slack-live-fixture',
        })
      ).accessToken
      expect((await api('auth.test', member.token)).user_id).toBe(member.subject)
    }
    const privateInfo = await api('conversations.info', members[0].token, {
      channel: input.privateChannelId,
    })
    expect(isPlainRecord(privateInfo.channel) && privateInfo.channel.name).toMatch(
      /^sim-search-e2e-private-/
    )
    expect(isPlainRecord(privateInfo.channel) && privateInfo.channel.is_private).toBe(true)
    botCanReadPrivate = (await list(botToken)).some(
      (row) => row.metadata?.channelId === input.privateChannelId
    )
    const root = await api('chat.postMessage', botToken, {
      channel: input.publicChannelId,
      text: `Orion live Slack root ${generateId()}. Disposable enterprise search verification.`,
    })
    expect(typeof root.ts).toBe('string')
    publicRootTs = String(root.ts)
    publicReplyTs = String(
      (
        await api('chat.postMessage', botToken, {
          channel: input.publicChannelId,
          thread_ts: publicRootTs,
          text: 'Orion reply before edit.',
        })
      ).ts
    )
    await vi.waitFor(
      async () => {
        expect((await list(botToken)).some((row) => row.externalId.endsWith(publicRootTs))).toBe(
          true
        )
      },
      { timeout: 10000, interval: 500 }
    )
  }, 120000)

  afterAll(async () => {
    try {
      if (input && botToken) {
        if (disposableRootTs)
          await api('chat.delete', botToken, {
            channel: input.publicChannelId,
            ts: disposableRootTs,
          })
        if (publicReplyTs)
          await api('chat.delete', botToken, { channel: input.publicChannelId, ts: publicReplyTs })
        if (publicRootTs)
          await api('chat.delete', botToken, { channel: input.publicChannelId, ts: publicRootTs })
      }
    } finally {
      try {
        if (groupId)
          await revokeKnowledgeConnectorCredentialAccess(
            {
              workspaceId: input.workspaceId,
              credentialGroupId: groupId,
              connectorId: memberConnectorId,
            },
            ownerId
          )
        await stored(botConnectorId)
        await stored()
        for (const key of storedKeys)
          await deleteFile({ key, context: 'knowledge-base' }).catch((error: unknown) => {
            if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
          })
      } finally {
        await db.delete(knowledgeBase).where(eq(knowledgeBase.id, kbId))
        if (createdPermissionIds.length)
          await db.delete(permissions).where(inArray(permissions.id, createdPermissionIds))
        if (createdUserIds.length) await db.delete(user).where(inArray(user.id, createdUserIds))
        await db.$client.end()
      }
    }
  }, 120000)

  it('indexes actual bot-visible threads through the full workspace content engine', async () => {
    const result = await executeSync(botConnectorId, {
      fullSync: true,
      billingAttribution: await resolveBillingAttribution({
        actorUserId: ownerId,
        workspaceId: input.workspaceId,
      }),
    })
    expect(result.error).toBeUndefined()
    expect(result.skipReason).toBeUndefined()
    expect(result.docsFailed).toBe(0)
    const rows = await stored(botConnectorId)
    expect(rows.every((row) => row.processingStatus === 'completed')).toBe(true)
    expect(rows.some((row) => row.externalId?.endsWith(publicRootTs))).toBe(true)
    expect(await search(workspaceKey(), botConnectorId)).toEqual(new Set(rows.map((row) => row.id)))
  }, 120000)

  it('uses real human OAuth identities to build a union and matches provider private-channel access', async () => {
    await syncMembers()
    const rows = await stored()
    expect(rows.some((row) => row.externalId?.includes(input.privateChannelId))).toBe(true)
    expect(rows.every((row) => row.processingStatus === 'completed')).toBe(true)
    await assertParity()
  }, 120000)

  it('refreshes each person’s ACL evidence without duplicating content or embeddings', async () => {
    const before = await vectors()
    await syncMembers()
    expect(await vectors()).toEqual(before)
    await assertParity()
  }, 120000)

  it('removes access when evidence expires or the managed grant is disabled', async () => {
    const before = await vectors()
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000)
    await db
      .update(knowledgeConnectorMember)
      .set({ memberSyncedThrough: old })
      .where(eq(knowledgeConnectorMember.connectorId, memberConnectorId))
    const memberRows = await db
      .select()
      .from(knowledgeConnectorMember)
      .where(eq(knowledgeConnectorMember.connectorId, memberConnectorId))
    await db
      .update(knowledgeDocumentObservation)
      .set({ lastSeenAt: old })
      .where(
        inArray(
          knowledgeDocumentObservation.memberId,
          memberRows.map((row) => row.id)
        )
      )
    expect(await search(actor(members[0].userId))).toEqual(new Set())
    await syncMembers()
    expect(await vectors()).toEqual(before)
    await db
      .update(credential)
      .set({ managedOauthStatus: 'needs_reauth' })
      .where(eq(credential.id, members[0].credentialId))
    try {
      expect(await search(actor(members[0].userId))).toEqual(new Set())
    } finally {
      await db
        .update(credential)
        .set({ managedOauthStatus: 'active' })
        .where(eq(credential.id, members[0].credentialId))
    }
    await assertParity()
  }, 120000)

  it('distinguishes two real humans with different private-channel membership', async ({
    skip,
  }) => {
    if (members.length < 2) skip()
    const membership = await Promise.all(
      members.map(async (member) =>
        (await list(member.token)).some((row) => row.metadata?.channelId === input.privateChannelId)
      )
    )
    expect(membership).toEqual([true, false])
    await assertParity()
  }, 120000)

  it('denies a connected human after removal from the Sim workspace', async ({ skip }) => {
    const member = members.find((person) => person.userId !== ownerId)
    if (!member) {
      skip()
      return
    }
    const current = await db
      .select()
      .from(permissions)
      .where(
        and(
          eq(permissions.userId, member.userId),
          eq(permissions.entityId, input.workspaceId),
          eq(permissions.entityType, 'workspace')
        )
      )
    expect(current.length).toBeGreaterThan(0)
    await db.delete(permissions).where(
      inArray(
        permissions.id,
        current.map((row) => row.id)
      )
    )
    try {
      await expect(search(actor(member.userId))).rejects.toThrow()
    } finally {
      await db.insert(permissions).values(current)
    }
    await assertParity()
  }, 120000)

  it('rehydrates an edited and deleted reply even when its parent timestamp is unchanged', async () => {
    const before = await vectors()
    await api('chat.update', botToken, {
      channel: input.publicChannelId,
      ts: publicReplyTs,
      text: 'Orion reply AFTER EDIT.',
    })
    await syncMembers()
    expect((await vectors()).map((row) => row.content).join('\n')).toContain(
      'Orion reply AFTER EDIT.'
    )
    expect(await vectors()).not.toEqual(before)
    await api('chat.delete', botToken, { channel: input.publicChannelId, ts: publicReplyTs })
    publicReplyTs = undefined
    await syncMembers()
    expect((await vectors()).map((row) => row.content).join('\n')).not.toContain(
      'Orion reply AFTER EDIT.'
    )
    await assertParity()
  }, 120000)

  it('removes a deleted thread on the next routine member listing, inside the full-recrawl interval', async () => {
    disposableRootTs = String(
      (
        await api('chat.postMessage', botToken, {
          channel: input.publicChannelId,
          text: 'Orion disposable thread for routine removal verification.',
        })
      ).ts
    )
    await syncMembers()
    const thread = (await stored()).find((row) => row.externalId?.endsWith(disposableRootTs!))
    expect(thread).toBeDefined()
    await api('chat.delete', botToken, { channel: input.publicChannelId, ts: disposableRootTs })
    disposableRootTs = undefined
    await syncMembers()
    expect((await stored()).some((row) => row.id === thread!.id)).toBe(false)
    await assertParity()
  }, 120000)

  it('separates bot content ownership from human ACL observations', async () => {
    await db
      .update(knowledgeConnector)
      .set({ credentialId: input.botCredentialId })
      .where(eq(knowledgeConnector.id, memberConnectorId))
    await syncMembers()
    const rows = await stored()
    expect(rows.some((row) => row.externalId?.endsWith(publicRootTs))).toBe(true)
    expect(rows.some((row) => row.externalId?.includes(input.privateChannelId))).toBe(
      botCanReadPrivate
    )
    const before = await vectors()
    await syncMembers()
    expect(await vectors()).toEqual(before)
    await assertParity()
  }, 120000)

  it.skipIf(!revokeMember)(
    'fails closed after Slack revokes the exact new fixture human grant',
    async () => {
      await db
        .update(knowledgeConnector)
        .set({ credentialId: null })
        .where(eq(knowledgeConnector.id, memberConnectorId))
      await syncMembers()
      const privateRows = (await stored()).filter((row) =>
        row.externalId?.includes(input.privateChannelId)
      )
      expect(privateRows.length).toBeGreaterThan(0)
      expect(await search(actor(members[0].userId))).toEqual(
        new Set((await stored()).map((row) => row.id))
      )
      expect((await api('auth.revoke', members[0].token)).revoked).toBe(true)
      await expect(api('auth.test', members[0].token)).rejects.toThrow(/token_revoked|invalid_auth/)
      await syncMembers(false)
      expect(await search(actor(members[0].userId))).toEqual(new Set())
      expect(await search(workspaceKey())).toEqual(new Set())
    },
    120000
  )
})
