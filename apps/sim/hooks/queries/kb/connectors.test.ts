import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { searchSourceKeys } from '@/hooks/queries/utils/search-source-keys'

const mocks = vi.hoisted(() => ({
  requestJson: vi.fn(),
  useInfiniteQuery: vi.fn().mockReturnValue({ data: undefined, dataUpdatedAt: 0 }),
  useQuery: vi.fn().mockReturnValue({ data: undefined, dataUpdatedAt: 0 }),
  useMutation: vi.fn(),
  cancelQueries: vi.fn(),
  getQueryData: vi.fn(),
  setQueryData: vi.fn(),
  setQueriesData: vi.fn(),
  invalidateQueries: vi.fn(),
}))

vi.mock('react', () => ({ useEffect: vi.fn() }))

vi.mock('@tanstack/react-query', () => ({
  keepPreviousData: Symbol('keepPreviousData'),
  useInfiniteQuery: mocks.useInfiniteQuery,
  useMutation: mocks.useMutation,
  useQuery: mocks.useQuery,
  useQueryClient: vi.fn(() => ({
    cancelQueries: mocks.cancelQueries,
    getQueryData: mocks.getQueryData,
    setQueryData: mocks.setQueryData,
    setQueriesData: mocks.setQueriesData,
    invalidateQueries: mocks.invalidateQueries,
  })),
}))

vi.mock('@/lib/api/client/request', () => ({
  requestJson: mocks.requestJson,
}))

import {
  type ConnectorData,
  listKnowledgeConnectorDocumentsContract,
  listSearchSourcesContract,
} from '@/lib/api/contracts/knowledge'
import {
  type ConnectorDetailData,
  readSearchIndexContract,
} from '@/lib/api/contracts/knowledge/connectors'
import { MAX_KNOWLEDGE_CONNECTOR_DOCUMENT_PAGE_SIZE } from '@/lib/knowledge/constants'
import {
  connectorKeys,
  isConnectorSyncingOrPending,
  useConnectorDocuments,
  useSearchIndex,
  useSearchSources,
  useTriggerSync,
} from '@/hooks/queries/kb/connectors'

const KB_ID = 'kb-1'

function makeConnector(overrides: Partial<ConnectorData> = {}): ConnectorData {
  return {
    id: 'connector-1',
    knowledgeBaseId: KB_ID,
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
    createdAt: '2026-08-21T12:00:00.000Z',
    updatedAt: '2026-08-21T12:00:00.000Z',
    ...overrides,
  }
}

/**
 * The status write patches the list and the detail cache, so pick the call for
 * the list rather than whichever landed last.
 */
function lastListStatusUpdater() {
  const listKey = JSON.stringify(connectorKeys.lists(KB_ID))
  const call = mocks.setQueryData.mock.calls.filter((c) => JSON.stringify(c[0]) === listKey).at(-1)
  return call?.[1] as (connectors?: ConnectorData[]) => ConnectorData[] | undefined
}

describe('isConnectorSyncingOrPending', () => {
  /**
   * The state this replaced: a just-created connector that had not synced yet
   * was inferred to be pending from its `createdAt`. The server now says so
   * itself, and an `active` row means idle no matter how recent it is.
   */
  it('does not infer a queued sync from a freshly created unsynced connector', () => {
    expect(
      isConnectorSyncingOrPending(
        makeConnector({
          status: 'active',
          lastSyncAt: null,
          createdAt: new Date().toISOString(),
        })
      )
    ).toBe(false)
  })
})

describe('useTriggerSync optimistic state', () => {
  function capturedMutationOptions() {
    return mocks.useMutation.mock.calls.at(-1)?.[0] as {
      onMutate: (vars: { knowledgeBaseId: string; connectorId: string }) => Promise<unknown>
      onSettled: (
        data: undefined,
        error: Error | null,
        vars: { knowledgeBaseId: string; connectorId: string }
      ) => Promise<unknown>
      onSuccess: (data: undefined, vars: { knowledgeBaseId: string; connectorId: string }) => void
      onError: (
        error: unknown,
        vars: { knowledgeBaseId: string; connectorId: string },
        context: unknown
      ) => void
    }
  }

  /**
   * Two connectors can be in flight at once. A whole-list snapshot would make
   * one connector's rollback discard the other's still-pending optimistic write.
   */
  it('rolls back only the connector that failed', async () => {
    const existing = [
      makeConnector({ id: 'connector-1', status: 'active' }),
      makeConnector({ id: 'connector-2', status: 'active' }),
    ]
    mocks.getQueryData.mockReturnValue(existing)

    useTriggerSync()
    const options = capturedMutationOptions()
    const context = await options.onMutate({ knowledgeBaseId: KB_ID, connectorId: 'connector-1' })

    /** connector-2 goes optimistically pending while connector-1 is still in flight. */
    const concurrent = existing.map((connector) =>
      connector.id === 'connector-2' ? { ...connector, status: 'pending' as const } : connector
    )

    mocks.setQueryData.mockClear()
    options.onError(
      new Error('boom'),
      { knowledgeBaseId: KB_ID, connectorId: 'connector-1' },
      context
    )

    const rolledBack = lastListStatusUpdater()(concurrent)
    expect(rolledBack?.find((c) => c.id === 'connector-1')?.status).toBe('active')
    expect(rolledBack?.find((c) => c.id === 'connector-2')?.status).toBe('pending')
  })
})

