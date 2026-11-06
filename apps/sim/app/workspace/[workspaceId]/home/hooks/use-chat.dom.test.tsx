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

import { type ReactNode, act as reactAct, StrictMode, useEffect, useState } from 'react'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { authClientMock, authClientMockFns } from '@sim/testing/mocks/auth-client.mock'
import { libDesktopMock, libDesktopMockFns } from '@sim/testing/mocks/lib-desktop.mock'
import { nextNavigationMock, nextNavigationMockFns } from '@sim/testing/mocks/next-navigation.mock'
import { sleep } from '@sim/utils/helpers'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockRequestJson,
  mockExecuteWorkflow,
  mockExecuteBrowserToolOnClient,
  mockExecuteLocalFilesystemTool,
} = vi.hoisted(() => ({
  mockExecuteBrowserToolOnClient: vi.fn(),
  mockExecuteLocalFilesystemTool: vi.fn(),
  mockRequestJson: vi.fn(),
  mockExecuteWorkflow:
    vi.fn<
      (options: {
        workflowId?: string
        executionId?: string
        abortSignal?: AbortSignal
      }) => Promise<{ success: boolean }>
    >(),
}))

vi.mock('@/lib/core/config/feature-flags-context', () => ({
  useFeatureFlag: () => false,
}))

vi.mock('next/navigation', () => nextNavigationMock)
vi.mock('@/lib/desktop', () => libDesktopMock)
vi.mock('@/lib/mothership/tools/client/local-filesystem', () => ({
  executeLocalFilesystemTool: mockExecuteLocalFilesystemTool,
}))
vi.mock('@/lib/mothership/tools/client/browser-tool-execution', () => ({
  executeBrowserToolOnClient: mockExecuteBrowserToolOnClient,
}))
vi.mock('@/lib/auth/client', () => authClientMock)
vi.unmock('@/stores/execution/store')
vi.unmock('@/stores/terminal')
vi.unmock('@/stores/terminal/console/store')
vi.mock('@/app/workspace/[workspaceId]/w/[workflowId]/utils/workflow-execution', () => ({
  executeWorkflowWithFullLogging: mockExecuteWorkflow,
}))

vi.mock('@/lib/api/client/request', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/client/request')>()
  return {
    ...actual,
    requestJson<C extends AnyApiRouteContract>(contract: C, input: ApiClientRequest<C>) {
      return contract.path === '/api/copilot/chat/abort' ||
        contract.path === '/api/copilot/chat/steer'
        ? actual.requestJson(contract, input)
        : mockRequestJson(contract, input)
    },
  }
})

import { ToastProvider } from '@sim/emcn'
import type { ApiClientRequest } from '@/lib/api/client/request'
import type { AnyApiRouteContract } from '@/lib/api/contracts'
import type {
  CopilotChatAbortBody,
  CopilotChatSteerBody,
  CopilotChatStopBody,
} from '@/lib/api/contracts/copilot'
import {
  resetDeploymentShape,
  resolveDeploymentShape,
  seedDeploymentShape,
} from '@/lib/core/config/deployment-shape'
import { MothershipHandoffStorage } from '@/lib/core/utils/browser-storage'
import { MOTHERSHIP_STREAM_REPLAY_HEADER } from '@/lib/mothership/constants'
import type { MothershipStreamV1EventEnvelope } from '@/lib/mothership/generated/mothership-stream-v1'
import type { PersistedStreamEventEnvelope } from '@/lib/mothership/request/session/contract'
import {
  getChatResourceSelectionId,
  type MothershipResource,
} from '@/lib/mothership/resources/types'
import { ChatSurfaceProvider } from '@/app/workspace/[workspaceId]/home/components/chat-surface-context'
import { collectCitedMessageSources } from '@/app/workspace/[workspaceId]/home/components/message-content/message-sources'
import { ModelSelector } from '@/app/workspace/[workspaceId]/home/components/user-input/components/model-selector'
import { useChat } from '@/app/workspace/[workspaceId]/home/hooks/use-chat'
import { type MothershipChatHistory, mothershipChatKeys } from '@/hooks/queries/mothership-chats'
import { handleMothershipChatStatusEvent } from '@/hooks/use-mothership-chat-events'
import { useExecutionStore } from '@/stores/execution/store'
import { useMothershipEffortStore } from '@/stores/mothership-effort/store'
import { useMothershipOutgoingStore } from '@/stores/mothership-outgoing/store'
import type { ChatContext } from '@/stores/panel'

/** Captured before any test fakes timers, so the act budget below runs in real time. */
const realSetTimeout = globalThis.setTimeout
const realClearTimeout = globalThis.clearTimeout
/** Well under the 10s test timeout: the scope must end before the runner abandons the test. */
const ACT_BUDGET_MS = 6_000

/**
 * React's `act`, with async callbacks bounded. A callback that never settles (a
 * regressed send stuck reconnecting) used to run into the test timeout while
 * still inside React's act scope, and the renders of every later test queued
 * behind it ("Hook result is not ready"). Failing the act after a budget ends
 * the scope, so one regression is one red test. Sync callbacks stay synchronous.
 */
function act(callback: () => unknown): Promise<void> {
  return reactAct((): undefined | Promise<void> => {
    const result = callback()
    if (!(result instanceof Promise)) return undefined
    let budget: ReturnType<typeof setTimeout> | undefined
    const budgetSpent = new Promise<never>((_, reject) => {
      budget = realSetTimeout(
        () => reject(new Error(`act callback still pending after ${ACT_BUDGET_MS}ms`)),
        ACT_BUDGET_MS
      )
    })
    return Promise.race([result.then(() => undefined), budgetSpent]).finally(() =>
      realClearTimeout(budget)
    )
  })
}

authClientMockFns.mockUseSession.mockImplementation(() => ({
  data: { user: { id: 'test-viewer' } },
}))

const mockUsePathname = nextNavigationMockFns.mockUsePathname
mockUsePathname.mockReturnValue('/workspace/ws-1/home')

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
  postBodies: Array<{
    message: string
    mode?: string
    userMessageId?: string
    chatId?: string
    effort?: string
  }>
  pendingAdmissions: Map<string, () => void>
  abortSettlements: boolean[]
  abortBodies: CopilotChatAbortBody[]
  stopBodies: CopilotChatStopBody[]
  toolInputPadding?: string
  abortTraceparents: Array<string | null>
  steerBodies: CopilotChatSteerBody[]
  /**
   * How the steer route answers, one per request: a disposition status, or
   * `409` (no live run took it). Once spent, it answers `409`.
   */
  steerDispositions: Array<'queued' | 'applied' | 'not_applied' | 409>
  /** The `textOffset` an `applied` disposition reports. */
  appliedOffset?: number
}

