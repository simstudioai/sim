/**
 * @vitest-environment jsdom
 */

import { act, type ReactNode } from 'react'
import {
  apiClientRequestMock,
  apiClientRequestMockFns,
} from '@sim/testing/mocks/api-client-request.mock'
import {
  focusManager,
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api/client/request', () => apiClientRequestMock)

import {
  type LogFilters,
  logKeys,
  NEW_LOG_COUNT_STALE_TIME,
  useCancelExecution,
  useLogSnapshotUpdates,
  useLogsSnapshot,
  useNewLogCount,
} from '@/hooks/queries/logs'

const mockRequestJson = apiClientRequestMockFns.mockRequestJson

function renderHookWithClient<T>(useHook: () => T): {
  result: () => T
  unmount: () => void
  rerender: () => void
  queryClient: QueryClient
} {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  const container = document.createElement('div')
  const root: Root = createRoot(container)
  let latest: T

  function Probe() {
    latest = useHook()
    return null
  }

  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }

  act(() => {
    root.render(
      <Wrapper>
        <Probe />
      </Wrapper>
    )
  })

  return {
    result: () => latest,
    unmount: () => {
      act(() => root.unmount())
      queryClient.clear()
    },
    rerender: () =>
      act(() =>
        root.render(
          <Wrapper>
            <Probe />
          </Wrapper>
        )
      ),
    queryClient,
  }
}

const SNAPSHOT_AT = '2026-09-24T15:45:00.000Z'
const NEXT_SNAPSHOT_AT = '2026-09-24T15:46:00.000Z'
const LOG_FILTERS: LogFilters = {
  timeRange: 'All time',
  level: 'all',
  workflowIds: [],
  folderIds: [],
  triggers: [],
  searchQuery: '',
  limit: 50,
  sortBy: 'date',
  sortOrder: 'desc',
}

async function flushQueries() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10)
  })
}

describe('manually refreshed logs', () => {
  let unmount: (() => void) | undefined
  let snapshotAt: string
  let newCount: number
  let failRefresh: boolean
  let revision: string

  beforeEach(() => {
    vi.useFakeTimers()
    snapshotAt = SNAPSHOT_AT
    newCount = 0
    failRefresh = false
    revision = 'first-revision'
    mockRequestJson.mockImplementation(async (_contract, { query }) => {
      if (query.startedAfter) return { data: [], nextCursor: null, total: newCount }
      if (query.countOnly) return { data: [], nextCursor: null, total: 1, revision }
      if (failRefresh) throw new Error('Refresh failed')
      return {
        data: [{ id: query.cursor ? 'older-log' : snapshotAt, status: 'running' }],
        nextCursor: query.cursor ? null : 'next-page',
        snapshotAt,
        revision,
      }
    })
  })

  afterEach(() => {
    unmount?.()
    unmount = undefined
    focusManager.setFocused(undefined)
    onlineManager.setOnline(true)
    vi.useRealTimers()
  })

  function useLogs(
    filters = LOG_FILTERS,
    enabled = true,
    workspaceId: string | undefined = 'ws-1'
  ) {
    const list = useLogsSnapshot(workspaceId, filters, { enabled })
    const count = useNewLogCount(
      workspaceId,
      filters,
      list.isPlaceholderData ? undefined : list.data?.pages[0]?.snapshotAt,
      { enabled }
    )
    const updates = useLogSnapshotUpdates(
      workspaceId,
      list.isPlaceholderData ? undefined : list.data?.pages[0],
      { enabled: enabled && (count.data ?? 0) === 0 }
    )
    return { list, count, updates }
  }

  it('pins pagination to the displayed snapshot and acknowledges new logs only after refresh', async () => {
    const hook = renderHookWithClient(() => useLogs())
    unmount = hook.unmount
    await flushQueries()
    newCount = 2
    await act(async () => {
      await vi.advanceTimersByTimeAsync(NEW_LOG_COUNT_STALE_TIME)
    })
    await act(async () => {
      await hook.result().list.fetchNextPage()
    })
    await flushQueries()

    expect(hook.result().list.data?.pages).toHaveLength(2)
    expect(hook.result().count.data).toBe(2)
    expect(mockRequestJson).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        query: expect.objectContaining({ cursor: 'next-page', snapshotAt: SNAPSHOT_AT }),
        signal: expect.any(AbortSignal),
      })
    )

    snapshotAt = NEXT_SNAPSHOT_AT
    newCount = 0
    await act(async () => {
      await hook.result().list.refetch()
    })
    await flushQueries()

    expect(hook.result().list.data?.pages[0]?.logs[0]?.id).toBe(NEXT_SNAPSHOT_AT)
    expect(hook.result().count.data).toBe(0)
    expect(mockRequestJson).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        query: expect.objectContaining({
          startedAfter: NEXT_SNAPSHOT_AT,
          countOnly: true,
        }),
      })
    )
  })

  it('stops pagination when a row moves across the sort cursor and recovers on refresh', async () => {
    const hook = renderHookWithClient(() => useLogs({ ...LOG_FILTERS, sortBy: 'cost' }))
    unmount = hook.unmount
    await flushQueries()
    const originalRows = hook.result().list.data?.pages[0]?.logs
    revision = 'cost-changed-revision'
    await act(async () => {
      await hook.result().list.fetchNextPage()
    })
    await flushQueries()

    expect(hook.result().list.data?.pages[0]?.logs).toBe(originalRows)
    expect(hook.result().list.data?.pages[1]).toMatchObject({ logs: [], snapshotChanged: true })
    expect(hook.result().list.hasNextPage).toBe(false)

    snapshotAt = NEXT_SNAPSHOT_AT
    await act(async () => {
      await hook.result().list.refetch()
    })
    await flushQueries()
    expect(hook.result().list.data?.pages.every((page) => !page.snapshotChanged)).toBe(true)
    expect(hook.result().list.data?.pages[1]?.logs).toHaveLength(1)
  })

  it('resets the indicator when filters change and checks the same filters as the list', async () => {
    let filters = LOG_FILTERS
    newCount = 8
    const hook = renderHookWithClient(() => useLogs(filters))
    unmount = hook.unmount
    await flushQueries()
    expect(hook.result().count.data).toBe(8)

    filters = {
      ...LOG_FILTERS,
      workflowIds: ['wf-1'],
      level: 'error',
      sortBy: 'cost',
      sortOrder: 'asc',
    }
    newCount = 0
    hook.rerender()
    expect(hook.result().count.data).toBeUndefined()
    await flushQueries()

    expect(hook.result().count.data).toBe(0)
    expect(mockRequestJson).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        query: expect.objectContaining({
          workspaceId: 'ws-1',
          workflowIds: 'wf-1',
          level: 'error',
          sortBy: 'cost',
          sortOrder: 'asc',
          startedAfter: SNAPSHOT_AT,
          countOnly: true,
        }),
      })
    )
  })
})

