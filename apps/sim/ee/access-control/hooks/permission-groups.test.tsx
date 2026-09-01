/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { sleep } from '@sim/utils/helpers'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequestJson } = vi.hoisted(() => ({
  mockRequestJson: vi.fn(),
}))

vi.mock('@/lib/api/client/request', () => ({
  requestJson: mockRequestJson,
}))

import { ApiClientError } from '@/lib/api/client/errors'
import { useUserPermissionConfig } from '@/ee/access-control/hooks/permission-groups'

const WORKSPACE_ID = 'ws-1'

const CONFIG_RESPONSE = {
  entitled: true,
  permissionGroupId: null,
  config: null,
}

/**
 * Mounts the hook in a real React root under a real `QueryClientProvider`, the
 * way `hooks/queries/unsubscribe.test.tsx` does (the repo has no
 * `@testing-library/react`).
 *
 * The client deliberately overrides only `retryDelay`, so the hook's own
 * `retry` and `retryOnMount` are the options under test rather than the
 * harness's. `gcTime: Infinity` keeps the failed query in the cache across the
 * unmount/remount that `retryOnMount` is about.
 */
function makeHarness() {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retryDelay: 0, gcTime: Number.POSITIVE_INFINITY },
      mutations: { retry: false },
    },
  })

  function mount<T>(useHook: () => T) {
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

  return { queryClient, mount }
}

/** Drives React and the query observer until `predicate` holds, or gives up. */
async function settle(predicate: () => boolean) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (predicate()) return
    await act(async () => {
      await Promise.resolve()
      await sleep(0)
    })
  }
}

function serverError() {
  return new ApiClientError({ status: 500, message: 'boom' })
}

function refusal() {
  return new ApiClientError({ status: 403, message: 'Forbidden' })
}

/**
 * Consumers of this query fail CLOSED — the API-keys page withholds the create
 * button until the read succeeds. The app's own query defaults (`retry: 1`,
 * `retryOnMount: false`, no focus refetch on the web) would leave one transient
 * failure disabling that button for the rest of the session, so the retry
 * policy is the thing that keeps a fail-closed gate from wedging.
 */
describe('useUserPermissionConfig retry policy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('retries a transient failure three times before giving up', async () => {
    mockRequestJson.mockRejectedValue(serverError())

    const { mount } = makeHarness()
    const { result, unmount } = mount(() => useUserPermissionConfig(WORKSPACE_ID))
    await settle(() => result().isError)

    expect(result().isError).toBe(true)
    expect(mockRequestJson).toHaveBeenCalledTimes(4)

    unmount()
  })

  it('recovers when a retry succeeds, so the gate is never left unanswered', async () => {
    mockRequestJson
      .mockRejectedValueOnce(serverError())
      .mockResolvedValueOnce(structuredClone(CONFIG_RESPONSE))

    const { mount } = makeHarness()
    const { result, unmount } = mount(() => useUserPermissionConfig(WORKSPACE_ID))
    await settle(() => result().isSuccess)

    expect(result().isSuccess).toBe(true)
    expect(mockRequestJson).toHaveBeenCalledTimes(2)

    unmount()
  })

  it('does not retry a refusal, which asking again cannot change', async () => {
    mockRequestJson.mockRejectedValue(refusal())

    const { mount } = makeHarness()
    const { result, unmount } = mount(() => useUserPermissionConfig(WORKSPACE_ID))
    await settle(() => result().isError)

    expect(result().isError).toBe(true)
    expect(mockRequestJson).toHaveBeenCalledTimes(1)

    unmount()
  })

  /**
   * `requestJson` raises an `ApiClientError` carrying the response status when a
   * 2xx body fails contract validation, so the failure arrives as a `200`.
   * Asking again produces the same body; a "not a 4xx" test sent four.
   */
  it('does not retry a contract-validation failure, which arrives as a 200', async () => {
    mockRequestJson.mockRejectedValue(
      new ApiClientError({ status: 200, message: 'Invalid response' })
    )

    const { mount } = makeHarness()
    const { result, unmount } = mount(() => useUserPermissionConfig(WORKSPACE_ID))
    await settle(() => result().isError)

    expect(mockRequestJson).toHaveBeenCalledTimes(1)

    unmount()
  })

  it('retries again on remount, so reopening settings is a real retry', async () => {
    mockRequestJson.mockRejectedValue(refusal())

    const { mount } = makeHarness()
    const first = mount(() => useUserPermissionConfig(WORKSPACE_ID))
    await settle(() => first.result().isError)
    expect(mockRequestJson).toHaveBeenCalledTimes(1)
    first.unmount()

    mockRequestJson.mockReset()
    mockRequestJson.mockResolvedValue(structuredClone(CONFIG_RESPONSE))

    const second = mount(() => useUserPermissionConfig(WORKSPACE_ID))
    await settle(() => second.result().isSuccess)

    expect(mockRequestJson).toHaveBeenCalledTimes(1)
    expect(second.result().isSuccess).toBe(true)

    second.unmount()
  })
})