const state: NetworkState = {
  postBehavior: 'hang',
  postBodies: [],
  pendingAdmissions: new Map(),
  abortSettlements: [],
  abortBodies: [],
  stopBodies: [],
  abortTraceparents: [],
  steerBodies: [],
  steerDispositions: [],
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
    const body: CopilotChatAbortBody = JSON.parse(String(init?.body))
    state.abortBodies.push(body)
    if (body.streamId) state.pendingAdmissions.get(body.streamId)?.()
    state.abortTraceparents.push(new Headers(init?.headers).get('traceparent'))
    return Response.json({ aborted: true, settled: state.abortSettlements.shift() ?? true })
  }
  if (url.includes('/api/copilot/chat/steer')) {
    const body: CopilotChatSteerBody = JSON.parse(String(init?.body))
    state.steerBodies.push(body)
    const disposition = state.steerDispositions.shift() ?? 409
    return disposition === 409
      ? Response.json({ error: 'No running turn accepted this message.' }, { status: 409 })
      : Response.json({
          steeringId: body.steeringId,
          status: disposition,
          ...(disposition === 'applied' && state.appliedOffset !== undefined
            ? { eventSeq: 1, textOffset: state.appliedOffset }
            : {}),
        })
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
    const sent = state.postBodies.at(-1)
    const admissionHeaders = {
      'Content-Type': 'text/event-stream',
      'x-mothership-chat-id': sent?.chatId ?? DEDUPED_CHAT_ID,
    }
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
        { status: 200, headers: admissionHeaders }
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
          executor: state.toolInputPadding ? 'go' : 'client',
          mode: state.toolInputPadding ? 'sync' : 'async',
          toolName: state.toolInputPadding ? 'run_code' : 'run_workflow',
          toolCallId: 'this-chat-tool',
          arguments: {
            workflowId: 'this-chat-workflow',
            ...(state.toolInputPadding ? { padding: state.toolInputPadding } : {}),
          },
        },
      }
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`))
          },
        }),
        { status: 200, headers: { ...admissionHeaders, traceparent: TRACEPARENT } }
      )
    }
    return new Promise<Response>((resolve, reject) => {
      if (sent?.userMessageId) {
        const admit = () => resolve(new Response(null, { status: 200, headers: admissionHeaders }))
        state.pendingAdmissions.set(sent.userMessageId, admit)
        if (state.abortBodies.some((body) => body.streamId === sent.userMessageId)) admit()
      }
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

function renderUseChat(
  owner: string | { organizationId: string } = 'ws-1',
  requestMode?: 'agent' | 'assistant',
  getChatUrl?: (chatId: string) => string
): {
  getResult: () => ReturnType<typeof useChat>
  unmount: () => void
  selectMode: (mode: 'agent' | 'assistant') => void
} {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const container = document.createElement('div')
  const root = createRoot(container)
  mountedRoots.push(root)
  let result: ReturnType<typeof useChat> | undefined

  function Probe() {
    result = useChat(owner, undefined, { requestMode, getChatUrl })
    return null
  }

  act(() => {
    root.render(
      <ToastProvider>
        <QueryClientProvider client={queryClient}>{(<Probe />) as ReactNode}</QueryClientProvider>
      </ToastProvider>
    )
  })

  return {
    getResult: () => {
      if (result === undefined) throw new Error('Hook result is not ready')
      return result
    },
    unmount: () => act(() => root.unmount()),
    selectMode: (mode) => {
      requestMode = mode
      act(() =>
        root.render(
          <ToastProvider>
            <QueryClientProvider client={queryClient}>
              <Probe />
            </QueryClientProvider>
          </ToastProvider>
        )
      )
    },
  }
}

/**
 * As `renderUseChat`, but bound to an existing chat rather than chatless. The
 * pathname has to match: the hook resets a chat-bound surface back to a fresh
 * pending key when it finds itself on the home route.
 */
function renderUseChatInChat(
  chatId: string,
  history?: MothershipChatHistory,
  sharedQueryClient: QueryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  }),
  selectedResourceId?: string,
  requestMode?: 'agent' | 'assistant'
): {
  getResult: () => ReturnType<typeof useChat>
  unmount: () => void
  navigate: (nextChatId: string, nextHistory: MothershipChatHistory) => void
} {
  mockUsePathname.mockReturnValue(`/workspace/ws-1/chat/${chatId}`)
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  queryClient = sharedQueryClient
  if (history) queryClient.setQueryData(mothershipChatKeys.detail(chatId), history)
  const container = document.createElement('div')
  const root = createRoot(container)
  mountedRoots.push(root)
  let result: ReturnType<typeof useChat> | undefined

  function Probe() {
    const activeResourceState = useState<string | null>(selectedResourceId ?? null)
    result = useChat('ws-1', chatId, {
      ...(selectedResourceId ? { activeResourceState } : {}),
      ...(requestMode ? { requestMode } : {}),
    })
    return null
  }

  act(() => {
    root.render(
      <ToastProvider>
        <QueryClientProvider client={queryClient}>{(<Probe />) as ReactNode}</QueryClientProvider>
      </ToastProvider>
    )
  })

  return {
    getResult: () => {
      if (result === undefined) throw new Error('Hook result is not ready')
      return result
    },
    unmount: () => act(() => root.unmount()),
    navigate: (nextChatId, nextHistory) => {
      chatId = nextChatId
      mockUsePathname.mockReturnValue(`/workspace/ws-1/chat/${chatId}`)
      queryClient.setQueryData(mothershipChatKeys.detail(chatId), nextHistory)
      act(() =>
        root.render(
          <ToastProvider>
            <QueryClientProvider client={queryClient}>
              <Probe />
            </QueryClientProvider>
          </ToastProvider>
        )
      )
    },
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
      <ToastProvider>
        <QueryClientProvider client={queryClient}>
          {(<HomeLike />) as ReactNode}
        </QueryClientProvider>
      </ToastProvider>
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

/** Holds the chat POST of the first send until the test settles it. */
function holdFirstSend(): PromiseWithResolvers<Response> {
  const post = Promise.withResolvers<Response>()
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) !== '/api/mothership/chat' || init?.method !== 'POST') {
      return fetchStub(input, init)
    }
    state.postBodies.push(JSON.parse(String(init.body)))
    return post.promise
  })
  return post
}

/**
 * Mounts a chatless surface shaped like `home.tsx`, with real composers: the empty-state one
 * swaps for the chat view's once messages show, and the chat view's names the resolved chat.
 */
function renderComposerSwap(): {
  container: HTMLElement
  getResult: () => ReturnType<typeof useChat>
  shownEffort: () => string | null | undefined
  visit: (pathname: string) => void
} {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  useMothershipEffortStore.getState().reset()
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const container = document.createElement('div')
  const root = createRoot(container)
  mountedRoots.push(root)
  let result: ReturnType<typeof useChat> | undefined

  function HomeLike() {
    result = useChat('ws-1', undefined)
    return result.messages.length > 0 ? (
      <section key='chat'>
        <ChatSurfaceProvider chatId={result.resolvedChatId}>
          <ModelSelector />
        </ChatSurfaceProvider>
      </section>
    ) : (
      <main key='empty'>
        <ModelSelector />
      </main>
    )
  }

  const render = () =>
    act(() => {
      root.render(
        <ToastProvider>
          <QueryClientProvider client={queryClient}>
            <HomeLike />
          </QueryClientProvider>
        </ToastProvider>
      )
    })
  render()

  return {
    container,
    getResult: () => {
      if (result === undefined) throw new Error('Hook result is not ready')
      return result
    },
    shownEffort: () =>
      container.querySelector('[aria-label="Reasoning effort"]')?.getAttribute('aria-description'),
    visit: (pathname) => {
      mockUsePathname.mockReturnValue(pathname)
      render()
    },
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
        <ToastProvider>
          <QueryClientProvider client={queryClient}>{(<Probe />) as ReactNode}</QueryClientProvider>
        </ToastProvider>
      </StrictMode>
    )
  })
}

/** The user messages the transcript shows, in order. */
function userMessages(result: ReturnType<typeof useChat>): string[] {
  return result.messages.filter((message) => message.role === 'user').map((m) => m.content)
}

/** Lets `ms` pass, on the fake clock when a test runs one. */
function elapse(ms: number): Promise<unknown> {
  return vi.isFakeTimers() ? vi.advanceTimersByTimeAsync(ms) : sleep(ms)
}

async function waitFor(predicate: () => boolean, budgetMs = 2000): Promise<void> {
  const deadline = Date.now() + budgetMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitFor timed out')
    await act(async () => {
      await elapse(10)
    })
  }
}

describe('useChat remount send recovery', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchStub)
    mockUsePathname.mockReturnValue('/workspace/ws-1/home')
    state.postBehavior = 'hang'
    state.postBodies = []
    state.pendingAdmissions.clear()
    state.abortSettlements = []
    state.abortBodies = []
    state.toolInputPadding = undefined
    state.stopBodies = []
    state.abortTraceparents = []
    mockRequestJson.mockResolvedValue({ chats: [] })
    state.steerBodies = []
    state.steerDispositions = []
    state.appliedOffset = undefined
    useMothershipOutgoingStore.getState().reset()
    useExecutionStore.setState({ workflowExecutions: new Map() })
    window.sessionStorage.clear()
    window.localStorage.clear()
  })

  afterEach(() => {
    for (const root of mountedRoots.splice(0)) {
      act(() => root.unmount())
    }
    queryClient?.clear()
    resetDeploymentShape()
  })

  it.each([false, true])(
    'keeps Search citations in the answer without replacing user panels (existing search: %s)',
    async (hasSearchPanel) => {
      const shape = resolveDeploymentShape()
      seedDeploymentShape({
        ...shape,
        features: shape.features,
      })
      const history: MothershipChatHistory = {
        id: 'chat-cited-search',
        title: 'Search',
        messages: [],
        activeStreamId: null,
        resources: hasSearchPanel
          ? [
              {
                type: 'search',
                id: 'search:workspace:ws-1',
                title: 'Search results',
                workspaceId: 'ws-1',
                search: { query: 'policy', scope: { kind: 'workspace', workspaceId: 'ws-1' } },
              },
              {
                type: 'sources',
                id: 'cited-sources',
                title: 'Sources',
                sources: { messageId: 'previous-answer' },
              },
            ]
          : [],
      }
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) !== '/api/mothership/chat' || init?.method !== 'POST') {
          return fetchStub(input, init)
        }
        const sent = JSON.parse(String(init.body))
        const envelope = { v: 1 as const, ts: '', stream: { streamId: sent.userMessageId } }
        const events: MothershipStreamV1EventEnvelope[] = [
          {
            ...envelope,
            seq: 1,
            type: 'tool',
            payload: {
              phase: 'call',
              executor: 'go',
              mode: 'sync',
              toolName: 'search_workspace',
              toolCallId: 'search-policy',
              arguments: { query: 'policy' },
            },
          },
          {
            ...envelope,
            seq: 2,
            type: 'tool',
            payload: {
              phase: 'result',
              toolName: 'search_workspace',
              toolCallId: 'search-policy',
              success: true,
              output: {
                results: [
                  {
                    citationId: 'policy',
                    citationUrl: 'https://example.com/policy',
                    documentName: 'Policy',
                    content: 'Policy evidence',
                  },
                ],
              },
            },
          },
          {
            ...envelope,
            seq: 3,
            type: 'text',
            payload: {
              channel: 'assistant',
              text: 'Here is the policy. <source>{"id":"policy"}</source>',
            },
          },
          {
            ...envelope,
            seq: 4,
            type: 'resource',
            payload: {
              op: 'upsert',
              resource: {
                type: 'search',
                id: 'search:workspace:ws-1',
                title: 'Search results',
                workspaceId: 'ws-1',
                search: { query: 'policy', scope: { kind: 'workspace', workspaceId: 'ws-1' } },
              },
            },
          },
          { ...envelope, seq: 5, type: 'complete', payload: { status: 'complete' } },
        ]
        return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
          headers: { 'Content-Type': 'text/event-stream', 'x-mothership-chat-id': history.id },
        })
      })
      const selectedId = history.resources[0]
        ? getChatResourceSelectionId(history.resources[0])
        : undefined
      const { getResult } = renderUseChatInChat(
        history.id,
        history,
        undefined,
        selectedId,
        'assistant'
      )
      expect(getResult().resources).toEqual(history.resources)
      await act(async () => {
        await getResult().sendMessage('Find the policy')
      })
      const answer = getResult().messages.find((message) => message.role === 'assistant')
      const sources = collectCitedMessageSources(answer?.contentBlocks ?? [], answer?.content ?? '')
      expect(sources.map((source) => source.url)).toEqual(['https://example.com/policy'])
      expect(getResult().resources).toEqual(history.resources)
      expect(getResult().activeResourceId).toBe(selectedId ?? null)
      expect(getResult().isSending).toBe(false)
    }
  )

  describe('a tab the server removed while the client was still adding it', () => {
    const chat: MothershipChatHistory = {
      id: 'chat-removed-file',
      title: 'Files',
      messages: [],
      activeStreamId: null,
      resources: [],
    }

    /**
     * Streams a turn that opens a file tab without an effect (the client
     * persists it), then the server's own removal of that file as an effect.
     * Later turns only complete. The removal is held until `addSent` resolves,
     * so the client's own write for the add has started by then. Returns each
     * send's resource attachments.
     */
    function streamAddThenServerRemoval(addSent: Promise<void>): unknown[] {
      const sentAttachments: unknown[] = []
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) !== '/api/mothership/chat' || init?.method !== 'POST') {
          return fetchStub(input, init)
        }
        const sent = JSON.parse(String(init.body))
        sentAttachments.push(sent.resourceAttachments)
        const envelope = { v: 1 as const, ts: '', stream: { streamId: sent.userMessageId } }
        const file = { type: 'file' as const, id: 'deleted-file', title: 'report.csv' }
        const complete: PersistedStreamEventEnvelope = {
          ...envelope,
          seq: 3,
          type: 'complete',
          payload: { status: 'complete' },
        }
        const events: PersistedStreamEventEnvelope[] =
          sentAttachments.length === 1
            ? [
                {
                  ...envelope,
                  seq: 1,
                  type: 'resource',
                  payload: { op: 'upsert', resource: file },
                },
                {
                  ...envelope,
                  seq: 2,
                  type: 'resource',
                  payload: { op: 'remove', resource: file, effectId: 'remove-deleted-file' },
                },
                complete,
              ]
            : [complete]
        const encoder = new TextEncoder()
        const body = new ReadableStream<Uint8Array>({
          async start(controller) {
            const [first, ...rest] = events
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(first)}\n\n`))
            if (rest.length > 0) {
              await addSent
              // One macrotask lets a write that already failed settle in the queue.
              await sleep(0)
            }
            for (const event of rest) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
            }
            controller.close()
          },
        })
        return new Response(body, {
          headers: { 'Content-Type': 'text/event-stream', 'x-mothership-chat-id': chat.id },
        })
      })
      return sentAttachments
    }

    /**
     * Resource writes the hook sent, as `METHOD id`, and a promise that
     * resolves once the first add has been sent.
     */
    function recordResourceWrites(persist: () => Promise<unknown>): {
      writes: string[]
      addSent: Promise<void>
    } {
      const writes: string[] = []
      const addSent = createDeferred<void>()
      mockRequestJson.mockImplementation(async (contract: AnyApiRouteContract, input) => {
        if (contract.path !== '/api/mothership/chat/resources') return { chats: [] }
        const { body } = input as { body: { resource?: { id: string }; resourceId?: string } }
        writes.push(`${contract.method} ${body.resource?.id ?? body.resourceId}`)
        if (contract.method !== 'POST') return { resources: [] }
        addSent.resolve()
        return persist()
      })
      return { writes, addSent: addSent.promise }
    }

    it('drops a failed add without re-posting it or deleting server-side', async () => {
      const { writes, addSent } = recordResourceWrites(async () => {
        throw new Error('Persist failed')
      })
      const sentAttachments = streamAddThenServerRemoval(addSent)
      const { getResult } = renderUseChatInChat(chat.id, chat)

      await act(async () => {
        await getResult().sendMessage('Export the report, then delete it')
      })
      const writesBeforeRemoval = [...writes]
      await act(async () => {
        queryClient.setQueryData(mothershipChatKeys.detail(chat.id), { ...chat })
        await sleep(0)
      })
      await act(async () => {
        await getResult().sendMessage('What is open?')
      })

      expect(writesBeforeRemoval).not.toContain('DELETE deleted-file')
      expect(writes).toEqual(writesBeforeRemoval)
      expect(getResult().resources.map((resource) => resource.id)).not.toContain('deleted-file')
      expect(JSON.stringify(sentAttachments.at(-1) ?? [])).not.toContain('deleted-file')
    })

    it('drops a failed add when the removal arrives in a reconnect replay', async () => {
      const { writes } = recordResourceWrites(async () => {
        throw new Error('Persist failed')
      })
      const file = { type: 'file' as const, id: 'deleted-file', title: 'report.csv' }
      const sentAttachments: unknown[] = []
      let streamId = ''
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.includes('/api/mothership/chat/stream')) {
          const removal: PersistedStreamEventEnvelope = {
            v: 1,
            ts: '',
            stream: { streamId },
            seq: 2,
            type: 'resource',
            payload: { op: 'remove', resource: file, effectId: 'remove-deleted-file' },
          }
          const opened: PersistedStreamEventEnvelope = {
            ...removal,
            seq: 1,
            payload: { op: 'upsert', resource: file },
          }
          return Response.json({
            success: true,
            events: [opened, removal].map((event) => ({ eventId: event.seq, streamId, event })),
            status: 'complete',
          })
        }
        if (url !== '/api/mothership/chat' || init?.method !== 'POST') {
          return fetchStub(input, init)
        }
        const sent = JSON.parse(String(init.body))
        sentAttachments.push(sent.resourceAttachments)
        streamId = sent.userMessageId
        const envelope = { v: 1 as const, ts: '', stream: { streamId } }
        const events: PersistedStreamEventEnvelope[] =
          sentAttachments.length === 1
            ? [{ ...envelope, seq: 1, type: 'resource', payload: { op: 'upsert', resource: file } }]
            : [{ ...envelope, seq: 1, type: 'complete', payload: { status: 'complete' } }]
        return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
          headers: { 'Content-Type': 'text/event-stream', 'x-mothership-chat-id': chat.id },
        })
      })
      const { getResult } = renderUseChatInChat(chat.id, chat)

      await act(async () => {
        await getResult().sendMessage('Export the report, then delete it')
      })
      await waitFor(() => !getResult().isSending)
      const writesBeforeRemoval = [...writes]
      await act(async () => {
        queryClient.setQueryData(mothershipChatKeys.detail(chat.id), { ...chat })
        await sleep(0)
      })
      await act(async () => {
        await getResult().sendMessage('What is open?')
      })

      expect(writes).toEqual(writesBeforeRemoval)
      expect(getResult().resources.map((resource) => resource.id)).not.toContain('deleted-file')
      expect(JSON.stringify(sentAttachments.at(-1) ?? [])).not.toContain('deleted-file')
    })
  })

  describe('closing a file tab', () => {
    const projectFile: MothershipResource = {
      type: 'file',
      id: 'shared-file',
      title: 'brief.md',
      owner: { entityType: 'project', entityId: 'project-1' },
    }
    const workspaceFile: MothershipResource = {
      type: 'file',
      id: 'shared-file',
      title: 'notes.md',
      workspaceId: 'ws-1',
      owner: { entityType: 'workspace', entityId: 'ws-1' },
    }

    /** Opens a chat holding `resources` and records each resource DELETE body. */
    function renderChatRecordingRemovals(resources: MothershipResource[], selected?: string) {
      const history: MothershipChatHistory = {
        id: 'chat-file-tabs',
        title: 'Files',
        messages: [],
        activeStreamId: null,
        resources,
      }
      const removals: unknown[] = []
      mockRequestJson.mockImplementation(async (contract: AnyApiRouteContract, input) => {
        if (contract.path !== '/api/mothership/chat/resources') return { chats: [] }
        removals.push((input as { body: unknown }).body)
        return { resources: [] }
      })
      const { getResult } = renderUseChatInChat(history.id, history, undefined, selected)
      return { history, removals, getResult }
    }

    it('closes a Project file tab by its owner and leaves a workspace file with the same id', async () => {
      const { history, removals, getResult } = renderChatRecordingRemovals(
        [projectFile, workspaceFile],
        getChatResourceSelectionId(projectFile)
      )

      await act(async () => {
        getResult().removeResource(projectFile)
        await sleep(0)
      })

      expect(removals).toEqual([
        {
          chatId: history.id,
          resourceType: 'file',
          resourceId: 'shared-file',
          owner: { entityType: 'project', entityId: 'project-1' },
        },
      ])
      expect(getResult().resources).toEqual([workspaceFile])
      expect(getResult().activeResourceId).not.toBe(getChatResourceSelectionId(projectFile))
    })

    it('closes a workspace file tab named only by type and id, deleting it as stored', async () => {
      const { history, removals, getResult } = renderChatRecordingRemovals([workspaceFile])

      await act(async () => {
        getResult().removeResource({ type: 'file', id: 'shared-file' })
        await sleep(0)
      })

      expect(removals).toEqual([
        {
          chatId: history.id,
          resourceType: 'file',
          resourceId: 'shared-file',
          workspaceId: 'ws-1',
          owner: { entityType: 'workspace', entityId: 'ws-1' },
        },
      ])
      expect(getResult().resources).toEqual([])
    })
  })

  it('restores an explicitly selected Search tab while reconnecting an active turn', async () => {
    const shape = resolveDeploymentShape()
    seedDeploymentShape({ ...shape, features: shape.features })
    const history: MothershipChatHistory = {
      id: 'chat-reconnecting-search',
      title: 'Search',
      activeStreamId: 'accepted-search',
      messages: [
        { id: 'accepted-search', role: 'user', content: 'Find the policy', timestamp: '' },
      ],
      resources: [
        {
          type: 'search',
          id: 'search:workspace:ws-1',
          title: 'Search',
          workspaceId: 'ws-1',
          search: { query: 'policy', scope: { kind: 'workspace', workspaceId: 'ws-1' } },
        },
        {
          type: 'sources',
          id: 'cited-sources',
          title: 'Sources',
          sources: { messageId: 'previous-answer' },
        },
      ],
    }
    const selected = getChatResourceSelectionId(history.resources[0])
    const { getResult } = renderUseChatInChat(history.id, history, undefined, selected, 'assistant')
    expect(getResult().resources).toEqual(history.resources)
    expect(getResult().activeResourceId).toBe(selected)
    await act(async () => {})
    expect(getResult().resources).toEqual(history.resources)
    expect(getResult().activeResourceId).toBe(selected)
  })

  it.each([
    { surface: 'a new chat', newChatPick: null, storedPick: null, sends: undefined },
    { surface: 'a new chat', newChatPick: 'medium', storedPick: null, sends: 'medium' },
    { surface: 'an existing chat', newChatPick: null, storedPick: null, sends: undefined },
    { surface: 'an existing chat', newChatPick: null, storedPick: 'medium', sends: 'medium' },
  ] as const)(
    'sends effort $sends from $surface only when the user picked one',
    async ({ surface, newChatPick, storedPick, sends }) => {
      state.postBehavior = 'accept'
      useMothershipEffortStore.getState().reset()
      if (newChatPick) useMothershipEffortStore.getState().setNewChatEffort(newChatPick)
      const { getResult } =
        surface === 'a new chat'
          ? renderUseChat('ws-1', 'agent')
          : renderUseChatInChat('chat-effort', {
              id: 'chat-effort',
              title: 'Effort',
              messages: [],
              activeStreamId: null,
              resources: [],
              effort: storedPick,
            })
      await act(async () => {
        await getResult().sendMessage('Plan the launch')
      })
      expect(state.postBodies).toHaveLength(1)
      expect(state.postBodies[0].effort).toBe(sends)
    }
  )

  it('identifies a Stop while an existing-chat query is still cancelling', async () => {
    const { getResult } = renderUseChatInChat('chat-a')
    let releaseCancellation!: () => void
    vi.spyOn(queryClient, 'cancelQueries').mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseCancellation = resolve
        })
    )
    let sent!: Promise<void>
    let stopped!: Promise<void>
    await act(async () => {
      sent = getResult().sendMessage('Stop before the POST')
      stopped = getResult().stopGeneration()
    })
    expect(state.postBodies).toHaveLength(0)
    expect(state.abortBodies[0]?.streamId).toBeTruthy()
    await act(async () => {
      releaseCancellation()
      await Promise.all([sent, stopped])
    })
    expect(state.postBodies[0].userMessageId).toBe(state.abortBodies[0].streamId)
    expect(state.postBodies[0].chatId).toBe('chat-a')
  })

  it('moves an Assistant turn from organization Home to its Search chat, and Home starts over', async () => {
    mockUsePathname.mockReturnValue('/o/org-1/home')
    state.postBehavior = 'task'
    const replace = vi.spyOn(window.history, 'replaceState')
    const { getResult, selectMode } = renderUseChat(
      { organizationId: 'org-1' },
      'assistant',
      (id) => `/o/org-1/search/chat/${id}?mode=assistant`
    )
    await act(async () => {
      void getResult().sendMessage('What changed in the renewal policy?', undefined, undefined, {
        requestMode: 'assistant',
      })
    })
    await waitFor(() => getResult().resolvedChatId === DEDUPED_CHAT_ID)
    expect(state.postBodies[0]).toMatchObject({ mode: 'assistant' })
    const chatPath = `/o/org-1/search/chat/${DEDUPED_CHAT_ID}`
    expect(replace).toHaveBeenCalledWith(null, '', `${chatPath}?mode=assistant`)

    mockUsePathname.mockReturnValue(chatPath)
    selectMode('assistant')
    expect(getResult().resolvedChatId).toBe(DEDUPED_CHAT_ID)
    expect(getResult().messages.length).toBeGreaterThan(0)

    mockUsePathname.mockReturnValue('/o/org-1/home')
    selectMode('assistant')
    await waitFor(() => getResult().resolvedChatId === undefined)
    expect(getResult().messages).toEqual([])
  })

  it('does not navigate from an unmounted stopped send when admission arrives late', async () => {
    let admit!: (response: Response) => void
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/api/mothership/chat') && init?.method === 'POST') {
        state.postBodies.push(JSON.parse(String(init.body)))
        return new Promise<Response>((resolve) => {
          admit = resolve
        })
      }
      return fetchStub(input, init)
    })
    const { getResult, unmount } = renderUseChat()
    await act(async () => {
      void getResult().sendMessage('Keep my stopped message')
    })
    await waitFor(() => state.postBodies.length === 1)
    let stopped!: Promise<void>
    await act(async () => {
      stopped = getResult().stopGeneration()
    })
    unmount()
    const replace = vi.spyOn(window.history, 'replaceState')
    await act(async () => {
      admit(new Response(null, { headers: { 'x-mothership-chat-id': DEDUPED_CHAT_ID } }))
      await stopped
    })
    expect(replace).not.toHaveBeenCalled()
    expect(state.stopBodies[0]).toMatchObject({ chatId: DEDUPED_CHAT_ID })
  })

  it('bounds the Stop wait without sending a follow-up into a second chat', async () => {
    let admit!: (response: Response) => void
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/api/mothership/chat') && init?.method === 'POST') {
        state.postBodies.push(JSON.parse(String(init.body)))
        if (state.postBodies.length === 1)
          return new Promise<Response>((resolve) => {
            admit = resolve
          })
        return emptySseResponse()
      }
      return fetchStub(input, init)
    })
    const { getResult } = renderUseChat()
    await act(async () => {
      void getResult().sendMessage('A slowly admitted message')
    })
    await waitFor(() => state.postBodies.length === 1)
    vi.useFakeTimers()
    try {
      let stopped!: Promise<void>
      await act(async () => {
        stopped = getResult().stopGeneration()
        void stopped.catch(() => {})
        await vi.advanceTimersByTimeAsync(31_000)
      })
      await expect(stopped).rejects.toThrow('Operation deadline expired')
      await act(async () => {
        await getResult().sendMessage('Do not create a second chat')
      })
      await act(async () => {
        await getResult().sendMessage('Keep another follow-up here too')
      })
      expect(state.postBodies).toHaveLength(1)
      expect(userMessages(getResult())).toContain('Do not create a second chat')
      await act(async () => {
        admit(new Response(null, { headers: { 'x-mothership-chat-id': DEDUPED_CHAT_ID } }))
        await vi.advanceTimersByTimeAsync(1)
      })
      expect(state.postBodies.length).toBeGreaterThanOrEqual(2)
      expect(state.postBodies[1].chatId).toBe(DEDUPED_CHAT_ID)
      expect(state.postBodies.slice(1).every((body) => body.chatId === DEDUPED_CHAT_ID)).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('surfaces an explicit admission rejection without reconnecting or marking the user turn stopped', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/mothership/chat' && init?.method === 'POST')
        return Response.json(
          { error: 'Fast Search is unavailable for this request' },
          { status: 400 }
        )
      return fetchStub(input, init)
    })
    vi.stubGlobal('fetch', fetch)
    const { getResult } = renderUseChat({ organizationId: 'org-a' }, 'assistant')
    await act(async () => {
      await getResult().sendMessage('Find Orion', undefined, undefined, {
        assistantSearchLevel: 'fast',
      })
    })
    expect(getResult().error).toBe('Fast Search is unavailable for this request')
    expect(getResult().isSending).toBe(false)
    expect(getResult().isReconnecting).toBe(false)
    expect(
      getResult()
        .messages.filter((message) => message.role === 'user')
        .map((message) => message.content)
    ).toEqual(['Find Orion'])
    expect(
      getResult()
        .messages.flatMap((message) => message.contentBlocks ?? [])
        .some((block) => block.type === 'stopped')
    ).toBe(false)
    expect(fetch.mock.calls.some(([input]) => String(input).includes('/stream'))).toBe(false)
  })

  it.each(['initial', 'tail'] as const)(
    'recovers a silent %s connection after a tool group without refresh or resending',
    async (connection) => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      let unmount: (() => void) | undefined
      try {
        const history: MothershipChatHistory = {
          id: 'chat-silent-stream',
          title: 'Silent stream',
          messages: [],
          activeStreamId: null,
          resources: [],
        }
        const cancelled = vi.fn()
        const cursors: string[] = []
        let recovered = false
        let tailReads = 0
        let streamId = ''
        const textEvent = (): MothershipStreamV1EventEnvelope => ({
          v: 1,
          seq: 3,
          ts: new Date().toISOString(),
          type: 'text',
          stream: { streamId },
          payload: { channel: 'assistant', text: 'The work continued.' },
        })
        vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input)
          if (url === '/api/mothership/chat' && init?.method === 'POST') {
            const sent = JSON.parse(String(init.body))
            state.postBodies.push(sent)
            streamId = sent.userMessageId
            const events: MothershipStreamV1EventEnvelope[] = [
              {
                v: 1,
                seq: 1,
                ts: new Date().toISOString(),
                type: 'tool',
                stream: { streamId },
                payload: {
                  phase: 'call',
                  executor: 'go',
                  mode: 'sync',
                  toolName: 'run_code',
                  toolCallId: 'finished-tool',
                  arguments: { code: 'return 1' },
                },
              },
              {
                v: 1,
                seq: 2,
                ts: new Date().toISOString(),
                type: 'tool',
                stream: { streamId },
                payload: {
                  phase: 'result',
                  toolName: 'run_code',
                  toolCallId: 'finished-tool',
                  success: true,
                  output: { value: 1 },
                },
              },
            ]
            return new Response(
              new ReadableStream<Uint8Array>({
                start(controller) {
                  for (const event of events)
                    controller.enqueue(
                      new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)
                    )
                  if (connection === 'tail') controller.close()
                },
                cancel: cancelled,
              }),
              {
                headers: {
                  'Content-Type': 'text/event-stream',
                  'x-mothership-chat-id': history.id,
                },
              }
            )
          }
          if (url.includes('/api/mothership/chat/stream')) {
            const params = new URL(url, 'https://sim.test').searchParams
            if (params.get('batch') === 'true') {
              cursors.push(params.get('after') ?? '')
              recovered = connection === 'initial' || tailReads > 0
              return Response.json({
                success: true,
                status: 'streaming',
                events: recovered ? [{ eventId: 3, streamId, event: textEvent() }] : [],
              })
            }
            tailReads++
            return new Response(new ReadableStream<Uint8Array>({ cancel: cancelled }), {
              headers: { 'Content-Type': 'text/event-stream' },
            })
          }
          return fetchStub(input, init)
        })
        const mounted = renderUseChatInChat(history.id, history)
        unmount = mounted.unmount
        const { getResult } = mounted
        await act(async () => {
          void getResult().sendMessage('Keep working')
        })
        await act(async () => vi.advanceTimersByTimeAsync(0))
        expect(
          getResult()
            .messages.flatMap((message) => message.contentBlocks ?? [])
            .find((block) => block.toolCall?.id === 'finished-tool')?.toolCall?.status
        ).toBe('success')
        expect(recovered).toBe(false)
        await act(async () => vi.advanceTimersByTimeAsync(45_000))
        expect(recovered).toBe(true)
        expect(cursors.every((cursor) => cursor === '2')).toBe(true)
        expect(cancelled).toHaveBeenCalledTimes(1)
        expect(
          getResult()
            .messages.filter((message) => message.role === 'assistant')
            .map((message) => message.content)
        ).toEqual(['The work continued.'])
        expect(getResult().isSending).toBe(true)
        expect(getResult().error).toBeNull()
        expect(state.postBodies).toHaveLength(1)
        expect(state.abortBodies).toHaveLength(0)
      } finally {
        unmount?.()
        vi.useRealTimers()
      }
    }
  )

  it('recovers a running turn after reconnect exhaustion without reloading or resending', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      let online = false
      let recoveredTail = false
      let failedReconnects = 0
      const history: MothershipChatHistory = {
        id: 'chat-reconnect-exhausted',
        mode: 'agent',
        title: 'Reconnect',
        messages: [],
        activeStreamId: null,
        resources: [],
      }
      mockRequestJson.mockImplementation(() =>
        Promise.resolve({
          chat: {
            ...history,
            activeStreamId: state.postBodies[0]?.userMessageId ?? null,
          },
        })
      )
      state.postBehavior = 'accept'
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (!url.includes('/api/mothership/chat/stream')) return fetchStub(input, init)
        if (!online) {
          failedReconnects++
          throw new TypeError('Failed to fetch')
        }
        if (url.includes('batch=true')) {
          return Response.json({ success: true, events: [], status: 'streaming' })
        }
        recoveredTail = true
        return new Response(new ReadableStream<Uint8Array>(), {
          headers: { 'Content-Type': 'text/event-stream' },
        })
      })
      const { getResult } = renderUseChatInChat(history.id, history)
      await act(async () => {
        void getResult().sendMessage('Continue working')
      })
      for (let second = 0; second < 240 && failedReconnects < 12; second++) {
        await act(async () => vi.advanceTimersByTimeAsync(1_000))
      }
      expect(failedReconnects).toBeGreaterThanOrEqual(12)
      online = true
      await act(async () => vi.advanceTimersByTimeAsync(30_000))
      expect(recoveredTail).toBe(true)
      expect(getResult().isSending).toBe(true)
      expect(state.postBodies).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  /**
   * After the user leaves and returns once, the return recovery owns the stream for
   * the rest of the turn. When the network then drops, its tail either goes silent
   * (the socket stalls) or fails into the reconnect backoff, which grows to 30s.
   * Coming back online must re-attach at once, as it does while the send still owns
   * the stream, instead of waiting out the idle timeout or the backoff.
   */
  it.each(['stalled', 'failed'] as const)(
    're-attaches at once when the network returns to a return recovery whose tail %s',
    async (tailOutcome) => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      try {
        let online = true
        let backOnline = false
        let tailOpenedAfterReturn = false
        let failedReconnects = 0
        const openTails: ReadableStreamDefaultController<Uint8Array>[] = []
        const history: MothershipChatHistory = {
          id: `chat-recovery-${tailOutcome}`,
          mode: 'agent',
          title: 'Recovery',
          messages: [],
          activeStreamId: null,
          resources: [],
        }
        mockRequestJson.mockImplementation(() =>
          Promise.resolve({
            chat: { ...history, activeStreamId: state.postBodies[0]?.userMessageId ?? null },
          })
        )
        state.postBehavior = 'accept'
        vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input)
          if (!url.includes('/api/mothership/chat/stream')) return fetchStub(input, init)
          if (!online) {
            failedReconnects++
            throw new TypeError('Failed to fetch')
          }
          if (url.includes('batch=true')) {
            return Response.json({ success: true, events: [], status: 'streaming' })
          }
          if (backOnline) tailOpenedAfterReturn = true
          return new Response(
            new ReadableStream<Uint8Array>({
              start: (controller) => void openTails.push(controller),
            }),
            { headers: { 'Content-Type': 'text/event-stream' } }
          )
        })
        const { getResult } = renderUseChatInChat(history.id, history)
        await act(async () => {
          void getResult().sendMessage('Keep going while I am away')
        })
        await act(async () => vi.advanceTimersByTimeAsync(100))
        await act(async () => {
          window.dispatchEvent(new Event('pageshow'))
          await vi.advanceTimersByTimeAsync(100)
        })
        expect(openTails.length).toBeGreaterThan(0)

        online = false
        if (tailOutcome === 'failed') {
          await act(async () => {
            for (const tail of openTails.splice(0)) tail.error(new TypeError('network error'))
            await vi.advanceTimersByTimeAsync(0)
          })
          for (let second = 0; second < 120 && failedReconnects < 6; second++) {
            await act(async () => vi.advanceTimersByTimeAsync(1_000))
          }
          expect(failedReconnects).toBeGreaterThanOrEqual(6)
        } else {
          await act(async () => vi.advanceTimersByTimeAsync(20_000))
        }

        online = true
        backOnline = true
        await act(async () => {
          window.dispatchEvent(new Event('online'))
          await vi.advanceTimersByTimeAsync(500)
        })

        expect(tailOpenedAfterReturn).toBe(true)
        expect(getResult().isSending).toBe(true)
        expect(state.postBodies).toHaveLength(1)
      } finally {
        vi.useRealTimers()
      }
    }
  )

  /**
   * The turn ends on the server while this surface's reader is silent (a stalled
   * socket, or a recovery a later return superseded), so it never sees `complete`.
   * The next return reads a chat with no running turn; it must resolve the stream
   * it still shows as running instead of leaving the chat stuck on Stop.
   */
  it('finishes a turn that ended while its reader was silent when the user returns', async () => {
    let turnRunning = true
    const history: MothershipChatHistory = {
      id: 'chat-ended-while-silent',
      mode: 'agent',
      title: 'Ended while silent',
      messages: [],
      activeStreamId: null,
      resources: [],
    }
    mockRequestJson.mockImplementation(() =>
      Promise.resolve({
        chat: {
          ...history,
          activeStreamId: turnRunning ? (state.postBodies[0]?.userMessageId ?? null) : null,
        },
      })
    )
    state.postBehavior = 'accept'
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (!url.includes('/api/mothership/chat/stream')) return fetchStub(input, init)
      if (url.includes('batch=true')) {
        return Response.json({
          success: true,
          events: [],
          status: turnRunning ? 'streaming' : 'complete',
        })
      }
      return new Response(new ReadableStream<Uint8Array>(), {
        headers: { 'Content-Type': 'text/event-stream' },
      })
    })
    const { getResult } = renderUseChatInChat(history.id, history)
    await act(async () => {
      void getResult().sendMessage('Finish while I am away')
    })
    await act(async () => {
      window.dispatchEvent(new Event('pageshow'))
      await sleep(100)
    })
    expect(getResult().isSending).toBe(true)

    turnRunning = false
    await act(async () => {
      window.dispatchEvent(new Event('online'))
    })
    await waitFor(() => !getResult().isSending)

    expect(state.postBodies).toHaveLength(1)
  })

  /**
   * Before its POST is admitted a send shows as running, but the chat cannot list
   * it yet. A return event in that window must leave the POST alone.
   */
  it('does not abort a send still waiting for admission when the user returns', async () => {
    const history: MothershipChatHistory = {
      id: 'chat-pending-admission',
      mode: 'agent',
      title: 'Pending admission',
      messages: [],
      activeStreamId: null,
      resources: [],
    }
    mockRequestJson.mockImplementation(() => Promise.resolve({ chat: history }))
    let postSignal: AbortSignal | undefined
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/mothership/chat' && init?.method === 'POST') {
        state.postBodies.push(JSON.parse(String(init.body)))
        postSignal = init.signal ?? undefined
        return new Promise<Response>(() => {})
      }
      return fetchStub(input, init)
    })
    const { getResult } = renderUseChatInChat(history.id, history)
    await act(async () => {
      void getResult().sendMessage('Still being admitted')
    })
    await waitFor(() => postSignal !== undefined)

    await act(async () => {
      window.dispatchEvent(new Event('online'))
      await sleep(200)
    })

    expect(postSignal?.aborted).toBe(false)
    expect(getResult().isSending).toBe(true)
  })

  /**
   * The server admitted the send and finished its turn, but the POST's answer
   * never arrived. Once the chat holds the message, a return resolves the turn
   * rather than leaving the chat on Stop behind a POST that will not answer.
   */
  it('finishes an admitted turn whose POST never answered when the user returns', async () => {
    let admitted = false
    const history: MothershipChatHistory = {
      id: 'chat-admitted-unanswered',
      mode: 'agent',
      title: 'Admitted, unanswered',
      messages: [],
      activeStreamId: null,
      resources: [],
    }
    mockRequestJson.mockImplementation(() => {
      const userMessageId = state.postBodies[0]?.userMessageId
      return Promise.resolve({
        chat: {
          ...history,
          messages:
            admitted && userMessageId
              ? [
                  { id: userMessageId, role: 'user', content: 'Answer lost' },
                  { id: 'saved-answer', role: 'assistant', content: 'Done.' },
                ]
              : [],
        },
      })
    })
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/mothership/chat' && init?.method === 'POST') {
        state.postBodies.push(JSON.parse(String(init.body)))
        return new Promise<Response>(() => {})
      }
      if (url.includes('/api/mothership/chat/stream')) {
        return Response.json({ success: true, events: [], status: 'complete' })
      }
      return fetchStub(input, init)
    })
    const { getResult } = renderUseChatInChat(history.id, history)
    await act(async () => {
      void getResult().sendMessage('Answer lost')
    })
    await waitFor(() => state.postBodies.length === 1)

    admitted = true
    await act(async () => {
      window.dispatchEvent(new Event('online'))
    })
    await waitFor(() => !getResult().isSending)

    expect(state.postBodies).toHaveLength(1)
  })

  it('keeps re-attaching a long turn whose tails deliver events between separate network failures', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      let tails = 0
      const history: MothershipChatHistory = {
        id: 'chat-long-turn',
        mode: 'agent',
        title: 'Long turn',
        messages: [],
        activeStreamId: null,
        resources: [],
      }
      mockRequestJson.mockImplementation(() =>
        Promise.resolve({
          chat: { ...history, activeStreamId: state.postBodies[0]?.userMessageId ?? null },
        })
      )
      state.postBehavior = 'accept'
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (!url.includes('/api/mothership/chat/stream')) return fetchStub(input, init)
        if (url.includes('batch=true')) {
          return Response.json({ success: true, events: [], status: 'streaming' })
        }
        tails++
        const streamId = state.postBodies[0]?.userMessageId ?? ''
        const event: MothershipStreamV1EventEnvelope = {
          v: 1,
          seq: tails,
          ts: new Date().toISOString(),
          type: 'text',
          stream: { streamId, cursor: String(tails) },
          payload: { channel: 'assistant', text: `part ${tails} ` },
        }
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`))
            },
            pull(controller) {
              controller.error(new TypeError('network error'))
            },
          }),
          { headers: { 'Content-Type': 'text/event-stream' } }
        )
      })
      const { getResult } = renderUseChatInChat(history.id, history)
      await act(async () => {
        void getResult().sendMessage('Keep going for hours')
      })
      const errors = new Set<string>()
      let seconds = 0
      for (; seconds < 600 && tails < 15; seconds++) {
        await act(async () => vi.advanceTimersByTimeAsync(1_000))
        const error = getResult().error
        if (error) errors.add(error)
      }

      expect(tails).toBeGreaterThanOrEqual(15)
      /* Each failure after a tail that delivered events retries at the base delay. */
      expect(seconds).toBeLessThan(60)
      expect([...errors]).toEqual([])
      expect(getResult().isSending).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('rebuilds the turn from an empty response when a reconnect is re-synced from the log, and stays on the log', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      let tails = 0
      const streamUrls: string[] = []
      const history: MothershipChatHistory = {
        id: 'chat-log-resync',
        mode: 'agent',
        title: 'Log re-sync',
        messages: [],
        activeStreamId: null,
        resources: [],
      }
      mockRequestJson.mockImplementation(() =>
        Promise.resolve({
          chat: { ...history, activeStreamId: state.postBodies[0]?.userMessageId ?? null },
        })
      )
      state.postBehavior = 'accept'
      const frame = (streamId: string, seq: number, text: string) =>
        `data: ${JSON.stringify({
          v: 1,
          seq,
          ts: new Date().toISOString(),
          type: 'text',
          stream: { streamId, cursor: String(seq) },
          payload: { channel: 'assistant', text },
        } satisfies MothershipStreamV1EventEnvelope)}\n\n`
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (!url.includes('/api/mothership/chat/stream')) return fetchStub(input, init)
        streamUrls.push(url)
        if (url.includes('batch=true')) {
          return Response.json({ success: true, events: [], status: 'streaming' })
        }
        tails++
        const streamId = state.postBodies[0]?.userMessageId ?? ''
        if (tails === 1) {
          return new Response([1, 2, 3].map((seq) => frame(streamId, seq, 'stale ')).join(''), {
            headers: { 'Content-Type': 'text/event-stream' },
          })
        }
        return new Response(frame(streamId, 1, 'Full response.'), {
          headers: {
            'Content-Type': 'text/event-stream',
            [MOTHERSHIP_STREAM_REPLAY_HEADER]: 'log',
          },
        })
      })
      const { getResult } = renderUseChatInChat(history.id, history)
      await act(async () => {
        void getResult().sendMessage('Pick up where it left off')
      })
      for (let second = 0; second < 10 && tails < 3; second++) {
        await act(async () => vi.advanceTimersByTimeAsync(1_000))
      }

      const answer = getResult().messages.find((message) => message.role === 'assistant')
      expect(tails).toBeGreaterThanOrEqual(3)
      expect(answer?.content).toBe('Full response.')
      const logResyncTail = streamUrls.findIndex(
        (url) => url.includes('after=3') && !url.includes('batch=true')
      )
      const afterLogResync = streamUrls.slice(logResyncTail + 1)
      expect(afterLogResync.length).toBeGreaterThan(0)
      expect(afterLogResync.every((url) => url.includes('source=log'))).toBe(true)
    } finally {
      vi.useRealTimers()
    }
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
    expect(state.abortBodies[1]).toEqual({ ...state.abortBodies[0], chatId: DEDUPED_CHAT_ID })
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
    expect(state.abortBodies[1]).toEqual({ ...state.abortBodies[0], chatId: DEDUPED_CHAT_ID })
    expect(state.abortBodies[0]).not.toHaveProperty('chatId')
  })

  /**
   * Send-now on a resumed message whose Stop of the running turn does not
   * settle sends nothing. That says nothing about the earlier attempt the
   * message resumes, so it must stay uneditable.
   */

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

  it('keeps a cross-route handoff recoverable across a StrictMode double-mount', async () => {
    MothershipHandoffStorage.store({ message: 'investigate this failed run' }, 'ws-1')

    renderStrictModeHandoffConsumer()
    await waitFor(() => state.postBodies.length >= 1)

    // Something must still hold the message: the live event was claimed and it
    // is in flight again, or it is back in storage for the next mount.
    await waitFor(
      () =>
        window.localStorage.getItem('sim_mothership_handoff') !== null ||
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

    unmount()
    await waitFor(() => window.localStorage.getItem('sim_mothership_handoff') !== null)

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

  describe('a send the server never admitted', () => {
    const idleHistory = (id: string): MothershipChatHistory => ({
      id,
      mode: 'agent',
      title: 'Not admitted',
      messages: [],
      activeStreamId: null,
      resources: [],
    })

    /**
     * The POST fails at the network layer until the network is back, and the
     * stream it would have opened does not exist.
     */
    const network = { online: false, acceptedPosts: 0 }
    /**
     * By default the browser knows it is offline until the network is back; with
     * `browserStaysOnline` it reports itself online throughout, as when a
     * connection drops without the browser noticing.
     */
    function stubUnreachableSend({ browserStaysOnline = false } = {}) {
      network.online = false
      network.acceptedPosts = 0
      vi.spyOn(window.navigator, 'onLine', 'get').mockImplementation(
        () => browserStaysOnline || network.online
      )
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url === '/api/mothership/chat' && init?.method === 'POST') {
          state.postBodies.push(JSON.parse(String(init.body)))
          if (network.online) {
            network.acceptedPosts++
            return emptySseResponse()
          }
          throw new TypeError('Failed to fetch')
        }
        if (url.includes('/api/mothership/chat/stream')) {
          return Response.json({ error: 'Stream not found' }, { status: 404 })
        }
        return fetchStub(input, init)
      })
    }

    /**
     * A follow-up typed while a direct send waits on its POST waits for that
     * admission (it would steer the turn). If the send then fails it stays ahead
     * of the follow-up: it was written first, and must still go out first.
     */
    it.each(['offline', 'blip', 'busy'] as const)(
      'keeps a failed direct send ahead of a follow-up written during its POST (%s)',
      async (outcome) => {
        const history = idleHistory(`chat-requeue-order-${outcome}`)
        mockRequestJson.mockImplementation(() => Promise.resolve({ chat: history }))
        vi.spyOn(window.navigator, 'onLine', 'get').mockImplementation(() => outcome !== 'offline')
        let failFirstPost: (() => void) | undefined
        vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input)
          if (url === '/api/mothership/chat' && init?.method === 'POST') {
            state.postBodies.push(JSON.parse(String(init.body)))
            return new Promise<Response>((resolve, reject) => {
              failFirstPost = () =>
                outcome === 'busy'
                  ? resolve(
                      Response.json(
                        { error: 'A response is already in progress for this chat.' },
                        { status: 409 }
                      )
                    )
                  : reject(new TypeError('Failed to fetch'))
            })
          }
          if (url.includes('/api/mothership/chat/stream')) {
            return Response.json({ error: 'Stream not found' }, { status: 404 })
          }
          return fetchStub(input, init)
        })
        const { getResult } = renderUseChatInChat(history.id, history)
        await act(async () => {
          void getResult().sendMessage('First, written before the follow-up')
        })
        await waitFor(() => failFirstPost !== undefined)
        await act(async () => {
          await getResult().sendMessage('Follow-up, written while the first was out')
        })

        await act(async () => {
          failFirstPost?.()
          await sleep(100)
        })

        expect(userMessages(getResult())).toEqual([
          'First, written before the follow-up',
          'Follow-up, written while the first was out',
        ])
        expect(state.postBodies).toHaveLength(1)
        expect(state.steerBodies).toHaveLength(0)
      }
    )

    it('holds a message sent while offline and sends it under the same id once back online', async () => {
      const history = idleHistory('chat-offline-send')
      mockRequestJson.mockImplementation(() => Promise.resolve({ chat: history }))
      stubUnreachableSend()
      const { getResult } = renderUseChatInChat(history.id, history)

      await act(async () => {
        await getResult().sendMessage('Written while offline')
      })
      await waitFor(() => !getResult().isSending)

      expect(userMessages(getResult())).toEqual(['Written while offline'])
      expect(getResult().error).not.toBeNull()
      expect(state.postBodies).toHaveLength(1)

      network.online = true
      await act(async () => {
        window.dispatchEvent(new Event('online'))
      })
      await waitFor(() => state.postBodies.length === 2)

      expect(state.postBodies[1].message).toBe('Written while offline')
      expect(state.postBodies[1].userMessageId).toBe(state.postBodies[0].userMessageId)
    })

    it('keeps a message sent while offline across a remount and sends it once back online', async () => {
      const history = idleHistory('chat-offline-remount')
      mockRequestJson.mockImplementation(() => Promise.resolve({ chat: history }))
      stubUnreachableSend()
      const first = renderUseChatInChat(history.id, history)
      await act(async () => {
        await first.getResult().sendMessage('Written while offline')
      })
      await waitFor(() => !first.getResult().isSending)
      first.unmount()

      const remounted = renderUseChatInChat(history.id, history)
      expect(userMessages(remounted.getResult())).toEqual(['Written while offline'])
      network.online = true
      await act(async () => {
        window.dispatchEvent(new Event('online'))
      })
      await waitFor(() => state.postBodies.length === 2)

      expect(state.postBodies[1].message).toBe('Written while offline')
      expect(state.postBodies[1].userMessageId).toBe(state.postBodies[0].userMessageId)
    })

    /**
     * A connection can drop while the browser stays online (`ERR_NETWORK_CHANGED`
     * when an interface changes, a proxy that resets), so no `online` event follows
     * the failure. The message, and a follow-up sent behind it, must still go out.
     */
    it('sends a message whose POST failed while the browser stayed online', async () => {
      const history = idleHistory('chat-network-changed')
      mockRequestJson.mockImplementation(() => Promise.resolve({ chat: history }))
      stubUnreachableSend({ browserStaysOnline: true })
      const { getResult } = renderUseChatInChat(history.id, history)

      await act(async () => {
        await getResult().sendMessage('Sent as the network changed')
      })
      network.online = true
      await act(async () => {
        await getResult().sendMessage('Sent after it')
      })
      await waitFor(() => network.acceptedPosts === 2, 5000)

      expect(state.postBodies.map((body) => body.message)).toEqual([
        'Sent as the network changed',
        'Sent as the network changed',
        'Sent after it',
      ])
      expect(state.postBodies[1].userMessageId).toBe(state.postBodies[0].userMessageId)
    })

    /** Sim stays unreachable while the browser reports itself online: retried on a growing delay. */
    it('backs off retrying a send that keeps failing while the browser stays online', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
      try {
        const history = idleHistory('chat-unreachable-online')
        mockRequestJson.mockImplementation(() => Promise.resolve({ chat: history }))
        stubUnreachableSend({ browserStaysOnline: true })
        const { getResult } = renderUseChatInChat(history.id, history)
        await act(async () => {
          void getResult().sendMessage('Sent while Sim is unreachable')
          await vi.advanceTimersByTimeAsync(50)
        })
        for (let second = 0; second < 60; second++) {
          await act(async () => vi.advanceTimersByTimeAsync(1_000))
        }

        /** 1, 2, 4, 8, 16 and 30 s apart (give or take a fifth): about six attempts in a minute. */
        expect(state.postBodies.length).toBeGreaterThan(2)
        expect(state.postBodies.length).toBeLessThanOrEqual(8)

        network.online = true
        for (let second = 0; second < 45; second++) {
          await act(async () => vi.advanceTimersByTimeAsync(1_000))
        }
        expect(network.acceptedPosts).toBe(1)
        expect(new Set(state.postBodies.map((body) => body.userMessageId)).size).toBe(1)
      } finally {
        vi.useRealTimers()
      }
    })

    /**
     * The browser can come back online while the failing POST is still pending,
     * so the release fires before the message is held. It must not then wait
     * for a release that already happened.
     */
    it('sends a message whose POST failed after the network had already returned', async () => {
      const history = idleHistory('chat-online-mid-send')
      mockRequestJson.mockImplementation(() => Promise.resolve({ chat: history }))
      let failFirstPost: (() => void) | undefined
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url === '/api/mothership/chat' && init?.method === 'POST') {
          state.postBodies.push(JSON.parse(String(init.body)))
          if (state.postBodies.length === 1) {
            return new Promise<Response>((_, reject) => {
              failFirstPost = () => reject(new TypeError('Failed to fetch'))
            })
          }
          return emptySseResponse()
        }
        if (url.includes('/api/mothership/chat/stream')) {
          return Response.json({ error: 'Stream not found' }, { status: 404 })
        }
        return fetchStub(input, init)
      })
      const { getResult } = renderUseChatInChat(history.id, history)
      await act(async () => {
        void getResult().sendMessage('Sent as the network came back')
      })
      await waitFor(() => failFirstPost !== undefined)

      await act(async () => {
        window.dispatchEvent(new Event('online'))
        failFirstPost?.()
      })
      await waitFor(() => state.postBodies.length === 2)

      expect(state.postBodies[1].message).toBe('Sent as the network came back')
      expect(state.postBodies[1].userMessageId).toBe(state.postBodies[0].userMessageId)
    })

    /**
     * With Redis down the server refuses every send as busy without naming a
     * turn, and nothing is running. The message must be retried on a growing
     * delay, not resent as fast as each refusal comes back.
     */
    it('backs off retrying a send the server keeps refusing as busy without a turn', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
      try {
        const history = idleHistory('chat-busy-without-redis')
        mockRequestJson.mockImplementation(() => Promise.resolve({ chat: history }))
        const redis = { up: false, acceptedPosts: 0 }
        vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
          if (String(input) === '/api/mothership/chat' && init?.method === 'POST') {
            state.postBodies.push(JSON.parse(String(init.body)))
            if (redis.up) {
              redis.acceptedPosts++
              return emptySseResponse()
            }
            /** The server waits on the chat lock before refusing. */
            await sleep(5_000)
            return Response.json(
              { error: 'A response is already in progress for this chat.' },
              { status: 409 }
            )
          }
          return fetchStub(input, init)
        })
        const { getResult } = renderUseChatInChat(history.id, history)
        await act(async () => {
          void getResult().sendMessage('Refused while Redis is down')
          await vi.advanceTimersByTimeAsync(50)
        })
        for (let second = 0; second < 90; second++) {
          await act(async () => vi.advanceTimersByTimeAsync(1_000))
        }

        /** Back to back, a 5s refusal allows 18 attempts in 90s; backing off allows far fewer. */
        expect(state.postBodies.length).toBeGreaterThan(2)
        expect(state.postBodies.length).toBeLessThanOrEqual(8)

        /** Kept through every refusal: it goes out once Redis is back, under the same id. */
        redis.up = true
        for (let second = 0; second < 45; second++) {
          await act(async () => vi.advanceTimersByTimeAsync(1_000))
        }
        expect(redis.acceptedPosts).toBe(1)
        expect(state.postBodies.at(-1)?.message).toBe('Refused while Redis is down')
        expect(new Set(state.postBodies.map((body) => body.userMessageId)).size).toBe(1)
      } finally {
        vi.useRealTimers()
      }
    })

    /**
     * A retry can be told "already sent" while the server's earlier attempt with
     * that id is still in flight and has opened no stream. The message must be
     * retried once that attempt settles, not read as a finished turn and dropped.
     */
    it('retries a send deduplicated against an attempt that opened no stream', async () => {
      const history = idleHistory('chat-deduped-without-stream')
      mockRequestJson.mockImplementation(() => Promise.resolve({ chat: history }))
      let posts = 0
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url === '/api/mothership/chat' && init?.method === 'POST') {
          state.postBodies.push(JSON.parse(String(init.body)))
          posts++
          if (posts === 1) {
            return Response.json(
              {
                error: 'This message was already sent.',
                activeStreamId: state.postBodies[0].userMessageId,
              },
              { status: 409 }
            )
          }
          return emptySseResponse()
        }
        if (url.includes('/api/mothership/chat/stream') && posts === 1) {
          return Response.json({ error: 'Stream not found' }, { status: 404 })
        }
        return fetchStub(input, init)
      })
      const { getResult } = renderUseChatInChat(history.id, history)

      await act(async () => {
        await getResult().sendMessage('Told it was already sent')
      })
      await waitFor(() => state.postBodies.length === 2, 5_000)

      expect(state.postBodies[1].message).toBe('Told it was already sent')
      expect(state.postBodies[1].userMessageId).toBe(state.postBodies[0].userMessageId)
    })

    /**
     * The "already sent" check of a deduplicated send can resolve after the user
     * has moved to another chat and started a turn there. Stop must still stop
     * that new turn, not the one the stale check found.
     */
    it('keeps Stop on the new turn when a deduplicated send is checked after a chat switch', async () => {
      const history = idleHistory('chat-deduped-then-left')
      const other = idleHistory('chat-new-turn-after-switch')
      mockRequestJson.mockImplementation((_contract: AnyApiRouteContract, input: unknown) =>
        Promise.resolve({
          chat: JSON.stringify(input).includes(other.id) ? other : history,
        })
      )
      let finishCheck: (() => void) | undefined
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url === '/api/mothership/chat' && init?.method === 'POST') {
          state.postBodies.push(JSON.parse(String(init.body)))
          if (state.postBodies.length === 1) {
            return Response.json(
              {
                error: 'This message was already sent.',
                activeStreamId: state.postBodies[0].userMessageId,
              },
              { status: 409 }
            )
          }
          return new Response(new ReadableStream<Uint8Array>(), {
            headers: { 'Content-Type': 'text/event-stream' },
          })
        }
        if (url.includes('/api/mothership/chat/stream') && finishCheck === undefined) {
          return new Promise<Response>((resolve) => {
            finishCheck = () =>
              resolve(Response.json({ success: true, events: [], status: 'streaming' }))
          })
        }
        return fetchStub(input, init)
      })
      const { getResult, navigate } = renderUseChatInChat(history.id, history)
      await act(async () => {
        void getResult().sendMessage('Already sent here')
      })
      await waitFor(() => finishCheck !== undefined)

      navigate(other.id, other)
      await act(async () => {
        void getResult().sendMessage('A new turn in the other chat')
      })
      await waitFor(() => state.postBodies.length === 2)
      await act(async () => {
        finishCheck?.()
        await sleep(100)
      })
      await act(async () => {
        await getResult().stopGeneration()
      })

      expect(state.abortBodies.map((body) => body.streamId)).toContain(
        state.postBodies[1].userMessageId
      )
      expect(state.abortBodies.map((body) => body.streamId)).not.toContain(
        state.postBodies[0].userMessageId
      )
    })

    /** A stream lookup that fails for another reason does not prove a turn ran either. */
    it('retries a deduplicated send whose stream lookup failed', async () => {
      const history = idleHistory('chat-deduped-lookup-failed')
      mockRequestJson.mockImplementation(() => Promise.resolve({ chat: history }))
      let posts = 0
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url === '/api/mothership/chat' && init?.method === 'POST') {
          state.postBodies.push(JSON.parse(String(init.body)))
          posts++
          if (posts === 1) {
            return Response.json(
              {
                error: 'This message was already sent.',
                activeStreamId: state.postBodies[0].userMessageId,
              },
              { status: 409 }
            )
          }
          return emptySseResponse()
        }
        if (url.includes('/api/mothership/chat/stream') && posts === 1) {
          return Response.json({ error: 'Internal error' }, { status: 500 })
        }
        return fetchStub(input, init)
      })
      const { getResult } = renderUseChatInChat(history.id, history)

      await act(async () => {
        await getResult().sendMessage('Told it was already sent, lookup failed')
      })
      await waitFor(() => state.postBodies.length === 2, 5_000)

      expect(state.postBodies[1].message).toBe('Told it was already sent, lookup failed')
      expect(state.postBodies[1].userMessageId).toBe(state.postBodies[0].userMessageId)
    })

    /**
     * On the new-chat surface the "already sent" answer also names the chat the
     * earlier attempt opened. With no stream yet, the retry must still go out,
     * not wait under the new-chat key after the surface moved to that chat.
     */
    it('retries a first message deduplicated against an attempt that opened no stream', async () => {
      const opened = idleHistory('chat-opened-by-earlier-attempt')
      mockRequestJson.mockImplementation(() => Promise.resolve({ chat: opened }))
      let posts = 0
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url === '/api/mothership/chat' && init?.method === 'POST') {
          state.postBodies.push(JSON.parse(String(init.body)))
          posts++
          if (posts === 1) {
            return Response.json(
              {
                error: 'This message was already sent.',
                activeStreamId: state.postBodies[0].userMessageId,
                chatId: opened.id,
              },
              { status: 409 }
            )
          }
          return emptySseResponse()
        }
        if (url.includes('/api/mothership/chat/stream') && posts === 1) {
          return Response.json({ error: 'Stream not found' }, { status: 404 })
        }
        return fetchStub(input, init)
      })
      const { getResult } = renderHomeLikeSurface()

      await act(async () => {
        await getResult().sendMessage('First message, told it was already sent')
      })
      await waitFor(() => state.postBodies.length === 2, 5_000)

      expect(state.postBodies[1].message).toBe('First message, told it was already sent')
      expect(state.postBodies[1].userMessageId).toBe(state.postBodies[0].userMessageId)
    })
  })

  it.each([
    { pendingPick: 'high', kept: 'high', saved: true },
    { pendingPick: 'low', kept: 'low', saved: false },
  ] as const)(
    'keeps a new chat effort picked while its first send is pending ($pendingPick)',
    async ({ pendingPick, kept, saved }) => {
      mockRequestJson.mockClear()
      useMothershipEffortStore.getState().reset()
      useMothershipEffortStore.getState().setNewChatEffort('low')
      const { getResult } = renderUseChat()
      await act(async () => {
        void getResult().sendMessage('Pick while pending')
      })
      await waitFor(() => state.postBodies.length === 1)
      expect(state.postBodies[0]).toMatchObject({ effort: 'low' })

      useMothershipEffortStore.getState().setNewChatEffort(pendingPick)
      const userMessageId = state.postBodies[0].userMessageId ?? ''
      await act(async () => {
        state.pendingAdmissions.get(userMessageId)?.()
      })
      await waitFor(() => !getResult().isSending)

      expect(useMothershipEffortStore.getState().chatEfforts[DEDUPED_CHAT_ID]?.effort).toBe(kept)
      const saves = mockRequestJson.mock.calls.filter(
        ([contract]) => contract.path === '/api/mothership/chats/[chatId]/effort'
      )
      expect(saves.map(([, input]) => input)).toEqual(
        saved ? [{ params: { chatId: DEDUPED_CHAT_ID }, body: { effort: kept } }] : []
      )
    }
  )

  it('saves the latest new-chat effort to the chat a deduplicated send names', async () => {
    mockRequestJson.mockClear()
    useMothershipEffortStore.getState().reset()
    useMothershipEffortStore.getState().setNewChatEffort('high')
    state.postBehavior = 'deduped'
    const { getResult } = renderUseChat()
    await act(async () => {
      void getResult().sendMessage('Retry of an admitted send')
    })
    await waitFor(() => state.postBodies.length === 1 && !getResult().isSending)

    expect(useMothershipEffortStore.getState().chatEfforts[DEDUPED_CHAT_ID]?.effort).toBe('high')
    const saves = mockRequestJson.mock.calls.filter(
      ([contract]) => contract.path === '/api/mothership/chats/[chatId]/effort'
    )
    expect(saves.map(([, input]) => input)).toEqual([
      { params: { chatId: DEDUPED_CHAT_ID }, body: { effort: 'high' } },
    ])
  })

  it('keeps the new-chat effort across the composer swap of a first send that fails', async () => {
    const post = holdFirstSend()
    const surface = renderComposerSwap()
    act(() => useMothershipEffortStore.getState().setNewChatEffort('low'))
    expect(surface.shownEffort()).toBe('Low')

    await act(async () => {
      void surface.getResult().sendMessage('Plan the launch')
    })
    await waitFor(() => state.postBodies.length === 1)
    expect(state.postBodies[0].effort).toBe('low')
    expect(surface.container.querySelector('section')).not.toBeNull()
    expect(surface.shownEffort()).toBe('Low')

    await act(async () => {
      post.reject(new TypeError('Failed to fetch'))
    })
    /* The unsent message stays in the transcript, waiting to go out again. */
    await waitFor(() => !surface.getResult().isSending)
    expect(userMessages(surface.getResult())).toEqual(['Plan the launch'])

    expect(useMothershipEffortStore.getState().newChatEffort).toBe('low')
    expect(surface.shownEffort()).toBe('Low')
  })

  it('keeps a new-chat effort picked while the first send is pending when that send fails', async () => {
    const post = holdFirstSend()
    const surface = renderComposerSwap()
    act(() => useMothershipEffortStore.getState().setNewChatEffort('low'))
    await act(async () => {
      void surface.getResult().sendMessage('Plan the launch')
    })
    await waitFor(() => state.postBodies.length === 1)
    act(() => useMothershipEffortStore.getState().setNewChatEffort('medium'))

    await act(async () => {
      post.reject(new TypeError('Failed to fetch'))
    })
    /* The unsent message stays in the transcript, waiting to go out again. */
    await waitFor(() => !surface.getResult().isSending)
    expect(userMessages(surface.getResult())).toEqual(['Plan the launch'])

    expect(surface.shownEffort()).toBe('Medium')
  })

  it('starts the next new chat at the default after a first send stopped before admission', async () => {
    const surface = renderComposerSwap()
    act(() => useMothershipEffortStore.getState().setNewChatEffort('low'))
    await act(async () => {
      void surface.getResult().sendMessage('Plan the launch')
    })
    await waitFor(() => state.postBodies.length === 1)
    await act(async () => {
      await surface.getResult().stopGeneration()
    })
    await waitFor(() => surface.getResult().resolvedChatId === DEDUPED_CHAT_ID)

    surface.visit(`/workspace/ws-1/chat/${DEDUPED_CHAT_ID}`)
    surface.visit('/workspace/ws-1/home')
    await waitFor(() => surface.container.querySelector('main') !== null)

    expect(surface.shownEffort()).toBe('High')
  })

  it.each(['leaves the page', 'opens another chat'] as const)(
    'drops an unsent new-chat effort when the surface %s',
    (leave) => {
      useMothershipEffortStore.getState().reset()
      ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
      queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      const root = createRoot(document.createElement('div'))
      mountedRoots.push(root)
      function Surface({ chatId }: { chatId?: string }) {
        useChat('ws-1', chatId)
        return null
      }
      const render = (chatId?: string) =>
        act(() =>
          root.render(
            <ToastProvider>
              <QueryClientProvider client={queryClient}>
                <Surface chatId={chatId} />
              </QueryClientProvider>
            </ToastProvider>
          )
        )
      render()
      useMothershipEffortStore.getState().setNewChatEffort('low')

      if (leave === 'leaves the page') act(() => root.unmount())
      else render('chat-other')

      expect(useMothershipEffortStore.getState().newChatEffort).toBeNull()
    }
  )

  it('loads the saved transcript once when its own stream completes', async () => {
    const chatId = 'chat-own-completion'
    const history: MothershipChatHistory = {
      id: chatId,
      mode: 'agent',
      title: 'Own stream',
      messages: [],
      activeStreamId: null,
      resources: [],
    }
    const saved = [
      { id: 'saved-user', role: 'user', content: 'Summarize the run' },
      { id: 'saved-assistant', role: 'assistant', content: 'Done.' },
    ]
    const detailRequests: string[] = []
    mockRequestJson.mockImplementation((contract: AnyApiRouteContract) => {
      if (contract.path !== '/api/mothership/chats/[chatId]') {
        return Promise.resolve({ chats: [] })
      }
      detailRequests.push(chatId)
      return Promise.resolve({ chat: { ...history, messages: saved } })
    })
    let stream: ReadableStreamDefaultController<Uint8Array> | undefined
    let streamId: string | undefined
    const emit = (event: Omit<MothershipStreamV1EventEnvelope, 'v' | 'ts' | 'stream'>) =>
      stream?.enqueue(
        new TextEncoder().encode(
          `data: ${JSON.stringify({ v: 1, ts: '', stream: { streamId }, ...event })}\n\n`
        )
      )
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) !== '/api/mothership/chat' || init?.method !== 'POST') {
        return fetchStub(input, init)
      }
      streamId = JSON.parse(String(init.body)).userMessageId
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            stream = controller
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream', 'x-mothership-chat-id': chatId } }
      )
    })
    const { getResult } = renderUseChatInChat(chatId, history)

    await act(async () => {
      void getResult().sendMessage('Summarize the run')
    })
    await waitFor(() => stream !== undefined)
    emit({ seq: 1, type: 'text', payload: { channel: 'assistant', text: 'Done.' } })
    await waitFor(
      () =>
        queryClient.getQueryData<MothershipChatHistory>(mothershipChatKeys.detail(chatId))
          ?.activeStreamId === streamId
    )
    /** The server publishes `completed` after persisting and before closing the stream. */
    handleMothershipChatStatusEvent(queryClient, 'ws-1', {
      chatId,
      type: 'completed',
      streamId,
    })
    emit({ seq: 2, type: 'complete', payload: { status: 'complete' } })
    stream?.close()

    await waitFor(() => !getResult().isSending && detailRequests.length > 0)
    await act(async () => {
      await sleep(50)
    })
    expect(detailRequests).toHaveLength(1)
    expect(
      queryClient
        .getQueryData<MothershipChatHistory>(mothershipChatKeys.detail(chatId))
        ?.messages.map((message) => message.id)
    ).toEqual(['saved-user', 'saved-assistant'])
  })

  it('keeps a completed Assistant answer through a late user-only transcript with a cleared stream marker', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const chatId = 'chat-assistant-stale-terminal-history'
      const history: MothershipChatHistory = {
        id: chatId,
        mode: 'assistant',
        title: 'Assistant answer',
        messages: [],
        activeStreamId: null,
        resources: [],
      }
      const staleRead = createDeferred<{ chat: MothershipChatHistory }>()
      const savedRead = createDeferred<{ chat: MothershipChatHistory }>()
      let firstDetailRead = true
      mockRequestJson.mockImplementation((contract: AnyApiRouteContract) => {
        if (contract.path === '/api/mothership/chats/[chatId]/stream-status') {
          return Promise.resolve({ success: true, activeStreamId: null })
        }
        if (contract.path !== '/api/mothership/chats/[chatId]') {
          return Promise.resolve({ chats: [] })
        }
        if (firstDetailRead) {
          firstDetailRead = false
          return staleRead.promise
        }
        return savedRead.promise
      })
      let stream: ReadableStreamDefaultController<Uint8Array> | undefined
      let streamId: string | undefined
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) !== '/api/mothership/chat' || init?.method !== 'POST') {
          return fetchStub(input, init)
        }
        streamId = JSON.parse(String(init.body)).userMessageId
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              stream = controller
            },
          }),
          { headers: { 'Content-Type': 'text/event-stream', 'x-mothership-chat-id': chatId } }
        )
      })
      const { getResult } = renderUseChatInChat(chatId, history, undefined, undefined, 'assistant')
      await act(async () => {
        void getResult().sendMessage('Summarize the run')
        await vi.advanceTimersByTimeAsync(50)
      })
      if (!stream || !streamId) throw new Error('Assistant stream was not admitted')
      const userMessage = {
        id: streamId,
        role: 'user' as const,
        content: 'Summarize the run',
        timestamp: new Date().toISOString(),
      }
      await act(async () => {
        for (const event of [
          { seq: 1, type: 'text', payload: { channel: 'assistant', text: 'Done.' } },
          { seq: 2, type: 'complete', payload: { status: 'complete' } },
        ]) {
          stream?.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({ v: 1, ts: '', stream: { streamId }, ...event })}\n\n`
            )
          )
        }
        stream?.close()
        await vi.advanceTimersByTimeAsync(50)
      })
      expect(getResult().isSending).toBe(false)
      expect(getResult().messages.find((message) => message.role === 'assistant')?.streamId).toBe(
        streamId
      )
      expect(
        getResult()
          .messages.filter((message) => message.role === 'assistant')
          .map((message) => message.content)
      ).toEqual(['Done.'])

      await act(async () => {
        staleRead.resolve({ chat: { ...history, messages: [userMessage] } })
        await vi.advanceTimersByTimeAsync(50)
      })
      expect(getResult().isSending).toBe(false)
      expect(
        getResult()
          .messages.filter((message) => message.role === 'assistant')
          .map((message) => message.content)
      ).toEqual(['Done.'])

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000)
        savedRead.resolve({
          chat: {
            ...history,
            messages: [
              userMessage,
              {
                id: 'saved-assistant',
                role: 'assistant',
                content: 'Done.',
                timestamp: userMessage.timestamp,
              },
            ],
          },
        })
        await vi.advanceTimersByTimeAsync(50)
      })
      expect(getResult().messages.map((message) => message.id)).toEqual([
        streamId,
        'saved-assistant',
      ])
      expect(
        getResult()
          .messages.filter((message) => message.role === 'assistant')
          .map((message) => message.content)
      ).toEqual(['Done.'])
      expect(getResult().isSending).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  /**
   * The saved-turn re-read belongs to the chat view: once it unmounts, nothing
   * renders that chat, so the re-read must stop instead of refetching it for
   * minutes.
   */
  it('stops re-reading the saved turn when the chat view unmounts', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const chatId = 'chat-reread-unmount'
      const history: MothershipChatHistory = {
        id: chatId,
        mode: 'agent',
        title: 'Never saved',
        messages: [],
        activeStreamId: null,
        resources: [],
      }
      let streamId: string | undefined
      let completed = false
      let detailReads = 0
      mockRequestJson.mockImplementation((contract: AnyApiRouteContract) => {
        if (contract.path !== '/api/mothership/chats/[chatId]') {
          return Promise.resolve({ chats: [] })
        }
        if (!completed || !streamId) return Promise.resolve({ chat: history })
        detailReads++
        return Promise.resolve({
          chat: {
            ...history,
            activeStreamId: streamId,
            messages: [
              { id: streamId, role: 'user', content: 'Summarize the run' },
              { id: `live-assistant:${streamId}`, role: 'assistant', content: 'Done.' },
            ],
          },
        })
      })
      let stream: ReadableStreamDefaultController<Uint8Array> | undefined
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) !== '/api/mothership/chat' || init?.method !== 'POST') {
          return fetchStub(input, init)
        }
        streamId = JSON.parse(String(init.body)).userMessageId
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              stream = controller
            },
          }),
          { headers: { 'Content-Type': 'text/event-stream', 'x-mothership-chat-id': chatId } }
        )
      })
      const { getResult, unmount } = renderUseChatInChat(chatId, history)
      await act(async () => {
        void getResult().sendMessage('Summarize the run')
        await vi.advanceTimersByTimeAsync(50)
      })
      await act(async () => {
        stream?.enqueue(
          new TextEncoder().encode(
            `data: ${JSON.stringify({ v: 1, ts: '', stream: { streamId }, seq: 1, type: 'complete', payload: { status: 'complete' } })}\n\n`
          )
        )
        completed = true
        stream?.close()
        await vi.advanceTimersByTimeAsync(1_000)
      })
      expect(detailReads).toBeGreaterThan(0)

      unmount()
      const readsAtUnmount = detailReads
      for (let second = 0; second < 60; second++) {
        await act(async () => vi.advanceTimersByTimeAsync(1_000))
      }

      expect(detailReads).toBe(readsAtUnmount)
    } finally {
      vi.useRealTimers()
    }
  })

  describe.each([
    {
      kind: 'browser action',
      toolName: 'browser_list_tabs',
      arguments: {},
      lifetimeOf: () => mockExecuteBrowserToolOnClient.mock.calls[0]?.[5],
    },
    {
      kind: 'local file read',
      toolName: 'read_local_file',
      arguments: { path: '/Users/me/notes.txt' },
      lifetimeOf: () => mockExecuteLocalFilesystemTool.mock.calls[0]?.[3]?.signal,
    },
  ])('a desktop $kind in flight', ({ toolName, arguments: toolArguments, lifetimeOf }) => {
    const chatId = 'chat-desktop-action'
    const history: MothershipChatHistory = {
      id: chatId,
      mode: 'agent',
      title: 'Browser action',
      messages: [],
      activeStreamId: null,
      resources: [],
    }

    /** Opens a turn whose stream delivers one desktop tool call and stays open. */
    async function startDesktopAction() {
      let streamId: string | undefined
      const replays: string[] = []
      mockRequestJson.mockImplementation((contract: AnyApiRouteContract) =>
        Promise.resolve(
          contract.path === '/api/mothership/chats/[chatId]'
            ? { chat: { ...history, activeStreamId: streamId ?? null } }
            : { chats: [] }
        )
      )
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.includes('/api/mothership/chat/stream')) replays.push(url)
        if (url !== '/api/mothership/chat' || init?.method !== 'POST') {
          return fetchStub(input, init)
        }
        streamId = JSON.parse(String(init.body)).userMessageId
        const call: MothershipStreamV1EventEnvelope = {
          v: 1,
          seq: 1,
          ts: new Date().toISOString(),
          type: 'tool',
          stream: { streamId: streamId ?? '' },
          payload: {
            phase: 'call',
            executor: 'client',
            mode: 'async',
            toolName,
            toolCallId: 'desktop-call',
            arguments: toolArguments,
          },
        }
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(call)}\n\n`))
            },
          }),
          { headers: { 'Content-Type': 'text/event-stream', 'x-mothership-chat-id': chatId } }
        )
      })
      const chat = renderUseChatInChat(chatId, history)
      await act(async () => {
        void chat.getResult().sendMessage('List my tabs')
      })
      await waitFor(() => lifetimeOf() !== undefined)
      const toolSignal = lifetimeOf()
      if (!(toolSignal instanceof AbortSignal))
        throw new Error('The desktop action has no lifetime')
      return { ...chat, toolSignal, replays, streamId: () => streamId }
    }

    beforeEach(() => {
      libDesktopMockFns.mockIsDesktopApp.mockReturnValue(true)
      const stillRunning = () => new Promise<void>(() => {})
      mockExecuteBrowserToolOnClient.mockImplementation(stillRunning)
      mockExecuteLocalFilesystemTool.mockImplementation(stillRunning)
    })

    afterEach(() => {
      libDesktopMockFns.mockIsDesktopApp.mockReset()
    })

    it('keeps running when the window returns to view and the stream is recovered', async () => {
      const { toolSignal, replays } = await startDesktopAction()

      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'visible',
      })
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'))
      })
      await waitFor(() => replays.length > 0)

      expect(toolSignal.aborted).toBe(false)
    })

    it('keeps running when the chat view unmounts, so it finishes and reports its result', async () => {
      const { toolSignal, unmount } = await startDesktopAction()

      unmount()

      expect(toolSignal.aborted).toBe(false)
    })

    it('is still cancelled by Stop after the stream was recovered', async () => {
      const { toolSignal, replays, getResult } = await startDesktopAction()
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'visible',
      })
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'))
      })
      await waitFor(() => replays.length > 0)

      await act(async () => {
        await getResult().stopGeneration()
      })

      expect(toolSignal.aborted).toBe(true)
    })

    it('keeps running when the user stops a turn in another chat', async () => {
      const { toolSignal, navigate, getResult } = await startDesktopAction()
      navigate('chat-other', { ...history, id: 'chat-other' })
      await act(async () => {
        void getResult().sendMessage('Something else')
      })

      await act(async () => {
        await getResult().stopGeneration()
      })

      expect(toolSignal.aborted).toBe(false)
    })

    it('is still cancelled by Stop from the chat view reopened on its turn', async () => {
      const { toolSignal, unmount, streamId } = await startDesktopAction()
      unmount()
      const reopened = renderUseChatInChat(chatId, {
        ...history,
        activeStreamId: streamId() ?? null,
      })
      await waitFor(() => reopened.getResult().isSending)

      await act(async () => {
        await reopened.getResult().stopGeneration()
      })

      expect(toolSignal.aborted).toBe(true)
    })

    it('is cancelled when the user stops the chat', async () => {
      const { toolSignal, getResult } = await startDesktopAction()

      await act(async () => {
        await getResult().stopGeneration()
      })

      expect(toolSignal.aborted).toBe(true)
    })
  })
  /**
   * A message sent while a turn runs steers that turn. Failure modes, each one
   * test: it is queued or sent as a turn of its own while the turn runs; it is not
   * visible until the turn ends; it is not placed where the turn applied it; a turn
   * that ends without applying it loses it; one that did apply it sends it again;
   * a refused steer is retried into the same turn; one that cannot be steered
   * (files) is steered anyway; a Stop strands it; the fallback a run already
   * applied shows as an error.
   */
  describe('steering a running turn', () => {
    const chatId = 'chat-steered'
    const history: MothershipChatHistory = {
      id: chatId,
      mode: 'agent',
      title: 'Steered',
      messages: [],
      activeStreamId: null,
      resources: [],
    }
    const encoder = new TextEncoder()

    /**
     * The first turn streams until the test ends it; every later turn answers at
     * once. `fallbackStatus` is what a later turn's POST answers instead.
     */
    function stubRunningTurn(options: { fallback?: Response } = {}) {
      let controller: ReadableStreamDefaultController<Uint8Array> | undefined
      let seq = 0
      const firstStreamId = () => state.postBodies[0]?.userMessageId ?? ''
      const frame = (streamId: string, type: string, payload: Record<string, unknown>) =>
        encoder.encode(
          `data: ${JSON.stringify({
            v: 1,
            seq: ++seq,
            ts: new Date().toISOString(),
            type,
            stream: { streamId, cursor: String(seq) },
            payload,
          })}\n\n`
        )
      mockRequestJson.mockImplementation(() => Promise.resolve({ chat: history }))
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) !== '/api/mothership/chat' || init?.method !== 'POST') {
          return fetchStub(input, init)
        }
        const body = JSON.parse(String(init.body))
        state.postBodies.push(body)
        const headers = { 'Content-Type': 'text/event-stream', 'x-mothership-chat-id': chatId }
        if (state.postBodies.length === 1) {
          return new Response(
            new ReadableStream<Uint8Array>({
              start(streamController) {
                controller = streamController
              },
            }),
            { headers }
          )
        }
        if (options.fallback) return options.fallback
        return new Response(
          new ReadableStream<Uint8Array>({
            start(streamController) {
              streamController.enqueue(
                frame(body.userMessageId, 'text', { channel: 'assistant', text: 'Next answer' })
              )
              streamController.enqueue(
                frame(body.userMessageId, 'complete', { status: 'complete' })
              )
              streamController.close()
            },
          }),
          { headers }
        )
      })
      const emit = async (type: string, payload: Record<string, unknown>) => {
        await act(async () => {
          controller?.enqueue(frame(firstStreamId(), type, payload))
          await elapse(100)
        })
      }
      return {
        firstStreamId,
        emit,
        text: (text: string) => emit('text', { channel: 'assistant', text }),
        applied: (steeringId: string) => emit('run', { kind: 'steering_applied', steeringId }),
        end: async () => {
          await emit('complete', { status: 'complete' })
          await act(async () => {
            controller?.close()
            await elapse(30)
          })
        },
      }
    }

    async function startTurn() {
      const turn = stubRunningTurn()
      const view = renderUseChatInChat(chatId, history)
      await act(async () => {
        void view.getResult().sendMessage('Count to fifty')
      })
      await waitFor(() => view.getResult().isSending && state.postBodies.length === 1)
      await turn.text('1\n')
      return { turn, view }
    }

    it('steers the running turn instead of sending a turn of its own, and shows it at once', async () => {
      const { turn, view } = await startTurn()
      state.steerDispositions = ['queued']

      await act(async () => {
        await view.getResult().sendMessage('Stop at ten')
      })
      await waitFor(() => state.steerBodies.length === 1)

      expect(state.steerBodies[0]).toMatchObject({
        streamId: turn.firstStreamId(),
        chatId,
        content: 'Stop at ten',
      })
      expect(state.postBodies).toHaveLength(1)
      expect(view.getResult().messages.map((message) => message.role)).toEqual([
        'user',
        'assistant',
        'user',
      ])
      expect(userMessages(view.getResult())).toEqual(['Count to fifty', 'Stop at ten'])
    })

    it('places the steered message where the turn applied it, and never sends it again', async () => {
      const { turn, view } = await startTurn()
      state.steerDispositions = ['queued']
      await act(async () => {
        await view.getResult().sendMessage('Stop at ten')
      })
      await waitFor(() => state.steerBodies.length === 1)
      const steeringId = state.steerBodies[0].steeringId

      await turn.applied(steeringId)
      await turn.text('Stopping at ten.')

      const shown = view.getResult().messages
      expect(shown.map((message) => message.role)).toEqual([
        'user',
        'assistant',
        'user',
        'assistant',
      ])
      expect(shown[1].content).toBe('1\n')
      expect(shown[2].content).toBe('Stop at ten')
      expect(shown[3].content).toBe('Stopping at ten.')

      await turn.end()
      await act(async () => {
        await sleep(100)
      })
      expect(state.postBodies).toHaveLength(1)
      expect(state.steerBodies).toHaveLength(1)
    })

    it('sends a message the turn ended without applying as the next turn, once, under its steering id', async () => {
      const { turn, view } = await startTurn()
      state.steerDispositions = ['queued', 'not_applied']
      await act(async () => {
        await view.getResult().sendMessage('Then summarize')
      })
      await waitFor(() => state.steerBodies.length === 1)
      const steeringId = state.steerBodies[0].steeringId

      await turn.end()
      await waitFor(() => state.postBodies.length === 2)
      await waitFor(() => !view.getResult().isSending)
      await act(async () => {
        await sleep(100)
      })

      expect(state.steerBodies.map((body) => body.steeringId)).toEqual([steeringId, steeringId])
      expect(state.steerBodies[1].content).toBe('Then summarize')
      expect(state.postBodies).toHaveLength(2)
      expect(state.postBodies[1]).toMatchObject({
        message: 'Then summarize',
        userMessageId: steeringId,
        chatId,
      })
      expect(
        userMessages(view.getResult()).filter((text) => text === 'Then summarize')
      ).toHaveLength(1)
    })

    it('does not send a message the worker reports applied after the turn ended', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
      try {
        const { turn, view } = await startTurn()
        state.steerDispositions = ['queued', 'applied']
        await act(async () => {
          await view.getResult().sendMessage('Then summarize')
        })
        await waitFor(() => state.steerBodies.length === 1)

        await turn.end()
        await waitFor(() => state.steerBodies.length === 2)
        await act(async () => {
          await vi.advanceTimersByTimeAsync(10_000)
        })

        expect(state.steerBodies).toHaveLength(2)
        expect(state.postBodies).toHaveLength(1)
      } finally {
        vi.useRealTimers()
      }
    })

    it('waits for the end of a turn that refused the steer, then sends it as the next turn', async () => {
      const { turn, view } = await startTurn()
      state.steerDispositions = [409]
      await act(async () => {
        await view.getResult().sendMessage('Then summarize')
      })
      await waitFor(() => state.steerBodies.length === 1)
      await turn.text('2\n')
      await act(async () => {
        await sleep(50)
      })
      expect(state.steerBodies).toHaveLength(1)
      expect(state.postBodies).toHaveLength(1)
      expect(userMessages(view.getResult())).toEqual(['Count to fifty', 'Then summarize'])

      await turn.end()
      await waitFor(() => state.postBodies.length === 2)

      expect(state.steerBodies).toHaveLength(1)
      expect(state.postBodies[1]).toMatchObject({
        message: 'Then summarize',
        userMessageId: state.steerBodies[0].steeringId,
      })
    })

    it('steers a message with files and mentions, carrying them as a turn would', async () => {
      const { turn, view } = await startTurn()
      state.steerDispositions = ['queued']
      const attachment = {
        id: 'file-1',
        key: 'uploads/file-1',
        filename: 'notes.pdf',
        media_type: 'application/pdf',
        size: 10,
      }
      const mention: ChatContext = { kind: 'workflow', workflowId: 'wf-1', label: 'Invoices' }
      await act(async () => {
        await view.getResult().sendMessage('Use these notes', [attachment], [mention])
      })
      await waitFor(() => state.steerBodies.length === 1)

      expect(state.steerBodies[0]).toMatchObject({
        streamId: turn.firstStreamId(),
        content: 'Use these notes',
        fileAttachments: [attachment],
        contexts: [mention],
      })
      expect(state.postBodies).toHaveLength(1)
      expect(userMessages(view.getResult())).toEqual(['Count to fifty', 'Use these notes'])
    })

    it('places a message the worker reports applied at its offset, before any frame', async () => {
      const { turn, view } = await startTurn()
      await turn.text('2\n3\n')
      state.steerDispositions = ['applied']
      state.appliedOffset = 2
      await act(async () => {
        await view.getResult().sendMessage('Stop at ten')
      })
      await waitFor(() => state.steerBodies.length === 1)
      await act(async () => {
        await sleep(50)
      })

      const shown = view.getResult().messages
      expect(shown.map((message) => [message.role, message.content])).toEqual([
        ['user', 'Count to fifty'],
        ['assistant', '1\n'],
        ['user', 'Stop at ten'],
        ['assistant', '2\n3\n'],
      ])
    })

    it('resumes a steered message after a remount and sends it as the next turn once its turn ended without it', async () => {
      const { view } = await startTurn()
      state.steerDispositions = ['queued']
      await act(async () => {
        await view.getResult().sendMessage('Then summarize')
      })
      await waitFor(() => state.steerBodies.length === 1)
      const steeringId = state.steerBodies[0].steeringId
      view.unmount()

      state.steerDispositions = ['not_applied']
      const remounted = renderUseChatInChat(chatId, history)
      await waitFor(() => state.postBodies.length === 2)

      expect(state.steerBodies.map((body) => body.steeringId)).toEqual([steeringId, steeringId])
      expect(state.postBodies[1]).toMatchObject({
        message: 'Then summarize',
        userMessageId: steeringId,
      })
      expect(
        userMessages(remounted.getResult()).filter((text) => text === 'Then summarize')
      ).toHaveLength(1)
    })

    it('never sends a remounted steered message as a turn while the worker still holds it', async () => {
      const { view } = await startTurn()
      state.steerDispositions = ['queued']
      await act(async () => {
        await view.getResult().sendMessage('Then summarize')
      })
      await waitFor(() => state.steerBodies.length === 1)
      view.unmount()

      state.steerDispositions = ['queued', 'queued', 'queued']
      const remounted = renderUseChatInChat(chatId, history)
      await waitFor(() => state.steerBodies.length === 2)
      await act(async () => {
        await sleep(100)
      })

      expect(state.postBodies).toHaveLength(1)
      expect(userMessages(remounted.getResult())).toContain('Then summarize')
    })

    it('sends a message still unapplied when the user stops the turn as the next turn', async () => {
      const { view } = await startTurn()
      state.steerDispositions = ['queued', 'not_applied']
      await act(async () => {
        await view.getResult().sendMessage('Then summarize')
      })
      await waitFor(() => state.steerBodies.length === 1)

      await act(async () => {
        await view.getResult().stopGeneration()
      })
      await waitFor(() => state.postBodies.length === 2)

      expect(state.postBodies[1]).toMatchObject({
        message: 'Then summarize',
        userMessageId: state.steerBodies[0].steeringId,
      })
    })

    it('treats a fallback the worker says was already applied as delivered, not as an error', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
      try {
        const turn = stubRunningTurn({
          fallback: Response.json(
            {
              error: 'This message was already included in the response it steered.',
              code: 'input_applied',
            },
            { status: 409 }
          ),
        })
        const view = renderUseChatInChat(chatId, history)
        await act(async () => {
          void view.getResult().sendMessage('Count to fifty')
        })
        await waitFor(() => view.getResult().isSending)
        state.steerDispositions = ['queued', 'not_applied']
        await act(async () => {
          await view.getResult().sendMessage('Then summarize')
        })
        await waitFor(() => state.steerBodies.length === 1)

        await turn.end()
        await waitFor(() => state.postBodies.length === 2)
        await waitFor(() => !view.getResult().isSending)
        /** Nothing is left to retry: a later attempt would only be refused the same way. */
        await act(async () => {
          await vi.advanceTimersByTimeAsync(10_000)
        })

        expect(view.getResult().error).toBeNull()
        expect(state.postBodies).toHaveLength(2)
      } finally {
        vi.useRealTimers()
      }
    })
  })
})
