/**
 * @vitest-environment jsdom
 *
 * Regression tests for the mount-settling send loss: a send started on a
 * fresh chat surface used to be silently dropped when React ran the unmount
 * cleanup mid-flight (a Suspense hide/reveal cycles every effect shortly
 * after Home mounts), aborting the fetch before it dispatched. The fix routes
 * idle sends through the durable message queue and restores the queued entry
 * when the cleanup abort strikes before the server received the request.
 */
import { act, type ReactNode } from 'react'
import { sleep } from '@sim/utils/helpers'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequestJson, navigationMocks } = vi.hoisted(() => ({
  mockRequestJson: vi.fn(),
  navigationMocks: {
    usePathname: vi.fn(() => '/workspace/ws-1/home'),
    useRouter: vi.fn(() => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() })),
    useSearchParams: vi.fn(() => new URLSearchParams()),
  },
}))

vi.mock('next/navigation', () => navigationMocks)

vi.mock('@/lib/api/client/request', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/client/request')>()),
  requestJson: mockRequestJson,
}))

import { MothershipHandoffStorage } from '@/lib/core/utils/browser-storage'
import { useChat } from '@/app/workspace/[workspaceId]/home/hooks/use-chat'
import { useMothershipQueueStore } from '@/stores/mothership-queue/store'

interface NetworkState {
  /** How the chat POST behaves for the next call. */
  postBehavior: 'hang' | 'accept'
  postCalls: number
}

const state: NetworkState = { postBehavior: 'hang', postCalls: 0 }

/** An SSE response whose stream ends immediately without a terminal event. */
function emptySseResponse(): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close()
    },
  })
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

async function fetchStub(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input)

  if (url.includes('/api/mothership/chat') && init?.method === 'POST') {
    state.postCalls++
    if (state.postBehavior === 'accept') return emptySseResponse()
    return new Promise<Response>((_, reject) => {
      const signal = init?.signal
      if (!signal) return
      // Real fetch rejects with the RAW abort reason (a string here), not an
      // AbortError — the regression this suite guards depends on that shape.
      if (signal.aborted) {
        reject(signal.reason)
        return
      }
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
  }

  return new Response(JSON.stringify({ error: 'not found' }), { status: 404 })
}

const mountedRoots: Root[] = []
let queryClient: QueryClient

function renderUseChat(): {
  getResult: () => ReturnType<typeof useChat>
  unmount: () => void
} {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const container = document.createElement('div')
  const root = createRoot(container)
  mountedRoots.push(root)
  let result: ReturnType<typeof useChat> | undefined

  function Probe() {
    result = useChat('ws-1', undefined)
    return null
  }

  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>{(<Probe />) as ReactNode}</QueryClientProvider>
    )
  })

  return {
    getResult: () => {
      if (result === undefined) throw new Error('Hook result is not ready')
      return result
    },
    unmount: () => act(() => root.unmount()),
  }
}

/** Every queued message across all chat keys, flattened. */
function allQueuedMessages() {
  return Object.values(useMothershipQueueStore.getState().queues).flat()
}

async function waitFor(predicate: () => boolean, budgetMs = 2000): Promise<void> {
  const deadline = Date.now() + budgetMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitFor timed out')
    await act(async () => {
      await sleep(10)
    })
  }
}

describe('useChat mount-settling send recovery', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchStub)
    state.postBehavior = 'hang'
    state.postCalls = 0
    mockRequestJson.mockResolvedValue({ chats: [] })
    useMothershipQueueStore.setState({ queues: {}, editing: {} })
    window.sessionStorage.clear()
    window.localStorage.clear()
  })

  afterEach(() => {
    for (const root of mountedRoots.splice(0)) {
      act(() => root.unmount())
    }
    queryClient?.clear()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('delivers an aborted chatless send directly to a live replacement surface', async () => {
    const attachment = {
      id: 'file-1',
      key: 'uploads/file-1',
      filename: 'notes.txt',
      media_type: 'text/plain',
      size: 12,
    }
    const received: Array<{ message: string; fileAttachments?: unknown[] }> = []
    const claim = (event: Event) => {
      const detail = (event as CustomEvent<{ message: string; fileAttachments?: unknown[] }>).detail
      received.push(detail)
      event.preventDefault()
    }
    window.addEventListener('mothership-send-message', claim)

    try {
      const { getResult, unmount } = renderUseChat()
      await act(async () => {
        void getResult().sendMessage('hello from the palette', [attachment])
      })
      await waitFor(() => state.postCalls === 1)

      unmount()
      await waitFor(() => received.length === 1)

      expect(received[0].message).toBe('hello from the palette')
      expect(received[0].fileAttachments).toEqual([attachment])
      expect(window.localStorage.getItem('sim_mothership_handoff')).toBeNull()
    } finally {
      window.removeEventListener('mothership-send-message', claim)
    }
  })

  it('re-persists an aborted chatless send as a handoff for the next mount', async () => {
    const { getResult, unmount } = renderUseChat()

    await act(async () => {
      void getResult().sendMessage('hello from the palette')
    })
    await waitFor(() => state.postCalls === 1)

    // The dispatch claimed the queue head when the optimistic send applied.
    expect(allQueuedMessages()).toHaveLength(0)

    // The cleanup abort (the same code path the mount-settling remount runs)
    // fires while the POST is still awaiting the server. A chatless surface
    // regenerates its queue key per mount, so recovery re-persists the send
    // as a one-shot handoff for the next mount's consumer instead of
    // restoring the dead instance's queue.
    unmount()
    await waitFor(() => window.localStorage.getItem('sim_mothership_handoff') !== null)

    expect(allQueuedMessages()).toHaveLength(0)
    expect(MothershipHandoffStorage.consume('ws-1')?.message).toBe('hello from the palette')
  })

  it('does not re-queue a send the server already received', async () => {
    state.postBehavior = 'accept'
    const { getResult, unmount } = renderUseChat()

    await act(async () => {
      void getResult().sendMessage('already accepted')
    })
    await waitFor(() => state.postCalls === 1)

    unmount()
    await act(async () => {
      await sleep(50)
    })

    expect(allQueuedMessages()).toHaveLength(0)
    expect(MothershipHandoffStorage.consume('ws-1')).toBeNull()
  })
})
