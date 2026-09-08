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

import { listAuthorizedAppsContract, revokeAuthorizedAppContract } from '@/lib/api/contracts/user'
import {
  oauthProviderKeys,
  useAuthorizedApps,
  useOAuthConsent,
  useOAuthPublicClient,
  useOAuthSwitchAccount,
  useRevokeAuthorizedApp,
} from '@/hooks/queries/oauth-provider'

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
    vi.clearAllMocks()
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

  it('loads subsequent pages with the same search and forwards cancellation', async () => {
    mocks.requestJson
      .mockResolvedValueOnce({ apps: [{ clientId: 'first' }], nextCursor: 'next-cursor' })
      .mockResolvedValueOnce({ apps: [{ clientId: 'last' }], nextCursor: null })
    const hook = renderHook(() => useAuthorizedApps('test app'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })

    expect(hook.result().hasNextPage).toBe(true)
    await act(async () => {
      await hook.result().fetchNextPage()
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(mocks.requestJson).toHaveBeenNthCalledWith(1, listAuthorizedAppsContract, {
      query: { search: 'test app' },
      signal: expect.any(AbortSignal),
    })
    expect(mocks.requestJson).toHaveBeenNthCalledWith(2, listAuthorizedAppsContract, {
      query: { search: 'test app', cursor: 'next-cursor' },
      signal: expect.any(AbortSignal),
    })
    expect(hook.result().data?.pages).toHaveLength(2)
    expect(hook.result().hasNextPage).toBe(false)
  })

  it('invalidates every search after revocation without invalidating client registrations', async () => {
    mocks.requestJson.mockResolvedValue({ success: true })
    const hook = renderHook(useRevokeAuthorizedApp)
    hook.queryClient.setQueryData(oauthProviderKeys.authorizedAppsList('one'), { pages: [] })
    hook.queryClient.setQueryData(oauthProviderKeys.authorizedAppsList('two'), { pages: [] })
    hook.queryClient.setQueryData(oauthProviderKeys.client('sim-cli', 'request'), {
      name: 'Sim CLI',
    })

    await act(async () => {
      await hook.result().mutateAsync('sim-cli')
    })
    expect(mocks.requestJson).toHaveBeenCalledWith(revokeAuthorizedAppContract, {
      params: { clientId: 'sim-cli' },
    })
    expect(
      hook.queryClient.getQueryState(oauthProviderKeys.authorizedAppsList('one'))?.isInvalidated
    ).toBe(true)
    expect(
      hook.queryClient.getQueryState(oauthProviderKeys.authorizedAppsList('two'))?.isInvalidated
    ).toBe(true)
    expect(
      hook.queryClient.getQueryState(oauthProviderKeys.client('sim-cli', 'request'))?.isInvalidated
    ).toBe(false)
  })

  it('does not look up unsigned requests and aborts an in-flight registration lookup', async () => {
    const unsigned = renderHook(() => useOAuthPublicClient('sim-cli'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(unsigned.result().fetchStatus).toBe('idle')
    expect(mocks.publicClientPrelogin).not.toHaveBeenCalled()

    mocks.publicClientPrelogin.mockReturnValue(new Promise(() => {}))
    const signed = renderHook(() => useOAuthPublicClient('sim-cli', 'signed-request'))
    const signal = mocks.publicClientPrelogin.mock.calls[0][0].fetchOptions.signal as AbortSignal
    expect(signal.aborted).toBe(false)
    await act(async () => {
      await signed.queryClient.cancelQueries()
    })
    expect(signal.aborted).toBe(true)
  })

  it.each([true, false])('returns the protocol redirect after accept=%s', async (accept) => {
    const url = accept
      ? 'http://127.0.0.1:1234/callback?code=accepted&state=state'
      : 'http://127.0.0.1:1234/callback?error=access_denied&state=state'
    mocks.consent.mockResolvedValue({ data: { url }, error: null })
    const hook = renderHook(useOAuthConsent)
    await act(async () => {
      await expect(hook.result().mutateAsync(accept)).resolves.toBe(url)
    })
    expect(mocks.consent).toHaveBeenCalledWith({ accept })
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
