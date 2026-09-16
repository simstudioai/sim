/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiClientError } from '@/lib/api/client/errors'
import type { GitHubSearchSetupStatus } from '@/lib/api/contracts/knowledge/github-setup'

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  cancel: vi.fn(),
  refetch: vi.fn(),
  invalidate: vi.fn(),
  connected: vi.fn(),
  status: undefined as GitHubSearchSetupStatus | undefined,
  error: null as Error | null,
}))
const client = { invalidateQueries: mocks.invalidate }
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => client }))
vi.mock('@/hooks/queries/github-search-setup', () => ({
  isGitHubSetupTerminalError: (error: unknown) =>
    error instanceof ApiClientError && error.status === 403,
  useStartGitHubSearchSetup: () => ({ mutateAsync: mocks.start, isPending: false }),
  useCancelGitHubSearchSetup: () => ({ mutateAsync: mocks.cancel }),
  useGitHubSearchSetup: () => ({
    data: mocks.status,
    error: mocks.error,
    refetch: mocks.refetch,
  }),
}))

import { useGitHubInstallationSetup } from '@/hooks/use-github-installation-setup'

describe('GitHub installation setup handoff', () => {
  let root: Root
  let container: HTMLDivElement
  let current: ReturnType<typeof useGitHubInstallationSetup>
  let channels: Array<{
    onmessage: ((event: MessageEvent<unknown>) => void) | null
    close: ReturnType<typeof vi.fn>
  }>
  let tab: {
    opener: unknown
    location: { href: string }
    focus: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
  }
  function Probe({ organizationId = 'org-1' }: { organizationId?: string }) {
    current = useGitHubInstallationSetup({ organizationId, onConnected: mocks.connected })
    return null
  }
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mocks.status = undefined
    mocks.error = null
    mocks.start.mockResolvedValue({ url: 'https://github.com/login/oauth/authorize' })
    mocks.cancel.mockResolvedValue({ success: true })
    channels = []
    vi.stubGlobal(
      'BroadcastChannel',
      class {
        onmessage = null
        close = vi.fn()
        constructor() {
          channels.push(this)
        }
      }
    )
    tab = { opener: {}, location: { href: 'about:blank' }, focus: vi.fn(), close: vi.fn() }
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window)
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root.render(<Probe />))
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('opens approval synchronously and completes only from the authorized server receipt', async () => {
    await act(async () => current.connect())
    expect(tab.opener).toBeNull()
    expect(tab.location.href).toBe('https://github.com/login/oauth/authorize')
    expect(mocks.start).toHaveBeenCalledWith({
      organizationId: 'org-1',
      setupId: expect.any(String),
    })
    expect(current.pending).toBe(true)
    act(() => channels[0].onmessage?.({ data: 'connected' } as MessageEvent<unknown>))
    expect(mocks.refetch).toHaveBeenCalledOnce()
    expect(mocks.connected).not.toHaveBeenCalled()
    mocks.status = {
      status: 'completed',
      credential: { id: 'installation-1', displayName: 'Acme' },
    }
    act(() => root.render(<Probe />))
    expect(current.pending).toBe(false)
    expect(mocks.connected).toHaveBeenCalledExactlyOnceWith('installation-1')
    expect(tab.close).toHaveBeenCalledOnce()
    expect(mocks.invalidate).toHaveBeenCalledTimes(4)
    expect(mocks.invalidate).toHaveBeenCalledWith({
      queryKey: ['oauthCredentials', 'list', 'github-repositories', '', '', 'org-1', 'browsing'],
    })
    act(() => root.render(<Probe />))
    expect(mocks.connected).toHaveBeenCalledOnce()
  })

  it('keeps one approval attempt and focuses it when Connect is clicked again', async () => {
    await act(async () => current.connect())
    await act(async () => current.connect())
    expect(window.open).toHaveBeenCalledOnce()
    expect(mocks.start).toHaveBeenCalledOnce()
    expect(tab.focus).toHaveBeenCalledOnce()
  })

  it('cancels without navigating a late start response or accepting its completion', async () => {
    let resolve!: (value: { url: string }) => void
    mocks.start.mockReturnValue(
      new Promise((done) => {
        resolve = done
      })
    )
    let connecting!: Promise<void>
    act(() => {
      connecting = current.connect()
    })
    act(() => current.cancel())
    await act(async () => {
      resolve({ url: 'https://github.com/apps/sim/installations/new' })
      await connecting
    })
    expect(tab.location.href).toBe('about:blank')
    expect(mocks.cancel).toHaveBeenCalledWith(mocks.start.mock.calls[0][0])
    mocks.status = { status: 'completed', credential: { id: 'cancelled', displayName: 'Acme' } }
    act(() => root.render(<Probe />))
    expect(mocks.connected).not.toHaveBeenCalled()
    expect(current.pending).toBe(false)
  })

  it('shows denied approval inline and allows a new attempt', async () => {
    await act(async () => current.connect())
    act(() => channels[0].onmessage?.({ data: 'denied' } as MessageEvent<unknown>))
    expect(current.pending).toBe(true)
    expect(mocks.refetch).toHaveBeenCalledOnce()
    mocks.status = { status: 'failed', error: 'Choose a GitHub organization you own.' }
    act(() => root.render(<Probe />))
    expect(current.error).toBe('Choose a GitHub organization you own.')
    expect(current.pending).toBe(false)
    mocks.status = undefined
    await act(async () => current.connect())
    expect(mocks.start).toHaveBeenCalledTimes(2)
    expect(current.error).toBeNull()
  })

  it('cancels on organization change and ignores the previous receipt', async () => {
    await act(async () => current.connect())
    mocks.status = { status: 'completed', credential: { id: 'wrong-org', displayName: 'Acme' } }
    act(() => root.render(<Probe organizationId='org-2' />))
    expect(mocks.cancel).toHaveBeenCalledWith(mocks.start.mock.calls[0][0])
    expect(mocks.connected).not.toHaveBeenCalled()
    expect(current.pending).toBe(false)
  })

  it('keeps the approval open through transient polling failures but stops on lost access', async () => {
    await act(async () => current.connect())
    mocks.error = new Error('Failed to fetch')
    act(() => root.render(<Probe />))
    expect(current.pending).toBe(true)
    expect(mocks.cancel).not.toHaveBeenCalled()
    mocks.error = new ApiClientError({
      status: 403,
      message: 'Organization access denied',
      body: null,
    })
    act(() => root.render(<Probe />))
    expect(current.pending).toBe(false)
    expect(current.error).toBe('Organization access denied')
    expect(mocks.cancel).toHaveBeenCalledOnce()
  })

  it('forwards an explicit new-organization request instead of reusing an existing installation', async () => {
    await act(async () => current.connect('install'))
    expect(mocks.start).toHaveBeenCalledWith({
      organizationId: 'org-1',
      setupId: expect.any(String),
      intent: 'install',
    })
  })

  it('bounds the attempt lifetime and cleans up its channel', async () => {
    await act(async () => current.connect())
    act(() => vi.advanceTimersByTime(10 * 60_000))
    expect(current.pending).toBe(false)
    expect(current.error).toContain('timed out')
    expect(channels[0].close).toHaveBeenCalledOnce()
    expect(mocks.cancel).toHaveBeenCalledOnce()
  })

  it('reports popup blocking before creating any server attempt', async () => {
    vi.mocked(window.open).mockReturnValue(null)
    await act(async () => current.connect())
    expect(mocks.start).not.toHaveBeenCalled()
    expect(current.error).toContain('Allow pop-ups')
  })

  it.each([
    'https://attacker.example/authorize',
    'javascript:alert(1)',
    'https://github.com@attacker.example',
  ])('rejects an unexpected approval destination: %s', async (url) => {
    mocks.start.mockResolvedValue({ url })
    await act(async () => current.connect())
    expect(tab.location.href).toBe('about:blank')
    expect(current.error).toBe('GitHub returned an invalid setup URL')
    expect(mocks.cancel).toHaveBeenCalledOnce()
  })
})
