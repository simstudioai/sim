/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requestJson: vi.fn(),
  useInfiniteQuery: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  keepPreviousData: Symbol('keepPreviousData'),
  useInfiniteQuery: mocks.useInfiniteQuery,
  useMutation: vi.fn(),
  useQuery: vi.fn(),
  useQueryClient: vi.fn(() => ({ invalidateQueries: vi.fn() })),
}))

vi.mock('@/lib/api/client/request', () => ({
  requestJson: mocks.requestJson,
}))

import { listKnowledgeConnectorDocumentsContract } from '@/lib/api/contracts/knowledge'
import { MAX_KNOWLEDGE_CONNECTOR_DOCUMENT_PAGE_SIZE } from '@/lib/knowledge/constants'
import { useConnectorDocuments } from '@/hooks/queries/kb/connectors'

interface ConnectorDocumentsPage {
  documents: Array<{ id: string }>
  counts: { active: number; excluded: number }
}

interface ConnectorDocumentsQueryOptions {
  initialPageParam: number
  queryFn: (context: { signal: AbortSignal; pageParam: number }) => Promise<unknown>
  getNextPageParam: (
    lastPage: ConnectorDocumentsPage,
    pages: ConnectorDocumentsPage[]
  ) => number | undefined
}

describe('useConnectorDocuments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('requests bounded pages and advances until the authoritative total is loaded', async () => {
    const firstPage = {
      documents: [{ id: 'document-1' }, { id: 'document-2' }],
      counts: { active: 2, excluded: 1 },
    }
    const finalPage = {
      documents: [{ id: 'document-3' }],
      counts: firstPage.counts,
    }
    mocks.requestJson.mockResolvedValue({ data: firstPage })

    useConnectorDocuments('knowledge-1', 'connector-1', { includeExcluded: true })

    const options = mocks.useInfiniteQuery.mock.calls[0]?.[0] as ConnectorDocumentsQueryOptions
    const signal = new AbortController().signal
    await options.queryFn({ signal, pageParam: 200 })

    expect(mocks.requestJson).toHaveBeenCalledWith(listKnowledgeConnectorDocumentsContract, {
      params: { id: 'knowledge-1', connectorId: 'connector-1' },
      query: {
        includeExcluded: true,
        limit: MAX_KNOWLEDGE_CONNECTOR_DOCUMENT_PAGE_SIZE,
        offset: 200,
      },
      signal,
    })
    expect(options.initialPageParam).toBe(0)
    expect(options.getNextPageParam(firstPage, [firstPage])).toBe(2)
    expect(options.getNextPageParam(finalPage, [firstPage, finalPage])).toBeUndefined()
  })

  it('does not page toward excluded documents when they were not requested', () => {
    const activePage = {
      documents: [{ id: 'document-1' }, { id: 'document-2' }],
      counts: { active: 2, excluded: 10 },
    }

    useConnectorDocuments('knowledge-1', 'connector-1')

    const options = mocks.useInfiniteQuery.mock.calls[0]?.[0] as ConnectorDocumentsQueryOptions
    expect(options.getNextPageParam(activePage, [activePage])).toBeUndefined()
  })
})
