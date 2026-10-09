/** @vitest-environment jsdom */
import { act } from 'react'
import { flushMicrotasks } from '@sim/testing/helpers/async'
import { jsonResponse } from '@sim/testing/helpers/http'
import { authClientMock, authClientMockFns } from '@sim/testing/mocks/auth-client.mock'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { Benchmark } from '@/app/o/[organizationId]/benchmark/benchmark'

vi.mock('@/lib/auth/auth-client', () => authClientMock)

vi.mock('@/app/o/[organizationId]/benchmark/components', () => ({
  BenchmarkDetail: () => null,
  CreateBenchmark: () => null,
}))

it.each([false, true])(
  'recovers initial failure %s and paginates without losing cached benchmarks',
  async (initialFailure) => {
    authClientMockFns.mockUseSession.mockReturnValue({
      data: { user: { id: 'owner' } },
      isPending: false,
      error: null,
    })
    vi.useFakeTimers()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const record = (id: string) => ({
      id,
      name: id,
      organizationId: 'org',
      userId: 'owner',
      runAsUserId: 'owner',
      sourceWorkspaceId: 'workspace',
      version: 1,
      runningStage: null,
      leaseExpiresAt: null,
      attemptId: null,
      plannerChatId: null,
      error: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    const fetcher = vi.fn()
    if (initialFailure)
      fetcher.mockResolvedValueOnce(jsonResponse({ error: 'Temporary failure' }, 503))
    fetcher
      .mockResolvedValueOnce(
        jsonResponse({ benchmarks: [record('First benchmark')], nextCursor: 'next' })
      )
      .mockResolvedValueOnce(jsonResponse({ error: 'Temporary failure' }, 503))
      .mockResolvedValueOnce(
        jsonResponse({ benchmarks: [record('Older benchmark')], nextCursor: null })
      )
    vi.stubGlobal('fetch', fetcher)
    const settle = async (action: () => void) => {
      await act(async () => action())
      await act(async () => {
        await flushMicrotasks()
        await vi.advanceTimersByTimeAsync(1)
      })
    }
    const openButtons = () =>
      [...container.querySelectorAll<HTMLButtonElement>('button')].filter(
        (button) => button.textContent === 'Open'
      )
    const olderButton = () =>
      [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
        /older benchmarks/i.test(button.textContent ?? '')
      )
    try {
      await settle(() =>
        root.render(
          <QueryClientProvider client={client}>
            <NuqsTestingAdapter hasMemory>
              <Benchmark organizationId='org' runAsUserId='owner' canPlan />
            </NuqsTestingAdapter>
          </QueryClientProvider>
        )
      )
      if (initialFailure) {
        expect(openButtons()).toHaveLength(0)
        await settle(() =>
          [...container.querySelectorAll<HTMLButtonElement>('button')]
            .find((button) => button.textContent === 'Retry')
            ?.click()
        )
      }
      expect(openButtons()).toHaveLength(1)
      await settle(() => olderButton()?.click())
      expect(container.querySelector('[role="alert"]')).not.toBeNull()
      expect(openButtons()).toHaveLength(1)
      expect(olderButton()?.disabled).toBe(false)
      await settle(() => olderButton()?.click())
      expect(openButtons()).toHaveLength(2)
      expect(container.querySelector('[role="alert"]')).toBeNull()
      expect(olderButton()).toBeUndefined()
    } finally {
      await act(async () => root.unmount())
      client.clear()
      container.remove()
      vi.useRealTimers()
    }
  }
)