describe('useCancelExecution', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it.each(['completed', 'failed'] as const)(
    'rejects when the run reaches %s instead of cancelled',
    async (status) => {
      mockRequestJson
        .mockResolvedValueOnce({
          success: true,
          executionId: 'execution-1',
          redisAvailable: true,
          durablyRecorded: true,
          locallyAborted: false,
          pausedCancelled: false,
          reason: 'recorded',
        })
        .mockResolvedValueOnce({ data: { id: 'log-1', status } })

      const { result, unmount, queryClient } = renderHookWithClient(() =>
        useCancelExecution('workspace-1')
      )
      const key = logKeys.snapshot('workspace-1', LOG_FILTERS)
      queryClient.setQueryData(key, {
        pages: [
          {
            logs: [{ id: 'log-1', executionId: 'execution-1', status: 'running' }],
            snapshotAt: SNAPSHOT_AT,
            nextCursor: null,
          },
        ],
        pageParams: [null],
      })
      queryClient.setQueryData(logKeys.detail('workspace-1', 'log-1'), {
        id: 'log-1',
        status: 'running',
      })

      await act(async () => {
        await expect(
          result().mutateAsync({
            workflowId: 'workflow-1',
            executionId: 'execution-1',
          })
        ).rejects.toThrow(`Run finished as ${status} before cancellation was confirmed`)
      })
      expect(queryClient.getQueryData(key)).toMatchObject({
        pages: [{ logs: [{ id: 'log-1', status }], snapshotAt: SNAPSHOT_AT }],
      })
      expect(queryClient.getQueryData(logKeys.detail('workspace-1', 'log-1'))).toMatchObject({
        status,
      })
      unmount()
    }
  )

  it('surfaces persistent log lookup failures instead of reporting success', async () => {
    mockRequestJson.mockResolvedValueOnce({
      success: true,
      executionId: 'execution-1',
      redisAvailable: true,
      durablyRecorded: true,
      locallyAborted: false,
      pausedCancelled: false,
      reason: 'recorded',
    })
    mockRequestJson.mockRejectedValue(new Error('network unavailable'))

    const { result, unmount } = renderHookWithClient(() => useCancelExecution('workspace-1'))

    await act(async () => {
      const mutation = result().mutateAsync({
        workflowId: 'workflow-1',
        executionId: 'execution-1',
      })
      const assertion = expect(mutation).rejects.toThrow(
        'Unable to confirm that the run stopped: network unavailable'
      )
      await vi.runAllTimersAsync()
      await assertion
    })
    expect(result().isError).toBe(true)

    unmount()
  })
})
