/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { sleep } from '@sim/utils/helpers'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockStartOauth } = vi.hoisted(() => ({ mockStartOauth: vi.fn() }))

vi.mock('@sim/emcn', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@/hooks/queries/mcp', () => ({
  useStartMcpOauth: () => ({ mutateAsync: mockStartOauth }),
  mcpKeys: {
    serversList: (workspaceId: string) => ['mcp', 'servers', workspaceId],
    serverToolsList: (workspaceId: string, serverId: string) => [
      'mcp',
      'server-tools',
      workspaceId,
      serverId,
    ],
    storedToolsList: (workspaceId: string) => ['mcp', 'stored-tools', workspaceId],
  },
}))

import { useMcpOauthPopup } from '@/hooks/mcp/use-mcp-oauth-popup'

/**
 * Minimal dependency-free hook harness (the repo has no `@testing-library/react`).
 * Mounts the hook in a real React 19 root under jsdom, wrapped in a real
 * `QueryClientProvider`, so query/mutation lifecycles run exactly as in the app.
 */
function renderHookWithClient<T>(useHook: () => T): { result: () => T; unmount: () => void } {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
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

  return { result: () => latest, unmount: () => act(() => root.unmount()) }
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i++) {
      await Promise.resolve()
      await sleep(0)
    }
  })
}

describe('useMcpOauthPopup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // jsdom has no BroadcastChannel; the hook opens one on mount.
    class FakeBroadcastChannel {
      onmessage: ((event: MessageEvent) => void) | null = null
      constructor(public name: string) {}
      postMessage(): void {}
      close(): void {}
    }
    ;(globalThis as unknown as { BroadcastChannel: unknown }).BroadcastChannel =
      FakeBroadcastChannel
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('ignores a concurrent second start for the same server (no double popup)', async () => {
    let resolveStart: (value: unknown) => void = () => {}
    mockStartOauth.mockImplementation(
      () =>
        new Promise((res) => {
          resolveStart = res
        })
    )

    const hook = renderHookWithClient(() => useMcpOauthPopup({ workspaceId: 'w1' }))
    await flush()

    // Two clicks before /oauth/start resolves — the guard must collapse them to one request.
    await act(async () => {
      void hook.result().startOauthForServer('s1')
      void hook.result().startOauthForServer('s1')
    })
    expect(mockStartOauth).toHaveBeenCalledTimes(1)

    // Settle the first flow so the guard clears.
    await act(async () => {
      resolveStart({ status: 'redirect', popup: { closed: false }, state: 'state-1' })
    })
    await flush()

    hook.unmount()
  })

  it('allows a fresh start after the previous one settles (reopen after abandon)', async () => {
    mockStartOauth.mockResolvedValue({ status: 'redirect', popup: { closed: false }, state: 'st' })

    const hook = renderHookWithClient(() => useMcpOauthPopup({ workspaceId: 'w1' }))
    await flush()

    await act(async () => {
      await hook.result().startOauthForServer('s1')
    })
    await flush()

    await act(async () => {
      await hook.result().startOauthForServer('s1')
    })
    await flush()

    // Both distinct clicks reached the mutation — the guard only blocks concurrent re-entry.
    expect(mockStartOauth).toHaveBeenCalledTimes(2)

    hook.unmount()
  })
})
