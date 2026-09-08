/** Real source storage, PDF parsing, worker failure persistence, and retry suppression. */
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { db } from '@sim/db'
import {
  document,
  embedding,
  knowledgeBase,
  organization,
  outboxEvent,
  rateLimitBucket,
  user,
  workspace,
} from '@sim/db/schema'
import { sha256Hex } from '@sim/security/hash'
import { generateId } from '@sim/utils/id'
import { eq, inArray, sql } from 'drizzle-orm'
import { PDFDocument, PDFHexString } from 'pdf-lib'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const fixtureStorage = vi.hoisted(() => ({ root: '' }))
vi.mock('@/lib/uploads/core/setup.server', () => ({
  get UPLOAD_DIR_SERVER() {
    return fixtureStorage.root
  },
}))

import { resolveBillingAttribution } from '@/lib/billing/core/billing-attribution'
import { env } from '@/lib/core/config/env'
import * as egress from '@/lib/core/security/input-validation.server'
import { getMistralCapacityScope } from '@/lib/internal/mistral/capacity'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { createContentSyncLease } from '@/lib/knowledge/connectors/sync-lock'
import { addDocument } from '@/lib/knowledge/connectors/sync-persistence'
import { processDocumentsWithQueue } from '@/lib/knowledge/documents/service'
import { MAX_PROCESSING_ATTEMPTS } from '@/lib/knowledge/documents/types'

const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64')

async function encryptedPdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create()
  pdf.addPage()
  pdf.context.trailerInfo.Encrypt = pdf.context.register(
    pdf.context.obj({
      Filter: 'Standard',
      V: 1,
      R: 2,
      P: -4,
      O: PDFHexString.of('00'.repeat(32)),
      U: PDFHexString.of('00'.repeat(32)),
    })
  )
  pdf.context.trailerInfo.ID = pdf.context.obj([
    PDFHexString.of('11'.repeat(16)),
    PDFHexString.of('11'.repeat(16)),
  ])
  return Buffer.from(await pdf.save({ useObjectStreams: false }))
}

