/** @vitest-environment node */
import { document } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { eq, gt } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type KnowledgeAccessProvider,
  type KnowledgeAccessScope,
  MAX_KNOWLEDGE_ACCESS_CANDIDATES,
} from '@/lib/knowledge/access/types'
import { knowledgeReadAccessBatches } from '@/lib/knowledge/read-access'

const identity: KnowledgeAccessScope = { kind: 'user', userId: 'reader', tokens: ['org'] }

beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
})

describe('knowledgeReadAccessBatches', () => {
  it('continues after a full denied candidate page using fixed source IDs only', async () => {
    const first = Array.from({ length: MAX_KNOWLEDGE_ACCESS_CANDIDATES }, (_, index) => ({
      connectorId: `source-${String(index).padStart(4, '0')}`,
    }))
    queueTableRows(document, first)
    queueTableRows(document, [{ connectorId: 'source-last' }])
    const resolve = vi.fn(async () => identity)
    const provider: KnowledgeAccessProvider = {
      get: async () => identity,
      getForConnectors: resolve,
      getForDocuments: async () => identity,
    }
    const filter = eq(document.knowledgeBaseId, 'one-index')
    const batches = []
    for await (const predicate of knowledgeReadAccessBatches(provider, [filter]))
      batches.push(predicate)
    expect(batches).toHaveLength(3)
    expect(resolve.mock.calls).toHaveLength(2)
    expect(resolve).toHaveBeenNthCalledWith(
      1,
      first.map((row) => row.connectorId),
      undefined
    )
    expect(resolve).toHaveBeenNthCalledWith(2, ['source-last'], undefined)
    expect(dbChainMockFns.selectDistinct).toHaveBeenCalledWith({
      connectorId: document.connectorId,
    })
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(MAX_KNOWLEDGE_ACCESS_CANDIDATES)
    expect(gt).toHaveBeenCalledWith(document.connectorId, first.at(-1)!.connectorId)
  })

  it('does not enumerate sources after a satisfied ordinary existence probe', async () => {
    const resolve = vi.fn(async () => identity)
    const provider: KnowledgeAccessProvider = {
      get: async () => identity,
      getForConnectors: resolve,
      getForDocuments: async () => identity,
    }
    for await (const predicate of knowledgeReadAccessBatches(provider, [])) {
      expect(predicate).toBeDefined()
      break
    }
    expect(dbChainMockFns.selectDistinct).not.toHaveBeenCalled()
    expect(resolve).not.toHaveBeenCalled()
  })

  it('honors cancellation before returning any predicate', async () => {
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    await expect(
      knowledgeReadAccessBatches(identity, [], controller.signal).next()
    ).rejects.toThrow('cancelled')
    expect(dbChainMockFns.selectDistinct).not.toHaveBeenCalled()
  })
})
