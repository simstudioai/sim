/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requestJson: vi.fn(),
  useInfiniteQuery: vi.fn(),
  useQuery: vi.fn(),
  useMutation: vi.fn(),
  cancelQueries: vi.fn(),
  getQueryData: vi.fn(),
  setQueryData: vi.fn(),
  setQueriesData: vi.fn(),
  invalidateQueries: vi.fn(),
}))

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
import { readSearchIndexContract } from '@/lib/api/contracts/knowledge/connectors'
import { MAX_KNOWLEDGE_CONNECTOR_DOCUMENT_PAGE_SIZE } from '@/lib/knowledge/constants'
import {
  CONNECTOR_SYNC_POLL_INTERVAL_MS,
  connectorKeys,
  isConnectorSyncingOrPending,
  memberConnectorKeys,
  searchSourceKeys,
  useConnectorDetail,
  useConnectorDocuments,
  useConnectorList,
  useSearchIndex,
  useSearchSources,
  useTriggerSync,
  type WorkspaceMemberConnector,
} from '@/hooks/queries/kb/connectors'

const KB_ID = 'kb-1'

function makeMemberConnector(
  overrides: Partial<WorkspaceMemberConnector> = {}
): WorkspaceMemberConnector {
  return {
    knowledgeBaseId: KB_ID,
    knowledgeBaseName: 'Sim Search',
    connectorId: 'connector-1',
    connectorType: 'hubspot',
    memberSyncStatus: 'idle',
    viewerMembership: 'connected',
    viewerDocumentCount: 0,
    ...overrides,
  }
}

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

interface PollableQueryOptions<TData> {
  refetchInterval: (query: { state: { data?: TData } }) => number | false
}

function capturedQueryOptions<TData>(): PollableQueryOptions<TData> {
  return mocks.useQuery.mock.calls.at(-1)?.[0] as PollableQueryOptions<TData>
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
  it('treats a queued sync as in flight', () => {
    expect(isConnectorSyncingOrPending(makeConnector({ status: 'pending' }))).toBe(true)
  })

  it('treats a running sync as in flight', () => {
    expect(isConnectorSyncingOrPending(makeConnector({ status: 'syncing' }))).toBe(true)
  })

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

  it.each(['active', 'paused', 'error', 'disabled'] as const)(
    'does not treat a %s connector as in flight',
    (status) => {
      expect(isConnectorSyncingOrPending(makeConnector({ status }))).toBe(false)
    }
  )
})

describe('useConnectorList polling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(['pending', 'syncing'] as const)('polls while a connector is %s', (status) => {
    useConnectorList(KB_ID)
    const { refetchInterval } = capturedQueryOptions<ConnectorData[]>()

    expect(refetchInterval({ state: { data: [makeConnector({ status })] } })).toBe(
      CONNECTOR_SYNC_POLL_INTERVAL_MS
    )
  })

  it('stops polling once every connector is idle', () => {
    useConnectorList(KB_ID)
    const { refetchInterval } = capturedQueryOptions<ConnectorData[]>()

    expect(refetchInterval({ state: { data: [makeConnector({ status: 'active' })] } })).toBe(false)
  })

  it('does not poll an empty list', () => {
    useConnectorList(KB_ID)
    const { refetchInterval } = capturedQueryOptions<ConnectorData[]>()

    expect(refetchInterval({ state: { data: [] } })).toBe(false)
  })
})

describe('useConnectorDetail polling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('polls the sync history while a sync is in flight', () => {
    useConnectorDetail(KB_ID, 'connector-1')
    const { refetchInterval } = capturedQueryOptions<ConnectorData>()

    expect(refetchInterval({ state: { data: makeConnector({ status: 'syncing' }) } })).toBe(
      CONNECTOR_SYNC_POLL_INTERVAL_MS
    )
  })

  it('stops polling the sync history once the sync finishes', () => {
    useConnectorDetail(KB_ID, 'connector-1')
    const { refetchInterval } = capturedQueryOptions<ConnectorData>()

    expect(refetchInterval({ state: { data: makeConnector({ status: 'active' }) } })).toBe(false)
  })
})

