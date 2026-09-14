/** @vitest-environment node */
import { document, knowledgeConnector } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { and, eq, gt, sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type KnowledgeAccessProvider,
  type KnowledgeAccessScope,
  MAX_KNOWLEDGE_ACCESS_CANDIDATES,
} from '@/lib/knowledge/access/types'
import { knowledgeReadAccessBatches } from '@/lib/knowledge/read-access'

const identity: KnowledgeAccessScope = { kind: 'user', userId: 'reader', tokens: ['org'] }
const liveSources = sql`live-sources`

beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
})

describe('knowledgeReadAccessBatches', () => {
  it('continues after a full denied candidate page using fixed source IDs only', async () => {
    const first = Array.from({ length: MAX_KNOWLEDGE_ACCESS_CANDIDATES }, (_, index) => ({
      connectorId: `source-${String(index).padStart(4, '0')}`,
    }))
    queueTableRows(knowledgeConnector, first)
    queueTableRows(knowledgeConnector, [{ connectorId: 'source-last' }])
    const resolve = vi.fn(async () => identity)
    const provider: KnowledgeAccessProvider = {
      get: async () => identity,
      getForConnectors: resolve,
      getForDocuments: async () => identity,
      liveSourceConnectorCondition: async () => liveSources,
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
    expect(dbChainMockFns.select).toHaveBeenCalledWith({ connectorId: knowledgeConnector.id })
    expect(dbChainMockFns.from).toHaveBeenCalledWith(knowledgeConnector)
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(MAX_KNOWLEDGE_ACCESS_CANDIDATES)
    expect(gt).toHaveBeenCalledWith(knowledgeConnector.id, first.at(-1)!.connectorId)
  })

  it('searches only the sources a live grant could authorize, one document per source', async () => {
    const provider: KnowledgeAccessProvider = {
      get: async () => identity,
      getForConnectors: vi.fn(async () => identity),
      getForDocuments: async () => identity,
      liveSourceConnectorCondition: async () => liveSources,
    }
    const filter = eq(document.knowledgeBaseId, 'one-index')
    const batches = []
    for await (const predicate of knowledgeReadAccessBatches(provider, [filter]))
      batches.push(predicate)
    expect(batches).toHaveLength(1)
    expect(eq).toHaveBeenCalledWith(document.connectorId, knowledgeConnector.id)
    expect(vi.mocked(and).mock.calls.some((conditions) => conditions[0] === liveSources)).toBe(true)
    expect(dbChainMockFns.selectDistinct).not.toHaveBeenCalled()
  })

  it('yields only the ordinary predicate for a reader without live-source credentials', async () => {
    const resolve = vi.fn(async () => identity)
    const provider: KnowledgeAccessProvider = {
      get: async () => identity,
      getForConnectors: resolve,
      getForDocuments: async () => identity,
      liveSourceConnectorCondition: async () => null,
    }
    const batches = []
    for await (const predicate of knowledgeReadAccessBatches(provider, [])) batches.push(predicate)
    expect(batches).toHaveLength(1)
    expect(resolve).not.toHaveBeenCalled()
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })

  it('does not enumerate sources after a satisfied ordinary existence probe', async () => {
    const resolve = vi.fn(async () => identity)
    const liveSourceConnectorCondition = vi.fn(async () => liveSources)
    const provider: KnowledgeAccessProvider = {
      get: async () => identity,
      getForConnectors: resolve,
      getForDocuments: async () => identity,
      liveSourceConnectorCondition,
    }
    for await (const predicate of knowledgeReadAccessBatches(provider, [])) {
      expect(predicate).toBeDefined()
      break
    }
    expect(liveSourceConnectorCondition).not.toHaveBeenCalled()
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
    expect(resolve).not.toHaveBeenCalled()
  })

  it('honors cancellation before returning any predicate', async () => {
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    await expect(
      knowledgeReadAccessBatches(identity, [], controller.signal).next()
    ).rejects.toThrow('cancelled')
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })
})
