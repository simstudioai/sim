/** Opt-in paid provider checks using only explicitly selected local OpenAI/Mistral keys and synthetic content. */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseEnv } from 'node:util'
import { db } from '@sim/db'
import {
  credential,
  credentialGroup,
  document,
  embedding,
  knowledgeConnector,
  knowledgeConnectorMember,
  knowledgeConnectorMemberSyncLog,
  resourcePolicy,
  user,
  workspace,
  workspaceBYOKKeys,
  workspaceFiles,
} from '@sim/db/schema'
import { createLogger, LogLevel } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { PDFDocument } from 'pdf-lib'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const fixtureStorage = vi.hoisted(() => ({ root: '' }))
vi.mock('@/lib/uploads/core/setup.server', () => ({
  get UPLOAD_DIR_SERVER() {
    return fixtureStorage.root
  },
}))

import { resolveBillingAttribution } from '@/lib/billing/core/billing-attribution'
import { env } from '@/lib/core/config/env'
import { encryptSecret } from '@/lib/core/security/encryption'
import { compileCredentialGroupWorkflowAccessPolicy } from '@/lib/credential-groups/application/workflow-access-policy'
import { getCredentialGroupProviderAdapter } from '@/lib/credential-groups/provider-registry'
import { encryptManagedOAuthTokenSet } from '@/lib/credentials/managed-oauth'
import { BYOK_EMBEDDING_CREDENTIAL_REJECTION_MESSAGE } from '@/lib/embeddings'
import {
  seedKnowledgeAclFixture,
  seedKnowledgeMemberFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { syncKnowledgeConnector } from '@/lib/knowledge/application/connectors'
import {
  readKnowledgeDocument,
  updateKnowledgeDocument,
} from '@/lib/knowledge/application/documents'
import { searchKnowledge } from '@/lib/knowledge/application/search'
import { grantKnowledgeConnectorCredentialAccess } from '@/lib/knowledge/connectors/member-access'
import { createContentSyncLease } from '@/lib/knowledge/connectors/sync-lock'
import { addDocument, persistDocumentAcls } from '@/lib/knowledge/connectors/sync-persistence'
import { processDocument } from '@/lib/knowledge/documents/document-processor'
import { processDocumentAsync } from '@/lib/knowledge/documents/service'
import { QUEUED_DISPATCH_GRACE_MS } from '@/lib/knowledge/documents/types'
import { generateEmbeddings } from '@/lib/knowledge/embeddings'
import { runWithKnowledgeModelInputProvenance } from '@/lib/knowledge/model-input-provenance'
import { deleteFile } from '@/lib/uploads/core/storage-service'

const credentialsFile = process.env.KNOWLEDGE_PROVIDER_LIVE_ENV_FILE
const logger = createLogger('KnowledgeLiveRetrievalQuality', {
  enabled: true,
  logLevel: LogLevel.INFO,
})

async function rasterFixture(): Promise<Buffer> {
  return sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="500"><rect width="1600" height="500" fill="white"/><text x="60" y="150" font-size="48" fill="black">Orion release checklist</text><text x="60" y="240" font-size="36" fill="black">Engineers approved the migration plan.</text><text x="60" y="320" font-size="36" fill="black">All operational dependencies are verified.</text></svg>`
    )
  )
    .png()
    .toBuffer()
}

describe.skipIf(!credentialsFile)('real embedding and scanned PDF providers', () => {
  let ids: Awaited<ReturnType<typeof seedKnowledgeAclFixture>>
  const content =
    'Orion release checklist: engineers approved the migration plan and verified the operational dependencies.'
  const prior = {
    OPENAI_API_KEY: env.OPENAI_API_KEY,
    MISTRAL_API_KEY: env.MISTRAL_API_KEY,
    OCR_PROVIDER: env.OCR_PROVIDER,
  }

  beforeAll(async () => {
    fixtureStorage.root = await mkdtemp(path.join(tmpdir(), 'sim-live-provider-storage-'))
    const selected = parseEnv(await readFile(credentialsFile!, 'utf8'))
    if (!selected.OPENAI_API_KEY) {
      throw new Error('Live embedding tests require an explicitly configured OpenAI key')
    }
    Object.assign(env, {
      OPENAI_API_KEY: selected.OPENAI_API_KEY,
      MISTRAL_API_KEY: selected.MISTRAL_API_KEY,
      OCR_PROVIDER: 'mistral',
    })
    ids = await seedKnowledgeAclFixture()
  })

  afterAll(async () => {
    Object.assign(env, prior)
    if (ids) {
      const files = await db
        .select({ key: workspaceFiles.key })
        .from(workspaceFiles)
        .where(eq(workspaceFiles.workspaceId, ids.workspaceId))
      for (const file of files) await deleteFile({ key: file.key, context: 'knowledge-base' })
      await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
      await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
    }
    if (fixtureStorage.root) await rm(fixtureStorage.root, { recursive: true, force: true })
    await db.$client.end()
  })

  it('persists real OpenAI embeddings and retrieves them through the application ACL predicate', async () => {
    const connectorId = generateId()
    const runId = generateId()
    await db.insert(knowledgeConnector).values({
      id: connectorId,
      knowledgeBaseId: ids.knowledgeBaseId,
      connectorType: 'confluence',
      sourceConfig: {},
      accessMode: 'workspace',
      status: 'syncing',
      syncLockToken: runId,
    })
    const created = await addDocument(
      ids.knowledgeBaseId,
      connectorId,
      'confluence',
      {
        externalId: 'live-provider-text',
        title: 'Orion release checklist',
        content,
        contentHash: 'provider-fixture-v1',
        mimeType: 'text/plain',
      },
      { userId: ids.aliceId, workspaceId: ids.workspaceId },
      undefined,
      'workspace',
      createContentSyncLease(connectorId, runId)
    )
    await processDocumentAsync(
      ids.knowledgeBaseId,
      created.documentId,
      created,
      {},
      await resolveBillingAttribution({ actorUserId: ids.aliceId, workspaceId: ids.workspaceId })
    )
    const [stored] = await db
      .select({ status: document.processingStatus, error: document.processingError })
      .from(document)
      .where(eq(document.id, created.documentId))
    expect(stored).toEqual({ status: 'completed', error: null })
    const vectors = await db
      .select({ vector: embedding.embedding })
      .from(embedding)
      .where(eq(embedding.documentId, created.documentId))
    expect(vectors.length).toBeGreaterThan(0)
    expect(vectors[0].vector).toHaveLength(1536)
    expect(vectors[0].vector!.every(Number.isFinite)).toBe(true)
    expect(new Set(vectors[0].vector).size).toBeGreaterThan(100)
    const result = await searchKnowledge.execute({
      principal: {
        kind: 'workspace_api_key',
        workspaceId: ids.workspaceId,
        keyId: 'synthetic-provider-fixture',
      },
      input: {
        workspaceId: ids.workspaceId,
        knowledgeBaseIds: [ids.knowledgeBaseId],
        query: 'Who approved the Orion migration?',
        topK: 3,
      },
    })
    expect(result.results.map((row) => row.documentId)).toContain(created.documentId)
  }, 120000)

  it('recovers unchanged Gmail documents after a real embedding rejection through manual sync', async () => {
    const previous = {
      OPENAI_API_KEY: env.OPENAI_API_KEY,
      GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,
    }
    const fetchProvider = globalThis.fetch
    let rejectedEmbeddingRequests = 0
    let hydratedThreads = 0
    /** Only Gmail HTTP is a fixture. OpenAI receives real requests and returns real errors/vectors. */
    const provider = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input)
      if (url.origin === 'https://api.openai.com') {
        const response = await fetchProvider(input, init)
        if (response.status === 401) rejectedEmbeddingRequests++
        return response
      }
      if (url.origin !== 'https://gmail.googleapis.com') {
        throw new Error(`Unexpected recovery fixture request: ${url.origin}${url.pathname}`)
      }
      if (url.pathname.endsWith('/labels')) return Response.json({ labels: [] })
      if (url.pathname.endsWith('/threads'))
        return Response.json({ threads: [{ id: 'unchanged-recovery-thread' }] })
      expect(url.pathname.endsWith('/threads/unchanged-recovery-thread')).toBe(true)
      const metadata = { id: 'unchanged-recovery-thread', historyId: '100' }
      if (url.searchParams.get('format') === 'minimal') return Response.json(metadata)
      hydratedThreads++
      return Response.json({
        ...metadata,
        messages: [
          {
            id: 'unchanged-recovery-message',
            threadId: metadata.id,
            internalDate: '1700000000000',
            payload: {
              mimeType: 'text/plain',
              headers: [{ name: 'Subject', value: 'Kestrel invoice exception approved' }],
              body: {
                data: Buffer.from(
                  'Morgan Ellis approved net-45 payment terms for the Kestrel invoice. Reference KESTREL-RECOVERY-7477.'
                ).toString('base64url'),
              },
            },
          },
        ],
      })
    })
    try {
      Object.assign(env, {
        GOOGLE_CLIENT_ID: 'gmail-recovery-fixture-client',
        GOOGLE_CLIENT_SECRET: 'gmail-recovery-fixture-secret',
      })
      const fixture = await seedKnowledgeMemberFixture(ids)
      const policy = await getCredentialGroupProviderAdapter('gmail').getPolicy(undefined, {
        workspaceId: ids.workspaceId,
        credentialGroupId: fixture.groupId,
        credentialGroupOptionId: fixture.optionId,
      })
      await db
        .update(credentialGroup)
        .set({
          options: [
            {
              id: fixture.optionId,
              provider: 'gmail',
              label: 'Gmail recovery fixture',
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
      for (const member of fixture.members) {
        await db
          .update(credential)
          .set({
            providerId: 'google-email',
            authorizationAppId: policy.authorizationAppId,
            managedOauthScopeVersion: policy.scopeVersion,
            grantedScopes: policy.requiredScopes,
            encryptedOauthTokenSet: await encryptManagedOAuthTokenSet({
              accessToken: 'gmail-recovery-fixture',
            }),
            accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
          })
          .where(eq(credential.id, member.credentialId))
        await db
          .update(knowledgeConnectorMember)
          .set({
            subjectToken: `s:google-email:fixture-domain:${member.userId}`,
          })
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

      const documents = () =>
        db
          .select()
          .from(document)
          .where(eq(document.connectorId, fixture.connectorId))
          .orderBy(document.id)
      let runCount = 0
      async function manualSync() {
        await syncKnowledgeConnector.execute({
          principal: {
            kind: 'session',
            userId: ids.aliceId,
            sessionId: 'synthetic-indexing-recovery',
          },
          input: {
            assertedWorkspaceId: ids.workspaceId,
            connectorId: fixture.connectorId,
            source: 'ui',
          },
        })
        runCount++
        await expect
          .poll(
            async () => {
              const logs = await db
                .select({ status: knowledgeConnectorMemberSyncLog.status })
                .from(knowledgeConnectorMemberSyncLog)
                .where(eq(knowledgeConnectorMemberSyncLog.connectorId, fixture.connectorId))
              return logs.filter((log) => log.status === 'completed').length
            },
            { timeout: 60000, interval: 100 }
          )
          .toBe(runCount)
      }
      const search = () =>
        searchKnowledge.execute({
          principal: {
            kind: 'session',
            userId: ids.aliceId,
            sessionId: 'synthetic-indexing-recovery',
          },
          input: {
            workspaceId: ids.workspaceId,
            knowledgeBaseIds: [ids.knowledgeBaseId],
            query: 'Who approved the Kestrel invoice payment terms?',
            topK: 3,
          },
        })
      Object.assign(env, { OPENAI_API_KEY: 'sk-synthetic-invalid-indexing-recovery' })
      await manualSync()
      await expect
        .poll(async () => (await documents()).map((row) => row.processingStatus), {
          timeout: 60000,
          interval: 100,
        })
        .toEqual(['failed', 'failed'])
      const failed = await documents()
      expect(rejectedEmbeddingRequests).toBe(2)
      expect(failed.every((row) => row.processingError && row.processingAttempts === 1)).toBe(true)
      expect(
        await db
          .select()
          .from(embedding)
          .where(
            inArray(
              embedding.documentId,
              failed.map((row) => row.id)
            )
          )
      ).toEqual([])
      const hydratedBeforeRecovery = hydratedThreads

      Object.assign(env, { OPENAI_API_KEY: previous.OPENAI_API_KEY })
      expect(
        (await search()).results.filter((row) => failed.some((item) => item.id === row.documentId))
      ).toEqual([])
      await manualSync()
      expect(
        (await documents()).map((row) => ({
          id: row.id,
          hash: row.contentHash,
          status: row.processingStatus,
          attempts: row.processingAttempts,
        }))
      ).toEqual(
        failed.map((row) => ({ id: row.id, hash: row.contentHash, status: 'failed', attempts: 1 }))
      )

      /** Age only this fixture's document lifecycle timestamps, preserving their order and the unchanged content. */
      const elapsedGraceMs = QUEUED_DISPATCH_GRACE_MS + 1000
      for (const row of failed) {
        const age = (value: Date | null) => value && new Date(value.getTime() - elapsedGraceMs)
        await db
          .update(document)
          .set({
            uploadedAt: age(row.uploadedAt)!,
            processingQueuedAt: age(row.processingQueuedAt),
            processingStartedAt: age(row.processingStartedAt),
            processingCompletedAt: age(row.processingCompletedAt),
          })
          .where(eq(document.id, row.id))
      }
      await manualSync()
      await expect
        .poll(async () => (await documents()).map((row) => row.processingStatus), {
          timeout: 60000,
          interval: 100,
        })
        .toEqual(['completed', 'completed'])
      const recovered = await documents()
      expect(
        recovered.map((row) => ({
          id: row.id,
          externalId: row.externalId,
          hash: row.contentHash,
          storageKey: row.storageKey,
        }))
      ).toEqual(
        failed.map((row) => ({
          id: row.id,
          externalId: row.externalId,
          hash: row.contentHash,
          storageKey: row.storageKey,
        }))
      )
      expect(
        recovered.every((row) => row.processingError === null && row.processingAttempts === 0)
      ).toBe(true)
      expect(hydratedThreads).toBe(hydratedBeforeRecovery)
      const vectors = await db
        .select()
        .from(embedding)
        .where(
          inArray(
            embedding.documentId,
            recovered.map((row) => row.id)
          )
        )
      expect(vectors).toHaveLength(2)
      expect(
        vectors.every(
          (row) => row.embedding?.length === 1536 && row.embedding.every(Number.isFinite)
        )
      ).toBe(true)
      const aliceDocument = recovered.find((row) =>
        row.externalId?.startsWith(`member:${fixture.members[0].id}:`)
      )!
      const bobDocument = recovered.find((row) => row.id !== aliceDocument.id)!
      const results = await search()
      expect(results.results[0]?.documentId).toBe(aliceDocument.id)
      expect(results.results.some((row) => row.documentId === bobDocument.id)).toBe(false)
      logger.info('Real OpenAI indexing recovery through unchanged-source manual sync', {
        rejectedEmbeddingRequests,
        retryGraceMs: QUEUED_DISPATCH_GRACE_MS,
        fixtureLifecycleTimestampsAged: true,
        completedDocuments: recovered.length,
        sourceContentUnchanged: true,
        documentIdsAndStorageUnchanged: true,
        authorizedDocumentRank: 1,
        peerDocumentExcluded: true,
      })
    } finally {
      Object.assign(env, previous)
      provider.mockRestore()
    }
  }, 180000)

  it('recovers a terminal workspace-key rejection through the authorized document retry', async () => {
    const keyId = generateId()
    const externalId = 'workspace-key-retry-fixture'
    const originalPlatformKey = env.OPENAI_API_KEY
    const invalidKey = 'sk-synthetic-invalid-workspace-retry'
    let expectedKey = invalidKey
    const responseStatuses: number[] = []
    const fetchProvider = globalThis.fetch
    /** Observe real OpenAI requests without substituting a provider response or exposing key material. */
    const provider = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input)
      expect(url.origin === 'https://api.openai.com').toBe(true)
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : {}))
      expect(headers.get('authorization') === `Bearer ${expectedKey}`).toBe(true)
      const response = await fetchProvider(input, init)
      responseStatuses.push(response.status)
      return response
    })
    try {
      await db.insert(workspaceBYOKKeys).values({
        id: keyId,
        workspaceId: ids.workspaceId,
        providerId: 'openai',
        encryptedApiKey: (await encryptSecret(invalidKey)).encrypted,
        createdBy: ids.aliceId,
      })
      const created = await addDocument(
        ids.knowledgeBaseId,
        ids.connectorId,
        'confluence',
        {
          externalId,
          title: 'Juniper workspace key retry approval',
          content:
            'Sasha Chen approved the Juniper archive retention exception. Reference JUNIPER-BYOK-RETRY-7477.',
          contentHash: 'workspace-key-retry-v1',
          mimeType: 'text/plain',
        },
        { userId: ids.aliceId, workspaceId: ids.workspaceId },
        undefined,
        'admin',
        createContentSyncLease(ids.connectorId, ids.lockId)
      )
      await persistDocumentAcls(
        ids.connectorId,
        new Map([[externalId, [`u:${ids.aliceId}@fixture.test`]]])
      )
      const savedDocument = async () => {
        const [saved] = await db.select().from(document).where(eq(document.id, created.documentId))
        return saved
      }
      await expect(
        processDocumentAsync(
          ids.knowledgeBaseId,
          created.documentId,
          created,
          {},
          await resolveBillingAttribution({
            actorUserId: ids.aliceId,
            workspaceId: ids.workspaceId,
          })
        )
      ).rejects.toMatchObject({ status: 401, isBYOK: true })
      const failed = await savedDocument()
      expect(responseStatuses).toEqual([401])
      expect(failed).toMatchObject({
        processingStatus: 'failed',
        processingError: BYOK_EMBEDDING_CREDENTIAL_REJECTION_MESSAGE,
        processingDeferredUntil: null,
      })
      expect(
        await db.select().from(embedding).where(eq(embedding.documentId, created.documentId))
      ).toEqual([])

      expectedKey = originalPlatformKey!
      await db
        .update(workspaceBYOKKeys)
        .set({ encryptedApiKey: (await encryptSecret(expectedKey)).encrypted })
        .where(eq(workspaceBYOKKeys.id, keyId))
      /** A working platform fallback cannot mask whether the replaced workspace key is used. */
      Object.assign(env, { OPENAI_API_KEY: 'sk-synthetic-blocked-platform-fallback' })
      const principal = {
        kind: 'session' as const,
        userId: ids.aliceId,
        sessionId: 'synthetic-workspace-key-retry',
      }
      const input = {
        assertedWorkspaceId: ids.workspaceId,
        knowledgeBaseId: ids.knowledgeBaseId,
        documentId: created.documentId,
        retryProcessing: true,
        source: 'ui',
      }
      await expect(
        updateKnowledgeDocument.execute({
          principal: { ...principal, userId: ids.bobId },
          input,
        })
      ).rejects.toMatchObject({ code: 'not_found' })
      expect(responseStatuses).toEqual([401])
      const retry = await updateKnowledgeDocument.execute({ principal, input })
      expect(retry).toMatchObject({ kind: 'processing', documentId: created.documentId })
      await expect
        .poll(async () => (await savedDocument()).processingStatus, {
          timeout: 60000,
          interval: 100,
        })
        .toBe('completed')
      const recovered = await savedDocument()
      expect(recovered).toMatchObject({
        id: failed.id,
        externalId: failed.externalId,
        contentHash: failed.contentHash,
        storageKey: failed.storageKey,
        acl: failed.acl,
        processingError: null,
        processingDeferredUntil: null,
      })
      expect(responseStatuses).toEqual([401, 200])
      const vectors = await db
        .select()
        .from(embedding)
        .where(eq(embedding.documentId, created.documentId))
      expect(vectors).toHaveLength(1)
      expect(vectors[0].embedding).toHaveLength(1536)
      expect(vectors[0].embedding!.every(Number.isFinite)).toBe(true)
      const result = await searchKnowledge.execute({
        principal,
        input: {
          workspaceId: ids.workspaceId,
          knowledgeBaseIds: [ids.knowledgeBaseId],
          query: 'JUNIPER-BYOK-RETRY-7477',
          topK: 3,
        },
      })
      expect(result.results[0]?.documentId).toBe(created.documentId)
      for (const deniedPrincipal of [
        { ...principal, userId: ids.bobId },
        { kind: 'workspace_api_key' as const, workspaceId: ids.workspaceId, keyId: 'fixture' },
      ]) {
        await expect(
          readKnowledgeDocument.execute({ principal: deniedPrincipal, input })
        ).rejects.toMatchObject({ code: 'not_found' })
      }
      logger.info('Real OpenAI workspace-key rejection recovered through document Retry', {
        initialStatus: 401,
        terminalFailureMessage: BYOK_EMBEDDING_CREDENTIAL_REJECTION_MESSAGE,
        workspaceKeyStoredAndReplaced: true,
        platformFallbackBlockedDuringRetry: true,
        retryUsedAuthorizedApplicationOperation: true,
        lifecycleTimestampsAged: false,
        documentIdContentStorageAndAclUnchanged: true,
        authorizedDocumentRank: 1,
        peerAndActorlessDirectReadsDenied: true,
      })
    } finally {
      Object.assign(env, { OPENAI_API_KEY: originalPlatformKey })
      provider.mockRestore()
      await db.delete(workspaceBYOKKeys).where(eq(workspaceBYOKKeys.id, keyId))
    }
  }, 120000)

  it('ranks synthetic integration documents with real OpenAI embeddings and excludes private source content', async () => {
    const corpus = [
      {
        key: 'gmail-renewal',
        title: 'Bluebird renewal — approved net-60 payment terms',
        content: `Subject: Bluebird annual subscription renewal
From: procurement@example.com
Date: October 1, 2026
Alex: Can we extend payment terms on the Bluebird annual subscription invoice?
Priya Shah: Approved. Use net-60 instead of net-30 for this renewal. I am the approver for the purchasing exception. The revised quote expires October 15.`,
      },
      {
        key: 'gmail-security',
        title: 'Bluebird renewal — security questionnaire',
        content: `Subject: Bluebird renewal security review
From: security@example.com
The Bluebird annual subscription renewal requires a vendor security questionnaire. Marcus is reviewing SOC 2 certification, encryption at rest, and incident response. This conversation tracks the security assessment.`,
      },
      {
        key: 'jira-duplicate',
        title: 'PAY-4821: Duplicate invoices after webhook retries',
        content: `Issue: PAY-4821
Type: Bug
Status: In Progress
Assignee: Lena Ortiz
Project: Payments
Repeated delivery of a payment callback creates duplicate invoices. Deduplicate webhook events by their provider event ID before invoice generation. Acceptance: retrying the same callback must create one invoice. The idempotency fix is scheduled for the next patch release.`,
      },
      {
        key: 'jira-latency',
        title: 'PAY-4812: Invoice dashboard loads slowly',
        content: `Issue: PAY-4812
Type: Performance bug
Status: Open
The invoice dashboard takes eight seconds to show historical billing records. Add pagination and an index on customer_id to improve dashboard loading. This issue does not change payment callback handling.`,
      },
      {
        key: 'github-idempotency',
        title: 'billing-service/src/webhooks/idempotency.ts',
        content: `Repository: billing-service
Path: src/webhooks/idempotency.ts
The payment webhook handler calls reserveWebhookEvent before processing an event. This function records each processed event ID in Postgres. A duplicate insert returns false and prevents repeated callback execution.
export async function reserveWebhookEvent(eventId: string): Promise<boolean> {
  const result = await db.query('INSERT INTO processed_events (event_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING event_id', [eventId]);
  return result.rowCount === 1;
}`,
      },
      {
        key: 'github-client',
        title: 'billing-client/README.md — network retry configuration',
        content: `Repository: billing-client
Path: README.md
The HTTP client retries connection failures with exponential backoff. Configure maxRetries and requestTimeoutMs for invoice API requests. The client-side retry policy handles transient network outages; webhook server persistence is implemented in billing-service.`,
      },
      {
        key: 'calendar-rehearsal',
        title: 'Vega EU cutover rehearsal',
        content: `Event: Vega EU cutover rehearsal
Start: Thursday, October 8, 2026 at 10:00 UTC
End: Thursday, October 8, 2026 at 11:00 UTC
Organizer: Platform Engineering
Location: Room C
Description: Practice switching the European production database to its standby before the Vega launch. Review failover commands and rollback steps. This is a rehearsal, not the production migration.`,
      },
      {
        key: 'calendar-review',
        title: 'Vega US capacity review',
        content: `Event: Vega US capacity review
Start: Thursday, October 15, 2026 at 16:00 UTC
Location: Room A
Description: Review North American database storage growth and capacity forecasts. Finance and platform teams will compare infrastructure costs for next quarter.`,
      },
      {
        key: 'gmail-export',
        title: 'Larch customer archive — CSV delivery decision',
        content: `Subject: Larch data export request
From: customer-success@example.com
Customer Larch needs an offline archive of their account before the end of the quarter. Daniel Wu approved a CSV export, encrypted with the customer-provided public key, delivered through their SFTP server. Delivery is due October 22. Do not send the archive as an email attachment.`,
      },
      {
        key: 'jira-export-ui',
        title: 'DATA-731: Larch export button progress indicator',
        content: `Issue: DATA-731
The Larch export button should display a progress spinner while the export job runs. This frontend issue adds polling and a completion toast. It does not decide the archive file format, encryption, delivery channel, or customer deadline.`,
      },
      {
        key: 'gmail-retention',
        title: 'Aster audit records — retention exception approved',
        content: `Subject: Aster audit-log retention exception
From: compliance@example.com
Nadia Brooks approved keeping Aster audit records for 400 days instead of the standard 90. The exception applies only to audit-log metadata, not message bodies. Legal will review the exception next April.`,
      },
      {
        key: 'github-retention',
        title: 'audit-service/README.md — standard retention configuration',
        content: `Repository: audit-service
The default audit-log retention is 90 days. Set AUDIT_RETENTION_DAYS to change the deployment default. Customer-specific exceptions require a compliance approval recorded separately. Aster is mentioned in the integration-test fixtures but the fixture is not an approved policy.`,
      },
      {
        key: 'gmail-incident',
        title: 'Juniper outage follow-up — customer notification owner',
        content: `Subject: Juniper outage customer follow-up
From: incident-command@example.com
The Juniper ingestion outage has ended. Elena Park will send affected customers the incident summary by 17:00 UTC on October 12. The message must explain that delayed records have been replayed and no records were lost. Infrastructure remediation is tracked separately.`,
      },
      {
        key: 'calendar-incident',
        title: 'Juniper incident retrospective',
        content: `Event: Juniper incident retrospective
Start: October 14, 2026 at 15:00 UTC
Location: Video room J
Review the ingestion outage timeline and infrastructure remediation. This internal retrospective occurs after customer notifications and does not assign the person sending them.`,
      },
      {
        key: 'jira-session',
        title: 'AUTH-2196: Signing out leaves a usable session cookie',
        content: `Issue: AUTH-2196
Type: Security bug
Assignee: Mateo Cruz
After a user signs out, replaying their old session cookie still grants access. Invalidate the server-side session row on logout. Acceptance: the same cookie must receive HTTP 401 after logout, including on a second browser tab.`,
      },
      {
        key: 'gmail-session',
        title: 'Sign-in copy review and expired-session messaging',
        content: `Subject: Sign-in screen wording
Product design is revising the message shown when a session expires naturally after inactivity. This review is about the login page text, not invalidating sessions when a person actively signs out.`,
      },
      {
        key: 'jira-accessibility',
        title: 'UI-6402: Keyboard focus escapes the source setup dialog',
        content: `Issue: UI-6402
Type: Accessibility bug
Assignee: Imani Reed
When the source setup dialog is open, pressing Tab reaches controls behind the modal. Keep keyboard focus inside the dialog; Escape closes it and returns focus to the original Add source button. Screen-reader labels must remain intact.`,
      },
      {
        key: 'calendar-accessibility',
        title: 'Source setup visual design review',
        content: `Event: Source setup visual design review
The designer will review the source dialog button spacing, typography, and empty-state illustrations. Focus trapping and keyboard navigation are tracked in the accessibility backlog. This calendar invite is not the implementation ticket.`,
      },
      {
        key: 'jira-calendar-dst',
        title: 'CAL-3188: Recurring meetings shift after daylight saving',
        content: `Issue: CAL-3188
Assignee: Theo Martin
Weekly meetings created at 09:00 Europe/London move an hour after the daylight-saving transition. Preserve the IANA time-zone identifier when expanding recurring events. Acceptance: local wall-clock start stays at nine in the morning across the clock change.`,
      },
      {
        key: 'github-calendar-format',
        title: 'calendar-ui/src/format-time.ts — event display formatting',
        content: `Repository: calendar-ui
Path: src/format-time.ts
formatEventTime chooses a user's twelve-hour or twenty-four-hour clock presentation. It accepts already expanded occurrence timestamps. It does not calculate recurring occurrences or fix daylight-saving expansion.`,
      },
      {
        key: 'github-signature',
        title: 'gateway/src/security/verify-signature.ts',
        content: `Repository: gateway
Path: src/security/verify-signature.ts
verifyDeliverySignature computes an HMAC SHA-256 digest over the raw webhook request bytes and compares it with the supplied signature using timingSafeEqual. Reject invalid signatures before JSON parsing or event dispatch. The shared signing secret comes from the credential resolver, never the payload.`,
      },
      {
        key: 'jira-signature-ui',
        title: 'WEB-1882: Show webhook signature failures on the deliveries page',
        content: `Issue: WEB-1882
The deliveries page should display signature-verification failures with a helpful error message and timestamp. This UI ticket reads the error recorded by gateway. The cryptographic verification function already exists in the gateway security code.`,
      },
      {
        key: 'github-rollback',
        title: 'deploy/runbooks/restore-release.md — Finch rollback',
        content: `Repository: deploy
Path: runbooks/restore-release.md
For the Finch deployment, run restoreFinchRelease to disable the new-checkout flag, restore the previous container image digest, and verify the /healthz endpoint. Do not reverse the additive database migration. Escalate if error rates remain above the rollback threshold.`,
      },
      {
        key: 'gmail-rollback',
        title: 'Finch launch announcement draft',
        content: `Subject: Finch launch announcement
Marketing is preparing the Finch release announcement. The draft describes faster checkout and a refreshed purchase confirmation screen. If engineering rolls the deployment back, delay publication; engineering's rollback commands are documented in the deployment repository.`,
      },
      {
        key: 'github-pagination',
        title: 'directory/src/paging/cursor.ts',
        content: `Repository: directory
Path: src/paging/cursor.ts
encodeDirectoryCursor serializes the last seen created_at and id tuple into an opaque cursor. The next page uses a strict tuple comparison, ordered by created_at then id, so equal timestamps do not duplicate or skip directory entries. Do not use an offset against a changing directory.`,
      },
      {
        key: 'jira-pagination',
        title: 'DIR-770: Directory table pagination button alignment',
        content: `Issue: DIR-770
Align the Previous and Next buttons under the directory table and show the current page label. This layout issue does not implement the opaque cursor encoding or database ordering used by the directory service.`,
      },
      {
        key: 'calendar-rotation',
        title: 'Cobalt signing-key rotation rehearsal',
        content: `Event: Cobalt signing-key rotation rehearsal
Start: Tuesday, October 20, 2026 at 14:00 UTC
Location: Security room B
Organizer: Security Engineering
Practice publishing the new signing key, running both public keys during the overlap period, and retiring the old key. This is a sandbox rehearsal. Bring the key-rotation checklist.`,
      },
      {
        key: 'gmail-rotation',
        title: 'Cobalt key inventory review',
        content: `Subject: Cobalt signing-key inventory
Security is collecting the list of services that verify Cobalt signatures. Reply with each service owner and its key cache lifetime. The signing-key rotation rehearsal has a separate calendar invitation with the meeting time and room.`,
      },
      {
        key: 'calendar-workshop',
        title: 'Larch customer archive handoff workshop',
        content: `Event: Larch customer archive handoff workshop
Start: Wednesday, October 21, 2026 at 09:30 UTC
Location: Customer lab 2
Description: Customer success and data engineering will verify that Larch can decrypt the archive and connect to the SFTP delivery host. Bring a test public key. The workshop occurs before the archive delivery deadline.`,
      },
      {
        key: 'github-sftp',
        title: 'archive-worker/docs/sftp-delivery.md',
        content: `Repository: archive-worker
Path: docs/sftp-delivery.md
Archive delivery uploads encrypted files to the configured SFTP host. Set the remote directory and use the customer public key for encryption. This implementation guide includes Larch as a synthetic test tenant; it does not schedule the customer handoff workshop.`,
      },
      {
        key: 'calendar-freeze',
        title: 'Aster production change freeze approval',
        content: `Event: Aster production change freeze approval
Start: Friday, October 23, 2026 at 16:30 UTC
Location: Operations bridge
Description: Release managers will decide whether to freeze Aster production changes for the annual audit. Bring the open-change list and the audit readiness checklist. This meeting concerns release scheduling, not the audit-log retention exception.`,
      },
      {
        key: 'jira-freeze',
        title: 'OPS-909: Add the Aster change-freeze banner',
        content: `Issue: OPS-909
Show a banner in the deployment UI while an Aster production change freeze is active. The release managers decide when the freeze starts in their approval meeting. This ticket implements the banner and does not schedule that meeting.`,
      },
      {
        key: 'private-bluebird',
        title: 'PRIVATE-BB-916 Bluebird confidential settlement',
        content: `PRIVATE-BB-916. A confidential Bluebird settlement uses net-120 payment terms approved by Morgan Stone. This is a restricted legal settlement, not the public annual subscription renewal approved on net-60 terms. Only Alice may see this synthetic record.`,
      },
      {
        key: 'private-auth',
        title: 'PRIVATE-AUTH-228 signing out session exploit details',
        content: `PRIVATE-AUTH-228 is a restricted incident report about exploiting a session cookie after logout. It records a confidential customer incident, separate from the shared AUTH-2196 implementation ticket. The incident handler is Casey Hall. Only Alice may see this synthetic record.`,
      },
      {
        key: 'private-finance',
        title: 'PRIVATE-VEGA-540 confidential Vega acquisition meeting',
        content: `PRIVATE-VEGA-540. A confidential Vega acquisition negotiation meets on October 8 at 10:00 UTC in Finance room D. This meeting is unrelated to the shared European database switchover rehearsal. Only Alice may see this synthetic record.`,
      },
      {
        key: 'private-acquisition',
        title: 'INTERNAL-RAVEN-973 confidential acquisition closing plan',
        content: `INTERNAL-RAVEN-973 is the confidential acquisition closing plan. The Raven acquisition signing is scheduled for November 9. The legal team must complete the restricted merger checklist before the signing meeting. This synthetic document is available only to Alice.`,
      },
    ] as const
    const billing = await resolveBillingAttribution({
      actorUserId: ids.aliceId,
      workspaceId: ids.workspaceId,
    })
    const documentIds = new Map<string, string>()
    const acls = new Map<string, string[]>()
    for (const item of corpus) {
      const externalId = `quality-${item.key}`
      const created = await addDocument(
        ids.knowledgeBaseId,
        ids.connectorId,
        'confluence',
        {
          externalId,
          title: item.title,
          content: item.content,
          contentHash: externalId,
          mimeType: 'text/plain',
        },
        { userId: ids.aliceId, workspaceId: ids.workspaceId },
        undefined,
        'admin',
        createContentSyncLease(ids.connectorId, ids.lockId)
      )
      documentIds.set(item.key, created.documentId)
      await db
        .update(document)
        .set({ tag1: 'retrieval-quality' })
        .where(eq(document.id, created.documentId))
      await processDocumentAsync(ids.knowledgeBaseId, created.documentId, created, {}, billing)
      acls.set(
        externalId,
        item.key.startsWith('private-')
          ? [`u:${ids.aliceId}@fixture.test`]
          : [`u:${ids.aliceId}@fixture.test`, `u:${ids.bobId}@fixture.test`]
      )
    }
    expect(await persistDocumentAcls(ids.connectorId, acls)).toEqual({
      updated: corpus.length,
      rejected: 0,
    })
    const stored = await db
      .select({
        id: document.id,
        status: document.processingStatus,
        error: document.processingError,
      })
      .from(document)
      .where(inArray(document.id, [...documentIds.values()]))
    expect(stored).toHaveLength(corpus.length)
    expect(stored.every((row) => row.status === 'completed' && row.error === null)).toBe(true)
    const vectors = await db
      .select({ vector: embedding.embedding })
      .from(embedding)
      .where(inArray(embedding.documentId, [...documentIds.values()]))
    expect(vectors.length).toBeGreaterThanOrEqual(corpus.length)
    expect(
      vectors.every(
        (row) =>
          row.vector?.length === 1536 &&
          row.vector.every(Number.isFinite) &&
          new Set(row.vector).size > 100
      )
    ).toBe(true)

    const queries = [
      {
        key: 'gmail-renewal',
        mode: 'vector',
        maxRank: 3,
        query:
          'Who approved paying the Bluebird subscription invoice two months after it is issued?',
      },
      {
        key: 'jira-duplicate',
        mode: 'vector',
        maxRank: 3,
        query:
          'Which bug ticket addresses invoices being generated twice when the payment notification is delivered again?',
      },
      {
        key: 'github-idempotency',
        mode: 'vector',
        maxRank: 3,
        query:
          'Where in the repository does the payment callback handler remember event identifiers so the same notification is only processed once?',
      },
      {
        key: 'calendar-rehearsal',
        mode: 'vector',
        maxRank: 3,
        query:
          'When is the practice switchover for the European database and where are we meeting?',
      },
      { key: 'gmail-renewal', mode: 'hybrid', maxRank: 1, query: 'Bluebird net-60 payment terms' },
      { key: 'jira-duplicate', mode: 'hybrid', maxRank: 1, query: 'PAY-4821' },
      { key: 'github-idempotency', mode: 'hybrid', maxRank: 1, query: 'reserveWebhookEvent' },
      { key: 'calendar-rehearsal', mode: 'hybrid', maxRank: 1, query: 'Vega EU cutover rehearsal' },
      {
        key: 'gmail-export',
        mode: 'vector',
        maxRank: 3,
        query: 'Who signed off on the Larch archive delivery format and how should we send it?',
      },
      {
        key: 'gmail-retention',
        mode: 'vector',
        maxRank: 3,
        query:
          'Who allowed Aster to keep its audit history longer than three months, and for how long?',
      },
      {
        key: 'gmail-incident',
        mode: 'vector',
        maxRank: 3,
        query:
          'Who will tell Juniper customers that the delayed ingestion records have been recovered?',
      },
      {
        key: 'jira-session',
        mode: 'vector',
        maxRank: 3,
        query:
          'Which security ticket makes an old browser cookie stop working after the user logs out?',
      },
      {
        key: 'jira-accessibility',
        mode: 'vector',
        maxRank: 3,
        query:
          'Find the bug for keyboard navigation reaching the page behind the add-source popup.',
      },
      {
        key: 'jira-calendar-dst',
        mode: 'vector',
        maxRank: 3,
        query:
          'Which issue keeps weekly London meetings at the same local hour when the clocks change?',
      },
      {
        key: 'github-signature',
        mode: 'vector',
        maxRank: 3,
        query:
          'Where is the function that checks a webhook message really came from its sender before decoding JSON?',
      },
      {
        key: 'github-rollback',
        mode: 'vector',
        maxRank: 3,
        query:
          'Find the engineering runbook for undoing the Finch rollout while leaving its database migration in place.',
      },
      {
        key: 'github-pagination',
        mode: 'vector',
        maxRank: 3,
        query:
          'Which code builds directory page tokens so rows with identical creation times are neither repeated nor missed?',
      },
      {
        key: 'calendar-rotation',
        mode: 'vector',
        maxRank: 3,
        query: 'When and where are we practicing replacement of the Cobalt signing key?',
      },
      {
        key: 'calendar-workshop',
        mode: 'vector',
        maxRank: 3,
        query: 'Where is the session for checking that Larch can decrypt and download its archive?',
      },
      {
        key: 'calendar-freeze',
        mode: 'vector',
        maxRank: 3,
        query:
          'When do release managers meet to decide whether Aster deployments should stop during the audit?',
      },
      { key: 'gmail-export', mode: 'hybrid', maxRank: 1, query: 'Larch CSV delivery decision' },
      { key: 'gmail-retention', mode: 'hybrid', maxRank: 1, query: 'Aster retention 400 days' },
      { key: 'gmail-incident', mode: 'hybrid', maxRank: 1, query: 'Juniper Elena Park 17:00' },
      { key: 'jira-session', mode: 'hybrid', maxRank: 1, query: 'AUTH-2196' },
      { key: 'jira-accessibility', mode: 'hybrid', maxRank: 1, query: 'UI-6402' },
      { key: 'jira-calendar-dst', mode: 'hybrid', maxRank: 1, query: 'CAL-3188' },
      { key: 'github-signature', mode: 'hybrid', maxRank: 1, query: 'verifyDeliverySignature' },
      { key: 'github-rollback', mode: 'hybrid', maxRank: 1, query: 'restoreFinchRelease' },
      { key: 'github-pagination', mode: 'hybrid', maxRank: 1, query: 'encodeDirectoryCursor' },
      {
        key: 'calendar-rotation',
        mode: 'hybrid',
        maxRank: 1,
        query: 'Cobalt signing-key rotation rehearsal',
      },
      {
        key: 'calendar-workshop',
        mode: 'hybrid',
        maxRank: 1,
        query: 'Larch archive handoff workshop',
      },
      {
        key: 'calendar-freeze',
        mode: 'hybrid',
        maxRank: 1,
        query: 'Aster production change freeze approval',
      },
    ] as const
    const search = async (query: string, searchMode: 'vector' | 'hybrid', userId = ids.bobId) =>
      searchKnowledge.execute({
        principal: { kind: 'session', userId, sessionId: 'synthetic-retrieval-quality' },
        input: {
          workspaceId: ids.workspaceId,
          knowledgeBaseIds: [ids.knowledgeBaseId],
          query,
          searchMode,
          topK: 10,
          rerankerEnabled: false,
          tagFilters: [{ tagName: 'Fixture', operator: 'eq', value: 'retrieval-quality' }],
        },
      })
    const keysByDocumentId = new Map([...documentIds].map(([key, id]) => [id, key]))
    const privateItems = corpus.filter((item) => item.key.startsWith('private-'))
    const privateIds = privateItems.map((item) => documentIds.get(item.key)!)
    const observations: {
      key: string
      mode: string
      query: string
      rank: number | null
      top3: { key: string | undefined; similarity: number }[]
    }[] = []
    for (const item of queries) {
      const result = await search(item.query, item.mode)
      const rankedIds = [...new Set(result.results.map((row) => row.documentId))]
      const rank = rankedIds.indexOf(documentIds.get(item.key)!) + 1
      observations.push({
        key: item.key,
        mode: item.mode,
        query: item.query,
        rank: rank || null,
        top3: rankedIds.slice(0, 3).map((id) => ({
          key: keysByDocumentId.get(id),
          similarity: result.results.find((row) => row.documentId === id)!.similarity,
        })),
      })
      expect(rankedIds.filter((id) => privateIds.includes(id))).toEqual([])
      expect.soft(rank, `${item.mode}: ${item.query}`).toBeGreaterThan(0)
      expect.soft(rank, `${item.mode}: ${item.query}`).toBeLessThanOrEqual(item.maxRank)
    }
    for (const item of privateItems) {
      for (const mode of ['vector', 'hybrid'] as const) {
        const blocked = await search(item.title, mode)
        expect(blocked.results.filter((row) => privateIds.includes(row.documentId))).toEqual([])
        const allowed = await search(item.title, mode, ids.aliceId)
        expect
          .soft(allowed.results[0]?.documentId, `${mode}: ${item.key}`)
          .toBe(documentIds.get(item.key))
      }
    }
    const negativeObservations = []
    /** Retrieval is not an answerability classifier; record false-positive candidates without inventing an empty-result guarantee. */
    for (const query of [
      'What is the recipe and baking temperature for sourdough rye bread?',
      'Who won the 1986 football World Cup final and what was the score?',
      'How many moons orbit the planet Neptune?',
      'ZEBRA-UNKNOWN-990017 nonexistent project record',
    ]) {
      for (const mode of ['vector', 'hybrid'] as const) {
        const result = await search(query, mode)
        expect(result.results.filter((row) => privateIds.includes(row.documentId))).toEqual([])
        negativeObservations.push({
          query,
          mode,
          returnedDocuments: new Set(result.results.map((row) => row.documentId)).size,
          top3: result.results.slice(0, 3).map((row) => ({
            key: keysByDocumentId.get(row.documentId),
            similarity: row.similarity,
          })),
        })
      }
    }
    const report = {
      embeddingModel: 'text-embedding-3-small',
      corpusDocuments: corpus.length,
      privateDocuments: privateItems.length,
      publicQueries: observations.length,
      top1: observations.filter((row) => row.rank === 1).length,
      top3: observations.filter((row) => row.rank !== null && row.rank <= 3).length,
      precisionAt1: observations.filter((row) => row.rank === 1).length / observations.length,
      meanReciprocalRankAt10:
        observations.reduce((sum, row) => sum + (row.rank ? 1 / row.rank : 0), 0) /
        observations.length,
      observations,
      negativeObservations,
      privateDocumentExcludedInBothModes: true,
    }
    logger.info('Expanded synthetic integration retrieval benchmark', report)
  }, 180000)

  it('extracts a raster-only PDF through Mistral and embeds the recovered text', async () => {
    if (!env.MISTRAL_API_KEY)
      throw new Error('Live OCR tests require an explicitly configured Mistral key')
    const png = await rasterFixture()
    const pdf = await PDFDocument.create()
    const image = await pdf.embedPng(png)
    pdf.addPage([800, 250]).drawImage(image, { x: 0, y: 0, width: 800, height: 250 })
    const fileUrl = `data:application/pdf;base64,${Buffer.from(await pdf.save()).toString('base64')}`
    const result = await runWithKnowledgeModelInputProvenance(
      undefined,
      () =>
        processDocument(
          fileUrl,
          'synthetic-scanned-checklist.pdf',
          'application/pdf',
          1024,
          0,
          1,
          { userId: ids.aliceId },
          ids.workspaceId
        ),
      { opaqueInputSafe: true }
    )
    expect(result.metadata.processingMethod).toBe('mistral-ocr')
    expect(result.chunks.map((chunk) => chunk.text).join('\n')).toMatch(/Orion release checklist/i)
    const embedded = await generateEmbeddings(
      result.chunks.map((chunk) => chunk.text),
      { model: 'text-embedding-3-small', dimensions: 1536 },
      ids.workspaceId
    )
    expect(embedded.embeddings).toHaveLength(result.chunks.length)
    expect(embedded.embeddings[0]).toHaveLength(1536)
  }, 120000)
  it('extracts a PNG image through the real Mistral image endpoint', async () => {
    if (!env.MISTRAL_API_KEY)
      throw new Error('Live OCR tests require an explicitly configured Mistral key')
    const bytes = await rasterFixture()
    const result = await runWithKnowledgeModelInputProvenance(
      undefined,
      () =>
        processDocument(
          `data:image/png;base64,${bytes.toString('base64')}`,
          'synthetic-checklist.png',
          'image/png',
          1024,
          0,
          1,
          { userId: ids.aliceId },
          ids.workspaceId
        ),
      { opaqueInputSafe: true }
    )
    expect(result.metadata.processingMethod).toBe('mistral-ocr')
    expect(result.chunks.map((chunk) => chunk.text).join('\n')).toMatch(/Orion release checklist/i)
  }, 120000)
})
