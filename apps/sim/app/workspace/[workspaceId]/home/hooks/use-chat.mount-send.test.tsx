/**
 * @vitest-environment jsdom
 *
 * Regression tests for the remount send loss: a send started on a fresh chat
 * surface was silently dropped when the hook's unmount cleanup ran mid-flight
 * and aborted the POST. Two things run that cleanup while an auto-send is still
 * in flight — the chat route's `key={chatId}` remount when the user switches
 * chats, and StrictMode's dev double-mount — and because
 * `MothershipHandoffStorage` consumes atomically, the replacement mount finds
 * nothing left to retry.
 *
 * (A Suspense hide/reveal does NOT cause this: React 19 disappears layout
 * effects only, so this passive cleanup never runs for it.)
 *
 * Recovery hands the message to the next surface carrying the original
 * `userMessageId`. Reusing that id is what makes the retry safe: the server
 * deduplicates it against the first attempt rather than opening a second chat
 * and billing a second turn, so the client never has to guess whether the
 * request it aborted was accepted.
 */
import { act, type ReactNode, StrictMode, useEffect } from 'react'
import { sleep } from '@sim/utils/helpers'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequestJson, mockExecuteWorkflow, navigationMocks } = vi.hoisted(() => ({
  mockRequestJson: vi.fn(),
  mockExecuteWorkflow:
    vi.fn<
      (options: {
        workflowId?: string
        executionId?: string
        abortSignal?: AbortSignal
      }) => Promise<{ success: boolean }>
    >(),
  navigationMocks: {
    usePathname: vi.fn(() => '/workspace/ws-1/home'),
    useRouter: vi.fn(() => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() })),
    useSearchParams: vi.fn(() => new URLSearchParams()),
  },
}))

vi.mock('next/navigation', () => navigationMocks)
vi.unmock('@/stores/execution/store')
vi.unmock('@/stores/terminal')
vi.unmock('@/stores/terminal/console/store')
vi.mock('@/app/workspace/[workspaceId]/w/[workflowId]/utils/workflow-execution-utils', () => ({
  executeWorkflowWithFullLogging: mockExecuteWorkflow,
}))

vi.mock('@/lib/api/client/request', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/client/request')>()
  return {
    ...actual,
    requestJson<C extends AnyApiRouteContract>(contract: C, input: ApiClientRequest<C>) {
      return contract.path === '/api/copilot/chat/abort'
        ? actual.requestJson(contract, input)
        : mockRequestJson(contract, input)
    },
  }
})

import type { ApiClientRequest } from '@/lib/api/client/request'
import type { AnyApiRouteContract } from '@/lib/api/contracts'
import type { CopilotChatAbortBody, CopilotChatStopBody } from '@/lib/api/contracts/copilot'
import { MothershipHandoffStorage } from '@/lib/core/utils/browser-storage'
import { normalizeMessage } from '@/lib/mothership/chat/persisted-message'
import type { MothershipStreamV1EventEnvelope } from '@/lib/mothership/generated/mothership-stream-v1'
import {
  executeRunToolOnClient,
  isRunToolActiveForId,
  stopRunToolExecutions,
} from '@/lib/mothership/tools/client/run-tool-execution'
import {
  readQueuedSendHandoffState,
  writeQueuedSendHandoffState,
} from '@/app/workspace/[workspaceId]/home/hooks/send-handoff'
import { useChat } from '@/app/workspace/[workspaceId]/home/hooks/use-chat'
import { type MothershipChatHistory, mothershipChatKeys } from '@/hooks/queries/mothership-chats'
import { useExecutionStore } from '@/stores/execution/store'
import { useMothershipQueueStore } from '@/stores/mothership-queue/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const DEDUPED_CHAT_ID = 'chat-the-first-attempt-opened'
const TRACEPARENT = '00-11111111111111111111111111111111-2222222222222222-01'

interface NetworkState {
  /**
   * How the chat POST behaves:
   * - `hang` — accepted but never answered, the window the cleanup abort lands in
   * - `accept` — a normal streaming response
   * - `deduped` — the 409 the server returns for an already-claimed send
   */
  postBehavior: 'hang' | 'accept' | 'deduped' | 'tool' | 'task'
  postBodies: Array<{ message: string; userMessageId?: string }>
  abortSettlements: boolean[]
  abortBodies: CopilotChatAbortBody[]
  stopBodies: CopilotChatStopBody[]
  abortTraceparents: Array<string | null>
}

