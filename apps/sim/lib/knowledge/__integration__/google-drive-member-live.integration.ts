/**
 * Opt-in managed Google OAuth verification against the disposable ACL workspace.
 * GOOGLE_DRIVE_MEMBER_LIVE_FIXTURE_FILE contains only workspaceId, folderId and
 * one or two memberCredentialIds enrolled through the normal Sim UI. The first
 * human needs full Drive scope to create disposable child folders and text files.
 * GOOGLE_DRIVE_LIVE_SERVICE_ACCOUNT_FILE supplies the existing fixture account;
 * KNOWLEDGE_PROVIDER_LIVE_ENV_FILE supplies only the matching Google OAuth client
 * pair. No provider grants are revoked or secrets exported. OAuth refresh, Drive,
 * both indexing paths, storage, PostgreSQL and application authorization are real;
 * only embeddings are substituted. All created provider files are removed.
 */
import { readFile } from 'node:fs/promises'
import { parseEnv } from 'node:util'
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

const counters = vi.hoisted(() => ({ embeddings: 0 }))
vi.mock('@/lib/embeddings', async () => ({
  ...(await import('@/lib/embeddings/client')),
  assertKnowledgeEmbeddingCapacity: async () => {},
  embedKnowledge: async (texts: string[]) => {
    counters.embeddings += texts.length
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
import { encryptSecret } from '@/lib/core/security/encryption'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
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
import { resolveCredentialTokenBundle } from '@/lib/oauth/credential-service'
import { deleteFile } from '@/lib/uploads/core/storage-service'
import { downloadFileFromUrl } from '@/lib/uploads/utils/file-utils.server'
import { googleDriveConnector } from '@/connectors/google-drive/google-drive'
import type { ExternalDocument } from '@/connectors/types'
import { PER_MEMBER_LISTING_CONTEXT } from '@/connectors/utils'

const fixtureSchema = z.object({
  workspaceId: z.string().uuid(),
  folderId: z
    .string()
    .min(10)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/),
  memberCredentialIds: z.array(z.string().uuid()).min(1).max(2),
})
const fixtureFile = process.env.GOOGLE_DRIVE_MEMBER_LIVE_FIXTURE_FILE
const serviceAccountFile = process.env.GOOGLE_DRIVE_LIVE_SERVICE_ACCOUNT_FILE
const oauthEnvironmentFile = process.env.KNOWLEDGE_PROVIDER_LIVE_ENV_FILE
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive'

interface MemberFixture {
  credentialId: string
  userId: string
  email: string
  subject: string
  token: string
}

describe.skipIf(!fixtureFile || !serviceAccountFile)(
  'live Google Drive managed human access',
  () => {
    let input: z.infer<typeof fixtureSchema>
    let ownerId: string
    let groupId: string
    let optionId: string
    let serviceToken: string
    let sharedFolderId: string
    let privateFolderId: string
    let sharedFileId: string
    let privateFileId: string
    let secondPermissionId: string | undefined
    const kbId = generateId()
    const connectorId = generateId()
    const serviceCredentialId = generateId()
    const disconnectedUserId = generateId()
    const members: MemberFixture[] = []
    const createdUserIds: string[] = []
    const createdPermissionIds: string[] = []
    const createdProviderIds: string[] = []
    const storageKeys = new Set<string>()
    const previousClient = { id: env.GOOGLE_CLIENT_ID, secret: env.GOOGLE_CLIENT_SECRET }
    const actor = (userId: string): Principal => ({
      kind: 'session',
      userId,
      sessionId: 'drive-member-live',
    })
    const workspaceKey = (): Principal => ({
      kind: 'workspace_api_key',
      workspaceId: input.workspaceId,
      keyId: 'drive-member-live',
    })
    const sourceConfig = () => ({ folderId: [sharedFolderId, privateFolderId], maxFiles: 0 })

    async function request(token: string, path: string, options: RequestInit = {}) {
      const response = await fetch(`https://www.googleapis.com/${path}`, {
        ...options,
        headers: { Authorization: `Bearer ${token}`, ...options.headers },
        signal: AbortSignal.timeout(30000),
      })
      if (!response.ok) {
        await response.body?.cancel()
        throw new Error(`Drive fixture request failed: HTTP ${response.status}`)
      }
      if (response.status === 204) return {}
      const value = await readResponseJsonWithLimit(response, {
        maxBytes: 64 * 1024,
        label: 'Drive fixture response',
      })
      if (!isPlainRecord(value)) throw new Error('Drive fixture returned an invalid response')
      return value
    }
    const json = (method: string, body: Record<string, unknown>): RequestInit => ({
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    async function identity(token: string) {
      const value = await request(token, 'drive/v3/about?fields=user(emailAddress)')
      if (!isPlainRecord(value.user) || typeof value.user.emailAddress !== 'string')
        throw new Error('Drive did not return the authenticated identity')
      return value.user.emailAddress.toLowerCase()
    }
    async function mint(member: MemberFixture) {
      const result = await mintKnowledgeConnectorMemberToken({
        connectorId,
        workspaceId: input.workspaceId,
        credentialId: member.credentialId,
        expectedProviderId: 'google-drive',
        requiredScopes: [DRIVE_SCOPE],
        runId: 'drive-member-live',
      })
      member.token = result.accessToken
      return result
    }
    async function createFile(parentId: string, name: string, folder = false) {
      if (parentId !== input.folderId && !createdProviderIds.includes(parentId))
        throw new Error('Fixture creation escaped its disposable folder')
      const value = await request(
        members[0].token,
        'drive/v3/files?fields=id&supportsAllDrives=true',
        json('POST', {
          name,
          mimeType: folder ? 'application/vnd.google-apps.folder' : 'text/plain',
          parents: [parentId],
        })
      )
      if (typeof value.id !== 'string')
        throw new Error('Drive did not return the created fixture ID')
      createdProviderIds.push(value.id)
      if (folder) {
        const restricted = await request(
          members[0].token,
          `drive/v3/files/${encodeURIComponent(value.id)}?fields=id,inheritedPermissionsDisabled&supportsAllDrives=true`,
          json('PATCH', { inheritedPermissionsDisabled: true })
        )
        expect(restricted.inheritedPermissionsDisabled).toBe(true)
      }
      return value.id
    }
    async function writeText(fileId: string, content: string) {
      if (!createdProviderIds.includes(fileId) || content.length > 2048)
        throw new Error('Fixture update exceeded its bound')
      await request(
        members[0].token,
        `upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media&fields=id&supportsAllDrives=true`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'text/plain' },
          body: content,
        }
      )
    }
    async function shareFixtureFolder(folderId: string, email: string) {
      if (!createdProviderIds.includes(folderId))
        throw new Error('Fixture sharing escaped its disposable folders')
      const permission = await request(
        members[0].token,
        `drive/v3/files/${encodeURIComponent(folderId)}/permissions?fields=id&sendNotificationEmail=false&supportsAllDrives=true`,
        json('POST', { type: 'user', role: 'reader', emailAddress: email })
      )
      if (typeof permission.id !== 'string')
        throw new Error('Drive did not return the fixture sharing permission')
      return permission.id
    }
    async function shareSecond() {
      secondPermissionId = await shareFixtureFolder(sharedFolderId, members[1].email)
    }
    async function list(token: string) {
      const documents: ExternalDocument[] = []
      let cursor: string | undefined
      const context = { ...PER_MEMBER_LISTING_CONTEXT }
      for (let page = 0; page < 20; page++) {
        const result = await googleDriveConnector.listDocuments(
          token,
          sourceConfig(),
          cursor,
          context
        )
        documents.push(...result.documents)
        if (!result.hasMore) return documents
        if (!result.nextCursor) throw new Error('Drive fixture omitted its continuation cursor')
        cursor = result.nextCursor
      }
      throw new Error('Drive fixture exceeded its bounded listing budget')
    }
    async function stored() {
      const rows = await db
        .select()
        .from(document)
        .where(and(eq(document.connectorId, connectorId), isNull(document.deletedAt)))
      for (const row of rows) if (row.storageKey) storageKeys.add(row.storageKey)
      return rows
    }
    async function vectors() {
      const rows = await stored()
      if (!rows.length) return []
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
    async function search(principal: Principal) {
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
      return new Set(result.results.map((row) => row.documentId))
    }
    async function sync(forceContentRefresh = true) {
      await db
        .update(knowledgeConnectorMember)
        .set({ nextAttemptAt: new Date(0) })
        .where(eq(knowledgeConnectorMember.connectorId, connectorId))
      const result = await executeMemberSync(connectorId, {
        forceContentRefresh,
        billingAttribution: await resolveBillingAttribution({
          actorUserId: ownerId,
          workspaceId: input.workspaceId,
        }),
      })
      expect(result.error).toBeUndefined()
      expect(result.skipReason).toBeUndefined()
      expect(result.membersFailed).toBe(0)
      expect(result.docsFailed).toBe(0)
      expect(result.membersRemaining).toBe(false)
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
          const documentInput = { knowledgeBaseId: kbId, documentId: row.id }
          if (expected.has(row.id)) {
            expect(
              (
                await readKnowledgeDocument.execute({
                  principal: actor(member.userId),
                  input: documentInput,
                })
              ).document.id
            ).toBe(row.id)
            expect(
              (
                await listKnowledgeChunks.execute({
                  principal: actor(member.userId),
                  input: documentInput,
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
                input: documentInput,
              })
            ).rejects.toThrow('Document not found')
            await expect(
              listKnowledgeChunks.execute({ principal: actor(member.userId), input: documentInput })
            ).rejects.toThrow('Document not found')
            await expect(
              downloadFileFromUrl(row.fileUrl, { userId: member.userId, knowledgeAccess: 'user' })
            ).rejects.toThrow('Access denied')
          }
        }
      }
      expect(await search(workspaceKey())).toEqual(new Set())
      expect(await search(actor(disconnectedUserId))).toEqual(new Set())
    }
    async function addPerson(email: string, id = generateId()) {
      let [person] = await db.select().from(user).where(eq(user.email, email))
      if (!person) {
        await db.insert(user).values({
          id,
          email,
          emailVerified: true,
          name: 'Drive live fixture',
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        createdUserIds.push(id)
        ;[person] = await db.select().from(user).where(eq(user.id, id))
      }
      const access = await db
        .select()
        .from(permissions)
        .where(
          and(
            eq(permissions.userId, person.id),
            eq(permissions.entityId, input.workspaceId),
            eq(permissions.entityType, 'workspace')
          )
        )
      if (!access.length) {
        const permissionId = generateId()
        await db.insert(permissions).values({
          id: permissionId,
          userId: person.id,
          entityId: input.workspaceId,
          entityType: 'workspace',
          permissionType: 'read',
        })
        createdPermissionIds.push(permissionId)
      }
      return person.id
    }

    beforeAll(async () => {
      if (!oauthEnvironmentFile)
        throw new Error(
          'Provide the fixture Google OAuth client through KNOWLEDGE_PROVIDER_LIVE_ENV_FILE'
        )
      const selected = parseEnv(await readFile(oauthEnvironmentFile, 'utf8'))
      if (!selected.GOOGLE_CLIENT_ID || !selected.GOOGLE_CLIENT_SECRET)
        throw new Error('The fixture Google OAuth client pair is missing')
      Object.assign(env, {
        GOOGLE_CLIENT_ID: selected.GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET: selected.GOOGLE_CLIENT_SECRET,
      })
      input = fixtureSchema.parse(JSON.parse(await readFile(fixtureFile!, 'utf8')))
      const [base] = await db.select().from(workspace).where(eq(workspace.id, input.workspaceId))
      expect(base?.name).toBe('ACL integration fixture')
      ownerId = base.ownerId
      await db.insert(knowledgeBase).values({
        id: kbId,
        userId: ownerId,
        workspaceId: input.workspaceId,
        name: 'Disposable managed Drive live verification',
        chunkingConfig: { maxSize: 1024, minSize: 1, overlap: 20 },
      })
      await addPerson(`${disconnectedUserId}@fixture.test`, disconnectedUserId)
      for (const credentialId of input.memberCredentialIds) {
        const binding = await loadManagedCredentialGroupBinding(credentialId)
        expect(binding?.workspaceId).toBe(input.workspaceId)
        expect(binding?.providerId).toBe('google-drive')
        if (!binding) throw new Error('Enroll the fixture Google human through Sim first')
        if (groupId) {
          expect(binding.credentialGroupId).toBe(groupId)
          expect(binding.credentialGroupOptionId).toBe(optionId)
        } else {
          groupId = binding.credentialGroupId
          optionId = binding.credentialGroupOptionId
        }
        const [row] = await db
          .select({ credential, email: credentialGroupEnrollment.email })
          .from(credential)
          .innerJoin(
            credentialGroupEnrollment,
            eq(credentialGroupEnrollment.id, credential.credentialGroupEnrollmentId)
          )
          .where(eq(credential.id, credentialId))
        expect(row.credential.managedOauthStatus).toBe('active')
        expect(row.credential.grantedScopes).toContain(DRIVE_SCOPE)
        members.push({
          credentialId,
          userId: await addPerson(row.email),
          email: row.email.toLowerCase(),
          subject: row.credential.providerSubjectId!,
          token: '',
        })
      }
      expect(new Set(members.map((member) => member.subject)).size).toBe(members.length)
      await db.insert(knowledgeConnector).values({
        id: connectorId,
        knowledgeBaseId: kbId,
        connectorType: 'google_drive',
        sourceConfig: { folderId: input.folderId, maxFiles: 0 },
        accessMode: 'members',
        credentialGroupId: groupId,
        credentialGroupOptionId: optionId,
        status: 'active',
        memberSyncStatus: 'idle',
        syncIntervalMinutes: 1440,
      })
      await grantKnowledgeConnectorCredentialAccess(
        {
          workspaceId: input.workspaceId,
          credentialGroupId: groupId,
          credentialGroupOptionId: optionId,
          connectorId,
        },
        ownerId
      )
      for (const member of members) {
        await mint(member)
        expect(await identity(member.token)).toBe(member.email)
      }
      const folder = await request(
        members[0].token,
        `drive/v3/files/${input.folderId}?fields=id,name,mimeType&supportsAllDrives=true`
      )
      expect(folder.name).toMatch(/^Sim Search ACL E2E/)
      expect(folder.mimeType).toBe('application/vnd.google-apps.folder')
      const key = await readFile(serviceAccountFile!, 'utf8')
      await db.insert(credential).values({
        id: serviceCredentialId,
        workspaceId: input.workspaceId,
        type: 'service_account',
        displayName: 'Disposable managed Drive live content account',
        providerId: 'google-service-account',
        encryptedServiceAccountKey: (await encryptSecret(key)).encrypted,
        createdBy: ownerId,
      })
      const service = await resolveCredentialTokenBundle(
        serviceCredentialId,
        ownerId,
        'drive-member-live',
        ['https://www.googleapis.com/auth/drive.readonly'],
        undefined,
        { privacyMode: 'selector' }
      )
      if (!service?.accessToken) throw new Error('Fixture service account could not authenticate')
      serviceToken = service.accessToken
      const serviceFolder = await request(
        serviceToken,
        `drive/v3/files/${input.folderId}?fields=id,name,mimeType&supportsAllDrives=true`
      )
      expect(serviceFolder.id).toBe(input.folderId)
      sharedFolderId = await createFile(input.folderId, `Orion shared OAuth fixture ${kbId}`, true)
      privateFolderId = await createFile(
        input.folderId,
        `Orion private OAuth fixture ${kbId}`,
        true
      )
      const serviceIdentity: unknown = JSON.parse(key)
      if (!isPlainRecord(serviceIdentity) || typeof serviceIdentity.client_email !== 'string')
        throw new Error('Fixture service account identity is missing')
      await shareFixtureFolder(sharedFolderId, serviceIdentity.client_email)
      await shareFixtureFolder(privateFolderId, serviceIdentity.client_email)
      sharedFileId = await createFile(sharedFolderId, 'Orion shared OAuth fixture.txt')
      privateFileId = await createFile(privateFolderId, 'Orion private OAuth fixture.txt')
      await writeText(
        sharedFileId,
        'Orion shared managed OAuth fixture. Both enrolled humans may read this document.'
      )
      await writeText(
        privateFileId,
        'Orion private managed OAuth fixture. Only the first enrolled human may read this document.'
      )
      await db
        .update(knowledgeConnector)
        .set({ sourceConfig: sourceConfig() })
        .where(eq(knowledgeConnector.id, connectorId))
      if (members.length > 1) await shareSecond()
      await vi.waitFor(
        async () => {
          expect(new Set((await list(serviceToken)).map((row) => row.externalId))).toEqual(
            new Set([sharedFileId, privateFileId])
          )
          if (members.length > 1)
            expect(new Set((await list(members[1].token)).map((row) => row.externalId))).toEqual(
              new Set([sharedFileId])
            )
        },
        { timeout: 15000, interval: 500 }
      )
    }, 120000)

    afterAll(async () => {
      const cleanupErrors: unknown[] = []
      if (members[0]?.token)
        for (const id of [...createdProviderIds].reverse()) {
          try {
            await request(
              members[0].token,
              `drive/v3/files/${encodeURIComponent(id)}?supportsAllDrives=true`,
              { method: 'DELETE' }
            )
          } catch (error) {
            if (!(error instanceof Error && error.message.endsWith('HTTP 404')))
              cleanupErrors.push(error)
          }
        }
      try {
        if (groupId)
          await revokeKnowledgeConnectorCredentialAccess(
            { workspaceId: input.workspaceId, credentialGroupId: groupId, connectorId },
            ownerId
          )
        await stored()
        for (const key of storageKeys)
          await deleteFile({ key, context: 'knowledge-base' }).catch((error: unknown) => {
            if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
          })
      } finally {
        await db.delete(knowledgeBase).where(eq(knowledgeBase.id, kbId))
        await db.delete(credential).where(eq(credential.id, serviceCredentialId))
        if (groupId) {
          await db
            .delete(credentialGroupEnrollment)
            .where(
              and(
                eq(credentialGroupEnrollment.credentialGroupId, groupId),
                eq(credentialGroupEnrollment.email, `${disconnectedUserId}@fixture.test`)
              )
            )
        }
        if (createdPermissionIds.length)
          await db.delete(permissions).where(inArray(permissions.id, createdPermissionIds))
        if (createdUserIds.length) await db.delete(user).where(inArray(user.id, createdUserIds))
        Object.assign(env, {
          GOOGLE_CLIENT_ID: previousClient.id,
          GOOGLE_CLIENT_SECRET: previousClient.secret,
        })
        await db.$client.end()
      }
      if (cleanupErrors.length)
        throw new AggregateError(cleanupErrors, 'Failed to remove disposable Drive fixtures')
    }, 120000)

    it('indexes the union of real managed-human Drive visibility through the complete pipeline', async () => {
      await sync()
      const rows = await stored()
      expect(new Set(rows.map((row) => row.externalId))).toEqual(
        new Set([sharedFileId, privateFileId])
      )
      expect(rows.every((row) => row.processingStatus === 'completed')).toBe(true)
      await assertParity()
    }, 120000)

    it('refreshes human ACL evidence without re-embedding unchanged content', async () => {
      const before = await vectors()
      const embeddingCalls = counters.embeddings
      await sync()
      expect(await vectors()).toEqual(before)
      expect(counters.embeddings).toBe(embeddingCalls)
      await assertParity()
    }, 120000)

    it('refreshes the real managed Google token through the canonical resolver', async () => {
      const member = members[0]
      await db
        .update(credential)
        .set({ accessTokenExpiresAt: new Date(0) })
        .where(eq(credential.id, member.credentialId))
      expect((await mint(member)).refreshed).toBe(true)
      expect(await identity(member.token)).toBe(member.email)
      const [row] = await db
        .select({ status: credential.managedOauthStatus, expires: credential.accessTokenExpiresAt })
        .from(credential)
        .where(eq(credential.id, member.credentialId))
      expect(row.status).toBe('active')
      expect(row.expires!.getTime()).toBeGreaterThan(Date.now())
      await sync()
      await assertParity()
    }, 120000)

    it('fails closed for expired ACL evidence and disabled local grants without revoking Google', async () => {
      const before = await vectors()
      const old = new Date(Date.now() - 25 * 60 * 60 * 1000)
      const rows = await db
        .select({ id: knowledgeConnectorMember.id })
        .from(knowledgeConnectorMember)
        .where(eq(knowledgeConnectorMember.connectorId, connectorId))
      await db
        .update(knowledgeConnectorMember)
        .set({ memberSyncedThrough: old })
        .where(eq(knowledgeConnectorMember.connectorId, connectorId))
      await db
        .update(knowledgeDocumentObservation)
        .set({ lastSeenAt: old })
        .where(
          inArray(
            knowledgeDocumentObservation.memberId,
            rows.map((row) => row.id)
          )
        )
      expect(await search(actor(members[0].userId))).toEqual(new Set())
      await sync()
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
          .where(
            and(
              eq(credential.id, members[0].credentialId),
              eq(credential.managedOauthStatus, 'needs_reauth')
            )
          )
      }
      await assertParity()
    }, 120000)

    it('reconciles real sharing revocation and restoration for a distinct second human', async ({
      skip,
    }) => {
      if (members.length < 2) {
        skip()
        return
      }
      expect(secondPermissionId).toBeDefined()
      await request(
        members[0].token,
        `drive/v3/files/${sharedFolderId}/permissions/${secondPermissionId}?supportsAllDrives=true`,
        { method: 'DELETE' }
      )
      secondPermissionId = undefined
      try {
        await vi.waitFor(async () => expect(await list(members[1].token)).toEqual([]), {
          timeout: 15000,
          interval: 500,
        })
        const before = await vectors()
        await sync()
        expect(await vectors()).toEqual(before)
        expect(await search(actor(members[1].userId))).toEqual(new Set())
        await assertParity()
      } finally {
        await shareSecond()
      }
      await vi.waitFor(
        async () =>
          expect((await list(members[1].token)).map((row) => row.externalId)).toEqual([
            sharedFileId,
          ]),
        { timeout: 15000, interval: 500 }
      )
      await sync()
      await assertParity()
    }, 120000)

    it('reindexes edited fixture content and reconciles deleted source documents', async () => {
      await writeText(
        sharedFileId,
        'Orion shared managed OAuth fixture AFTER EDIT. Updated source content.'
      )
      await sync()
      expect((await vectors()).map((row) => row.content).join('\n')).toContain('AFTER EDIT')
      const deletedId = await createFile(privateFolderId, 'Orion deleted OAuth fixture.txt')
      await writeText(deletedId, 'Orion disposable document to verify source deletion.')
      await sync()
      expect((await stored()).some((row) => row.externalId === deletedId)).toBe(true)
      await request(members[0].token, `drive/v3/files/${deletedId}?supportsAllDrives=true`, {
        method: 'DELETE',
      })
      await sync()
      expect((await stored()).some((row) => row.externalId === deletedId)).toBe(false)
      await assertParity()
    }, 120000)

    it('indexes with the service account while managed humans supply ACL-only observations', async () => {
      const serviceFileId = await createFile(privateFolderId, 'Orion dedicated content fixture.txt')
      await writeText(
        serviceFileId,
        'Orion new dedicated service account content. Human tokens only supply visibility.'
      )
      await db
        .update(knowledgeConnector)
        .set({ credentialId: serviceCredentialId })
        .where(eq(knowledgeConnector.id, connectorId))
      expect((await sync()).docsHydratedOnce).toBeGreaterThan(0)
      expect((await stored()).some((row) => row.externalId === serviceFileId)).toBe(true)
      expect(new Set((await stored()).map((row) => row.externalId))).toEqual(
        new Set((await list(serviceToken)).map((row) => row.externalId))
      )
      await assertParity()
      const before = await vectors()
      const embeddingCalls = counters.embeddings
      const result = await sync(false)
      expect(result.docsHydratedOnce).toBe(0)
      expect(await vectors()).toEqual(before)
      expect(counters.embeddings).toBe(embeddingCalls)
      await assertParity()
    }, 120000)
  }
)