describe('useTriggerSync optimistic state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function capturedMutationOptions() {
    return mocks.useMutation.mock.calls.at(-1)?.[0] as {
      onMutate: (vars: { knowledgeBaseId: string; connectorId: string }) => Promise<unknown>
      onError: (
        error: unknown,
        vars: { knowledgeBaseId: string; connectorId: string },
        context: unknown
      ) => void
    }
  }

  it('marks the connector queued for the duration of the request', async () => {
    const existing = [makeConnector({ status: 'active' })]
    mocks.getQueryData.mockReturnValue(existing)

    useTriggerSync()
    await capturedMutationOptions().onMutate({ knowledgeBaseId: KB_ID, connectorId: 'connector-1' })

    /** `all`, not `lists`: the detail query polls the same status and must not land after the settle. */
    expect(mocks.cancelQueries).toHaveBeenCalledWith({ queryKey: connectorKeys.all(KB_ID) })
    expect(lastListStatusUpdater()(existing)?.[0].status).toBe('pending')
  })

  it('restores the previous status when the request fails', async () => {
    const existing = [makeConnector({ status: 'active' })]
    mocks.getQueryData.mockReturnValue(existing)

    useTriggerSync()
    const options = capturedMutationOptions()
    const context = await options.onMutate({ knowledgeBaseId: KB_ID, connectorId: 'connector-1' })

    mocks.setQueryData.mockClear()
    options.onError(
      new Error('boom'),
      { knowledgeBaseId: KB_ID, connectorId: 'connector-1' },
      context
    )

    expect(lastListStatusUpdater()(existing)?.[0].status).toBe('active')
  })

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

  /**
   * The Search surface reads the member sync status from the workspace
   * member-connector list, which has no poll of its own, so a members-mode
   * trigger patches that cache too and a refused trigger refetches it.
   */
  it('queues a members connector in the workspace member-connector list as well', async () => {
    const existing = [
      makeConnector({ id: 'connector-1', accessMode: 'members', memberSyncStatus: 'idle' }),
    ]
    mocks.getQueryData.mockReturnValue(existing)

    useTriggerSync()
    const options = capturedMutationOptions()
    const context = await options.onMutate({ knowledgeBaseId: KB_ID, connectorId: 'connector-1' })

    expect(mocks.setQueriesData).toHaveBeenCalledWith(
      { queryKey: memberConnectorKeys.lists() },
      expect.any(Function)
    )
    const patchMemberList = mocks.setQueriesData.mock.calls.at(-1)?.[1] as (
      connectors: WorkspaceMemberConnector[] | undefined
    ) => WorkspaceMemberConnector[] | undefined
    const memberList = [
      makeMemberConnector({ connectorId: 'connector-1', memberSyncStatus: 'idle' }),
      makeMemberConnector({ connectorId: 'connector-2', memberSyncStatus: 'idle' }),
    ]
    expect(patchMemberList(memberList)?.map((c) => c.memberSyncStatus)).toEqual(['pending', 'idle'])
    expect(patchMemberList(undefined)).toBeUndefined()

    options.onError(
      new Error('boom'),
      { knowledgeBaseId: KB_ID, connectorId: 'connector-1' },
      context
    )
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: memberConnectorKeys.lists(),
    })
  })

  it('leaves the workspace member-connector list alone for a workspace connector', async () => {
    mocks.getQueryData.mockReturnValue([makeConnector({ status: 'active' })])

    useTriggerSync()
    const options = capturedMutationOptions()
    const context = await options.onMutate({ knowledgeBaseId: KB_ID, connectorId: 'connector-1' })
    options.onError(
      new Error('boom'),
      { knowledgeBaseId: KB_ID, connectorId: 'connector-1' },
      context
    )

    expect(mocks.setQueriesData).not.toHaveBeenCalledWith(
      { queryKey: memberConnectorKeys.lists() },
      expect.any(Function)
    )
    expect(mocks.invalidateQueries).not.toHaveBeenCalledWith({
      queryKey: memberConnectorKeys.lists(),
    })
  })
})

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
    const sources = mocks.useQuery.mock.calls.at(-1)?.[0]
    expect(sources.queryKey).not.toEqual(searchSourceKeys.list('scope-1'))
    await sources.queryFn({ signal })
    expect(mocks.requestJson).toHaveBeenLastCalledWith(listSearchSourcesContract, {
      query: { organizationId: 'scope-1' },
      signal,
    })
  })
  it('uses a workspace-specific key and forwards request cancellation', async () => {
    const signal = new AbortController().signal
    mocks.requestJson.mockResolvedValueOnce({ data: [] })
    useSearchSources('workspace-a')
    const options = mocks.useQuery.mock.calls.at(-1)?.[0]
    expect(options.queryKey).toEqual(searchSourceKeys.list('workspace-a'))
    expect(options.enabled).toBe(true)
    expect(options.staleTime).toBe(30_000)
    expect(options.placeholderData).toBeUndefined()
    await expect(options.queryFn({ signal })).resolves.toEqual([])
    expect(mocks.requestJson).toHaveBeenCalledWith(listSearchSourcesContract, {
      query: { workspaceId: 'workspace-a' },
      signal,
    })
  })

  it('waits for a workspace and respects explicit disabling', () => {
    useSearchSources()
    expect(mocks.useQuery.mock.calls.at(-1)?.[0].enabled).toBe(false)
    useSearchSources('')
    expect(mocks.useQuery.mock.calls.at(-1)?.[0].enabled).toBe(false)
    useSearchSources('workspace-a', { enabled: false })
    expect(mocks.useQuery.mock.calls.at(-1)?.[0].enabled).toBe(false)
  })

  it('polls while sources are syncing and stops after completion', () => {
    useSearchSources('workspace-a')
    const options = mocks.useQuery.mock.calls.at(-1)?.[0]
    expect(options.refetchInterval({ state: { data: [{ isSyncing: true }] } })).toBe(
      CONNECTOR_SYNC_POLL_INTERVAL_MS
    )
    expect(options.refetchInterval({ state: { data: [{ isSyncing: false }] } })).toBe(false)
    expect(options.refetchInterval({ state: {} })).toBe(false)
  })
})