describe('direct source detail mutation state', () => {
  const variables = { knowledgeBaseId: KB_ID, connectorId: 'connector-1' }
  const detailKey = JSON.stringify(connectorKeys.detail(KB_ID, variables.connectorId))
  const listKey = JSON.stringify(connectorKeys.lists(KB_ID))

  beforeEach(() => {
    mocks.getQueryData.mockReset()
  })

  afterEach(() => {
    mocks.getQueryData.mockReset()
  })

  function seedDetail(overrides: Partial<ConnectorData> = {}, list?: ConnectorData[]) {
    const detail: ConnectorDetailData = {
      ...makeConnector({ memberSyncStatus: 'idle', ...overrides }),
      syncLogs: [],
      memberSyncLogs: [],
      members: { active: 2, suspended: 0, stale: 0 },
    }
    mocks.getQueryData.mockImplementation((key) => {
      if (JSON.stringify(key) === detailKey) return detail
      if (JSON.stringify(key) === listKey) return list
      return undefined
    })
    return detail
  }

  function capturedMutation() {
    return mocks.useMutation.mock.calls.at(-1)?.[0] as {
      onMutate: (
        input: typeof variables & { updates?: { status: 'active' | 'paused' } }
      ) => Promise<unknown>
      onError: (error: Error, input: typeof variables, previous: unknown) => void
    }
  }

  function detailUpdater() {
    return mocks.setQueryData.mock.calls
      .filter(([key]) => JSON.stringify(key) === detailKey)
      .at(-1)?.[1] as (detail: ConnectorDetailData | undefined) => ConnectorDetailData | undefined
  }

  it.each([{ id: 'other-connector' }, { knowledgeBaseId: 'other-kb' }])(
    'does not use a mismatched detail to choose the sync engine: %j',
    async (identity) => {
      seedDetail({ accessMode: 'members', ...identity })
      useTriggerSync()
      expect(await capturedMutation().onMutate(variables)).toBeUndefined()
      expect(mocks.setQueryData).not.toHaveBeenCalled()
    }
  )

  it.each([{ id: 'other-connector' }, { knowledgeBaseId: 'other-kb' }])(
    'preserves mismatched detail data when queuing a matching list row: %j',
    async (identity) => {
      const detail = seedDetail(identity, [makeConnector({ accessMode: 'admin' })])
      useTriggerSync()
      await capturedMutation().onMutate(variables)
      expect(detailUpdater()(detail)).toBe(detail)
      expect(lastListStatusUpdater()([makeConnector()])?.[0].status).toBe('pending')
    }
  )
})

interface ConnectorDocumentsPage {
  documents: Array<{ id: string }>
  counts: { active: number; excluded: number }
}

interface ConnectorDocumentsQueryOptions {
  queryKey: readonly unknown[]
  initialPageParam: number
  queryFn: (context: { signal: AbortSignal; pageParam: number }) => Promise<unknown>
  getNextPageParam: (
    lastPage: ConnectorDocumentsPage,
    pages: ConnectorDocumentsPage[]
  ) => number | undefined
}

describe('useConnectorDocuments', () => {
  it('requests bounded pages and advances until the authoritative total is loaded', async () => {
    const firstPage = {
      documents: [{ id: 'document-1' }, { id: 'document-2' }],
      counts: { active: 2, excluded: 1 },
      hasMore: true,
    }
    const finalPage = {
      documents: [{ id: 'document-3' }],
      counts: firstPage.counts,
      hasMore: false,
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
        failedOnly: false,
        filter: undefined,
        search: undefined,
        limit: MAX_KNOWLEDGE_CONNECTOR_DOCUMENT_PAGE_SIZE,
        offset: 200,
      },
      signal,
    })
    expect(options.initialPageParam).toBe(0)
    expect(options.getNextPageParam(firstPage, [firstPage])).toBe(2)
    expect(options.getNextPageParam(finalPage, [firstPage, finalPage])).toBeUndefined()
  })
})

describe('useSearchSources', () => {
  it('isolates organization sources and resolves their index without listing workspace knowledge bases', async () => {
    const scope = { kind: 'organization' as const, organizationId: 'scope-1' }
    const signal = new AbortController().signal
    mocks.requestJson.mockResolvedValue({ data: { knowledgeBaseId: 'org-index' } })
    useSearchIndex(scope)
    const index = mocks.useQuery.mock.calls.at(-1)?.[0]
    await expect(index.queryFn({ signal })).resolves.toEqual({ knowledgeBaseId: 'org-index' })
    expect(mocks.requestJson).toHaveBeenCalledWith(readSearchIndexContract, {
      query: { organizationId: 'scope-1' },
      signal,
    })
    useSearchSources(scope)
    const sources = mocks.useInfiniteQuery.mock.calls.at(-1)?.[0]
    expect(sources.queryKey).not.toEqual(searchSourceKeys.list('scope-1'))
    await sources.queryFn({ signal })
    expect(mocks.requestJson).toHaveBeenLastCalledWith(listSearchSourcesContract, {
      query: { organizationId: 'scope-1', search: '', mine: false },
      signal,
    })
  })
})
