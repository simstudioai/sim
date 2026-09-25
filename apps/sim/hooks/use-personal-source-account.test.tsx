/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { emcnMock, emcnMockFns } from '@sim/testing/mocks/emcn.mock'
import { reactQueryMock, reactQueryMockFns } from '@sim/testing/mocks/react-query.mock'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  refetch: vi.fn(),
  completed: null as string | null,
  connected: vi.fn(),
}))
vi.mock('@tanstack/react-query', () => reactQueryMock)
vi.mock('@sim/emcn', () => emcnMock)
vi.mock('@/hooks/queries/personal-source-setup', () => ({
  personalSourceSetupKeys: { list: (query: unknown) => ['personal-source-setup', query] },
  useAuthorizePersonalSourceSetup: () => ({ mutateAsync: mocks.authorize, isPending: false }),
  usePersonalSourceSetupAccounts: () => ({
    data: { accounts: [], completedCredentialId: mocks.completed },
    refetch: mocks.refetch,
  }),
}))

import { usePersonalSourceAccount } from '@/hooks/use-personal-source-account'

const mockToastError = emcnMockFns.mockToast.error
const mockSetQueryData = reactQueryMockFns.mockQueryClient.setQueryData

describe('personal source account authorization', () => {
  let root: Root
  let container: HTMLDivElement
  let current: ReturnType<typeof usePersonalSourceAccount>
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
  function Probe() {
    current = usePersonalSourceAccount({
      organizationId: 'org-1',
      connectorType: 'jira',
      onConnected: mocks.connected,
    })
    return null
  }
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.completed = null
    mocks.authorize.mockResolvedValue({
      kind: 'authorization',
      url: 'https://auth.atlassian.com/authorize',
    })
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
  })
  it('authorizes before a source exists and requires server confirmation of completion', async () => {
    await act(async () => current.connect())
    expect(tab.opener).toBeNull()
    expect(tab.location.href).toBe('https://auth.atlassian.com/authorize')
    expect(mocks.authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'authorize',
        organizationId: 'org-1',
        connectorType: 'jira',
        oauthCompletionId: expect.any(String),
      })
    )
    expect(current.pending).toBe(true)
    act(() => channels[0].onmessage?.({ data: 'connected' } as MessageEvent<unknown>))
    expect(mocks.refetch).toHaveBeenCalledOnce()
    expect(current.pending).toBe(true)
    expect(tab.close).not.toHaveBeenCalled()
    mocks.completed = 'my-account'
    act(() => root.render(<Probe />))
    expect(current.pending).toBe(false)
    expect(tab.close).toHaveBeenCalledOnce()
    expect(mocks.connected).toHaveBeenCalledWith('my-account')
    mocks.completed = null
    act(() => root.render(<Probe />))
    expect(current.pending).toBe(false)
  })
  it('ignores a late authorization response after cancellation', async () => {
    let resolve!: (value: { kind: string; url: string }) => void
    mocks.authorize.mockReturnValue(
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
      resolve({ kind: 'authorization', url: 'https://auth.atlassian.com/authorize' })
      await connecting
    })
    expect(tab.location.href).toBe('about:blank')
    expect(current.pending).toBe(false)
  })
})
