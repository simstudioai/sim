/**
 * @vitest-environment jsdom
 *
 * Regression tests for the remount send loss: a send started on a fresh chat
 * surface was silently dropped when the hook's unmount cleanup ran mid-flight
 * and aborted the POST. Two things run that cleanup while an auto-send from a
 * cross-route handoff is still in flight — StrictMode's dev double-mount, and a
 * real client-side navigation away — and because `MothershipHandoffStorage`
 * consumes atomically, the second mount finds nothing left to retry.
 *
 * (A Suspense hide/reveal does NOT cause this: React 19 disappears layout
 * effects only, so this passive cleanup never runs for it.)
 *
 * The fix routes idle sends through the durable queue so every send has a
 * recoverable entry, and recovers one the cleanup withdrew — probing the
 * orphaned stream first so a request the server had already accepted is
 * adopted rather than sent twice.
 */
import { act, type ReactNode, StrictMode, useEffect } from 'react'
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
  /**
   * Chat the orphaned-stream probe resolves to, standing in for a request the
   * server accepted before the client's cleanup abort tore the socket down.
   * `null` means the server has no such stream (it never accepted the request).
   */
  orphanedStreamChatId: string | null
  streamProbes: number
}

const state: NetworkState = {
  postBehavior: 'hang',
  postCalls: 0,
  orphanedStreamChatId: null,
  streamProbes: 0,
}

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

  // The orphaned-stream probe: does the server hold a stream for the send the
  // cleanup abort withdrew?
  if (url.includes('/api/mothership/chat/stream')) {
    state.streamProbes++
    // 404 is what the server returns for a stream it never registered — i.e.
    // the request really was withdrawn before it was accepted.
    if (!state.orphanedStreamChatId) {
      return new Response(JSON.stringify({ error: 'stream gone' }), { status: 404 })
    }
    return new Response(
      JSON.stringify({
        success: true,
        events: [],
        status: 'streaming',
        chatId: state.orphanedStreamChatId,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

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

/**
 * Mounts the hook under StrictMode with a handoff already in storage, mirroring
 * `home.tsx`'s consume-and-auto-send effect. This is the production-shaped
 * failure: the dev double-mount runs the passive cleanup between the two
 * mounts, aborting the in-flight POST, and `consume` has already cleared the
 * entry so the second mount has nothing to replay.
 */
function renderStrictModeHandoffConsumer(): { unmount: () => void } {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const container = document.createElement('div')
  const root = createRoot(container)
  mountedRoots.push(root)

  function Probe() {
    const { sendMessage } = useChat('ws-1', undefined)
    useEffect(() => {
      const handoff = MothershipHandoffStorage.consume('ws-1')
      if (!handoff?.message) return
      sendMessage(handoff.message, handoff.fileAttachments, handoff.contexts, {
        ...(handoff.recoverStreamId ? { recoverStreamId: handoff.recoverStreamId } : {}),
      })
    }, [sendMessage])
    return null
  }

  act(() => {
    root.render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>{(<Probe />) as ReactNode}</QueryClientProvider>
      </StrictMode>
    )
  })

  return { unmount: () => act(() => root.unmount()) }
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

describe('useChat remount send recovery', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchStub)
    state.postBehavior = 'hang'
    state.postCalls = 0
    state.orphanedStreamChatId = null
    state.streamProbes = 0
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
    const attachment = {
      id: 'file-2',
      key: 'uploads/file-2',
      filename: 'report.pdf',
      media_type: 'application/pdf',
      size: 99,
    }
    const { getResult, unmount } = renderUseChat()

    await act(async () => {
      void getResult().sendMessage('hello from the palette', [attachment])
    })
    await waitFor(() => state.postCalls === 1)

    // The dispatch claimed the queue head when the optimistic send applied.
    expect(allQueuedMessages()).toHaveLength(0)

    // The cleanup abort (the same code path a StrictMode remount or a real
    // navigation away runs) fires while the POST is still awaiting the server.
    // A chatless surface regenerates its queue key per mount, so recovery
    // re-persists the send as a one-shot handoff for the next mount's consumer
    // instead of restoring the dead instance's queue.
    unmount()
    await waitFor(() => window.localStorage.getItem('sim_mothership_handoff') !== null)

    expect(allQueuedMessages()).toHaveLength(0)
    const handoff = MothershipHandoffStorage.consume('ws-1')
    expect(handoff?.message).toBe('hello from the palette')
    expect(handoff?.fileAttachments).toEqual([attachment])
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

  /**
   * The end-to-end failure, driven by the thing that actually runs the cleanup
   * mid-flight rather than by a hand-rolled unmount. On the unfixed hook the
   * handoff is consumed, the POST is aborted, and nothing survives to retry.
   */
  it('keeps a cross-route handoff recoverable across a StrictMode double-mount', async () => {
    MothershipHandoffStorage.store({ message: 'investigate this failed run' }, 'ws-1')

    renderStrictModeHandoffConsumer()
    await waitFor(() => state.postCalls >= 1)

    // Something must still be holding the message: either the live event was
    // claimed and it is queued/in flight again, or it is back in storage.
    await waitFor(() => {
      const stored = window.localStorage.getItem('sim_mothership_handoff')
      return stored !== null || allQueuedMessages().length > 0 || state.postCalls > 1
    })
  })

  /**
   * The abort tears down the client socket but the route handler never reads
   * `request.signal` — a request the server had already accepted still creates
   * the chat, persists the user message, and runs (and bills) the turn. So the
   * recovered send has to ask whether that happened before sending again.
   */
  describe('recovered send probes the orphaned stream before re-sending', () => {
    it('adopts the chat the server already created instead of sending twice', async () => {
      // The server accepted the withdrawn request and registered its stream.
      state.orphanedStreamChatId = 'chat-server-already-made'

      const { getResult, unmount } = renderUseChat()
      await act(async () => {
        void getResult().sendMessage('only once please')
      })
      await waitFor(() => state.postCalls === 1)
      unmount()
      await waitFor(() => window.localStorage.getItem('sim_mothership_handoff') !== null)

      // The next mount consumes the handoff, exactly as home.tsx does.
      const handoff = MothershipHandoffStorage.consume('ws-1')
      expect(handoff?.recoverStreamId).toBeTruthy()

      const replacement = renderUseChat()
      await act(async () => {
        void replacement.getResult().sendMessage(handoff?.message as string, undefined, undefined, {
          recoverStreamId: handoff?.recoverStreamId as string,
        })
      })
      await waitFor(() => state.streamProbes > 0)
      await waitFor(() => replacement.getResult().resolvedChatId === 'chat-server-already-made')

      expect(state.postCalls).toBe(1)
      expect(allQueuedMessages()).toHaveLength(0)
    })

    it('re-sends when the server has no stream for it', async () => {
      // 404 from the probe: the request really was withdrawn before acceptance.
      state.orphanedStreamChatId = null

      const { getResult, unmount } = renderUseChat()
      await act(async () => {
        void getResult().sendMessage('please actually send me')
      })
      await waitFor(() => state.postCalls === 1)
      unmount()
      await waitFor(() => window.localStorage.getItem('sim_mothership_handoff') !== null)

      const handoff = MothershipHandoffStorage.consume('ws-1')
      const replacement = renderUseChat()
      await act(async () => {
        void replacement.getResult().sendMessage(handoff?.message as string, undefined, undefined, {
          recoverStreamId: handoff?.recoverStreamId as string,
        })
      })
      await waitFor(() => state.postCalls === 2)

      expect(state.streamProbes).toBeGreaterThan(0)
    })
  })
})
