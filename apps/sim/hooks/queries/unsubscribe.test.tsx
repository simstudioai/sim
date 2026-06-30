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

import { requestJson } from '@/lib/api/client/request'
import { unsubscribeGetContract, unsubscribePostContract } from '@/lib/api/contracts/user'
import {
  unsubscribeKeys,
  useUnsubscribe,
  useUnsubscribeMutation,
} from '@/hooks/queries/unsubscribe'

const EMAIL = 'person@example.com'
const TOKEN = 'tok-123'

const getResponse = {
  success: true as const,
  email: EMAIL,
  token: TOKEN,
  emailType: 'marketing',
  isTransactional: false,
  currentPreferences: {
    unsubscribeAll: false,
    unsubscribeMarketing: false,
    unsubscribeUpdates: false,
    unsubscribeNotifications: false,
  },
}

/**
 * Minimal dependency-free hook harness (the repo has no `@testing-library/react`).
 * Mounts the hook in a real React 19 root under jsdom, wrapped in a real
 * `QueryClientProvider`, so query/mutation lifecycles run exactly as in the app.
 */
function renderHookWithClient<T>(useHook: () => T): {
  result: () => T
  queryClient: QueryClient
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
    queryClient,
    unmount: () => act(() => root.unmount()),
  }
}

/** Flush pending microtasks and the macrotask queue (query observer scheduling) inside act(). */
async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i++) {
      await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  })
}

describe('useUnsubscribe', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('is disabled and does not fetch when email or token is missing', async () => {
    const missingToken = renderHookWithClient(() => useUnsubscribe(EMAIL, undefined))
    const missingEmail = renderHookWithClient(() => useUnsubscribe(undefined, TOKEN))
    const missingBoth = renderHookWithClient(() => useUnsubscribe(undefined, undefined))
    await flush()

    expect(missingToken.result().fetchStatus).toBe('idle')
    expect(missingEmail.result().fetchStatus).toBe('idle')
    expect(missingBoth.result().fetchStatus).toBe('idle')
    expect(mockRequestJson).not.toHaveBeenCalled()

    missingToken.unmount()
    missingEmail.unmount()
    missingBoth.unmount()
  })

  it('fetches when both params are present and surfaces the contract data', async () => {
    mockRequestJson.mockResolvedValueOnce(getResponse)

    const { result, unmount } = renderHookWithClient(() => useUnsubscribe(EMAIL, TOKEN))
    await flush()

    expect(requestJson).toHaveBeenCalledTimes(1)
    expect(requestJson).toHaveBeenCalledWith(
      unsubscribeGetContract,
      expect.objectContaining({ query: { email: EMAIL, token: TOKEN } })
    )
    expect(result().isSuccess).toBe(true)
    expect(result().data).toEqual(getResponse)
    expect(result().data?.isTransactional).toBe(false)

    unmount()
  })
})

describe('useUnsubscribeMutation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('calls requestJson with the post contract and flips the cached preference flag on success', async () => {
    mockRequestJson.mockResolvedValueOnce({
      success: true as const,
      message: 'Unsubscribed',
      email: EMAIL,
      type: 'marketing' as const,
      emailType: 'marketing',
    })

    const { result, queryClient, unmount } = renderHookWithClient(() => useUnsubscribeMutation())
    const detailKey = unsubscribeKeys.detail(EMAIL, TOKEN)
    queryClient.setQueryData(detailKey, getResponse)

    await act(async () => {
      await result().mutateAsync({ email: EMAIL, token: TOKEN, type: 'marketing' })
    })
    await flush()

    expect(result().isSuccess).toBe(true)
    expect(requestJson).toHaveBeenCalledTimes(1)
    expect(requestJson).toHaveBeenCalledWith(
      unsubscribePostContract,
      expect.objectContaining({ body: { email: EMAIL, token: TOKEN, type: 'marketing' } })
    )

    const reconciled = queryClient.getQueryData<typeof getResponse>(detailKey)
    expect(reconciled?.currentPreferences.unsubscribeMarketing).toBe(true)
    expect(reconciled?.currentPreferences.unsubscribeAll).toBe(false)
    expect(reconciled?.currentPreferences.unsubscribeUpdates).toBe(false)

    unmount()
  })

  it('flips unsubscribeAll when type is "all"', async () => {
    mockRequestJson.mockResolvedValueOnce({
      success: true as const,
      message: 'Unsubscribed',
      email: EMAIL,
      type: 'all' as const,
      emailType: 'marketing',
    })

    const { result, queryClient, unmount } = renderHookWithClient(() => useUnsubscribeMutation())
    const detailKey = unsubscribeKeys.detail(EMAIL, TOKEN)
    queryClient.setQueryData(detailKey, getResponse)

    await act(async () => {
      await result().mutateAsync({ email: EMAIL, token: TOKEN, type: 'all' })
    })
    await flush()

    expect(result().isSuccess).toBe(true)
    const reconciled = queryClient.getQueryData<typeof getResponse>(detailKey)
    expect(reconciled?.currentPreferences.unsubscribeAll).toBe(true)

    unmount()
  })
})
