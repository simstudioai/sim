/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequestJson } = vi.hoisted(() => ({
  mockRequestJson: vi.fn(),
}))

vi.mock('@/lib/api/client/request', () => ({
  requestJson: mockRequestJson,
}))

import { getLogByExecutionIdContract } from '@/lib/api/contracts/logs'
import { cancelWorkflowExecutionContract } from '@/lib/api/contracts/workflows'
import { useCancelExecution } from '@/hooks/queries/logs'

function renderHookWithClient<T>(useHook: () => T): {
  result: () => T
  unmount: () => void
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
    unmount: () => act(() => root.unmount()),
  }
}

describe('useCancelExecution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('polls the execution and keeps reconciling until it is terminal', async () => {
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
      .mockResolvedValueOnce({ data: { id: 'log-1', status: 'running' } })
      .mockResolvedValueOnce({ data: { id: 'log-1', status: 'cancelled' } })

    const { result, unmount } = renderHookWithClient(() => useCancelExecution('workspace-1'))

    await act(async () => {
      const mutation = result().mutateAsync({
        workflowId: 'workflow-1',
        executionId: 'execution-1',
      })
      await vi.runAllTimersAsync()
      await mutation
    })

    expect(mockRequestJson).toHaveBeenNthCalledWith(1, cancelWorkflowExecutionContract, {
      params: { id: 'workflow-1', executionId: 'execution-1' },
    })
    expect(mockRequestJson).toHaveBeenNthCalledWith(2, getLogByExecutionIdContract, {
      params: { executionId: 'execution-1' },
      query: { workspaceId: 'workspace-1' },
      signal: undefined,
    })
    expect(mockRequestJson).toHaveBeenNthCalledWith(3, getLogByExecutionIdContract, {
      params: { executionId: 'execution-1' },
      query: { workspaceId: 'workspace-1' },
      signal: undefined,
    })
    expect(result().isSuccess).toBe(true)

    unmount()
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

      const { result, unmount } = renderHookWithClient(() => useCancelExecution('workspace-1'))

      await act(async () => {
        await expect(
          result().mutateAsync({
            workflowId: 'workflow-1',
            executionId: 'execution-1',
          })
        ).rejects.toThrow(`Run finished as ${status} before cancellation was confirmed`)
      })
      unmount()
    }
  )

  it('rejects when cancellation confirmation polling is exhausted', async () => {
    mockRequestJson.mockResolvedValueOnce({
      success: true,
      executionId: 'execution-1',
      redisAvailable: true,
      durablyRecorded: true,
      locallyAborted: false,
      pausedCancelled: false,
      reason: 'recorded',
    })
    mockRequestJson.mockResolvedValue({ data: { id: 'log-1', status: 'running' } })

    const { result, unmount } = renderHookWithClient(() => useCancelExecution('workspace-1'))

    await act(async () => {
      const mutation = result().mutateAsync({
        workflowId: 'workflow-1',
        executionId: 'execution-1',
      })
      const assertion = expect(mutation).rejects.toThrow(
        'Run stop was requested, but cancellation was not confirmed in time'
      )
      await vi.runAllTimersAsync()
      await assertion
    })
    expect(result().isError).toBe(true)

    unmount()
  })

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
