/**
 * Real sync workers, PostgreSQL, file storage, indexing and reconciliation for Confluence image
 * attachments. The source listing is a synthetic connector behind the real Confluence meta, and
 * the vision extraction and embeddings are synthetic, so no request leaves the process. A
 * `cutOff` image runs the real extractor against a Gemini reply stopped at its token limit.
 */
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
  usageLog,
  user,
  workspace,
} from '@sim/db/schema'
import { deleteWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => {
  process.env.KB_IMAGE_EXTRACTIONS_PER_SYNC = '2'
  return {
    storageRoot: '',
    /** externalId to version; a version bump changes the image's bytes and hash. */
    images: new Map<string, number>(),
    decorative: new Set<string>(),
    cutOff: new Set<string>(),
    extractions: [] as string[],
    /** Each chunk gets its own one-hot vector, so the shared HNSW graph sees no duplicates. */
    nextVector: 0,
  }
})
vi.mock('@/lib/uploads/core/setup.server', () => ({
  get UPLOAD_DIR_SERVER() {
    return fixture.storageRoot
  },
}))
vi.mock('@/lib/embeddings', async () => ({
  ...(await import('@/lib/embeddings/client')),
  assertKnowledgeEmbeddingCapacity: async () => {},
  embedKnowledge: async (texts: string[]) => ({
    embeddings: texts.map(() => {
      const vector = Array<number>(1536).fill(0)
      vector[fixture.nextVector++ % 512] = 1
      return vector
    }),
    totalTokens: texts.length,
    billableTokens: 0,
    isBYOK: true,
    modelName: 'text-embedding-3-small',
    pricingId: 'text-embedding-3-small',
  }),
}))
vi.mock('@/lib/knowledge/documents/image-extraction-gemini', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/knowledge/documents/image-extraction-gemini')>()),
  requestGeminiImageExtraction: async () => ({
    text: '{"kind": "table", "rendered_text": "Region: EMEA',
    finishReason: 'MAX_TOKENS',
    inputTokens: 1200,
    outputTokens: 32_768,
  }),
}))
vi.mock('@/lib/knowledge/documents/image-extraction', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/knowledge/documents/image-extraction')>()
  return {
    ...actual,
    extractImageText: async (input: Parameters<typeof actual.extractImageText>[0]) => {
      const externalId = input.filename.replace(/\.png$/, '')
      if (fixture.cutOff.has(externalId)) return actual.extractImageText(input)
      fixture.extractions.push(input.filename)
      if (fixture.decorative.has(externalId)) return { decorative: true, renderedText: '' }
      return {
        decorative: false,
        renderedText: `${externalId} version ${fixture.images.get(externalId)}: Region EMEA launches in Q1.`,
      }
    },
  }
})
vi.mock('@/connectors/registry.server', async () => {
  const { confluenceConnectorMeta } = await import('@/connectors/confluence/meta')
  const enabled = (config: Record<string, unknown>) => config.imageAttachments === 'semantic'
  /** A real, noisy PNG over the semantic byte floor, so the real extractor reads it. */
  const cutOffImage = async () => {
    const sharp = (await import('sharp')).default
    return sharp({
      create: {
        width: 256,
        height: 256,
        channels: 3,
        background: '#808080',
        noise: { type: 'gaussian', mean: 128, sigma: 60 },
      },
    })
      .png()
      .toBuffer()
  }
  const stub = (externalId: string) => {
    const version = fixture.images.get(externalId) ?? 1
    return {
      externalId,
      title: `${externalId}.png`,
      content: '',
      mimeType: 'image/png',
      contentHash: `fixture-image:${externalId}:${version}`,
      contentDeferred: true,
    }
  }
  return {
    CONNECTOR_REGISTRY: {
      confluence: {
        ...confluenceConnectorMeta,
        validateConfig: async () => ({ valid: true }),
        listDocuments: async (_token: string, config: Record<string, unknown>) => ({
          documents: enabled(config) ? [...fixture.images.keys()].map(stub) : [],
          hasMore: false,
        }),
        getDocument: async (
          _token: string,
          _config: Record<string, unknown>,
          externalId: string
        ) => {
          if (!fixture.images.has(externalId)) return null
          const bytes = fixture.cutOff.has(externalId)
            ? await cutOffImage()
            : Buffer.from(`fixture png ${externalId} v${fixture.images.get(externalId)}`)
          return {
            ...stub(externalId),
            contentDeferred: false,
            sourceFile: { bytes, fileName: `${externalId}.png`, mimeType: 'image/png' },
          }
        },
      },
    },
  }
})

