import { sha256Hex } from '@sim/security/hash'
import { dbChainMockFns } from '@sim/testing/mocks/database.mock'
import { storageServiceMock, storageServiceMockFns } from '@sim/testing/mocks/storage-service.mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/uploads/core/storage-service', () => storageServiceMock)
vi.mock('@/lib/embeddings/client', () => ({ EMBEDDING_RETRY_BUDGET_MS: 150000 }))

import {
  cleanupEmbeddingCheckpoint,
  createEmbeddingCheckpoints,
  EMBEDDING_CHECKPOINT_CLEANUP_EVENT,
} from '@/lib/knowledge/documents/embedding-checkpoints'

const identity = { key: sha256Hex('request'), itemCount: 2, dimensions: 2 }
const result = {
  embeddings: [
    [0.001, -Math.PI],
    [1e-16, 3.25],
  ],
  totalTokens: 10,
  dimensions: 2,
}
const scope = {
  knowledgeBaseId: 'kb',
  documentId: 'doc',
  indexingPassId: 'pass',
  sourceHash: sha256Hex('source'),
  batchOffset: 0,
}
function checkpoints(overrides: Partial<Parameters<typeof createEmbeddingCheckpoints>[0]> = {}) {
  return createEmbeddingCheckpoints({ ...scope, deadlineAt: Date.now() + 600000, ...overrides })
}
interface CleanupRow {
  id: string
  availableAt: Date
  status: string
  payload: { key: string; expiresAt: number }
}
describe('private embedding checkpoints', () => {
  const objects = new Map<string, Buffer>()
  const rows = new Map<string, CleanupRow>()
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1000000)
    objects.clear()
    rows.clear()
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
      const file = objects.get(key)
      return file ? { size: file.length } : null
    })
    storageServiceMockFns.mockDownloadFile.mockImplementation(async ({ key }: { key: string }) =>
      objects.get(key)
    )
    storageServiceMockFns.mockUploadFile.mockImplementation(
      async ({ customKey, file }: { customKey: string; file: Buffer }) => {
        expect([...rows.values()].some((row) => row.payload.key === customKey)).toBe(true)
        objects.set(customKey, file)
      }
    )
    storageServiceMockFns.mockDeleteFile.mockImplementation(async ({ key }: { key: string }) =>
      objects.delete(key)
    )
  })
  afterEach(() => vi.useRealTimers())
  it('preserves exact coordinates and usage with durable expiry queued before storage', async () => {
    await checkpoints().save(identity, result)
    expect(await checkpoints().load(identity)).toEqual(result)
    expect(storageServiceMockFns.mockUploadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        persistMetadata: false,
        preserveKey: true,
        context: 'knowledge-base',
      })
    )
    expect([...rows.values()][0].payload).toEqual({
      key: [...objects.keys()][0],
      expiresAt: Date.now() + 48 * 60 * 60 * 1000,
    })
    expect(JSON.stringify([...rows.values()])).not.toContain('embeddings')
  })
  it('invalidates changed documents, passes, input order and source content', async () => {
    await checkpoints().save(identity, result)
    for (const change of [
      { documentId: 'replacement' },
      { indexingPassId: 'next-pass' },
      { batchOffset: 1000 },
      { sourceHash: sha256Hex('replacement') },
    ])
      expect(await checkpoints(change).load(identity)).toBeNull()
  })
  it('refuses corrupt, expired, oversized and non-finite results without allocating unsafe vectors', async () => {
    await expect(checkpoints().save({ ...identity, itemCount: 2000000 }, result)).rejects.toThrow(
      'identity'
    )
    await expect(
      checkpoints().save(identity, {
        ...result,
        embeddings: [
          [Number.NaN, 1],
          [2, 3],
        ],
      })
    ).rejects.toThrow('coordinate')
    await checkpoints().save(identity, result)
    const key = [...objects.keys()][0]
    const valid = Buffer.from(objects.get(key)!)
    objects.get(key)![valid.length - 1] ^= 1
    expect(await checkpoints().load(identity)).toBeNull()
    objects.set(key, valid)
    vi.setSystemTime(Date.now() + 48 * 60 * 60 * 1000)
    expect(await checkpoints().load(identity)).toBeNull()
    await checkpoints().save(identity, result)
    expect(storageServiceMockFns.mockUploadFile).toHaveBeenCalledTimes(1)
  })
  it('defers uncached requests before their full retry budget can cross the processing deadline', () => {
    expect(() => checkpoints({ deadlineAt: Date.now() + 225000 }).beforeRequest()).toThrow(
      'provider capacity'
    )
    expect(() => checkpoints({ deadlineAt: Date.now() + 225001 }).beforeRequest()).not.toThrow()
  })
  it('expires only its private namespace and bounds stalled storage I/O', async () => {
    await checkpoints().save(identity, result)
    const payload = [...rows.values()][0].payload
    const context = {
      eventId: 'event',
      eventType: EMBEDDING_CHECKPOINT_CLEANUP_EVENT,
      signal: new AbortController().signal,
      attempts: 0,
      maxAttempts: 10,
      checkpointPayload: vi.fn(),
    }
    await cleanupEmbeddingCheckpoint(payload, context)
    expect(storageServiceMockFns.mockDeleteFile).not.toHaveBeenCalled()
    await expect(
      cleanupEmbeddingCheckpoint({ ...payload, key: 'knowledge/customer-document' }, context)
    ).rejects.toThrow('Invalid')
    vi.setSystemTime(payload.expiresAt)
    await cleanupEmbeddingCheckpoint(payload, context)
    expect(objects.size).toBe(0)
    storageServiceMockFns.mockHeadObject.mockImplementation(() => new Promise(() => {}))
    const pending = expect(checkpoints().load(identity)).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(15000)
    await pending
    expect(vi.getTimerCount()).toBe(0)
  })
})
