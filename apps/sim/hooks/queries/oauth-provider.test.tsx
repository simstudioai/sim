/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requestJson: vi.fn(),
  publicClientPrelogin: vi.fn(),
  consent: vi.fn(),
  signOut: vi.fn(),
}))

vi.mock('@/lib/api/client/request', () => ({ requestJson: mocks.requestJson }))
vi.mock('@/lib/auth/auth-client', () => ({
  client: {
    oauth2: { publicClientPrelogin: mocks.publicClientPrelogin, consent: mocks.consent },
    signOut: mocks.signOut,
  },
}))

import { useOAuthConsent, useOAuthSwitchAccount } from '@/hooks/queries/oauth-provider'

const mounted: { root: Root; queryClient: QueryClient }[] = []

function renderHook<T>(useHook: () => T) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const root = createRoot(document.createElement('div'))
  mounted.push({ root, queryClient })
  let latest: T
  function Probe() {
    latest = useHook()
    return null
  }
  act(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>
    )
  )
  return { result: () => latest, queryClient }
}

describe('OAuth provider hooks', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  })

  afterEach(() => {
    for (const { root, queryClient } of mounted.splice(0)) {
      act(() => root.unmount())
      queryClient.clear()
    }
    vi.useRealTimers()
  })

  it.each([
    [{ data: null, error: { message: 'The request has expired.' } }, 'The request has expired.'],
    [{ data: {}, error: null }, 'The authorization could not be completed.'],
  ])('rejects a failed or incomplete consent response', async (response, message) => {
    mocks.consent.mockResolvedValue(response)
    const hook = renderHook(useOAuthConsent)
    await act(async () => {
      await expect(hook.result().mutateAsync(true)).rejects.toThrow(message)
    })
  })

  it('rejects failed sign-out so the view cannot continue under the old account', async () => {
    mocks.signOut.mockResolvedValue({ error: { message: 'Unable to end this session.' } })
    const hook = renderHook(useOAuthSwitchAccount)
    await act(async () => {
      await expect(hook.result().mutateAsync()).rejects.toThrow('Unable to end this session.')
    })
    expect(mocks.signOut).toHaveBeenCalledExactlyOnceWith()
  })
})