describe('OCR input failures stop without partial indexing or futile retries', () => {
  const seeded: ReturnType<typeof createKnowledgeAclFixtureIds>[] = []
  const capacityKeys: string[] = []
  const prior = {
    OCR_PROVIDER: env.OCR_PROVIDER,
    MISTRAL_API_KEY: env.MISTRAL_API_KEY,
    MISTRAL_OCR_QUOTA_GROUPS: env.MISTRAL_OCR_QUOTA_GROUPS,
    OPENAI_API_KEY: env.OPENAI_API_KEY,
    TRIGGER_SECRET_KEY: env.TRIGGER_SECRET_KEY,
  }
  beforeAll(() => {
    fixtureStorage.root = mkdtempSync(path.join(tmpdir(), 'sim-ocr-input-'))
  })
  afterAll(async () => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    Object.assign(env, prior)
    if (capacityKeys.length)
      await db.delete(rateLimitBucket).where(inArray(rateLimitBucket.key, capacityKeys))
    for (const ids of seeded) {
      await db.delete(knowledgeBase).where(eq(knowledgeBase.id, ids.knowledgeBaseId))
      await db.delete(workspace).where(eq(workspace.id, ids.workspaceId))
      await db.delete(organization).where(eq(organization.id, ids.organizationId))
      await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
    }
    await rm(fixtureStorage.root, { recursive: true, force: true })
    await db.$client.end()
  })
  it.each(['encrypted PDF', 'mislabeled PDF', 'animated GIF', 'provider rejection'] as const)(
    'persists a useful terminal reason for %s through the complete indexing dispatch',
    async (kind) => {
      const ids = createKnowledgeAclFixtureIds()
      seeded.push(ids)
      await seedKnowledgeAclFixture(ids)
      const bytes =
        kind === 'encrypted PDF'
          ? await encryptedPdf()
          : kind === 'mislabeled PDF'
            ? Buffer.from('<html>This synthetic response is not a PDF</html>')
            : kind === 'animated GIF'
              ? Buffer.concat([GIF.subarray(0, -1), GIF.subarray(19, -1), Buffer.from([0x3b])])
              : GIF
      const mimeType = kind.endsWith('PDF') ? 'application/pdf' : 'image/gif'
      const filename = mimeType === 'application/pdf' ? 'fixture.pdf' : 'fixture.gif'
      const file = await addDocument(
        ids.knowledgeBaseId,
        ids.connectorId,
        'confluence',
        {
          externalId: 'synthetic-input',
          title: filename,
          content: '',
          mimeType,
          contentHash: generateId(),
          sourceFile: { bytes, fileName: filename, mimeType },
        },
        { userId: ids.aliceId, workspaceId: ids.workspaceId },
        undefined,
        'workspace',
        createContentSyncLease(ids.connectorId, ids.lockId)
      )
      Object.assign(env, {
        OCR_PROVIDER: 'mistral',
        MISTRAL_API_KEY: `fixture-${generateId()}`,
        OPENAI_API_KEY: `fixture-openai-${generateId()}`,
        TRIGGER_SECRET_KEY: undefined,
      })
      Object.assign(env, {
        MISTRAL_OCR_QUOTA_GROUPS: JSON.stringify({
          [sha256Hex(env.MISTRAL_API_KEY!)]: generateId(),
        }),
      })
      capacityKeys.push(
        `provider:ocr:mistral:${getMistralCapacityScope(env.MISTRAL_API_KEY!)}:capacity:v1`
      )
      let providerRequests = 0
      vi.stubGlobal('fetch', () => {
        throw new Error('Unexpected external fixture request')
      })
      vi.spyOn(egress, 'validateUrlWithDNS').mockResolvedValue({
        isValid: true,
        resolvedIP: '203.0.113.1',
        originalHostname: 'api.mistral.ai',
      })
      vi.spyOn(egress, 'secureFetchWithPinnedIP').mockImplementation(async () => {
        providerRequests++
        const response = Response.json(
          { message: 'Sensitive synthetic source echo' },
          { status: 400 }
        )
        return {
          ok: false,
          status: 400,
          statusText: response.statusText,
          headers: new egress.SecureFetchHeaders({}),
          body: response.body,
          text: () => response.text(),
          json: () => response.json(),
          arrayBuffer: () => response.arrayBuffer(),
        }
      })
      const billing = await resolveBillingAttribution({
        actorUserId: ids.aliceId,
        workspaceId: ids.workspaceId,
      })
      expect(
        await processDocumentsWithQueue([file], ids.knowledgeBaseId, {}, generateId(), billing)
      ).toMatchObject({ accepted: 1, failed: 0 })
      const [failed] = await db.select().from(document).where(eq(document.id, file.documentId))
      expect(failed).toMatchObject({
        processingStatus: 'failed',
        processingAttempts: MAX_PROCESSING_ATTEMPTS,
        processingDeferredUntil: null,
      })
      const message =
        kind === 'encrypted PDF'
          ? 'password-protected'
          : kind === 'mislabeled PDF'
            ? 'not a valid PDF'
            : kind === 'animated GIF'
              ? 'Animated GIFs'
              : 'OCR provider rejected'
      expect(failed.processingError).toContain(message)
      expect(failed.processingError).not.toContain('Sensitive synthetic')
      expect(providerRequests).toBe(kind === 'provider rejection' ? 1 : 0)
      expect(
        await db.select().from(embedding).where(eq(embedding.documentId, file.documentId))
      ).toEqual([])
      const pending = await db
        .select()
        .from(outboxEvent)
        .where(sql`${outboxEvent.payload}->>'documentId' = ${file.documentId}`)
      expect(pending.filter((event) => event.eventType.includes('continuation'))).toEqual([])
      vi.restoreAllMocks()
      vi.unstubAllGlobals()
    }
  )
})
