import { dbChainMockFns } from '@sim/testing/mocks/database.mock'
import { storageServiceMock, storageServiceMockFns } from '@sim/testing/mocks/storage-service.mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({ provenance: vi.fn() }))
vi.mock('@/lib/uploads/core/storage-service', () => storageServiceMock)
vi.mock('@/lib/knowledge/model-input-provenance', () => ({
  getKnowledgeOpaqueModelInputRegistry: hoisted.provenance,
}))

import type { OutboxEventContext } from '@/lib/core/outbox/service'
import { VISION_CHECKPOINT_CLEANUP_EVENT } from '@/lib/knowledge/documents/checkpoint-events'
import {
  readFramedCheckpoint,
  writeFramedCheckpoint,
} from '@/lib/knowledge/documents/processing-checkpoint-store'
import {
  cleanupVisionCheckpoint,
  createVisionCheckpoint,
} from '@/lib/knowledge/documents/vision-checkpoints'

const context = { knowledgeBaseId: 'kb-1', documentId: 'document-1', indexingPassId: 'pass-1' }
const source = Buffer.from('image bytes')
const result = {
  decorative: false,
  renderedText: 'Region: EMEA. Quarter: Q1.',
  usage: {
    chargeId: 'charge-1',
    model: 'gemini-3.8-flash',
    cost: 0.004,
    inputTokens: 1200,
    outputTokens: 300,
  },
}

interface CleanupRow {
  id: string
  availableAt: Date
  status: string
  payload: { key: string; expiresAt: number }
}

function checkpoint(overrides: Partial<Parameters<typeof createVisionCheckpoint>[0]> = {}) {
  return createVisionCheckpoint({
    context,
    source,
    filename: 'architecture.png',
    model: 'gemini-3.8-flash',
    contractVersion: 'image-extract-v1',
    ...overrides,
  })
}

describe('vision extraction checkpoints', () => {
  let objects: Map<string, Buffer>
  let rows: Map<string, CleanupRow>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-12T19:00:00Z'))
    objects = new Map()
    rows = new Map()
    hoisted.provenance.mockReset()
    dbChainMockFns.insert.mockImplementation(() => ({
      values: (input: Omit<CleanupRow, 'status'>) => ({
        onConflictDoNothing: () => ({
          returning: async () => {
            if (rows.has(input.id)) return []
            const row = { ...input, status: 'pending' }
            rows.set(input.id, row)
            return [row]
          },
        }),
      }),
    }))
    dbChainMockFns.select.mockImplementation(() => ({
      from: () => ({ where: () => ({ limit: async () => [...rows.values()] }) }),
    }))
    storageServiceMockFns.mockHeadObject.mockImplementation(async (key: string) => {
      const value = objects.get(key)
      return value ? { size: value.length } : null
    })
    storageServiceMockFns.mockDownloadFile.mockImplementation(async ({ key }: { key: string }) =>
      objects.get(key)
    )
    storageServiceMockFns.mockUploadFile.mockImplementation(
      async ({ customKey, file }: { customKey: string; file: Buffer }) => {
        objects.set(customKey, Buffer.from(file))
      }
    )
    storageServiceMockFns.mockDeleteFile.mockImplementation(async ({ key }: { key: string }) => {
      objects.delete(key)
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns a saved extraction, including its cost, to a resumed pass', async () => {
    await checkpoint().save(result)
    expect([...rows.values()][0]).toMatchObject({ payload: { key: expect.any(String) } })
    expect(await checkpoint().load()).toEqual(result)
  })

  it('gives a checkpoint written before charge ids one stable charge, so its replays dedupe', async () => {
    await checkpoint().save(result)
    const [key] = [...objects.keys()]
    const stored = await readFramedCheckpoint(key, { maxBodyBytes: 4 * 1024 * 1024 })
    if (!stored) throw new Error('Expected the saved checkpoint')
    const { chargeId: _chargeId, ...legacyUsage } = result.usage
    await writeFramedCheckpoint(
      key,
      stored.header,
      Buffer.from(JSON.stringify({ ...result, usage: legacyUsage })),
      {
        cleanupEventType: VISION_CHECKPOINT_CLEANUP_EVENT,
        cleanupIdPrefix: 'knowledge-vision-cleanup',
        fileName: 'vision-checkpoint.json',
      }
    )

    const first = await checkpoint().load()
    expect(first).toMatchObject({ renderedText: result.renderedText, usage: legacyUsage })
    expect(first?.usage.chargeId).toEqual(expect.any(String))
    expect((await checkpoint().load())?.usage.chargeId).toBe(first?.usage.chargeId)
  })

  it.each([
    { source: Buffer.from('changed image bytes') },
    { filename: 'renamed.png' },
    { context: { ...context, documentId: 'another-document' } },
    { context: { ...context, indexingPassId: 'new-pass' } },
    { model: 'gpt-5.4-mini' },
    { contractVersion: 'image-extract-v2' },
  ])(
    'never reuses a checkpoint across source, title, pass, model or contract changes: %o',
    async (change) => {
      await checkpoint().save(result)
      expect(await checkpoint(change).load()).toBeNull()
    }
  )

  it('ignores a corrupted or expired checkpoint', async () => {
    await checkpoint().save(result)
    const [[key, stored]] = [...objects.entries()]
    objects.set(key, Buffer.concat([stored, Buffer.from('tampered')]))
    expect(await checkpoint().load()).toBeNull()

    objects.clear()
    rows.clear()
    await checkpoint().save(result)
    vi.setSystemTime(new Date('2026-10-15T19:00:00Z'))
    expect(await checkpoint().load()).toBeNull()
  })

  it('deletes the object once its cleanup is due, and refuses a forged key', async () => {
    await checkpoint().save(result)
    const [row] = [...rows.values()]
    const outbox: OutboxEventContext = {
      eventId: row.id,
      eventType: VISION_CHECKPOINT_CLEANUP_EVENT,
      signal: new AbortController().signal,
      attempts: 0,
      maxAttempts: 10,
      checkpointPayload: vi.fn(),
    }
    vi.setSystemTime(new Date(row.payload.expiresAt + 1))
    await cleanupVisionCheckpoint(row.payload, outbox)
    expect(objects.size).toBe(0)
    await expect(
      cleanupVisionCheckpoint({ key: 'kb/document.png', expiresAt: 0 }, outbox)
    ).rejects.toThrow('Invalid Vision checkpoint cleanup payload')
  })
})
