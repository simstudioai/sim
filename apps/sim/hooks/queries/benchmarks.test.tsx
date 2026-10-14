/** @vitest-environment jsdom */
import { act } from 'react'
import { createDeferred } from '@sim/testing/helpers/deferred'
import {
  apiClientRequestMock,
  apiClientRequestMockFns,
} from '@sim/testing/mocks/api-client-request.mock'
import { authClientMock, authClientMockFns } from '@sim/testing/mocks/auth-client.mock'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  useBenchmark,
  useBenchmarkAvailability,
  useBenchmarkOrganizations,
  useBenchmarkRun,
  useBenchmarkRuns,
  useBenchmarks,
  useBenchmarkUsers,
  useBenchmarkWorkspaces,
  useUpdateBenchmark,
} from '@/hooks/queries/benchmarks'

vi.mock('@/lib/api/client/request', () => apiClientRequestMock)
vi.mock('@/lib/auth/auth-client', () => authClientMock)
let root: Root
let client: QueryClient
let container: HTMLDivElement
let update: ReturnType<typeof useUpdateBenchmark>
let observed: unknown
function Probe() {
  const detail = useBenchmark('org', 'benchmark')
  const list = useBenchmarks('org')
  const availability = useBenchmarkAvailability()
  const organizations = useBenchmarkOrganizations('')
  const users = useBenchmarkUsers('org', '')
  const workspaces = useBenchmarkWorkspaces('org', 'target')
  const runs = useBenchmarkRuns('org', 'benchmark', '')
  const run = useBenchmarkRun('org', 'benchmark', 'run')
  update = useUpdateBenchmark('org', 'benchmark')
  observed = [detail, list, availability, organizations, users, workspaces, runs, run].map(
    (query) => query.data
  )
  return null
}
const response = (owner: string) => ({
  marker: owner,
  benchmark: { id: 'benchmark', name: owner },
  benchmarks: [],
  runs: [],
  organizations: [],
  users: [],
  workspaces: [],
  nextCursor: null,
  available: true,
})
async function render(userId: string | null, isPending = false) {
  authClientMockFns.mockUseSession.mockReturnValue({
    data: userId ? { user: { id: userId } } : null,
    isPending,
    error: null,
  })
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>
    )
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1)
  })
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  apiClientRequestMockFns.mockRequestJson.mockReset()
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
      mutations: { retry: false, gcTime: Number.POSITIVE_INFINITY },
    },
  })
  container = document.createElement('div')
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  client.clear()
  vi.useRealTimers()
})
it('conceals all private benchmark data when an account refresh changes operator or becomes pending', async () => {
  apiClientRequestMockFns.mockRequestJson.mockResolvedValue(response('operator-a-private'))
  await render('a')
  expect(JSON.stringify(observed)).toContain('operator-a-private')
  const pending = createDeferred<unknown>()
  apiClientRequestMockFns.mockRequestJson.mockReturnValue(pending.promise)
  await render('b')
  expect(JSON.stringify(observed)).not.toContain('operator-a-private')
  const calls = apiClientRequestMockFns.mockRequestJson.mock.calls.length
  await render('a', true)
  expect(JSON.stringify(observed)).not.toContain('operator-a-private')
  expect(apiClientRequestMockFns.mockRequestJson).toHaveBeenCalledTimes(calls)
  await render(null)
  expect(JSON.stringify(observed)).not.toContain('operator-a-private')
  expect(apiClientRequestMockFns.mockRequestJson).toHaveBeenCalledTimes(calls)
})
it('keeps a pending previous-operator mutation from overwriting the new operator cache', async () => {
  apiClientRequestMockFns.mockRequestJson.mockResolvedValue(response('operator-a-private'))
  await render('a')
  const pending = createDeferred<unknown>()
  apiClientRequestMockFns.mockRequestJson.mockReturnValueOnce(pending.promise)
  let mutation: Promise<unknown>
  await act(async () => {
    mutation = update.mutateAsync({ version: 1, name: 'edited' })
  })
  apiClientRequestMockFns.mockRequestJson.mockResolvedValue(response('operator-b-private'))
  await render('b')
  await act(async () => {
    pending.resolve(response('operator-a-edited'))
    await mutation
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1)
  })
  expect(JSON.stringify(observed)).toContain('operator-b-private')
  expect(JSON.stringify(observed)).not.toContain('operator-a')
})
