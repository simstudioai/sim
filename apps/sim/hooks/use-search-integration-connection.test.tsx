/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  mutate: vi.fn(),
  invalidate: vi.fn(),
  refetch: vi.fn(),
  connected: vi.fn(),
  receipts: new Map<string, string>(),
  accounts: [] as Array<{ credentialId: string; status: string }>,
  channels: [] as Array<{
    name: string
    onmessage: ((event: MessageEvent<unknown>) => void) | null
    close: () => void
  }>,
  queryError: null as Error | null,
  requestedTarget: undefined as
    | { type: 'link'; provider: string; connectorType: string; connectorId?: string }
    | undefined,
}))
const target = {
  type: 'link',
  provider: 'gmail',
  connectorType: 'gmail',
  connectorId: 'source',
} as const
const client = { invalidateQueries: m.invalidate }
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => client }))
vi.mock('@/hooks/queries/personal-search-integrations', () => ({
  personalSearchIntegrationKeys: { lists: () => ['personal-integrations', 'list'] },
  useConnectPersonalSearchIntegration: () => ({ mutateAsync: m.mutate, isPending: false }),
  usePersonalSearchIntegrations: (query: { completionId?: string }) => ({
    data: {
      connections: [{ accounts: m.accounts }],
      available: [{ target }],
      completedCredentialId: m.receipts.get(query.completionId ?? '') ?? null,
    },
    isSuccess: !m.queryError,
    isPending: false,
    error: m.queryError,
    refetch: m.refetch,
  }),
}))
vi.mock('@/hooks/queries/organization-accounts', () => ({
  organizationAccountsKeys: { detail: (id: string) => ['accounts', id] },
}))

import { useSearchIntegrationConnection } from '@/hooks/use-search-integration-connection'

type Connection = ReturnType<typeof useSearchIntegrationConnection>
const latest = new Map<string, Connection>()
let root: Root
let container: HTMLDivElement
const windows: Array<{
  location: { href: string }
  close: ReturnType<typeof vi.fn>
  focus: ReturnType<typeof vi.fn>
  closed: boolean
}> = []
function Harness({ id }: { id: string }) {
  latest.set(
    id,
    useSearchIntegrationConnection({
      organizationId: 'org',
      userId: 'person',
      target: m.requestedTarget ?? target,
      controlId: id,
      onConnected: m.connected,
    })
  )
  return null
}
function render(ids = ['one']) {
  act(() =>
    root.render(
      <>
        {ids.map((id) => (
          <Harness id={id} key={id} />
        ))}
      </>
    )
  )
}
function connection(id = 'one') {
  const value = latest.get(id)
  if (!value) throw new Error('Missing connection')
  return value
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  m.accounts = []
  m.receipts.clear()
  m.channels.length = 0
  m.queryError = null
  m.requestedTarget = undefined
  windows.length = 0
  window.localStorage.clear()
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal(
    'BroadcastChannel',
    class {
      onmessage = null
      close = vi.fn()
      constructor(public name: string) {
        m.channels.push(this)
      }
    }
  )
  vi.spyOn(window, 'open').mockImplementation(() => {
    const popup = { location: { href: '' }, close: vi.fn(), focus: vi.fn(), closed: false }
    windows.push(popup)
    return popup as unknown as Window
  })
  m.refetch.mockResolvedValue({ isSuccess: true, data: { connections: [] } })
  m.mutate.mockResolvedValue({
    url: 'https://provider.test/authorize',
    connectorId: 'source',
    knowledgeBaseId: 'kb',
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  latest.clear()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Search connection card lifecycle', () => {
  it('starts OAuth only on click and completes only when its receipt and current account agree', async () => {
    render()
    expect(m.mutate).not.toHaveBeenCalled()
    await act(async () => {
      await connection().connect()
    })
    const id = m.mutate.mock.calls[0][0].oauthCompletionId
    expect(windows[0].location.href).toBe('https://provider.test/authorize')
    expect(connection().pending).toBe(true)
    act(() => m.channels[0].onmessage?.(new MessageEvent('message', { data: 'connected' })))
    expect(connection().connected).toBe(false)
    m.accounts = [{ credentialId: 'mine', status: 'connected' }]
    m.receipts.set(id, 'mine')
    render()
    expect(connection().connected).toBe(true)
    expect(m.connected).toHaveBeenCalled()
  })
  it('does not complete another card waiting for the same provider', async () => {
    render(['one', 'two'])
    await act(async () => {
      await connection('one').connect()
      await connection('two').connect()
    })
    const [first, second] = m.mutate.mock.calls.map(([input]) => input.oauthCompletionId)
    expect(first).not.toBe(second)
    m.accounts = [{ credentialId: 'mine', status: 'connected' }]
    m.receipts.set(first, 'mine')
    render(['one', 'two'])
    expect(connection('one').connected).toBe(true)
    expect(connection('two').connected).toBe(false)
    expect(windows[1].close).not.toHaveBeenCalled()
  })
  it('restores pending completion on reload and ignores browser clock skew', async () => {
    render()
    vi.setSystemTime(new Date('2030-01-01'))
    await act(async () => {
      await connection().connect()
    })
    const id = m.mutate.mock.calls[0][0].oauthCompletionId
    act(() => root.unmount())
    root = createRoot(container)
    m.accounts = [{ credentialId: 'mine', status: 'connected' }]
    m.receipts.set(id, 'mine')
    render()
    expect(connection().connected).toBe(true)
    m.accounts = [{ credentialId: 'mine', status: 'reconnect_needed' }]
    render()
    expect(connection().connected).toBe(false)
  })
  it('supports cancel and retry with a fresh attempt', async () => {
    render()
    await act(async () => {
      await connection().connect()
    })
    act(() => connection().cancel())
    expect(connection().pending).toBe(false)
    expect(connection().error).toContain('canceled')
    await act(async () => {
      await connection().connect()
    })
    expect(m.mutate).toHaveBeenCalledTimes(2)
    expect(connection().pending).toBe(true)
  })
  it('retries the exact source created by the first attempt after cancellation or reload', async () => {
    m.requestedTarget = { type: 'link', provider: 'gmail', connectorType: 'gmail' }
    render()
    await act(async () => {
      await connection().connect()
    })
    expect(m.mutate.mock.calls[0][0].target.connectorId).toBeUndefined()
    act(() => connection().cancel())
    act(() => root.unmount())
    root = createRoot(container)
    render()
    expect(connection().available).toBe(true)
    await act(async () => {
      await connection().connect()
    })
    expect(m.mutate.mock.calls[1][0].target.connectorId).toBe('source')
    expect(m.mutate.mock.calls[1][0].target.credentialId).toBeUndefined()
  })
  it('keeps failed starts actionable and rejects stale data after authorization errors', async () => {
    render()
    m.mutate.mockRejectedValueOnce(new Error('Source no longer available'))
    await act(async () => {
      expect(await connection().connect()).toBe(false)
    })
    expect(connection().error).toBe('Source no longer available')
    expect(windows[0].close).toHaveBeenCalled()
    m.queryError = new Error('Membership revoked')
    render()
    expect(connection().available).toBe(false)
  })
  it('times out without closing a separate successful attempt', async () => {
    render()
    await act(async () => {
      await connection().connect()
    })
    act(() => vi.advanceTimersByTime(600_001))
    expect(connection().pending).toBe(false)
    expect(connection().error).toContain('timed out')
  })
})