const state: NetworkState = {
  postBehavior: 'hang',
  postBodies: [],
  abortSettlements: [],
  abortBodies: [],
  stopBodies: [],
  abortTraceparents: [],
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

  if (url.includes('/api/copilot/chat/abort')) {
    state.abortBodies.push(JSON.parse(String(init?.body)))
    state.abortTraceparents.push(new Headers(init?.headers).get('traceparent'))
    return Response.json({ aborted: true, settled: state.abortSettlements.shift() ?? true })
  }
  if (url.includes('/api/mothership/chat/stop')) {
    state.stopBodies.push(JSON.parse(String(init?.body)))
    return Response.json({ success: true })
  }
  if (url.includes('/api/copilot/confirm')) return Response.json({ success: true })

  /* Stream replay, used by the reconnect a deduplicated send falls into.
     `complete` is the terminal status the hook recognises — anything else and
     reconnect polls forever. */
  if (url.includes('/api/mothership/chat/stream')) {
    return new Response(JSON.stringify({ success: true, events: [], status: 'complete' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (url.includes('/api/mothership/chat') && init?.method === 'POST') {
    state.postBodies.push(JSON.parse(String(init.body)))
    if (state.postBehavior === 'deduped') {
      return new Response(
        JSON.stringify({
          error: 'This message was already sent.',
          activeStreamId: state.postBodies.at(-1)?.userMessageId,
          chatId: DEDUPED_CHAT_ID,
        }),
        { status: 409, headers: { 'Content-Type': 'application/json' } }
      )
    }
    if (state.postBehavior === 'accept') return emptySseResponse()
    if (state.postBehavior === 'task') {
      const streamId = state.postBodies.at(-1)?.userMessageId
      if (!streamId) throw new Error('Missing request identity')
      const event: MothershipStreamV1EventEnvelope = {
        v: 1,
        seq: 1,
        ts: new Date().toISOString(),
        type: 'run',
        stream: { streamId },
        payload: {
          kind: 'task_armed',
          taskId: 'watch-1',
          taskKind: 'workflow_run',
          target: { workflowId: 'workflow-1', executionId: 'watched-execution' },
          note: 'Check the completed invoice run',
        },
      }
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`))
          },
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } }
      )
    }
    if (state.postBehavior === 'tool') {
      const streamId = state.postBodies.at(-1)?.userMessageId
      if (!streamId) throw new Error('Missing request identity')
      const event: MothershipStreamV1EventEnvelope = {
        v: 1,
        seq: 1,
        ts: new Date().toISOString(),
        type: 'tool',
        stream: { streamId },
        payload: {
          phase: 'call',
          executor: 'client',
          mode: 'async',
          toolName: 'run_workflow',
          toolCallId: 'this-chat-tool',
          arguments: { workflowId: 'this-chat-workflow' },
        },
      }
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`))
          },
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream', traceparent: TRACEPARENT } }
      )
    }
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
 * As `renderUseChat`, but bound to an existing chat rather than chatless. The
 * pathname has to match: the hook resets a chat-bound surface back to a fresh
 * pending key when it finds itself on the home route.
 */
function renderUseChatInChat(
  chatId: string,
  history?: MothershipChatHistory
): {
  getResult: () => ReturnType<typeof useChat>
  unmount: () => void
} {
  navigationMocks.usePathname.mockReturnValue(`/workspace/ws-1/chat/${chatId}`)
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  if (history) queryClient.setQueryData(mothershipChatKeys.detail(chatId), history)
  const container = document.createElement('div')
  const root = createRoot(container)
  mountedRoots.push(root)
  let result: ReturnType<typeof useChat> | undefined

  function Probe() {
    result = useChat('ws-1', chatId)
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
 * Mounts a surface shaped like `home.tsx`: it drives `useChat` AND registers the
 * `mothership-send-message` listener that claims the event with
 * `preventDefault`. Unmounting it exercises whether the departing surface's own
 * still-attached listener can claim the recovery event its teardown emitted,
 * which would suppress the storage fallback and strand the message.
 */
function renderHomeLikeSurface(): {
  getResult: () => ReturnType<typeof useChat>
  claimedByOwnListener: () => number
  unmount: () => void
} {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const container = document.createElement('div')
  const root = createRoot(container)
  mountedRoots.push(root)
  let result: ReturnType<typeof useChat> | undefined
  let claims = 0

  function HomeLike() {
    const chat = useChat('ws-1', undefined)
    result = chat
    const { sendMessage } = chat
    // Mirrors home.tsx — declared AFTER useChat, so on unmount React runs
    // useChat's cleanup (which aborts) before this removeEventListener.
    useEffect(() => {
      const handler = (e: Event) => {
        const detail = (e as CustomEvent<{ message?: string; resumeUserMessageId?: string }>).detail
        if (!detail?.message) return
        claims++
        e.preventDefault()
        sendMessage(detail.message, undefined, undefined, {
          ...(detail.resumeUserMessageId
            ? { resumeUserMessageId: detail.resumeUserMessageId }
            : {}),
        })
      }
      window.addEventListener('mothership-send-message', handler)
      return () => window.removeEventListener('mothership-send-message', handler)
    }, [sendMessage])
    return null
  }

  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>{(<HomeLike />) as ReactNode}</QueryClientProvider>
    )
  })

  return {
    getResult: () => {
      if (result === undefined) throw new Error('Hook result is not ready')
      return result
    },
    claimedByOwnListener: () => claims,
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
function renderStrictModeHandoffConsumer(): void {
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
        ...(handoff.resumeUserMessageId
          ? { resumeUserMessageId: handoff.resumeUserMessageId }
          : {}),
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
    navigationMocks.usePathname.mockReturnValue('/workspace/ws-1/home')
    state.postBehavior = 'hang'
    state.postBodies = []
    state.abortSettlements = []
    state.abortBodies = []
    state.stopBodies = []
    state.abortTraceparents = []
    mockRequestJson.mockResolvedValue({ chats: [] })
    useMothershipQueueStore.setState({ queues: {}, editing: {} })
    useExecutionStore.setState({ workflowExecutions: new Map() })
    window.sessionStorage.clear()
    window.localStorage.clear()
  })

  afterEach(() => {
    for (const root of mountedRoots.splice(0)) {
      act(() => root.unmount())
    }
    queryClient?.clear()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('preserves a visible workflow watch when Stop persists the partial response', async () => {
    state.postBehavior = 'task'
    const { getResult } = renderUseChatInChat('chat-a')
    await act(async () => {
      void getResult().sendMessage('watch the invoice run')
    })
    await waitFor(() =>
      getResult().messages.some((message) =>
        message.contentBlocks?.some(
          (block) => block.type === 'task' && block.task?.taskId === 'watch-1'
        )
      )
    )
    await act(async () => {
      await getResult().stopGeneration()
    })
    expect(state.stopBodies).toHaveLength(1)
    const saved = state.stopBodies[0]
    const restored = normalizeMessage({
      id: 'saved-assistant',
      role: 'assistant',
      content: saved.content,
      contentBlocks: saved.contentBlocks,
    })
    expect(restored.contentBlocks?.find((block) => block.type === 'task')?.task).toEqual({
      taskId: 'watch-1',
      kind: 'workflow_run',
      status: 'pending',
      target: { workflowId: 'workflow-1', executionId: 'watched-execution' },
      note: 'Check the completed invoice run',
    })
  })

  it.each([false, true])(
    'owns an early abort failure while partial persistence is pending (retry fails: %s)',
    async (retryFails) => {
      state.postBehavior = 'task'
      let releasePersistence = () => {}
      const persistenceGate = new Promise<void>((resolve) => {
        releasePersistence = resolve
      })
      let persistenceStarted = false
      let abortAttempts = 0
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input)
        if (url.includes('/api/copilot/chat/abort')) {
          abortAttempts += 1
          if (abortAttempts === 1 || retryFails) {
            return Response.json({ error: 'Stop service unavailable' }, { status: 503 })
          }
        }
        if (url.includes('/api/mothership/chat/stop')) {
          persistenceStarted = true
          await persistenceGate
        }
        return fetchStub(input, init)
      })
      const { getResult } = renderUseChatInChat('chat-a')
      await act(async () => {
        void getResult().sendMessage('watch the invoice run')
      })
      await waitFor(() =>
        getResult().messages.some((message) =>
          message.contentBlocks?.some((block) => block.type === 'task')
        )
      )
      let stopOutcome: 'pending' | 'success' | 'failed' = 'pending'
      let stopError: unknown
      let stopping: Promise<void> = Promise.resolve()
      await act(async () => {
        stopping = getResult()
          .stopGeneration()
          .then(
            () => {
              stopOutcome = 'success'
            },
            (error) => {
              stopOutcome = 'failed'
              stopError = error
            }
          )
      })
      try {
        await waitFor(() => persistenceStarted && abortAttempts === 1)
        await act(async () => {
          await sleep(20)
        })
        expect(stopOutcome).toBe('pending')
      } finally {
        await act(async () => {
          releasePersistence()
          await stopping
        })
      }
      expect(abortAttempts).toBe(2)
      expect(stopOutcome).toBe(retryFails ? 'failed' : 'success')
      if (retryFails) {
        expect(stopError).toMatchObject({ message: 'Stop service unavailable' })
      }
    }
  )

  it.each([
    [false, 'send-now'],
    [true, 'send-now'],
    [false, 'during-stop'],
    [true, 'during-stop'],
  ] as const)(
    'keeps a queued correction behind Stop settlement (retry settles: %s, mode: %s)',
    async (retrySettles, mode) => {
      state.postBehavior = 'task'
      state.abortSettlements = [false, retrySettles]
      let releasePersistence = () => {}
      const persistenceGate = new Promise<void>((resolve) => {
        releasePersistence = resolve
      })
      let persistenceStarted = false
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input)
        if (url.includes('/api/mothership/chat/stop')) {
          persistenceStarted = true
          await persistenceGate
        }
        return fetchStub(input, init)
      })
      const { getResult, unmount } = renderUseChatInChat('chat-a')
      await act(async () => {
        void getResult().sendMessage('watch the invoice run')
      })
      await waitFor(() =>
        getResult().messages.some((message) =>
          message.contentBlocks?.some((block) => block.type === 'task')
        )
      )
      let sending: Promise<void> = Promise.resolve()
      if (mode === 'during-stop') {
        await act(async () => {
          sending = getResult()
            .stopGeneration()
            .catch(() => {})
        })
      }
      await act(async () => {
        await getResult().sendMessage('inspect the second invoice instead')
      })
      const pendingHandoff = readQueuedSendHandoffState()
      const queued =
        allQueuedMessages()[0] ??
        (pendingHandoff ? { id: pendingHandoff.id, content: pendingHandoff.message } : undefined)
      expect(queued?.content).toBe('inspect the second invoice instead')
      if (!queued) throw new Error('The queued correction is missing')
      state.postBehavior = 'hang'
      if (mode === 'send-now') {
        await act(async () => {
          sending = getResult().sendNow(queued.id)
        })
      }
      try {
        await waitFor(() => persistenceStarted && state.abortBodies.length === 1)
        expect(state.postBodies).toHaveLength(1)
      } finally {
        await act(async () => {
          releasePersistence()
        })
      }
      if (retrySettles) {
        await waitFor(() => state.postBodies.length === 2)
        expect(state.postBodies[1].message).toBe('inspect the second invoice instead')
        expect(allQueuedMessages()).toHaveLength(0)
      } else {
        await act(async () => {
          await sending
        })
        await waitFor(() => allQueuedMessages().some((message) => message.retryRequired === true))
        expect(state.postBodies).toHaveLength(1)
        expect(allQueuedMessages()).toEqual([
          expect.objectContaining({ id: queued.id, content: queued.content }),
        ])
        expect(getResult().error).toBe('Previous response is still shutting down.')
        const failed = allQueuedMessages()[0]
        expect(failed).toMatchObject({
          retryRequired: true,
          queuedSendHandoff: {
            stopRequired: true,
            supersededStreamId: state.postBodies[0].userMessageId,
          },
        })
        const stored = window.sessionStorage.getItem('mothership-queue')
        expect(stored).not.toBeNull()
        await act(async () => {
          unmount()
          useMothershipQueueStore.setState({ queues: {}, editing: {} })
          window.sessionStorage.setItem('mothership-queue', stored ?? '')
          await useMothershipQueueStore.persist.rehydrate()
        })
        const recovered = renderUseChatInChat('chat-a')
        await act(async () => {
          await sleep(20)
        })
        expect(state.postBodies).toHaveLength(1)
        expect(allQueuedMessages()[0]).toEqual(failed)
        state.abortSettlements = [false]
        await act(async () => {
          await recovered.getResult().sendNow(queued.id)
        })
        expect(state.postBodies).toHaveLength(1)
        expect(state.abortBodies).toHaveLength(3)
        expect(state.abortBodies[2]).toEqual(state.abortBodies[0])
        state.abortSettlements = [true]
        await act(async () => {
          void recovered.getResult().sendNow(queued.id)
        })
        await waitFor(() => state.postBodies.length === 2)
        expect(state.postBodies[1]).toMatchObject({
          message: queued.content,
          userMessageId: failed.queuedSendHandoff?.userMessageId,
        })
        expect(state.abortBodies).toHaveLength(4)
        expect(state.abortBodies[3]).toEqual(state.abortBodies[0])
        expect(allQueuedMessages()).toHaveLength(0)
      }
      expect(state.abortBodies).toHaveLength(retrySettles ? 2 : 4)
    }
  )

  it('retains the handoff if the surface unmounts before Stop settles', async () => {
    state.postBehavior = 'task'
    state.abortSettlements = [false, false]
    let releasePersistence = () => {}
    const persistenceGate = new Promise<void>((resolve) => {
      releasePersistence = resolve
    })
    let persistenceStarted = false
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input)
      if (url.includes('/api/mothership/chat/stop')) {
        persistenceStarted = true
        await persistenceGate
      }
      return fetchStub(input, init)
    })
    const { getResult, unmount } = renderUseChatInChat('chat-a')
    await act(async () => {
      void getResult().sendMessage('watch the invoice run')
    })
    await waitFor(() =>
      getResult().messages.some((message) =>
        message.contentBlocks?.some((block) => block.type === 'task')
      )
    )
    await act(async () => {
      await getResult().sendMessage('inspect the second invoice instead')
    })
    const queued = allQueuedMessages()[0]
    let sending: Promise<void> = Promise.resolve()
    await act(async () => {
      sending = getResult().sendNow(queued.id)
    })
    await waitFor(() => persistenceStarted)
    const prepared = readQueuedSendHandoffState()
    await act(async () => {
      unmount()
      releasePersistence()
      await sending
    })
    expect(state.postBodies).toHaveLength(1)
    expect(readQueuedSendHandoffState()).toMatchObject({
      id: queued.id,
      message: queued.content,
      supersededStreamId: state.postBodies[0].userMessageId,
      userMessageId: prepared?.userMessageId,
      stopRequired: true,
    })
  })

  it.each([false, true])(
    'the remounted handoff reader requires Stop settlement (settled: %s)',
    async (settled) => {
      let settleResponse = settled
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input)
        if (url.includes('/api/copilot/chat/abort')) {
          state.abortBodies.push(JSON.parse(String(init?.body)))
          return Response.json({ aborted: true, settled: settleResponse })
        }
        return fetchStub(input, init)
      })
      writeQueuedSendHandoffState({
        id: 'queued-correction',
        chatId: 'chat-a',
        workspaceId: 'ws-1',
        supersededStreamId: 'previous-response',
        userMessageId: 'prepared-correction-request',
        message: 'inspect the second invoice instead',
        stopRequired: true,
        requestedAt: Date.now(),
      })
      const { getResult } = renderUseChatInChat('chat-a', {
        id: 'chat-a',
        title: 'Invoice inspection',
        messages: [],
        activeStreamId: null,
        resources: [],
      })
      await waitFor(() => state.abortBodies.length > 0)
      if (settled) {
        await waitFor(() => state.postBodies.length === 1)
        expect(state.postBodies[0]).toMatchObject({
          userMessageId: 'prepared-correction-request',
          message: 'inspect the second invoice instead',
        })
      } else {
        await act(async () => {
          await sleep(40)
        })
        expect(state.postBodies).toHaveLength(0)
        expect(getResult().error).toBe('Previous response is still shutting down.')
        expect(readQueuedSendHandoffState()).toBeNull()
        expect(allQueuedMessages()).toEqual([
          expect.objectContaining({
            id: 'queued-correction',
            retryRequired: true,
            queuedSendHandoff: expect.objectContaining({
              userMessageId: 'prepared-correction-request',
              supersededStreamId: 'previous-response',
              stopRequired: true,
            }),
          }),
        ])
      }
      expect(state.abortBodies).toEqual([
        { streamId: 'previous-response', workspaceId: 'ws-1', chatId: 'chat-a' },
      ])
      if (!settled) {
        settleResponse = true
        await act(async () => {
          void getResult().sendNow('queued-correction')
        })
        await waitFor(() => state.postBodies.length === 1)
        expect(state.postBodies[0]).toMatchObject({
          userMessageId: 'prepared-correction-request',
          message: 'inspect the second invoice instead',
        })
        expect(state.abortBodies).toHaveLength(2)
        expect(state.abortBodies[1]).toEqual(state.abortBodies[0])
      }
    }
  )

  it('binds a retried correction to the response being stopped now', async () => {
    useMothershipQueueStore.getState().enqueue('chat-a', {
      id: 'earlier-correction',
      content: 'inspect the second invoice instead',
      retryRequired: true,
      queuedSendHandoff: {
        id: 'earlier-correction',
        chatId: 'chat-a',
        supersededStreamId: 'earlier-response',
        userMessageId: 'prepared-correction',
        stopRequired: true,
      },
    })
    state.postBehavior = 'task'
    const { getResult } = renderUseChatInChat('chat-a', {
      id: 'chat-a',
      title: 'Invoice inspection',
      messages: [],
      activeStreamId: null,
      resources: [],
    })
    await act(async () => {
      await getResult().sendMessage('inspect a different invoice first')
    })
    const newer = allQueuedMessages().find(
      (message) => message.content === 'inspect a different invoice first'
    )
    if (!newer) throw new Error('The newer request is missing')
    await act(async () => {
      void getResult().sendNow(newer.id)
    })
    await waitFor(() =>
      getResult().messages.some((message) =>
        message.contentBlocks?.some((block) => block.type === 'task')
      )
    )
    const newerStreamId = state.postBodies[0].userMessageId
    state.abortSettlements = [false, false]
    await act(async () => {
      await getResult().sendNow('earlier-correction')
    })
    expect(state.abortBodies[0]?.streamId).toBe(newerStreamId)
    expect(state.postBodies).toHaveLength(1)
    expect(allQueuedMessages()[0]).toMatchObject({
      retryRequired: true,
      queuedSendHandoff: {
        supersededStreamId: newerStreamId,
        userMessageId: 'prepared-correction',
        stopRequired: true,
      },
    })
    state.abortSettlements = [false]
    await act(async () => {
      await getResult().sendNow('earlier-correction')
    })
    expect(state.postBodies).toHaveLength(1)
    expect(state.abortBodies[2]?.streamId).toBe(newerStreamId)
    state.abortSettlements = [true]
    state.postBehavior = 'hang'
    await act(async () => {
      void getResult().sendNow('earlier-correction')
    })
    await waitFor(() => state.postBodies.length === 2)
    expect(state.postBodies[1]).toMatchObject({
      message: 'inspect the second invoice instead',
      userMessageId: 'prepared-correction',
    })
    expect(state.abortBodies[3]?.streamId).toBe(newerStreamId)
  })

  it('does not certify an unsettled Stop before the chat ID arrives', async () => {
    state.abortSettlements = [false, false]
    const { getResult } = renderUseChat()
    await act(async () => {
      void getResult().sendMessage('inspect the workspace')
    })
    await waitFor(() => state.postBodies.length === 1)
    await act(async () => {
      await expect(getResult().stopGeneration()).rejects.toThrow(
        'Previous response is still shutting down.'
      )
    })
    expect(state.abortBodies).toHaveLength(2)
    expect(state.abortBodies[0]).toEqual({
      streamId: state.postBodies[0].userMessageId,
      workspaceId: 'ws-1',
    })
    expect(state.abortBodies[1]).toEqual(state.abortBodies[0])
  })

  it('retries unsettled chatless Stop with the same scoped identity and accepts settlement', async () => {
    state.abortSettlements = [false, true]
    const { getResult } = renderUseChat()
    await act(async () => {
      void getResult().sendMessage('inspect the workspace')
    })
    await waitFor(() => state.postBodies.length === 1)
    await act(async () => {
      await getResult().stopGeneration()
    })
    expect(state.abortBodies).toHaveLength(2)
    expect(state.abortBodies[1]).toEqual(state.abortBodies[0])
    expect(state.abortBodies[0]).not.toHaveProperty('chatId')
  })

  it('stopping a chat preserves an unrelated manual workflow execution', async () => {
    const executionStore = useExecutionStore.getState()
    executionStore.setIsExecuting('manual-workflow', true)
    executionStore.setCurrentExecutionId('manual-workflow', 'manual-execution')
    executionStore.setActiveBlocks('manual-workflow', new Set(['manual-block']))
    const { getResult } = renderUseChat()
    await act(async () => {
      void getResult().sendMessage('inspect the workspace')
    })
    await waitFor(() => state.postBodies.length === 1)

    await act(async () => {
      await getResult().stopGeneration()
    })

    expect(useExecutionStore.getState().getWorkflowExecution('manual-workflow')).toMatchObject({
      isExecuting: true,
      currentExecutionId: 'manual-execution',
      activeBlockIds: new Set(['manual-block']),
    })
    expect(mockRequestJson).not.toHaveBeenCalledWith(
      expect.objectContaining({ path: '/api/workflows/[id]/executions/[executionId]/cancel' }),
      expect.anything()
    )
  })

  it('stops its streamed run tool while another chat and manual workflow remain active', async () => {
    vi.spyOn(useWorkflowRegistry.getState(), 'setActiveWorkflow').mockResolvedValue()
    const signals = new Map<string, AbortSignal>()
    mockExecuteWorkflow.mockImplementation(
      ({ workflowId, abortSignal }) =>
        new Promise((_, reject) => {
          if (!workflowId || !abortSignal) throw new Error('Missing execution ownership')
          signals.set(workflowId, abortSignal)
          abortSignal.addEventListener('abort', () => reject(abortSignal.reason), { once: true })
        })
    )
    executeRunToolOnClient('other-chat-tool', 'run_workflow', { workflowId: 'other-chat-workflow' })
    const executionStore = useExecutionStore.getState()
    executionStore.setIsExecuting('manual-workflow', true)
    executionStore.setCurrentExecutionId('manual-workflow', 'manual-execution')
    state.postBehavior = 'tool'
    const { getResult } = renderUseChat()
    await act(async () => {
      void getResult().sendMessage('run this workflow')
    })
    await waitFor(() => signals.has('this-chat-workflow'))
    const ownedExecutionId = executionStore.getCurrentExecutionId('this-chat-workflow')

    try {
      await act(async () => {
        await getResult().stopGeneration()
      })
      expect(state.abortTraceparents).toEqual([TRACEPARENT])
      expect(signals.get('this-chat-workflow')?.aborted).toBe(true)
      expect(signals.get('other-chat-workflow')?.aborted).toBe(false)
      expect(
        useExecutionStore.getState().getWorkflowExecution('this-chat-workflow').isExecuting
      ).toBe(false)
      expect(
        useExecutionStore.getState().getWorkflowExecution('other-chat-workflow').isExecuting
      ).toBe(true)
      expect(useExecutionStore.getState().getWorkflowExecution('manual-workflow').isExecuting).toBe(
        true
      )
      expect(mockRequestJson).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/api/workflows/[id]/executions/[executionId]/cancel' }),
        { params: { id: 'this-chat-workflow', executionId: ownedExecutionId } }
      )
      expect(mockRequestJson).not.toHaveBeenCalledWith(expect.anything(), {
        params: expect.objectContaining({ id: 'other-chat-workflow' }),
      })
      await waitFor(() => !isRunToolActiveForId('this-chat-tool'))
    } finally {
      stopRunToolExecutions(new Set(['this-chat-tool', 'other-chat-tool']))
      await waitFor(() => !isRunToolActiveForId('other-chat-tool'))
    }
  })

  it('keeps a cross-route handoff recoverable across a StrictMode double-mount', async () => {
    MothershipHandoffStorage.store({ message: 'investigate this failed run' }, 'ws-1')

    renderStrictModeHandoffConsumer()
    await waitFor(() => state.postBodies.length >= 1)

    // Something must still hold the message: the live event was claimed and it
    // is in flight again, or it is back in storage for the next mount.
    await waitFor(
      () =>
        window.localStorage.getItem('sim_mothership_handoff') !== null ||
        allQueuedMessages().length > 0 ||
        state.postBodies.length > 1
    )
  })

  it('delivers a withdrawn chatless send to a live replacement surface', async () => {
    const attachment = {
      id: 'file-1',
      key: 'uploads/file-1',
      filename: 'notes.txt',
      media_type: 'text/plain',
      size: 12,
    }
    const received: Array<{
      message: string
      fileAttachments?: unknown[]
      resumeUserMessageId?: string
    }> = []
    const claim = (event: Event) => {
      received.push((event as CustomEvent<(typeof received)[number]>).detail)
      event.preventDefault()
    }
    window.addEventListener('mothership-send-message', claim)

    try {
      const { getResult, unmount } = renderUseChat()
      await act(async () => {
        void getResult().sendMessage('hello from the palette', [attachment])
      })
      await waitFor(() => state.postBodies.length === 1)

      unmount()
      await waitFor(() => received.length === 1)

      expect(received[0].message).toBe('hello from the palette')
      expect(received[0].fileAttachments).toEqual([attachment])
      // Carried so the replacement retries as the same send, not a new one.
      expect(received[0].resumeUserMessageId).toBe(state.postBodies[0].userMessageId)
      expect(window.localStorage.getItem('sim_mothership_handoff')).toBeNull()
    } finally {
      window.removeEventListener('mothership-send-message', claim)
    }
  })

  it('re-persists a withdrawn chatless send as a handoff for the next mount', async () => {
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
    await waitFor(() => state.postBodies.length === 1)

    // An idle send goes straight out — it never occupies the queue.
    expect(allQueuedMessages()).toHaveLength(0)

    unmount()
    await waitFor(() => window.localStorage.getItem('sim_mothership_handoff') !== null)

    expect(allQueuedMessages()).toHaveLength(0)
    const handoff = MothershipHandoffStorage.consume('ws-1')
    expect(handoff?.message).toBe('hello from the palette')
    expect(handoff?.fileAttachments).toEqual([attachment])
    expect(handoff?.resumeUserMessageId).toBe(state.postBodies[0].userMessageId)
  })

  it('does not recover a send the server already answered', async () => {
    state.postBehavior = 'accept'
    const { getResult, unmount } = renderUseChat()

    await act(async () => {
      void getResult().sendMessage('already accepted')
    })
    await waitFor(() => state.postBodies.length === 1)

    unmount()
    await act(async () => {
      await sleep(50)
    })

    expect(allQueuedMessages()).toHaveLength(0)
    expect(MothershipHandoffStorage.consume('ws-1')).toBeNull()
  })

  /**
   * A departing surface's own listener must not claim the recovery event its
   * teardown emitted: claiming returns `true`, which suppresses the storage
   * fallback, and the message would be stranded exactly where this fix is meant
   * to save it.
   */
  it('does not let a departing surface claim its own recovery event', async () => {
    const surface = renderHomeLikeSurface()
    await act(async () => {
      void surface.getResult().sendMessage('must survive my own teardown')
    })
    await waitFor(() => state.postBodies.length === 1)

    surface.unmount()
    await waitFor(() => window.localStorage.getItem('sim_mothership_handoff') !== null)

    expect(surface.claimedByOwnListener()).toBe(0)
    expect(MothershipHandoffStorage.consume('ws-1')?.message).toBe('must survive my own teardown')
  })

  describe('retrying a withdrawn send', () => {
    /**
     * The whole point of carrying the id: the server sees one logical send, so
     * it deduplicates instead of opening a second chat and billing again.
     */
    it('reuses the original message id so the server can deduplicate', async () => {
      const { getResult, unmount } = renderUseChat()
      await act(async () => {
        void getResult().sendMessage('only bill me once')
      })
      await waitFor(() => state.postBodies.length === 1)
      unmount()
      await waitFor(() => window.localStorage.getItem('sim_mothership_handoff') !== null)

      const handoff = MothershipHandoffStorage.consume('ws-1')
      const replacement = renderUseChat()
      await act(async () => {
        void replacement.getResult().sendMessage(handoff?.message as string, undefined, undefined, {
          resumeUserMessageId: handoff?.resumeUserMessageId as string,
        })
      })
      await waitFor(() => state.postBodies.length === 2)

      expect(state.postBodies[1].userMessageId).toBe(state.postBodies[0].userMessageId)
    })

    /**
     * When the first attempt did reach the server, the retry comes back 409
     * naming the chat it opened. The client adopts that chat rather than
     * starting another turn.
     */
    it('adopts the chat a deduplicated retry names', async () => {
      state.postBehavior = 'deduped'
      const { getResult } = renderUseChat()

      await act(async () => {
        void getResult().sendMessage('this one already landed', undefined, undefined, {
          resumeUserMessageId: 'the-first-attempt',
        })
      })
      await waitFor(() => getResult().resolvedChatId === DEDUPED_CHAT_ID)

      expect(state.postBodies).toHaveLength(1)
      expect(state.postBodies[0].userMessageId).toBe('the-first-attempt')
    })
  })

  /**
   * A withdrawn send belongs to the chat it was sent to. The cross-surface
   * lanes deliver to whatever chat is mounted next, so routing a chat-bound
   * send through them would drop the message into a different conversation —
   * exactly what happens if the user switches chats mid-send. Its key is the
   * stable chat id, so re-queueing under that key is the durable retry.
   */
  it('re-queues a withdrawn chat-bound send instead of following the user', async () => {
    const { getResult, unmount } = renderUseChatInChat('chat-a')

    await act(async () => {
      void getResult().sendMessage('belongs to chat-a')
    })
    await waitFor(() => state.postBodies.length === 1)

    unmount()
    await waitFor(() => allQueuedMessages().length === 1)

    const queues = useMothershipQueueStore.getState().queues
    expect(Object.keys(queues)).toEqual(['chat-a'])
    expect(queues['chat-a'][0].content).toBe('belongs to chat-a')
    // Reused on the retry so the server deduplicates it.
    expect(queues['chat-a'][0].resumeUserMessageId).toBe(state.postBodies[0].userMessageId)
    // Must NOT have gone to the cross-surface handoff.
    expect(MothershipHandoffStorage.consume('ws-1')).toBeNull()
  })
})
