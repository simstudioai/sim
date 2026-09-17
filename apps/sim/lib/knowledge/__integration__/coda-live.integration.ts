/**
 * Opt-in test of real Coda, credential resolution, admin setup, storage, indexing,
 * and application authorization. Only embeddings are substituted. Run with
 * CODA_CONNECTOR_LIVE_TOKEN_FILE and CODA_CONNECTOR_LIVE_FIXTURE_FILE produced by
 * connectors/coda/coda.live.test.ts, plus CODA_CONNECTOR_LIVE_SECOND_EMAIL.
 * Only the disposable fixture's sharing is changed; notifications are suppressed.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  credential,
  document,
  knowledgeBase,
  knowledgeConnector,
  member,
  organization,
  session,
  user,
  workspace,
} from '@sim/db/schema'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { serializeSignedCookie } from 'better-call'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

const metrics = vi.hoisted(() => ({ embeddingCalls: 0 }))
vi.mock('@/lib/embeddings', async () => ({
  ...(await import('@/lib/embeddings/client')),
  assertKnowledgeEmbeddingCapacity: async () => {},
  embedKnowledge: async (texts: string[]) => {
    metrics.embeddingCalls++
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

import {
  resolveBillingAttribution,
  resolveOrganizationBillingAttribution,
} from '@/lib/billing/core/billing-attribution'
import { encryptSecret } from '@/lib/core/security/encryption'
import { createOrganizationCredential } from '@/lib/credentials/application/organization-credentials'
import { seedKnowledgeAclFixture } from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { listKnowledgeChunks } from '@/lib/knowledge/application/chunks'
import { createKnowledgeConnector } from '@/lib/knowledge/application/connectors'
import { readKnowledgeDocument } from '@/lib/knowledge/application/documents'
import { searchKnowledge } from '@/lib/knowledge/application/search'
import { executeSync } from '@/lib/knowledge/connectors/sync-engine'
import { deleteFile } from '@/lib/uploads/core/storage-service'
import { codaJson } from '@/connectors/coda/client'
import { readCodaDocAcl } from '@/connectors/coda/permissions'
import { buildCodaUrl, codaDocPath, codaHeaders } from '@/tools/coda/utils'

const tokenPath = process.env.CODA_CONNECTOR_LIVE_TOKEN_FILE
const fixturePath = process.env.CODA_CONNECTOR_LIVE_FIXTURE_FILE
const secondEmail = process.env.CODA_CONNECTOR_LIVE_SECOND_EMAIL
const allowSharing = process.env.CODA_CONNECTOR_LIVE_ALLOW_SHARING !== 'false'
const organizationScope = process.env.CODA_CONNECTOR_LIVE_SCOPE === 'organization'
const uiFixturePath = process.env.CODA_CONNECTOR_LIVE_UI_FIXTURE_FILE
const fixtureSchema = z.object({
  docId: z.string(),
  pageId: z.string(),
  marker: z.string().startsWith('SimConnector-'),
})
const permissionListSchema = z.object({
  items: z.array(
    z.object({ id: z.string(), principal: z.object({ email: z.string().optional() }) })
  ),
  nextPageToken: z.string().optional(),
})

describe
  .skipIf(!tokenPath || !fixturePath || !secondEmail)
  .sequential('live Coda ingestion and source access', () => {
    let ids: Awaited<ReturnType<typeof seedKnowledgeAclFixture>>
    let connectorId: string
    let documentId: string
    let token: string
    let fixture: z.infer<typeof fixtureSchema>
    let credentialId = generateId()
    const principal = (userId: string): Principal => ({
      kind: 'session',
      userId,
      sessionId: 'coda-live',
    })

    async function mutation(path: string, method: string, body?: unknown) {
      const response = await fetch(buildCodaUrl(path), {
        method,
        redirect: 'error',
        headers: codaHeaders(token, body !== undefined),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      await response.body?.cancel()
      if (!response.ok) throw new Error(`Coda fixture mutation failed (${response.status})`)
    }

    async function revokeShare() {
      const path = codaDocPath(fixture.docId, 'acl', 'permissions')
      const permissions = await codaJson(token, path, permissionListSchema)
      if (permissions.nextPageToken) throw new Error('Disposable fixture has unexpected sharing')
      for (const item of permissions.items) {
        if (item.principal.email?.toLowerCase() === secondEmail!.toLowerCase()) {
          await mutation(`${path}/${encodeURIComponent(item.id)}`, 'DELETE')
        }
      }
    }

    async function waitForAcl(shared: boolean) {
      for (let attempt = 0; attempt < 30; attempt++) {
        const acl = await readCodaDocAcl(token, fixture.docId)
        if (acl.includes(`u:${secondEmail!.toLowerCase()}`) === shared) return
        await sleep(1000)
      }
      throw new Error('Coda sharing did not converge')
    }

    async function search(as: Principal) {
      const result = await searchKnowledge.execute({
        principal: as,
        input: {
          ...(organizationScope
            ? { organizationId: ids.organizationId }
            : { workspaceId: ids.workspaceId }),
          knowledgeBaseIds: [ids.knowledgeBaseId],
          query: fixture.marker,
          searchMode: 'hybrid',
          topK: 10,
        },
      })
      return result.results.map((row) => row.documentId)
    }

    async function sync() {
      const result = await executeSync(connectorId, {
        fullSync: false,
        billingAttribution: organizationScope
          ? await resolveOrganizationBillingAttribution({
              actorUserId: ids.aliceId,
              organizationId: ids.organizationId,
            })
          : await resolveBillingAttribution({
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
      token = readFileSync(tokenPath!, 'utf8').trim()
      fixture = fixtureSchema.parse(JSON.parse(readFileSync(fixturePath!, 'utf8')))
      const source = await codaJson(
        token,
        codaDocPath(fixture.docId),
        z.object({ name: z.string(), owner: z.string().email() })
      )
      if (
        source.name !== `Sim Coda connector verification ${fixture.marker}` ||
        source.owner === secondEmail
      ) {
        throw new Error('Refusing to change sharing on a non-fixture document')
      }
      await revokeShare()
      await waitForAcl(false)
      ids = await seedKnowledgeAclFixture()
      await db.update(user).set({ email: source.owner }).where(eq(user.id, ids.aliceId))
      await db.update(user).set({ email: secondEmail! }).where(eq(user.id, ids.bobId))
      if (organizationScope) {
        await db.insert(member).values([
          {
            id: generateId(),
            organizationId: ids.organizationId,
            userId: ids.aliceId,
            role: 'owner',
            createdAt: new Date(),
          },
          {
            id: generateId(),
            organizationId: ids.organizationId,
            userId: ids.bobId,
            role: 'member',
            createdAt: new Date(),
          },
        ])
        await db
          .update(knowledgeBase)
          .set({ workspaceId: null, organizationId: ids.organizationId, isSearchIndex: true })
          .where(eq(knowledgeBase.id, ids.knowledgeBaseId))
        const createdCredential = await createOrganizationCredential.execute({
          principal: principal(ids.aliceId),
          input: {
            organizationId: ids.organizationId,
            type: 'service_account',
            providerId: 'coda-service-account',
            displayName: 'Disposable Coda live fixture',
            apiToken: token,
          },
        })
        credentialId = createdCredential.credential.id
      } else
        await db.insert(credential).values({
          id: credentialId,
          workspaceId: ids.workspaceId,
          createdBy: ids.aliceId,
          type: 'service_account',
          providerId: 'coda-service-account',
          displayName: 'Disposable Coda live fixture',
          encryptedServiceAccountKey: (
            await encryptSecret(
              JSON.stringify({
                type: 'token_service_account',
                providerId: 'coda-service-account',
                apiToken: token,
              })
            )
          ).encrypted,
        })
      const created = await createKnowledgeConnector.execute({
        principal: principal(ids.aliceId),
        input: {
          knowledgeBaseId: ids.knowledgeBaseId,
          ...(organizationScope
            ? { assertedOrganizationId: ids.organizationId }
            : { assertedWorkspaceId: ids.workspaceId }),
          connectorType: 'coda',
          credentialId,
          accessMode: 'admin',
          sourceConfig: { docIds: [fixture.docId] },
          syncIntervalMinutes: 60,
        },
      })
      connectorId = created.connector.id
      for (let attempt = 0; attempt < 120; attempt++) {
        const [source] = await db
          .select()
          .from(knowledgeConnector)
          .where(eq(knowledgeConnector.id, connectorId))
        if (source.status === 'error')
          throw new Error(source.lastSyncError ?? 'Initial Coda sync failed')
        if (source.lastSyncAt && source.status === 'active') break
        await sleep(1000)
      }
      const stored = await db.select().from(document).where(eq(document.connectorId, connectorId))
      expect(stored.length).toBeGreaterThanOrEqual(2)
      expect(stored.every((row) => row.processingStatus === 'completed')).toBe(true)
      documentId = stored.find(
        (row) => row.externalId === `${fixture.docId}/pages/${fixture.pageId}`
      )!.id
    }, 180_000)

    afterAll(async () => {
      try {
        if (fixture && allowSharing) await revokeShare()
      } finally {
        if (ids && !uiFixturePath) {
          const rows = await db
            .select()
            .from(document)
            .where(eq(document.knowledgeBaseId, ids.knowledgeBaseId))
          for (const row of rows)
            if (row.storageKey) await deleteFile({ key: row.storageKey, context: 'knowledge-base' })
          await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
          await db.delete(organization).where(eq(organization.id, ids.organizationId))
          await db.delete(user).where(eq(user.id, ids.aliceId))
          await db.delete(user).where(eq(user.id, ids.bobId))
        }
        if (ids && uiFixturePath) {
          const sessionToken = generateId()
          await db.insert(session).values({
            id: generateId(),
            token: sessionToken,
            userId: ids.aliceId,
            expiresAt: new Date(Date.now() + 3_600_000),
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          const cookie = await serializeSignedCookie(
            'better-auth.session_token',
            sessionToken,
            process.env.BETTER_AUTH_SECRET!
          )
          writeFileSync(
            uiFixturePath,
            JSON.stringify({ ...ids, connectorId, cookie, databaseUrl: process.env.DATABASE_URL }),
            { mode: 0o600 }
          )
        }
        await db.$client.end()
      }
    })

    it('indexes through admin setup and restricts private content to its owner', async () => {
      expect(metrics.embeddingCalls).toBeGreaterThan(0)
      expect(await search(principal(ids.aliceId))).toContain(documentId)
      expect(await search(principal(ids.bobId))).not.toContain(documentId)
      const keySearch = search({
        kind: 'workspace_api_key',
        workspaceId: ids.workspaceId,
        keyId: 'fixture',
      })
      if (organizationScope) await expect(keySearch).rejects.toThrow()
      else expect(await keySearch).not.toContain(documentId)
      const chunks = await listKnowledgeChunks.execute({
        principal: principal(ids.aliceId),
        input: { knowledgeBaseId: ids.knowledgeBaseId, documentId },
      })
      expect(chunks.chunks.map((row) => row.content).join('\n')).toContain(
        `${fixture.marker} updated content`
      )
    })

    it('does not re-embed unchanged pages or tables during a permission refresh', async () => {
      const before = metrics.embeddingCalls
      const result = await sync()
      expect(result.docsUnchanged).toBeGreaterThanOrEqual(2)
      expect(metrics.embeddingCalls).toBe(before)
      expect(await search(principal(ids.aliceId))).toContain(documentId)
      expect(await search(principal(ids.bobId))).not.toContain(documentId)
    })

    it.skipIf(!allowSharing)(
      'propagates a real Coda email share to search and document reads',
      async () => {
        await mutation(codaDocPath(fixture.docId, 'acl', 'permissions'), 'POST', {
          access: 'readonly',
          principal: { type: 'email', email: secondEmail },
          suppressEmail: true,
        })
        await waitForAcl(true)
        await sync()
        expect(await search(principal(ids.bobId))).toContain(documentId)
        const result = await readKnowledgeDocument.execute({
          principal: principal(ids.bobId),
          input: { knowledgeBaseId: ids.knowledgeBaseId, documentId },
        })
        expect(result.document.id).toBe(documentId)
      },
      120_000
    )

    it('denies an unverified Sim email even for the Coda document owner', async () => {
      await db.update(user).set({ emailVerified: false }).where(eq(user.id, ids.aliceId))
      try {
        expect(await search(principal(ids.aliceId))).not.toContain(documentId)
      } finally {
        await db.update(user).set({ emailVerified: true }).where(eq(user.id, ids.aliceId))
      }
    })

    it.skipIf(!allowSharing)(
      'removes search and read access after source sharing is revoked without editing content',
      async () => {
        await revokeShare()
        await waitForAcl(false)
        await sync()
        expect(await search(principal(ids.bobId))).not.toContain(documentId)
        await expect(
          readKnowledgeDocument.execute({
            principal: principal(ids.bobId),
            input: { knowledgeBaseId: ids.knowledgeBaseId, documentId },
          })
        ).rejects.toThrow()
        expect(await search(principal(ids.aliceId))).toContain(documentId)
      },
      120_000
    )
  })