import { resolveBillingAttribution } from '@/lib/billing/core/billing-attribution'
import { env } from '@/lib/core/config/env'
import {
  createKnowledgeAclFixtureIds,
  seedKnowledgeAclFixture,
} from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import {
  createKnowledgeConnector,
  updateKnowledgeConnector,
  updateKnowledgeConnectorDocuments,
} from '@/lib/knowledge/application/connectors'
import * as connectorTokens from '@/lib/knowledge/connectors/access-token'
import { executeSync } from '@/lib/knowledge/connectors/sync-engine'
import { IMAGES_DEFERRED_NOTICE } from '@/lib/knowledge/connectors/sync-limits'
import { resolveImageExtractionModel } from '@/lib/knowledge/documents/image-extraction-gemini'

describe('Confluence image attachments through sync, indexing and reconciliation', () => {
  const ids = createKnowledgeAclFixtureIds()
  const principal = createSessionPrincipal({ userId: ids.aliceId, sessionId: 'confluence-images' })
  let billing: Awaited<ReturnType<typeof resolveBillingAttribution>>
  const priorGeminiKeys = {
    GEMINI_API_KEY: env.GEMINI_API_KEY,
    GEMINI_API_KEY_1: env.GEMINI_API_KEY_1,
    GEMINI_API_KEY_2: env.GEMINI_API_KEY_2,
    GEMINI_API_KEY_3: env.GEMINI_API_KEY_3,
  }

  async function configure(imageAttachments: 'semantic' | 'off' | undefined) {
    await db
      .update(knowledgeConnector)
      .set({
        sourceConfig: {
          domain: 'fixture.atlassian.net',
          spaceKey: 'ENG',
          ...(imageAttachments ? { imageAttachments } : {}),
        },
        accessMode: 'workspace',
        status: 'active',
        syncLockToken: null,
        imageRemovalPending: false,
      })
      .where(eq(knowledgeConnector.id, ids.connectorId))
  }
  /** Waits for the sync a create or update dispatched in-process to land. */
  async function syncFinished(connectorId: string) {
    await expect
      .poll(
        async () => {
          const [row] = await db
            .select()
            .from(knowledgeConnector)
            .where(eq(knowledgeConnector.id, connectorId))
          return {
            status: row?.status,
            error: row?.lastSyncError,
            synced: Boolean(row?.lastSyncAt),
          }
        },
        { timeout: 45_000 }
      )
      .toEqual({ status: 'active', error: null, synced: true })
  }
  /** Changes the setting the way a user does; the update dispatches the next sync, which runs in-process. */
  async function setImageAttachments(imageAttachments: 'semantic' | 'off') {
    await updateKnowledgeConnector.execute({
      principal,
      input: {
        connectorId: ids.connectorId,
        updates: {
          sourceConfig: { domain: 'fixture.atlassian.net', spaceKey: 'ENG', imageAttachments },
        },
      },
    })
    await syncFinished(ids.connectorId)
  }
  function setExcluded(documentId: string, operation: 'exclude' | 'restore') {
    return updateKnowledgeConnectorDocuments.execute({
      principal,
      input: {
        knowledgeBaseId: ids.knowledgeBaseId,
        connectorId: ids.connectorId,
        operation,
        documentIds: [documentId],
      },
    })
  }
  async function imageRemovalPending() {
    const [row] = await db
      .select({ pending: knowledgeConnector.imageRemovalPending })
      .from(knowledgeConnector)
      .where(eq(knowledgeConnector.id, ids.connectorId))
    return row?.pending
  }
  async function sync(options: { fullSync?: boolean; rehydrate?: boolean } = {}) {
    const result = await executeSync(ids.connectorId, {
      fullSync: true,
      ...options,
      billingAttribution: billing,
    })
    expect(result.docsFailed).toBe(0)
    return result
  }
  async function images() {
    return db
      .select()
      .from(document)
      .where(and(eq(document.connectorId, ids.connectorId), isNull(document.deletedAt)))
      .orderBy(document.externalId)
  }
  async function vectors(documentIds: string[]) {
    if (documentIds.length === 0) return []
    return db.select().from(embedding).where(inArray(embedding.documentId, documentIds))
  }
  async function lastSyncError() {
    const [connector] = await db
      .select({ lastSyncError: knowledgeConnector.lastSyncError })
      .from(knowledgeConnector)
      .where(eq(knowledgeConnector.id, ids.connectorId))
    return connector?.lastSyncError ?? null
  }

  beforeAll(async () => {
    fixture.storageRoot = mkdtempSync(path.join(tmpdir(), 'sim-confluence-images-'))
    await seedKnowledgeAclFixture(ids)
    billing = await resolveBillingAttribution({
      actorUserId: ids.aliceId,
      workspaceId: ids.workspaceId,
    })
    vi.spyOn(connectorTokens, 'resolveConnectorAccessToken').mockResolvedValue({
      accessToken: 'fixture-token',
    } as Awaited<ReturnType<typeof connectorTokens.resolveConnectorAccessToken>>)
    vi.stubGlobal('fetch', async () => {
      throw new Error('Unexpected outbound request in the Confluence image fixture')
    })
  })
  beforeEach(async () => {
    Object.assign(env, { GEMINI_API_KEY: 'fixture-gemini-key' })
    fixture.extractions.length = 0
    fixture.decorative.clear()
    fixture.cutOff.clear()
    fixture.images.clear()
    await db.delete(document).where(eq(document.connectorId, ids.connectorId))
    await configure('semantic')
  })
  afterAll(async () => {
    Object.assign(env, priorGeminiKeys)
    await deleteWorkspaceFixture(db, eq(workspace.id, ids.workspaceId))
    await db.delete(organization).where(eq(organization.id, ids.organizationId))
    await db.delete(user).where(inArray(user.id, [ids.aliceId, ids.bobId]))
    await rm(fixture.storageRoot, { recursive: true, force: true })
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    await db.$client.end()
  })

  it('reads new and changed images within the per-sync cap and keeps held-back ones indexed', async () => {
    for (const id of ['image-a', 'image-b', 'image-c']) fixture.images.set(id, 1)

    const first = await sync()
    expect(first.listingIncomplete).toBe(true)
    expect(await lastSyncError()).toContain(IMAGES_DEFERRED_NOTICE)
    expect((await images()).map((row) => row.externalId)).toHaveLength(2)

    await sync()
    const indexed = await images()
    expect(indexed.map((row) => row.externalId)).toEqual(['image-a', 'image-b', 'image-c'])
    expect(indexed.every((row) => row.processingStatus === 'completed')).toBe(true)
    expect(await vectors(indexed.map((row) => row.id))).toHaveLength(3)

    for (const id of fixture.images.keys()) fixture.images.set(id, 2)
    fixture.extractions.length = 0
    const changed = await sync()
    expect(changed.listingIncomplete).toBe(true)
    expect(fixture.extractions).toHaveLength(2)
    const afterChange = await images()
    /** The held-back image is still listed at the source, so reconciliation keeps it searchable. */
    expect(afterChange.map((row) => row.externalId)).toEqual(['image-a', 'image-b', 'image-c'])
    expect(afterChange.filter((row) => row.contentHash?.endsWith(':2'))).toHaveLength(2)
    expect(await vectors(afterChange.map((row) => row.id))).toHaveLength(3)

    await sync()
    expect((await images()).every((row) => row.contentHash?.endsWith(':2'))).toBe(true)
    expect(await lastSyncError()).toBeNull()
  }, 120_000)

  it('does not read unchanged images again on a full resync', async () => {
    fixture.images.set('image-a', 1)
    await sync()
    expect(fixture.extractions).toEqual(['image-a.png'])

    fixture.extractions.length = 0
    const resync = await sync({ fullSync: true, rehydrate: true })
    expect(fixture.extractions).toEqual([])
    expect(resync.docsUnchanged).toBe(1)
  })

  it('removes indexed images on the first sync after Image Attachments is turned off', async () => {
    for (const id of ['image-a', 'image-b']) fixture.images.set(id, 1)
    await sync()
    const indexed = await images()
    expect(indexed).toHaveLength(2)

    await setImageAttachments('off')
    expect(
      await db.select().from(document).where(eq(document.connectorId, ids.connectorId))
    ).toEqual([])
    expect(await vectors(indexed.map((row) => row.id))).toEqual([])
    expect(await imageRemovalPending()).toBe(false)

    fixture.extractions.length = 0
    await setImageAttachments('semantic')
    expect(fixture.extractions.sort()).toEqual(['image-a.png', 'image-b.png'])
  }, 120_000)

  it('keeps an excluded image excluded while Image Attachments is off', async () => {
    fixture.images.set('image-a', 1)
    await sync()
    const [excluded] = await images()
    await setExcluded(excluded.id, 'exclude')

    await setImageAttachments('off')
    await expect(setExcluded(excluded.id, 'restore')).rejects.toThrow(
      'Turn on image attachments for this connector before restoring an image.'
    )
    const [kept] = await images()
    expect(kept).toMatchObject({ id: excluded.id, userExcluded: true, enabled: false })

    await setImageAttachments('semantic')
    expect(await setExcluded(excluded.id, 'restore')).toMatchObject({ count: 1 })
  }, 120_000)

  it('bills the Gemini call once when a reply cut off at its token limit fails the image', async () => {
    fixture.images.set('image-a', 1)
    fixture.cutOff.add('image-a')
    await executeSync(ids.connectorId, { fullSync: true, billingAttribution: billing })

    await expect
      .poll(async () => (await images()).map((row) => row.processingStatus), { timeout: 45_000 })
      .toEqual(['failed'])
    const [failed] = await images()
    expect(failed.processingError).toContain('more text than one extraction can return')
    expect(await vectors([failed.id])).toEqual([])
    const charges = await db
      .select()
      .from(usageLog)
      .where(
        and(
          eq(usageLog.workspaceId, ids.workspaceId),
          eq(usageLog.source, 'knowledge-base'),
          eq(usageLog.description, resolveImageExtractionModel())
        )
      )
    expect(charges).toHaveLength(1)
    expect(Number(charges[0].cost)).toBeGreaterThan(0)
    expect(charges[0].metadata).toEqual({ inputTokens: 1200, outputTokens: 32_768 })
  }, 120_000)

  it('keeps images off for a connector created before the setting existed', async () => {
    fixture.images.set('image-a', 1)
    await configure(undefined)
    await sync()
    expect(await images()).toEqual([])
    expect(fixture.extractions).toEqual([])
  })

  it('drops the old embeddings when a changed image re-indexes to nothing', async () => {
    fixture.images.set('image-a', 1)
    await sync()
    const [before] = await images()
    expect(await vectors([before.id])).toHaveLength(1)

    fixture.images.set('image-a', 2)
    fixture.decorative.add('image-a')
    await sync()
    const [after] = await images()
    expect(after).toMatchObject({ id: before.id, processingStatus: 'completed', chunkCount: 0 })
    expect(await vectors([after.id])).toEqual([])
  })

  it('leaves images out, without failing them or holding the sync, when no Gemini key exists', async () => {
    Object.assign(env, {
      GEMINI_API_KEY: undefined,
      GEMINI_API_KEY_1: undefined,
      GEMINI_API_KEY_2: undefined,
      GEMINI_API_KEY_3: undefined,
    })
    fixture.images.set('image-a', 1)
    const result = await sync()
    expect(result.listingIncomplete).toBeFalsy()
    expect(await images()).toEqual([])
    expect(fixture.extractions).toEqual([])
  })

  it.each([
    [{}, 'semantic'],
    [{ imageAttachments: 'off' }, 'off'],
  ] as const)(
    'saves a new connector with Image Attachments on unless the request chose otherwise (%o)',
    async (chosen, saved) => {
      const created = await createKnowledgeConnector.execute({
        principal,
        input: {
          knowledgeBaseId: ids.knowledgeBaseId,
          connectorType: 'confluence',
          credentialId: ids.credentialId,
          sourceConfig: { domain: 'fixture.atlassian.net', spaceKey: 'ENG', ...chosen },
          syncIntervalMinutes: 1440,
        },
      })
      const [row] = await db
        .select({ sourceConfig: knowledgeConnector.sourceConfig })
        .from(knowledgeConnector)
        .where(eq(knowledgeConnector.id, created.connector.id))
      expect(row?.sourceConfig).toMatchObject({ imageAttachments: saved })
      await syncFinished(created.connector.id)
      await db.delete(knowledgeConnector).where(eq(knowledgeConnector.id, created.connector.id))
    },
    120_000
  )
})
