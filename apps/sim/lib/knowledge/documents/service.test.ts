/** @vitest-environment node */
import { document } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WORKSPACE_ACCESS_SCOPE } from '@/lib/knowledge/access/scope'
import type { KnowledgeAccessProvider, KnowledgeAccessScope } from '@/lib/knowledge/access/types'
import {
  getDocuments,
  getKnowledgeDocument,
  getKnowledgeDocumentById,
} from '@/lib/knowledge/documents/service'

beforeEach(() => {
  vi.clearAllMocks()
  resetDbChainMock()
})

describe('getDocuments pagination', () => {
  it('keeps static scopes on the direct count and offset queries', async () => {
    queueTableRows(document, [{ count: 25 }])
    queueTableRows(document, [])

    const result = await getDocuments(
      'knowledge-1',
      { limit: 5, offset: 20 },
      'request-1',
      WORKSPACE_ACCESS_SCOPE
    )

    expect(result.pagination).toEqual({ total: 25, limit: 5, offset: 20, hasMore: false })
    expect(dbChainMockFns.select).toHaveBeenCalledTimes(2)
    expect(dbChainMockFns.selectDistinct).not.toHaveBeenCalled()
    expect(dbChainMockFns.as).not.toHaveBeenCalled()
    expect(dbChainMockFns.offset).toHaveBeenCalledWith(20)
    expect(dbChainMockFns.limit).toHaveBeenCalledWith(5)
  })

  it('reads a newly admitted candidate even when the earlier count admitted no documents', async () => {
    const identity: KnowledgeAccessScope = { kind: 'user', userId: 'reader', tokens: [] }
    const resolve = vi.fn(async () => identity)
    const access: KnowledgeAccessProvider = {
      get: async () => identity,
      getForConnectors: async () => identity,
      getForDocuments: resolve,
    }
    queueTableRows(document, [{ count: 0 }])
    dbChainMockFns.limit
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'newly-readable', rank: 1 }])
      .mockResolvedValueOnce([{ id: 'newly-readable', rank: 1 }])
      .mockResolvedValueOnce([{ id: 'newly-readable', filename: 'Visible file' }])

    const result = await getDocuments('knowledge-1', { limit: 1 }, 'request-1', access)

    expect(resolve).toHaveBeenCalledWith(['newly-readable'])
    expect(result.documents).toMatchObject([{ id: 'newly-readable', filename: 'Visible file' }])
  })
})

describe('knowledge document detail live authorization', () => {
  it.each(['parent', 'canonical'] as const)(
    'authorizes a %s lookup before reading document fields',
    async (lookup) => {
      const identity: KnowledgeAccessScope = { kind: 'user', userId: 'reader', tokens: [] }
      const getForDocuments = vi.fn(async () => {
        expect(dbChainMockFns.select).not.toHaveBeenCalled()
        return identity
      })
      const access: KnowledgeAccessProvider = {
        get: async () => identity,
        getForConnectors: async () => identity,
        getForDocuments,
      }
      queueTableRows(document, [{ id: 'document-1', filename: 'Readable page' }])
      const result =
        lookup === 'parent'
          ? await getKnowledgeDocument('knowledge-1', 'document-1', access)
          : await getKnowledgeDocumentById('document-1', access)
      expect(getForDocuments).toHaveBeenCalledExactlyOnceWith(['document-1'])
      expect(result).toMatchObject({ id: 'document-1', filename: 'Readable page' })
    }
  )

  it('does not hydrate a document after source authorization fails', async () => {
    const access: KnowledgeAccessProvider = {
      get: vi.fn(),
      getForConnectors: vi.fn(),
      getForDocuments: vi.fn().mockRejectedValue(new Error('reader revoked')),
    }
    await expect(getKnowledgeDocument('knowledge-1', 'document-1', access)).rejects.toThrow(
      'reader revoked'
    )
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })
})
