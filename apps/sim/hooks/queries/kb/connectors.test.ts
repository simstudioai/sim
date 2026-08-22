/**
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requestJson: vi.fn(),
  useInfiniteQuery: vi.fn(),
  useQuery: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  keepPreviousData: Symbol('keepPreviousData'),
  useInfiniteQuery: mocks.useInfiniteQuery,
  useMutation: vi.fn(),
  useQuery: mocks.useQuery,
  useQueryClient: vi.fn(() => ({ invalidateQueries: vi.fn() })),
}))

vi.mock('@/lib/api/client/request', () => ({
  requestJson: mocks.requestJson,
}))

import {
  type ConnectorData,
  listKnowledgeConnectorDocumentsContract,
} from '@/lib/api/contracts/knowledge'
import { MAX_KNOWLEDGE_CONNECTOR_DOCUMENT_PAGE_SIZE } from '@/lib/knowledge/constants'
import {
  isConnectorSyncingOrPending,
  useConnectorDocuments,
  useConnectorList,
} from '@/hooks/queries/kb/connectors'

const NOW_MS = new Date('2026-08-21T12:00:00.000Z').getTime()

function makeConnector(overrides: Partial<ConnectorData> = {}): ConnectorData {
  const createdAt = new Date(NOW_MS - 60_000).toISOString()

  return {
    id: 'connector-1',
    knowledgeBaseId: 'knowledge-1',
    connectorType: 'hubspot',
    credentialId: 'credential-1',
    sourceConfig: {},
    syncMode: 'full',
    syncIntervalMinutes: 1440,
    status: 'active',
    lastSyncAt: null,
    lastSyncError: null,
    lastSyncDocCount: null,
    nextSyncAt: null,
    consecutiveFailures: 0,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  }
}

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

interface ConnectorListQueryOptions {
  notifyOnChangeProps?: 'all'
}

describe('isConnectorSyncingOrPending', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW_MS)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('treats a recently created active connector without a completed sync as pending', () => {
    expect(isConnectorSyncingOrPending(makeConnector())).toBe(true)
  })

  it('treats a syncing connector as syncing regardless of its age or sync history', () => {
    const connector = makeConnector({
      status: 'syncing',
      createdAt: new Date(NOW_MS - 24 * 60 * 60 * 1000).toISOString(),
      lastSyncAt: new Date(NOW_MS - 60 * 60 * 1000).toISOString(),
    })

    expect(isConnectorSyncingOrPending(connector)).toBe(true)
  })

  it('does not treat an active connector with a completed sync as pending', () => {
    const connector = makeConnector({
      lastSyncAt: new Date(NOW_MS - 30_000).toISOString(),
    })

    expect(isConnectorSyncingOrPending(connector)).toBe(false)
  })

  it('stops treating an active connector as pending at the two-minute boundary', () => {
    const connector = makeConnector({
      createdAt: new Date(NOW_MS - 2 * 60 * 1000).toISOString(),
    })

    expect(isConnectorSyncingOrPending(connector)).toBe(false)
  })

  it.each(['error', 'paused', 'disabled'] as const)(
    'does not treat a recent %s connector as pending',
    (status) => {
      expect(isConnectorSyncingOrPending(makeConnector({ status }))).toBe(false)
    }
  )
})

describe('useConnectorList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('notifies consumers when identical polls complete so pending UI can expire', () => {
    useConnectorList('knowledge-1')

    const options = mocks.useQuery.mock.calls[0]?.[0] as ConnectorListQueryOptions
    expect(options.notifyOnChangeProps).toBe('all')
  })
})

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
