/** @vitest-environment jsdom */
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiClientError } from '@/lib/api/client/errors'
import {
  type GitHubSearchSetupScope,
  type GitHubSearchSetupStatus,
  readGitHubSearchSetupContract,
} from '@/lib/api/contracts/knowledge/github-setup'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@/lib/api/client/request', () => ({ requestJson: mocks.request }))

import { githubSearchSetupKeys, useGitHubSearchSetup } from '@/hooks/queries/github-search-setup'

const SCOPE: GitHubSearchSetupScope = {
  organizationId: 'org-1',
  setupId: 'cbe393bf-eb93-4b61-8e53-ce1dd602ba77',
}

interface ProbeProps {
  scope?: GitHubSearchSetupScope
}

describe('GitHub setup status queries', () => {
  let root: Root
  let client: QueryClient
  let result: ReturnType<typeof useGitHubSearchSetup>

  function Probe({ scope }: ProbeProps) {
    result = useGitHubSearchSetup(scope)
    return null
  }

  async function advance(milliseconds: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(milliseconds)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
  }

  async function render(scope?: GitHubSearchSetupScope) {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <Probe scope={scope} />
        </QueryClientProvider>
      )
    )
    await advance(1)
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    mocks.request.mockReset()
    mocks.request.mockResolvedValue({ success: true, data: { status: 'pending' } })
    client = new QueryClient({ defaultOptions: { queries: { retryDelay: 1 } } })
    root = createRoot(document.createElement('div'))
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    client.clear()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('does not request or poll without an active scope', async () => {
    await render()
    await advance(30_000)
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('forwards the exact scope and aborts a read when its scope is replaced', async () => {
    const signals: AbortSignal[] = []
    mocks.request.mockImplementation((_contract: unknown, input: { signal: AbortSignal }) => {
      signals.push(input.signal)
      return new Promise((_resolve, reject) => {
        input.signal.addEventListener('abort', () => reject(new Error('Aborted')), {
          once: true,
        })
      })
    })
    await render(SCOPE)
    expect(mocks.request).toHaveBeenCalledWith(readGitHubSearchSetupContract, {
      query: SCOPE,
      signal: expect.any(AbortSignal),
    })
    expect(signals[0].aborted).toBe(false)

    const otherScope = { ...SCOPE, organizationId: 'org-2' }
    await render(otherScope)
    expect(signals[0].aborted).toBe(true)
    expect(signals[1].aborted).toBe(false)
    expect(mocks.request).toHaveBeenLastCalledWith(readGitHubSearchSetupContract, {
      query: otherScope,
      signal: signals[1],
    })
    expect(client.getQueryData(githubSearchSetupKeys.detail(SCOPE))).toBeUndefined()
  })

  it.each([
    new TypeError('Failed to fetch'),
    new ApiClientError({ status: 503, message: 'Temporarily unavailable', body: null }),
    new ApiClientError({ status: 429, message: 'Try again later', body: null }),
  ])('recovers a transient read failure: $message', async (failure) => {
    mocks.request.mockRejectedValueOnce(failure)
    await render(SCOPE)
    await advance(5)
    expect(result.data).toEqual({ status: 'pending' })
    expect(result.error).toBeNull()
    expect(mocks.request).toHaveBeenCalledTimes(2)

    await advance(1500)
    expect(mocks.request).toHaveBeenCalledTimes(3)
  })

  it('continues polling after transient errors exhaust the immediate retry budget', async () => {
    const failure = new ApiClientError({ status: 503, message: 'Try again', body: null })
    mocks.request.mockRejectedValue(failure)
    await render(SCOPE)
    await advance(10)
    expect(mocks.request).toHaveBeenCalledTimes(3)
    expect(result.error).toBe(failure)

    mocks.request.mockResolvedValue({ success: true, data: { status: 'pending' } })
    await advance(5000)
    expect(result.data).toEqual({ status: 'pending' })
    expect(result.error).toBeNull()
    expect(mocks.request).toHaveBeenCalledTimes(4)
  })

  it('does not retry or poll after a terminal authorization denial', async () => {
    const failure = new ApiClientError({ status: 403, message: 'Access denied', body: null })
    mocks.request.mockRejectedValue(failure)
    await render(SCOPE)
    await advance(30_000)
    expect(result.error).toBe(failure)
    expect(mocks.request).toHaveBeenCalledOnce()
  })

  it.each<GitHubSearchSetupStatus>([
    { status: 'completed', credential: { id: 'installation-1', displayName: 'Acme' } },
    { status: 'failed', error: 'Choose a GitHub organization you own.' },
    { status: 'expired' },
  ])('stops polling after the server returns $status', async (terminalStatus) => {
    await render(SCOPE)
    expect(result.data).toEqual({ status: 'pending' })
    mocks.request.mockResolvedValue({ success: true, data: terminalStatus })
    await advance(1500)
    expect(result.data).toEqual(terminalStatus)
    expect(mocks.request).toHaveBeenCalledTimes(2)

    await advance(30_000)
    expect(mocks.request).toHaveBeenCalledTimes(2)
  })
})
