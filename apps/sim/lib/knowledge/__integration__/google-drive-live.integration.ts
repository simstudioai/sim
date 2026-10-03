/**
 * Opt-in live Drive test against a newly created, harmless fixture folder.
 * Set GOOGLE_DRIVE_LIVE_SERVICE_ACCOUNT_FILE, GOOGLE_DRIVE_LIVE_FOLDER_ID,
 * GOOGLE_DRIVE_LIVE_OWNER_EMAIL and run Vitest with --mode integration.
 * GOOGLE_DRIVE_LIVE_ALLOW_CONTENT_UPDATE=true also edits and restores the fixture.
 * GOOGLE_DRIVE_LIVE_DELEGATED_EMAIL enables the complete delegated ACL and directory pass.
 * The token resolver, provider, sync engine, storage, database and application access
 * are real; only the embedding provider is substituted.
 * Direct user ACLs are checked separately from delegated Workspace directory setup.
 */
import { readFile } from 'node:fs/promises'
import { parseEnv } from 'node:util'
import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  credential,
  document,
  embedding,
  knowledgeConnector,
  knowledgeExternalGroup,
  user,
  workspace,
  workspaceFiles,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ embeddingCalls: 0 }))
vi.mock('@/lib/embeddings', async () => ({
  ...(await import('@/lib/embeddings/client')),
  assertKnowledgeEmbeddingCapacity: async () => {},
  embedKnowledge: async (texts: string[]) => {
    fixture.embeddingCalls += 1
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
import { seedKnowledgeAclFixture } from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { domainGroupId } from '@/lib/knowledge/access/external-groups'
import { listKnowledgeChunks } from '@/lib/knowledge/application/chunks'
import { readKnowledgeDocument } from '@/lib/knowledge/application/documents'
import { searchKnowledge } from '@/lib/knowledge/application/search'
import { executeSync } from '@/lib/knowledge/connectors/sync-engine'
import { persistDocumentAcls } from '@/lib/knowledge/connectors/sync-persistence'
import { resolveCredentialTokenBundle } from '@/lib/oauth/credential-service'
import { deleteFile } from '@/lib/uploads/core/storage-service'
import { downloadFileFromUrl } from '@/lib/uploads/utils/file-utils.server'
import { googleWorkspaceDomain } from '@/connectors/google-drive/directory'
import { googleDriveConnector } from '@/connectors/google-drive/google-drive'
import type { ExternalDocument } from '@/connectors/types'

const keyPath = process.env.GOOGLE_DRIVE_LIVE_SERVICE_ACCOUNT_FILE
const folderId = process.env.GOOGLE_DRIVE_LIVE_FOLDER_ID
const ownerEmail = process.env.GOOGLE_DRIVE_LIVE_OWNER_EMAIL
const delegatedEmail = process.env.GOOGLE_DRIVE_LIVE_DELEGATED_EMAIL
const allowUpdate = process.env.GOOGLE_DRIVE_LIVE_ALLOW_CONTENT_UPDATE === 'true'
const verifyRawFiles = process.env.GOOGLE_DRIVE_LIVE_VERIFY_RAW_FILES === 'true'
const verifyNativeExports = process.env.GOOGLE_DRIVE_LIVE_VERIFY_NATIVE_EXPORTS === 'true'
const providerCredentialsFile = process.env.KNOWLEDGE_PROVIDER_LIVE_ENV_FILE

describe.skipIf(!keyPath || !folderId || !ownerEmail)(
  'live Google Drive ingestion and access',
  () => {
    let ids: Awaited<ReturnType<typeof seedKnowledgeAclFixture>>
    let accessToken: string
    let original: ExternalDocument
    let documentId: string
    let fileUrl: string
    let contentChanged = false
    const listedDocuments: ExternalDocument[] = []
    const credentialId = generateId()
    const config = { folderId, maxFiles: 20 }
    const priorOcr = { MISTRAL_API_KEY: env.MISTRAL_API_KEY, OCR_PROVIDER: env.OCR_PROVIDER }
    const alice = (): Principal => ({
      kind: 'session',
      userId: ids.aliceId,
      sessionId: 'live-drive',
    })
    const bob = (): Principal => ({
      kind: 'personal_api_key',
      userId: ids.bobId,
      keyId: 'live-drive',
    })
    const workspaceKey = (): Principal => ({
      kind: 'workspace_api_key',
      workspaceId: ids.workspaceId,
      keyId: 'live-drive',
    })

    async function search(principal: Principal) {
      const result = await searchKnowledge.execute({
        principal,
        input: {
          workspaceId: ids.workspaceId,
          knowledgeBaseIds: [ids.knowledgeBaseId],
          query: 'Orion',
          searchMode: 'hybrid',
          topK: 10,
        },
      })
      return result.results.map((row) => row.documentId)
    }

    async function replaceFixtureContent(content: string) {
      const response = await fetch(
        `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(original.externalId)}?uploadType=media&supportsAllDrives=true`,
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'text/plain' },
          body: content,
        }
      )
      if (!response.ok) throw new Error(`Live fixture update failed: HTTP ${response.status}`)
    }

    async function syncContent() {
      const result = await executeSync(ids.connectorId, {
        fullSync: true,
        billingAttribution: await resolveBillingAttribution({
          actorUserId: ids.aliceId,
          workspaceId: ids.workspaceId,
        }),
      })
      expect(result.error).toBeUndefined()
      expect(result.skipReason).toBeUndefined()
      expect(result.docsFailed).toBe(0)
      return result
    }

    beforeAll(async () => {
      if (providerCredentialsFile) {
        const selected = parseEnv(await readFile(providerCredentialsFile, 'utf8'))
        if (!selected.MISTRAL_API_KEY)
          throw new Error('Live image ingestion requires the selected Mistral key')
        Object.assign(env, { MISTRAL_API_KEY: selected.MISTRAL_API_KEY, OCR_PROVIDER: 'mistral' })
      }
      ids = await seedKnowledgeAclFixture()
      const rawKey = await readFile(keyPath!, 'utf8')
      await db.insert(credential).values({
        id: credentialId,
        workspaceId: ids.workspaceId,
        type: 'service_account',
        displayName: 'Disposable live Drive fixture',
        providerId: 'google-service-account',
        encryptedServiceAccountKey: (await encryptSecret(rawKey)).encrypted,
        createdBy: ids.aliceId,
      })
      const token = await resolveCredentialTokenBundle(
        credentialId,
        ids.aliceId,
        'live-drive-integration',
        [`https://www.googleapis.com/auth/${allowUpdate ? 'drive' : 'drive.readonly'}`],
        undefined,
        { privacyMode: 'selector' }
      )
      if (!token?.accessToken) throw new Error('The service account did not return an access token')
      accessToken = token.accessToken
      const folder = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId!)}?fields=id,name,mimeType&supportsAllDrives=true`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      )
      if (!folder.ok)
        throw new Error(`Share the fixture folder with the service account: HTTP ${folder.status}`)
      const folderMetadata = await folder.json()
      expect(folderMetadata.mimeType).toBe('application/vnd.google-apps.folder')
      expect(folderMetadata.name).toMatch(/^Sim Search ACL E2E/)
      expect(await googleDriveConnector.validateConfig!(accessToken, config)).toEqual({
        valid: true,
      })
      let cursor: string | undefined
      const context = {}
      for (let pageNumber = 0; pageNumber < 20; pageNumber++) {
        const page = await googleDriveConnector.listDocuments(accessToken, config, cursor, context)
        expect(page.reconciliationSafe).not.toBe(false)
        listedDocuments.push(...page.documents)
        if (!page.hasMore) break
        if (!page.nextCursor || pageNumber === 19)
          throw new Error('Live fixture exceeded its bounded folder listing')
        cursor = page.nextCursor
      }
      const listed = listedDocuments.find((row) => row.title === 'sim-search-live-alpha.txt')
      expect(listed).toBeDefined()
      expect(listed?.contentDeferred).toBe(true)
      const hydrated = await googleDriveConnector.getDocument!(
        accessToken,
        config,
        listed!.externalId
      )
      expect(hydrated?.content).toContain('Orion live fixture alpha')
      expect(hydrated?.contentHash).toBe(listed?.contentHash)
      original = hydrated!
      await db
        .update(knowledgeConnector)
        .set({
          connectorType: 'google_drive',
          sourceConfig: config,
          credentialId,
          accessMode: 'workspace',
          status: 'active',
          syncLockToken: null,
        })
        .where(eq(knowledgeConnector.id, ids.connectorId))
      expect((await syncContent()).docsAdded).toBeGreaterThan(0)
      const [stored] = await db
        .select()
        .from(document)
        .where(
          and(
            eq(document.connectorId, ids.connectorId),
            eq(document.externalId, original.externalId)
          )
        )
      expect(stored.processingStatus).toBe('completed')
      documentId = stored.id
      fileUrl = stored.fileUrl
    }, 120000)

    afterAll(async () => {
      try {
        if (contentChanged) await replaceFixtureContent(original.content)
      } finally {
        if (ids) {
          const files = await db
            .select({ key: workspaceFiles.key })
            .from(workspaceFiles)
            .where(eq(workspaceFiles.workspaceId, ids.workspaceId))
          const documents = await db
            .select({ key: document.storageKey })
            .from(document)
            .where(eq(document.knowledgeBaseId, ids.knowledgeBaseId))
          const keys = new Set(
            [...files, ...documents]
              .map((file) => file.key)
              .filter((key): key is string => Boolean(key))
          )
          for (const key of keys) {
            await deleteFile({ key, context: 'knowledge-base' }).catch((error: unknown) => {
              if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
                throw error
              }
            })
          }
          await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
          await db.delete(user).where(eq(user.id, ids.aliceId))
          await db.delete(user).where(eq(user.id, ids.bobId))
        }
        Object.assign(env, priorOcr)
        await db.$client.end()
      }
    })

    it('indexes live deferred content and grants explicit workspace sharing to all principal surfaces', async () => {
      expect(await search(alice())).toContain(documentId)
      expect(await search(bob())).toContain(documentId)
      expect(await search(workspaceKey())).toContain(documentId)
      expect(
        (
          await readKnowledgeDocument.execute({
            principal: bob(),
            input: { knowledgeBaseId: ids.knowledgeBaseId, documentId },
          })
        ).document.id
      ).toBe(documentId)
      expect(fixture.embeddingCalls).toBeGreaterThan(0)
    })

    it.skipIf(!verifyRawFiles)(
      'indexes nested PDF, Word, every Excel sheet and a real OCR image through the full pipeline',
      async () => {
        const rows = await db
          .select()
          .from(document)
          .where(eq(document.connectorId, ids.connectorId))
        const expected = [
          'orion-nested.pdf',
          'orion-nested.docx',
          'orion-nested.xlsx',
          'orion-nested.png',
        ]
        for (const name of expected) {
          const row = rows.find((item) => item.filename === name)
          expect(row, name).toBeDefined()
          expect(row?.processingStatus, name).toBe('completed')
          const chunks = await listKnowledgeChunks.execute({
            principal: bob(),
            input: { knowledgeBaseId: ids.knowledgeBaseId, documentId: row!.id },
          })
          const text = chunks.chunks.map((chunk) => chunk.content).join('\n')
          expect(text, name).toMatch(/Orion/i)
          if (name.endsWith('.xlsx')) expect(text).toContain('Orion second sheet')
          const bytes = await downloadFileFromUrl(row!.fileUrl, {
            userId: ids.bobId,
            knowledgeAccess: 'user',
          })
          expect(bytes.length).toBeGreaterThan(100)
          if (name.endsWith('.pdf')) expect(bytes.subarray(0, 4).toString()).toBe('%PDF')
          if (name.endsWith('.png')) expect(bytes.subarray(1, 4).toString()).toBe('PNG')
        }
        expect(new Set(await search(alice())).size).toBeGreaterThanOrEqual(expected.length)
      },
      120000
    )

    it.skipIf(!verifyNativeExports)(
      'exports native Google Docs, every Sheets tab and Slides into searchable content',
      async () => {
        const rows = await db
          .select()
          .from(document)
          .where(eq(document.connectorId, ids.connectorId))
        for (const [name, mimeType] of [
          ['orion-native-docs', 'application/vnd.google-apps.document'],
          ['orion-native-sheets', 'application/vnd.google-apps.spreadsheet'],
          ['orion-native-slides', 'application/vnd.google-apps.presentation'],
        ]) {
          const listed = listedDocuments.find((item) => item.title === name)
          expect(listed?.metadata?.originalMimeType, name).toBe(mimeType)
          const stored = rows.find((item) => item.externalId === listed?.externalId)
          expect(stored?.processingStatus, name).toBe('completed')
          const chunks = await listKnowledgeChunks.execute({
            principal: bob(),
            input: { knowledgeBaseId: ids.knowledgeBaseId, documentId: stored!.id },
          })
          const text = chunks.chunks.map((chunk) => chunk.content).join('\n')
          expect(text, name).toMatch(/Orion/i)
          if (name === 'orion-native-docs') {
            expect(text).toContain('Orion Word fixture')
            expect(text).toContain('Orion second document tab')
          }
          if (name === 'orion-native-sheets') expect(text).toContain('Orion second sheet')
          if (name === 'orion-native-slides') expect(text).toContain('Orion second slide')
        }
      },
      120000
    )

    it.skipIf(!allowUpdate)(
      'detects a real edit in the change feed and reindexes through the complete content engine',
      async () => {
        const cursor = await googleDriveConnector.getChangeCursor!(accessToken, config)
        const updatedContent = `${original.content}\nOrion verification revision ${generateId()}.\n`
        contentChanged = true
        await replaceFixtureContent(updatedContent)
        const changed = await googleDriveConnector.getDocument!(
          accessToken,
          config,
          original.externalId
        )
        expect(changed?.content).toBe(updatedContent)
        expect(changed?.contentHash).not.toBe(original.contentHash)
        const changes = await googleDriveConnector.listChanges!(accessToken, config, cursor)
        expect(changes.changes.some((row) => row.externalId === original.externalId)).toBe(true)
        expect((await syncContent()).docsUpdated).toBeGreaterThan(0)
        const [saved] = await db
          .select({ status: document.processingStatus, hash: document.contentHash })
          .from(document)
          .where(eq(document.id, documentId))
        expect(saved).toEqual({ status: 'completed', hash: changed!.contentHash })
        expect(await search(alice())).toContain(documentId)
        expect(await search(bob())).toContain(documentId)
        await replaceFixtureContent(original.content)
        contentChanged = false
        await syncContent()
        const [restored] = await db.select().from(document).where(eq(document.id, documentId))
        fileUrl = restored.fileUrl
      },
      60000
    )

    it('uses live file permission snapshots to protect unchanged stored content without reembedding', async () => {
      const calls = fixture.embeddingCalls
      const before = await db
        .select({ id: embedding.id })
        .from(embedding)
        .where(eq(embedding.documentId, documentId))
      await db.update(user).set({ email: ownerEmail! }).where(eq(user.id, ids.aliceId))
      await db
        .update(knowledgeConnector)
        .set({ accessMode: 'admin' })
        .where(eq(knowledgeConnector.id, ids.connectorId))
      const acls = await googleDriveConnector.getDocumentAcls!(
        accessToken,
        { ...config, adminEmail: ownerEmail },
        listedDocuments,
        { mirrorsSourceAcls: true }
      )
      expect(acls[original.externalId]).toContain(`u:${ownerEmail}`)
      await persistDocumentAcls(ids.connectorId, new Map(Object.entries(acls)))
      expect(fixture.embeddingCalls).toBe(calls)
      expect(await search(alice())).toContain(documentId)
      expect(await search(bob())).toEqual([])
      expect(await search(workspaceKey())).toEqual([])
      const chunks = await listKnowledgeChunks.execute({
        principal: alice(),
        input: { knowledgeBaseId: ids.knowledgeBaseId, documentId },
      })
      expect(chunks.chunks.map((chunk) => chunk.content).join('\n')).toContain(
        'Orion live fixture alpha'
      )
      await expect(
        readKnowledgeDocument.execute({
          principal: bob(),
          input: { knowledgeBaseId: ids.knowledgeBaseId, documentId },
        })
      ).rejects.toThrow('Document not found')
      await expect(
        listKnowledgeChunks.execute({
          principal: bob(),
          input: { knowledgeBaseId: ids.knowledgeBaseId, documentId },
        })
      ).rejects.toThrow('Document not found')
      expect(
        (
          await downloadFileFromUrl(fileUrl, { userId: ids.aliceId, knowledgeAccess: 'user' })
        ).toString()
      ).toBe(original.content)
      await expect(
        downloadFileFromUrl(fileUrl, { userId: ids.bobId, knowledgeAccess: 'user' })
      ).rejects.toThrow('Access denied')
      const protectedRows = await db
        .select()
        .from(document)
        .where(eq(document.connectorId, ids.connectorId))
      for (const row of protectedRows) {
        await expect(
          downloadFileFromUrl(row.fileUrl, {
            userId: ids.bobId,
            knowledgeAccess: 'user',
          })
        ).rejects.toThrow('Access denied')
      }
      expect(
        await db
          .select({ id: embedding.id })
          .from(embedding)
          .where(eq(embedding.documentId, documentId))
      ).toEqual(before)
    })

    it('denies live-sourced content when its permission snapshot expires and restores only after a fresh source read', async () => {
      await db
        .update(document)
        .set({ aclVerifiedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) })
        .where(eq(document.connectorId, ids.connectorId))
      expect(await search(alice())).toEqual([])
      const acls = await googleDriveConnector.getDocumentAcls!(
        accessToken,
        { ...config, adminEmail: ownerEmail },
        listedDocuments,
        { mirrorsSourceAcls: true }
      )
      await persistDocumentAcls(ids.connectorId, new Map(Object.entries(acls)))
      expect(await search(alice())).toContain(documentId)
      expect(await search(bob())).toEqual([])
    })

    it.skipIf(!delegatedEmail)(
      'mirrors permissions and Workspace directory membership through the delegated sync engine',
      async () => {
        const startedAt = new Date()
        const embeddingCalls = fixture.embeddingCalls
        await db
          .update(knowledgeConnector)
          .set({
            accessMode: 'admin',
            sourceConfig: { ...config, adminEmail: delegatedEmail },
          })
          .where(eq(knowledgeConnector.id, ids.connectorId))
        await syncContent()
        const groups = await db
          .select({
            id: knowledgeExternalGroup.externalGroupId,
            syncedAt: knowledgeExternalGroup.lastSyncedAt,
          })
          .from(knowledgeExternalGroup)
          .where(
            and(
              eq(knowledgeExternalGroup.workspaceId, ids.workspaceId),
              eq(knowledgeExternalGroup.providerId, 'google-drive')
            )
          )
        expect(
          groups.some((group) => group.id === domainGroupId(googleWorkspaceDomain(delegatedEmail)!))
        ).toBe(true)
        expect(groups.every((group) => group.syncedAt && group.syncedAt >= startedAt)).toBe(true)
        expect(fixture.embeddingCalls).toBe(embeddingCalls)
        expect(await search(alice())).toContain(documentId)
        expect(await search(bob())).toEqual([])
        expect(await search(workspaceKey())).toEqual([])
        const [saved] = await db.select().from(document).where(eq(document.id, documentId))
        expect(saved.aclVerifiedAt && saved.aclVerifiedAt >= startedAt).toBe(true)
      },
      120000
    )
  }
)
