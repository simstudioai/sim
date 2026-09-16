/**
 * @vitest-environment node
 */
import { sha256Hex } from '@sim/security/hash'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  select: vi.fn(),
  upload: vi.fn(),
  download: vi.fn(),
  head: vi.fn(),
  delete: vi.fn(),
}))
vi.mock('@sim/db', () => ({ db: { insert: mocks.insert, select: mocks.select } }))
vi.mock('@/lib/uploads/core/storage-service', () => ({
  uploadFile: mocks.upload,
  downloadFile: mocks.download,
  headObject: mocks.head,
  deleteFile: mocks.delete,
}))
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
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(1000000)
    objects.clear()
    rows.clear()
    mocks.insert.mockImplementation(() => ({
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
    mocks.select.mockImplementation(() => ({
      from: () => ({ where: () => ({ limit: async () => [...rows.values()] }) }),
    }))
    mocks.head.mockImplementation(async (key: string) => {
      const file = objects.get(key)
      return file ? { size: file.length } : null
    })
    mocks.download.mockImplementation(async ({ key }: { key: string }) => objects.get(key))
    mocks.upload.mockImplementation(
      async ({ customKey, file }: { customKey: string; file: Buffer }) => {
        expect([...rows.values()].some((row) => row.payload.key === customKey)).toBe(true)
        objects.set(customKey, file)
      }
    )
    mocks.delete.mockImplementation(async ({ key }: { key: string }) => objects.delete(key))
  })
  afterEach(() => vi.useRealTimers())
  it('preserves exact coordinates and usage with durable expiry queued before storage', async () => {
    await checkpoints().save(identity, result)
    expect(await checkpoints().load(identity)).toEqual(result)
    expect(mocks.upload).toHaveBeenCalledWith(
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
    expect(mocks.upload).toHaveBeenCalledTimes(1)
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
    expect(mocks.delete).not.toHaveBeenCalled()
    await expect(
      cleanupEmbeddingCheckpoint({ ...payload, key: 'knowledge/customer-document' }, context)
    ).rejects.toThrow('Invalid')
    vi.setSystemTime(payload.expiresAt)
    await cleanupEmbeddingCheckpoint(payload, context)
    expect(objects.size).toBe(0)
    mocks.head.mockImplementation(() => new Promise(() => {}))
    const pending = expect(checkpoints().load(identity)).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(15000)
    await pending
    expect(vi.getTimerCount()).toBe(0)
  })
})
