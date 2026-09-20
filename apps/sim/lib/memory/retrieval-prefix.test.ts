/**
 * @vitest-environment node
 */
import { memory } from '@sim/db/schema'
import { dbChainMockFns, resetDbChainMock } from '@sim/testing'
import { eq, isNull } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hashDurableSecretProvenanceValue } from '@/lib/execution/durable-secret-provenance'
import {
  MAX_MEMORY_RETRIEVAL_PREFIX_BYTES,
  readMemoryRetrievalPrefix,
} from '@/lib/memory/retrieval-prefix'

const scope = { workspaceId: 'workspace-1', memoryId: 'original-memory' }
const data = [{ role: 'user', content: 'frozen history' }]

describe('byte-admitted legacy memory retrieval', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('uses the original active owner and SQL-admitted data/provenance projections', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        bytes: 500,
        data,
        entries: [],
        secretProvenanceVersion: 1,
        provenanceContentHash: hashDurableSecretProvenanceValue(data),
        status: 'exact',
      },
    ])
    expect(await readMemoryRetrievalPrefix(scope)).toEqual({
      status: 'available',
      messages: data,
      provenance: { status: 'exact', entries: [] },
    })
    expect(eq).toHaveBeenCalledWith(memory.id, scope.memoryId)
    expect(eq).toHaveBeenCalledWith(memory.workspaceId, scope.workspaceId)
    expect(isNull).toHaveBeenCalledWith(memory.deletedAt)
    expect(dbChainMockFns.select).toHaveBeenCalledWith(
      expect.objectContaining({
        bytes: expect.anything(),
        data: expect.anything(),
        entries: expect.anything(),
      })
    )
  })

  it('returns explicit oversized status for a rejected SQL admission', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      { bytes: MAX_MEMORY_RETRIEVAL_PREFIX_BYTES + 1, data: null, entries: null },
    ])
    expect(await readMemoryRetrievalPrefix(scope)).toEqual({ status: 'oversized' })
  })

  it('does not trust stale private provenance or malformed prefix JSON', async () => {
    dbChainMockFns.limit.mockResolvedValueOnce([
      {
        bytes: 500,
        data,
        entries: [],
        secretProvenanceVersion: 1,
        provenanceContentHash: 'stale',
        status: 'exact',
      },
    ])
    expect(await readMemoryRetrievalPrefix(scope)).toEqual({ status: 'unavailable' })
    dbChainMockFns.limit.mockResolvedValueOnce([{ bytes: 500, data: { private: 'not messages' } }])
    expect(await readMemoryRetrievalPrefix(scope)).toEqual({ status: 'unavailable' })
  })

  it('does not replace deleted original memory with a new conversation sharing its key', async () => {
    expect(await readMemoryRetrievalPrefix(scope)).toEqual({ status: 'missing' })
    expect(eq).not.toHaveBeenCalledWith(memory.key, expect.anything())
  })
})
