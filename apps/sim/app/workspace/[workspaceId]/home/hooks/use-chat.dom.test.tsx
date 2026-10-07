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

vi.mock('@/app/workspace/[workspaceId]/providers/feature-flags-provider', () => ({
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
vi.mock('@/lib/auth/auth-client', () => authClientMock)
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
import {
  resetDeploymentShape,
  resolveDeploymentShape,
  seedDeploymentShape,
} from '@/lib/core/config/deployment-shape'
import { MothershipHandoffStorage } from '@/lib/core/utils/browser-storage'
import { MOTHERSHIP_STREAM_REPLAY_HEADER } from '@/lib/mothership/constants'
import type { MothershipStreamV1EventEnvelope } from '@/lib/mothership/generated/mothership-stream-v1'
import { getChatResourceSelectionId } from '@/lib/mothership/resources/types'
import { collectCitedMessageSources } from '@/app/workspace/[workspaceId]/home/components/message-content/message-sources'
import {
  readQueuedSendHandoffState,
  writeQueuedSendHandoffState,
} from '@/app/workspace/[workspaceId]/home/hooks/send-handoff'
import { useChat } from '@/app/workspace/[workspaceId]/home/hooks/use-chat'
import { type MothershipChatHistory, mothershipChatKeys } from '@/hooks/queries/mothership-chats'
import { handleMothershipChatStatusEvent } from '@/hooks/use-mothership-chat-events'
import { useExecutionStore } from '@/stores/execution/store'
import { useMothershipEffortStore } from '@/stores/mothership-effort/store'
import { useMothershipQueueStore } from '@/stores/mothership-queue/store'

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
  postBodies: Array<{ message: string; userMessageId?: string; chatId?: string; effort?: string }>
  pendingAdmissions: Map<string, () => void>
  abortSettlements: boolean[]
  abortBodies: CopilotChatAbortBody[]
  stopBodies: CopilotChatStopBody[]
  toolInputPadding?: string
  abortTraceparents: Array<string | null>
}

const state: NetworkState = {
  postBehavior: 'hang',
  postBodies: [],
  pendingAdmissions: new Map(),
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
    const body: CopilotChatAbortBody = JSON.parse(String(init?.body))
    state.abortBodies.push(body)
    if (body.streamId) state.pendingAdmissions.get(body.streamId)?.()
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
  requestMode?: 'agent' | 'assistant'
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
    result = useChat(owner, undefined, { requestMode })
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
    selectMode: (mode) => {
      requestMode = mode
      act(() =>
        root.render(
          <QueryClientProvider client={queryClient}>
            <Probe />
          </QueryClientProvider>
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
      <QueryClientProvider client={queryClient}>{(<Probe />) as ReactNode}</QueryClientProvider>
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
          <QueryClientProvider client={queryClient}>
            <Probe />
          </QueryClientProvider>
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
    useMothershipQueueStore.setState({ queues: {}, editing: {}, cleared: {} })
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

  it('restores an explicitly selected Search tab while reconnecting an active turn', async () => {
    const shape = resolveDeploymentShape()
    seedDeploymentShape({ ...shape, features: shape.features })
    const history: MothershipChatHistory = {
      id: 'chat-reconnecting-search',
      title: 'Search',
      activeStreamId: 'accepted-search',
      messages: [{ id: 'accepted-search', role: 'user', content: 'Find the policy' }],
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

  it.each(['workspace', 'organization'] as const)(
    'preserves a %s send stopped during preparation and keeps the next send in that chat',
    async (scope) => {
      if (scope === 'organization') mockUsePathname.mockReturnValue('/o/org-1/home')
      const owner = scope === 'organization' ? { organizationId: 'org-1' } : 'ws-1'
      const { getResult } = renderUseChat(owner, 'agent')
      await act(async () => {
        const sent = getResult().sendMessage('Keep this message even if I stop immediately')
        const stopped = getResult().stopGeneration()
        await Promise.all([sent, stopped])
      })
      expect(state.postBodies).toHaveLength(1)
      expect(state.abortBodies[0]).toMatchObject({
        streamId: state.postBodies[0].userMessageId,
        ...(scope === 'organization' ? { organizationId: 'org-1' } : { workspaceId: 'ws-1' }),
      })
      expect(state.stopBodies[0]).toMatchObject({
        chatId: DEDUPED_CHAT_ID,
        streamId: state.postBodies[0].userMessageId,
      })
      await act(async () => {
        void getResult().sendMessage('Continue in the same chat')
      })
      await waitFor(() => state.postBodies.length === 2)
      expect(state.postBodies[1]).toMatchObject({ chatId: DEDUPED_CHAT_ID, createNewChat: false })
      expect(allQueuedMessages()).toHaveLength(0)
    }
  )

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
      expect(allQueuedMessages()[0]?.content).toBe('Do not create a second chat')
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

  it.each([false, true])(
    'does not interrupt or send a queued edit before submission (explicit ID: %s)',
    async (explicitId) => {
      state.postBehavior = 'task'
      const { getResult } = renderUseChatInChat('chat-a')
      await act(async () => {
        void getResult().sendMessage('Original request')
      })
      await waitFor(() => state.postBodies.length === 1 && getResult().isSending)
      const beforeRender = getResult()
      let queuedId = ''
      await act(async () => {
        void beforeRender.sendMessage('Unfinished correction')
        queuedId = allQueuedMessages()[0].id
        beforeRender.editQueuedMessage(queuedId)
        void beforeRender.sendNow(explicitId ? queuedId : undefined)
      })
      expect(state.abortBodies).toHaveLength(0)
      expect(state.postBodies).toHaveLength(1)
      expect(allQueuedMessages()).toEqual([
        expect.objectContaining({ id: queuedId, content: 'Unfinished correction' }),
      ])
      expect(useMothershipQueueStore.getState().editing['chat-a']).toBe(queuedId)
      state.postBehavior = 'hang'
      await act(async () => {
        void getResult().sendMessage('Finished correction')
        void getResult().sendNow()
      })
      await waitFor(() => state.postBodies.length === 2)
      expect(state.postBodies[1].message).toBe('Finished correction')
      expect(state.abortBodies).toHaveLength(1)
      expect(allQueuedMessages()).toHaveLength(0)
    }
  )

  it('sends the live queue head once without waiting for a render, after Stop settles', async () => {
    state.postBehavior = 'task'
    const { getResult } = renderUseChatInChat('chat-a')
    await act(async () => {
      void getResult().sendMessage('Original request')
    })
    await waitFor(() => state.postBodies.length === 1 && getResult().isSending)
    let releaseStop = () => {}
    const stopGate = new Promise<void>((resolve) => {
      releaseStop = resolve
    })
    let stopRequested = false
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/api/copilot/chat/abort')) {
        stopRequested = true
        await stopGate
      }
      return fetchStub(input, init)
    })
    state.postBehavior = 'hang'
    const beforeRender = getResult()
    await act(async () => {
      void beforeRender.sendMessage('Use the latest report')
      void beforeRender.sendNow()
      void beforeRender.sendNow()
    })
    try {
      await waitFor(() => stopRequested)
      expect(state.postBodies).toHaveLength(1)
    } finally {
      await act(async () => {
        releaseStop()
      })
    }
    await waitFor(() => state.postBodies.length === 2)
    expect(state.postBodies[1].message).toBe('Use the latest report')
    expect(allQueuedMessages()).toHaveLength(0)
    expect(state.abortBodies).toHaveLength(1)
  })

  /**
   * "Send now" on a queued message stops the running turn first. If the user
   * switches chats while that Stop settles, the message is not sent into the
   * other chat; it must go back to its own chat's queue, not vanish.
   */
  it('keeps a send-now message in its chat when the user switches chats during the Stop', async () => {
    state.postBehavior = 'task'
    const { getResult, navigate } = renderUseChatInChat('chat-a')
    await act(async () => {
      void getResult().sendMessage('Original request')
    })
    await waitFor(() => state.postBodies.length === 1 && getResult().isSending)
    let releaseStop = () => {}
    const stopGate = new Promise<void>((resolve) => {
      releaseStop = resolve
    })
    let stopRequested = false
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/api/copilot/chat/abort')) {
        stopRequested = true
        await stopGate
      }
      return fetchStub(input, init)
    })
    state.postBehavior = 'hang'
    await act(async () => {
      void getResult().sendMessage('Use the latest report')
    })
    await waitFor(() => useMothershipQueueStore.getState().queues['chat-a']?.length === 1)
    await act(async () => {
      void getResult().sendNow()
    })
    await waitFor(() => stopRequested)

    navigate('chat-b', {
      id: 'chat-b',
      mode: 'agent',
      title: 'Other chat',
      messages: [],
      activeStreamId: null,
      resources: [],
    })
    await act(async () => {
      releaseStop()
      await sleep(200)
    })

    expect(state.postBodies).toHaveLength(1)
    expect(
      (useMothershipQueueStore.getState().queues['chat-a'] ?? []).map((message) => message.content)
    ).toEqual(['Use the latest report'])
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

  it('sends a queued correction after stopping with more than 10 MiB of tool input', async () => {
    state.postBehavior = 'tool'
    state.toolInputPadding = 'x'.repeat(11 * 1024 * 1024)
    const { getResult } = renderUseChatInChat('chat-a')
    await act(async () => {
      void getResult().sendMessage('Start working')
    })
    await waitFor(() =>
      expect(
        getResult().messages.some((message) =>
          message.contentBlocks?.some((block) => block.toolCall?.id === 'this-chat-tool')
        )
      ).toBe(true)
    )
    state.postBehavior = 'hang'
    await act(async () => {
      await getResult().sendMessage('Use the correction')
      void getResult().sendNow()
    })
    await waitFor(() => expect(state.postBodies).toHaveLength(2))
    expect(state.postBodies[1].message).toBe('Use the correction')
    expect(state.stopBodies).toHaveLength(1)
    expect(state.stopBodies[0]).not.toHaveProperty('content')
    expect(state.stopBodies[0]).not.toHaveProperty('contentBlocks')
    expect(new TextEncoder().encode(JSON.stringify(state.stopBodies[0])).length).toBeLessThan(1024)
    expect(allQueuedMessages()).toHaveLength(0)
    expect(getResult().error).toBeNull()
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
        requestMode: 'assistant',
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
          mode: 'assistant',
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
   * The first POST on the new-chat surface reaches the server, which admits it,
   * but its answer never arrives. A resend under that id gets the server's
   * dedupe answer naming the chat it opened; any other POST opens a turn in
   * that chat. Until the remount, the abort endpoint and the stream lookup
   * fail, as they would for a Stop that cannot reach the server.
   */
  function stubFirstPostPendingThenAdmitted() {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/mothership/chat' && init?.method === 'POST') {
        state.postBodies.push(JSON.parse(String(init.body)))
        if (state.postBodies.length === 1) {
          return new Promise<Response>((_, reject) => {
            init.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
              once: true,
            })
          })
        }
        const firstId = state.postBodies[0].userMessageId
        if (state.postBodies.at(-1)?.userMessageId === firstId) {
          return Response.json(
            {
              error: 'This message was already sent.',
              activeStreamId: firstId,
              chatId: DEDUPED_CHAT_ID,
            },
            { status: 409 }
          )
        }
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.close()
            },
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'text/event-stream',
              'x-mothership-chat-id': DEDUPED_CHAT_ID,
            },
          }
        )
      }
      if (url.includes('/api/copilot/chat/abort')) {
        state.abortBodies.push(JSON.parse(String(init?.body)))
        return Response.json({ error: 'Internal error' }, { status: 500 })
      }
      if (url.includes('/api/mothership/chat/stream') && state.postBodies.length === 1) {
        return Response.json({ error: 'Internal error' }, { status: 500 })
      }
      return fetchStub(input, init)
    })
  }

  /**
   * A follow-up typed on the new-chat surface while the first message waits for
   * the server is queued behind it. If the surface remounts then, the first
   * message is withdrawn and both must reach the next mount in the order they
   * were written: the first message (under its own id), then the follow-up.
   */
  it('sends a withdrawn first message before its follow-up when the new-chat surface remounts', async () => {
    stubFirstPostPendingThenAdmitted()
    const first = renderHomeLikeSurface()
    await act(async () => {
      void first.getResult().sendMessage('inspect the workspace')
    })
    await waitFor(() => state.postBodies.length === 1)
    await act(async () => {
      void first.getResult().sendMessage('follow-up while admission pending')
    })
    await waitFor(() => allQueuedMessages().length === 1)
    first.unmount()
    /** Held first, as written: the server may already have it under its id. */
    expect(
      allQueuedMessages().map((message) => [message.content, message.admissionUnknown])
    ).toEqual([
      ['inspect the workspace', true],
      ['follow-up while admission pending', undefined],
    ])

    const second = renderHomeLikeSurface()
    await waitFor(() => state.postBodies.length >= 3, 4_000)
    await act(async () => {
      await sleep(300)
    })

    const afterRemount = state.postBodies.slice(1)
    expect(afterRemount.map((body) => body.message)).toEqual([
      'inspect the workspace',
      'follow-up while admission pending',
    ])
    expect(afterRemount[0].userMessageId).toBe(state.postBodies[0].userMessageId)
    expect(afterRemount[1].chatId).toBe(DEDUPED_CHAT_ID)
    expect(second.claimedByOwnListener()).toBe(0)
    expect(allQueuedMessages()).toHaveLength(0)
  })

  /**
   * A first message held at the queue head after a remount may already be a
   * turn on the server. Editing it would send different text under a new id,
   * a second message the user never meant to send.
   */
  it('does not let a withdrawn first message held at the queue head be edited', async () => {
    const history: MothershipChatHistory = {
      id: 'chat-running-while-held',
      mode: 'agent',
      title: 'Held',
      messages: [],
      activeStreamId: 'turn-still-running',
      resources: [],
    }
    mockRequestJson.mockImplementation(() => Promise.resolve({ chat: history }))
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/api/mothership/chat/stream')) {
        if (String(input).includes('batch=true')) {
          return Response.json({ success: true, events: [], status: 'streaming' })
        }
        return new Response(new ReadableStream<Uint8Array>(), {
          headers: { 'Content-Type': 'text/event-stream' },
        })
      }
      return fetchStub(input, init)
    })
    useMothershipQueueStore.getState().enqueue(history.id, {
      id: 'held-first',
      content: 'inspect the workspace',
      resumeUserMessageId: 'first-attempt',
      admissionUnknown: true,
    })
    const { getResult } = renderUseChatInChat(history.id, history)
    await waitFor(() => getResult().isSending)

    let edited: ReturnType<ReturnType<typeof useChat>['editQueuedMessage']>
    await act(async () => {
      edited = getResult().editQueuedMessage('held-first')
    })

    expect(edited).toBeUndefined()
    expect(getResult().editingQueuedId).toBeNull()
    expect(useMothershipQueueStore.getState().queues[history.id]?.[0]).toMatchObject({
      content: 'inspect the workspace',
      resumeUserMessageId: 'first-attempt',
    })
  })

  /** A chat with a turn running, so anything sent to it waits in its queue. */
  function renderBusyChat(id: string) {
    const history: MothershipChatHistory = {
      id,
      mode: 'agent',
      title: 'Busy',
      messages: [],
      activeStreamId: 'turn-still-running',
      resources: [],
    }
    mockRequestJson.mockImplementation(() => Promise.resolve({ chat: history }))
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/api/mothership/chat/stream')) {
        if (String(input).includes('batch=true')) {
          return Response.json({ success: true, events: [], status: 'streaming' })
        }
        return new Response(new ReadableStream<Uint8Array>(), {
          headers: { 'Content-Type': 'text/event-stream' },
        })
      }
      return fetchStub(input, init)
    })
    return { history, ...renderUseChatInChat(id, history) }
  }

  /**
   * A send another surface withdrew arrives here under its original id, through
   * the send event or the stored handoff. Queued behind a running turn, it may
   * already be a turn on the server, so it can't be edited either.
   */
  it('does not let a withdrawn send handed to a busy chat be edited', async () => {
    const { history, getResult } = renderBusyChat('chat-busy-on-handoff')
    await waitFor(() => getResult().isSending)
    await act(async () => {
      await getResult().sendMessage('handed over from another surface', undefined, undefined, {
        resumeUserMessageId: 'withdrawn-attempt',
      })
    })
    const queued = useMothershipQueueStore.getState().queues[history.id]?.[0]
    expect(queued?.resumeUserMessageId).toBe('withdrawn-attempt')

    let edited: ReturnType<ReturnType<typeof useChat>['editQueuedMessage']>
    await act(async () => {
      edited = getResult().editQueuedMessage(queued?.id ?? '')
    })

    expect(edited).toBeUndefined()
    expect(getResult().editingQueuedId).toBeNull()
  })

  /** A follow-up whose dispatch got no answer may have reached the server too. */
  it('does not let a queued follow-up be edited after its send got no answer', async () => {
    const history: MothershipChatHistory = {
      id: 'chat-follow-up-unanswered',
      mode: 'agent',
      title: 'Unanswered',
      messages: [],
      activeStreamId: null,
      resources: [],
    }
    mockRequestJson.mockImplementation(() => Promise.resolve({ chat: history }))
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/mothership/chat' && init?.method === 'POST') {
        state.postBodies.push(JSON.parse(String(init.body)))
        throw new TypeError('Failed to fetch')
      }
      return fetchStub(input, init)
    })
    useMothershipQueueStore
      .getState()
      .enqueue(history.id, { id: 'follow-up', content: 'and the second invoice' })
    const { getResult } = renderUseChatInChat(history.id, history)
    await waitFor(
      () =>
        useMothershipQueueStore.getState().queues[history.id]?.[0]?.resumeUserMessageId !==
        undefined
    )

    let edited: ReturnType<ReturnType<typeof useChat>['editQueuedMessage']>
    await act(async () => {
      edited = getResult().editQueuedMessage('follow-up')
    })

    expect(edited).toBeUndefined()
    expect(useMothershipQueueStore.getState().queues[history.id]?.[0]).toMatchObject({
      content: 'and the second invoice',
      resumeUserMessageId: state.postBodies[0].userMessageId,
    })
  })

  /**
   * Send-now on a resumed message whose Stop of the running turn does not
   * settle sends nothing. That says nothing about the earlier attempt the
   * message resumes, so it must stay uneditable.
   */
  it('keeps a resumed message uneditable when its Send-now Stop does not settle', async () => {
    state.abortSettlements = [false, false, false, false]
    const { getResult } = renderUseChatInChat('chat-a')
    await act(async () => {
      void getResult().sendMessage('Original request')
    })
    await waitFor(() => state.postBodies.length === 1 && getResult().isSending)
    await act(async () => {
      await getResult().sendMessage('handed over from another surface', undefined, undefined, {
        resumeUserMessageId: 'withdrawn-attempt',
      })
    })
    await waitFor(() => useMothershipQueueStore.getState().queues['chat-a']?.length === 1)

    await act(async () => {
      await getResult()
        .sendNow()
        .catch(() => {})
      await sleep(200)
    })
    const queued = useMothershipQueueStore.getState().queues['chat-a']?.[0]
    let edited: ReturnType<ReturnType<typeof useChat>['editQueuedMessage']>
    await act(async () => {
      edited = getResult().editQueuedMessage(queued?.id ?? '')
    })

    expect(state.postBodies).toHaveLength(1)
    expect(queued).toMatchObject({
      content: 'handed over from another surface',
      resumeUserMessageId: 'withdrawn-attempt',
      admissionUnknown: true,
    })
    expect(edited).toBeUndefined()
  })

  /**
   * A held message the server then refuses as busy is known not to be a turn
   * there: the server answers a retry of an admitted id as a duplicate, never
   * as busy. The user can edit it again.
   */
  it('lets a held message be edited again once the server refuses it as busy', async () => {
    const history: MothershipChatHistory = {
      id: 'chat-held-then-refused',
      mode: 'agent',
      title: 'Refused',
      messages: [],
      activeStreamId: null,
      resources: [],
    }
    mockRequestJson.mockImplementation(() => Promise.resolve({ chat: history }))
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/mothership/chat' && init?.method === 'POST') {
        state.postBodies.push(JSON.parse(String(init.body)))
        return Response.json(
          {
            error: 'A response is already in progress for this chat.',
            activeStreamId: 'turn-from-another-tab',
          },
          { status: 409 }
        )
      }
      if (url.includes('/api/mothership/chat/stream')) {
        if (url.includes('batch=true')) {
          return Response.json({ success: true, events: [], status: 'streaming' })
        }
        return new Response(new ReadableStream<Uint8Array>(), {
          headers: { 'Content-Type': 'text/event-stream' },
        })
      }
      return fetchStub(input, init)
    })
    useMothershipQueueStore.getState().enqueue(history.id, {
      id: 'held-first',
      content: 'inspect the workspace',
      resumeUserMessageId: 'first-attempt',
      admissionUnknown: true,
    })
    const { getResult } = renderUseChatInChat(history.id, history)
    await waitFor(() => state.postBodies.length === 1)
    await waitFor(
      () => useMothershipQueueStore.getState().queues[history.id]?.[0]?.id === 'held-first'
    )

    let edited: ReturnType<ReturnType<typeof useChat>['editQueuedMessage']>
    await act(async () => {
      edited = getResult().editQueuedMessage('held-first')
    })

    expect(edited?.content).toBe('inspect the workspace')
    expect(getResult().editingQueuedId).toBe('held-first')
  })

  /**
   * After a Stop of the first message, only the follow-up was the user's
   * intent: the Stop's POST is left to the server, nothing withdraws it, and the
   * next mount sends just the follow-up, once.
   */
  it('sends only the follow-up after a failed Stop when the new-chat surface remounts', async () => {
    stubFirstPostPendingThenAdmitted()
    const first = renderHomeLikeSurface()
    await act(async () => {
      void first.getResult().sendMessage('inspect the workspace')
    })
    await waitFor(() => state.postBodies.length === 1)
    await act(async () => {
      void first
        .getResult()
        .stopGeneration()
        .catch(() => {})
      void first.getResult().sendMessage('Sent while the Stop was failing')
      await sleep(1_000)
    })
    first.unmount()

    renderHomeLikeSurface()
    await waitFor(() => state.postBodies.length >= 2, 4_000)
    await act(async () => {
      await sleep(500)
    })

    expect(state.postBodies.slice(1).map((body) => body.message)).toEqual([
      'Sent while the Stop was failing',
    ])
    expect(allQueuedMessages()).toHaveLength(0)
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
    function stubUnreachableSend() {
      network.online = false
      network.acceptedPosts = 0
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

    it('holds a message sent while offline and sends it under the same id once back online', async () => {
      const history = idleHistory('chat-offline-send')
      mockRequestJson.mockImplementation(() => Promise.resolve({ chat: history }))
      stubUnreachableSend()
      const { getResult } = renderUseChatInChat(history.id, history)

      await act(async () => {
        await getResult().sendMessage('Written while offline')
      })
      await waitFor(() => !getResult().isSending)

      const queued = useMothershipQueueStore.getState().queues[history.id] ?? []
      expect(queued.map((message) => message.content)).toEqual(['Written while offline'])
      expect(queued[0].retryRequired).toBe(true)
      expect(queued[0].resumeUserMessageId).toBe(state.postBodies[0].userMessageId)
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

    it('keeps a queued follow-up whose dispatch could not reach the server', async () => {
      const history = idleHistory('chat-offline-queue')
      mockRequestJson.mockImplementation(() => Promise.resolve({ chat: history }))
      stubUnreachableSend()
      useMothershipQueueStore
        .getState()
        .enqueue(history.id, { id: 'queued-follow-up', content: 'Queued before the drop' })
      renderUseChatInChat(history.id, history)

      await waitFor(() => state.postBodies.length === 1)
      await waitFor(
        () => useMothershipQueueStore.getState().queues[history.id]?.[0]?.retryRequired === true
      )

      const queued = useMothershipQueueStore.getState().queues[history.id] ?? []
      expect(queued.map((message) => message.content)).toEqual(['Queued before the drop'])
      expect(queued[0].resumeUserMessageId).toBe(state.postBodies[0].userMessageId)
      expect(state.postBodies).toHaveLength(1)
    })

    /**
     * Another tab's turn holds the chat (this one missed its start). The server
     * refuses the send, naming that turn or, when its stream id is unreadable,
     * nothing. The message must go out exactly once, under its id, after that turn
     * ends: never rendered under the other turn's answer, never lost, never resent
     * while the turn still runs.
     */
    it.each([
      ['names', 'turn-from-another-tab'],
      ['does not name', undefined],
    ] as const)(
      'sends a message once, after the turn that held the chat ends, when the refusal %s it',
      async (_names, refusalStreamId) => {
        const history = idleHistory(`chat-busy-${refusalStreamId ?? 'unnamed'}`)
        let otherTurnRunning = true
        mockRequestJson.mockImplementation(() =>
          Promise.resolve({
            chat: {
              ...history,
              activeStreamId: otherTurnRunning ? 'turn-from-another-tab' : null,
            },
          })
        )
        vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input)
          if (url === '/api/mothership/chat' && init?.method === 'POST') {
            state.postBodies.push(JSON.parse(String(init.body)))
            if (otherTurnRunning) {
              return Response.json(
                {
                  error: 'A response is already in progress for this chat.',
                  ...(refusalStreamId ? { activeStreamId: refusalStreamId } : {}),
                },
                { status: 409 }
              )
            }
            return emptySseResponse()
          }
          if (url.includes('/api/mothership/chat/stream')) {
            if (url.includes('batch=true')) {
              return Response.json({
                success: true,
                events: [],
                status: otherTurnRunning ? 'streaming' : 'complete',
              })
            }
            return emptySseResponse()
          }
          return fetchStub(input, init)
        })
        const { getResult } = renderUseChatInChat(history.id, history)

        await act(async () => {
          await getResult().sendMessage('Sent from the second tab')
        })
        await act(async () => {
          await sleep(1500)
        })
        expect(state.postBodies).toHaveLength(1)
        expect(useMothershipQueueStore.getState().queues[history.id]?.[0]?.content).toBe(
          'Sent from the second tab'
        )

        otherTurnRunning = false
        await waitFor(() => state.postBodies.length === 2, 5000)
        await act(async () => {
          await sleep(500)
        })

        expect(state.postBodies).toHaveLength(2)
        expect(state.postBodies[1].message).toBe('Sent from the second tab')
        expect(state.postBodies[1].userMessageId).toBe(state.postBodies[0].userMessageId)
      }
    )

    /**
     * A chatless surface keys its queue by mount, so a held first message would
     * be stranded by a reload or remount before the network returns. The next
     * chatless mount of the same surface adopts it.
     */
    it('carries a first message held offline over to the next new-chat surface', async () => {
      stubUnreachableSend()
      const first = renderUseChat()
      await act(async () => {
        await first.getResult().sendMessage('First message, sent offline')
      })
      await waitFor(() => allQueuedMessages().some((message) => message.retryRequired === true))
      first.unmount()

      const second = renderUseChat()
      await waitFor(() =>
        second
          .getResult()
          .messageQueue.some((message) => message.content === 'First message, sent offline')
      )

      network.online = true
      await act(async () => {
        window.dispatchEvent(new Event('online'))
      })
      await waitFor(() => network.acceptedPosts === 1)
      await act(async () => {
        await sleep(300)
      })

      expect(network.acceptedPosts).toBe(1)
      expect(new Set(state.postBodies.map((body) => body.userMessageId)).size).toBe(1)
      expect(state.postBodies.at(-1)?.message).toBe('First message, sent offline')
    })

    /**
     * Releasing held sends on mount must not bypass the queue's own rules: a
     * follow-up queued behind a turn that is still running (here, restored after a
     * reload) waits for that turn instead of being sent into a busy chat.
     */
    it('keeps a queued follow-up waiting on mount while the chat is still running', async () => {
      const history: MothershipChatHistory = {
        ...idleHistory('chat-still-running'),
        activeStreamId: 'turn-still-running',
      }
      mockRequestJson.mockImplementation(() => Promise.resolve({ chat: history }))
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url === '/api/mothership/chat' && init?.method === 'POST') {
          state.postBodies.push(JSON.parse(String(init.body)))
          return emptySseResponse()
        }
        if (url.includes('/api/mothership/chat/stream')) {
          if (url.includes('batch=true')) {
            return Response.json({ success: true, events: [], status: 'streaming' })
          }
          return new Response(new ReadableStream<Uint8Array>(), {
            headers: { 'Content-Type': 'text/event-stream' },
          })
        }
        return fetchStub(input, init)
      })
      useMothershipQueueStore
        .getState()
        .enqueue(history.id, { id: 'queued-before-reload', content: 'Queued before the reload' })
      renderUseChatInChat(history.id)

      await act(async () => {
        await sleep(1000)
      })

      expect(state.postBodies).toHaveLength(0)
      expect(useMothershipQueueStore.getState().queues[history.id]?.[0]?.content).toBe(
        'Queued before the reload'
      )
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

    /** Switching chats while a queued send is failing must not drop it from its own chat. */
    it('keeps a queued send that failed after the user switched chats', async () => {
      const history = idleHistory('chat-left-mid-dispatch')
      const other = idleHistory('chat-switched-to')
      mockRequestJson.mockImplementation((_contract: AnyApiRouteContract, input: unknown) =>
        Promise.resolve({
          chat: JSON.stringify(input).includes(other.id) ? other : history,
        })
      )
      let failPost: (() => void) | undefined
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === '/api/mothership/chat' && init?.method === 'POST') {
          state.postBodies.push(JSON.parse(String(init.body)))
          return new Promise<Response>((_, reject) => {
            failPost = () => reject(new TypeError('Failed to fetch'))
          })
        }
        return fetchStub(input, init)
      })
      useMothershipQueueStore
        .getState()
        .enqueue(history.id, { id: 'queued-then-left', content: 'Sent as I switched chats' })
      const { navigate } = renderUseChatInChat(history.id, history)
      await waitFor(() => failPost !== undefined)

      navigate(other.id, other)
      await act(async () => {
        failPost?.()
        await sleep(100)
      })

      const queued = useMothershipQueueStore.getState().queues[history.id] ?? []
      expect(queued.map((message) => message.content)).toEqual(['Sent as I switched chats'])
      expect(queued[0].resumeUserMessageId).toBe(state.postBodies[0].userMessageId)
    })

    /**
     * A send can wait on the chat lock while the user switches chats. The switch
     * detaches the view but leaves the POST running, so the busy refusal that
     * answers it must still put the message back in its own chat's queue.
     */
    it.each(['direct', 'queued'] as const)(
      'keeps a %s send refused as busy after the user switched chats',
      async (origin) => {
        const history = idleHistory(`chat-busy-after-switch-${origin}`)
        const other = idleHistory(`chat-switched-to-during-lock-${origin}`)
        mockRequestJson.mockImplementation((_contract: AnyApiRouteContract, input: unknown) =>
          Promise.resolve({
            chat: JSON.stringify(input).includes(other.id) ? other : history,
          })
        )
        let answerPost: (() => void) | undefined
        vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
          if (String(input) === '/api/mothership/chat' && init?.method === 'POST') {
            state.postBodies.push(JSON.parse(String(init.body)))
            return new Promise<Response>((resolve) => {
              answerPost = () =>
                resolve(
                  Response.json(
                    {
                      error: 'A response is already in progress for this chat.',
                      activeStreamId: 'turn-from-another-tab',
                    },
                    { status: 409 }
                  )
                )
            })
          }
          if (String(input).includes('/api/mothership/chat/stream')) {
            return new Response(new ReadableStream<Uint8Array>(), {
              headers: { 'Content-Type': 'text/event-stream' },
            })
          }
          return fetchStub(input, init)
        })
        if (origin === 'queued') {
          useMothershipQueueStore
            .getState()
            .enqueue(history.id, { id: 'queued-on-lock', content: 'Waiting on the lock' })
        }
        const { getResult, navigate } = renderUseChatInChat(history.id, history)
        if (origin === 'direct') {
          await act(async () => {
            void getResult().sendMessage('Waiting on the lock')
          })
        }
        await waitFor(() => answerPost !== undefined)

        navigate(other.id, other)
        await act(async () => {
          answerPost?.()
          await sleep(300)
        })

        const queued = useMothershipQueueStore.getState().queues[history.id] ?? []
        expect(queued.map((message) => message.content)).toEqual(['Waiting on the lock'])
        expect(queued[0].resumeUserMessageId).toBe(state.postBodies[0].userMessageId)
        expect(useMothershipQueueStore.getState().queues[other.id]).toBeUndefined()
        expect(state.postBodies).toHaveLength(1)
      }
    )

    /** A chat deleted while its queued send was failing must not get that send back. */
    it('does not recreate the queue of a chat deleted while its queued send was failing', async () => {
      const history = idleHistory('chat-deleted-mid-dispatch')
      const other = idleHistory('chat-open-after-delete')
      mockRequestJson.mockImplementation((_contract: AnyApiRouteContract, input: unknown) =>
        Promise.resolve({
          chat: JSON.stringify(input).includes(other.id) ? other : history,
        })
      )
      let failPost: (() => void) | undefined
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === '/api/mothership/chat' && init?.method === 'POST') {
          state.postBodies.push(JSON.parse(String(init.body)))
          return new Promise<Response>((_, reject) => {
            failPost = () => reject(new TypeError('Failed to fetch'))
          })
        }
        return fetchStub(input, init)
      })
      useMothershipQueueStore
        .getState()
        .enqueue(history.id, { id: 'queued-then-deleted', content: 'In a chat I deleted' })
      const { navigate } = renderUseChatInChat(history.id, history)
      await waitFor(() => failPost !== undefined)

      navigate(other.id, other)
      useMothershipQueueStore.getState().clearChat(history.id)
      await act(async () => {
        failPost?.()
        await sleep(100)
      })

      expect(useMothershipQueueStore.getState().queues[history.id]).toBeUndefined()
    })

    /**
     * A direct send to a chat that is deleted while its POST is failing must not
     * bring the chat's queue back: nothing would show the message, and it would
     * go out by itself if the chat were ever restored.
     */
    it.each(['unreachable', 'busy'] as const)(
      'does not recreate a deleted chat through a %s direct send',
      async (outcome) => {
        const history = idleHistory(`chat-deleted-direct-${outcome}`)
        mockRequestJson.mockImplementation(() => Promise.resolve({ chat: history }))
        let answerPost: (() => void) | undefined
        vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
          if (String(input) === '/api/mothership/chat' && init?.method === 'POST') {
            state.postBodies.push(JSON.parse(String(init.body)))
            return new Promise<Response>((resolve, reject) => {
              answerPost = () =>
                outcome === 'unreachable'
                  ? reject(new TypeError('Failed to fetch'))
                  : resolve(
                      Response.json(
                        { error: 'A response is already in progress for this chat.' },
                        { status: 409 }
                      )
                    )
            })
          }
          if (String(input).includes('/api/mothership/chat/stream')) {
            return Response.json({ error: 'Stream not found' }, { status: 404 })
          }
          return fetchStub(input, init)
        })
        const { getResult } = renderUseChatInChat(history.id, history)
        await act(async () => {
          void getResult().sendMessage('Sent to a chat I then deleted')
        })
        await waitFor(() => answerPost !== undefined)

        useMothershipQueueStore.getState().clearChat(history.id)
        /** The server no longer returns a deleted chat. */
        mockRequestJson.mockImplementation(() => Promise.reject(new Error('Chat not found')))
        await act(async () => {
          answerPost?.()
          await sleep(300)
        })

        expect(useMothershipQueueStore.getState().queues[history.id]).toBeUndefined()
        expect(state.postBodies).toHaveLength(1)
      }
    )

    /** The same holds when the server read is the one a return to the tab makes. */
    it('queues a follow-up after a return to the tab finds a chat this tab saw deleted', async () => {
      const history = idleHistory('chat-restored-while-away')
      const running: MothershipChatHistory = { ...history, activeStreamId: 'turn-after-restore' }
      mockRequestJson.mockImplementation(() => Promise.resolve({ chat: running }))
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes('/api/mothership/chat/stream')) {
          if (String(input).includes('batch=true')) {
            return Response.json({ success: true, events: [], status: 'streaming' })
          }
          return new Response(new ReadableStream<Uint8Array>(), {
            headers: { 'Content-Type': 'text/event-stream' },
          })
        }
        return fetchStub(input, init)
      })
      const { getResult } = renderUseChatInChat(history.id, history)
      useMothershipQueueStore.getState().clearChat(history.id)

      await act(async () => {
        window.dispatchEvent(new Event('pageshow'))
      })
      await waitFor(() => getResult().isSending)
      await act(async () => {
        await getResult().sendMessage('Follow-up after coming back')
      })

      expect(
        useMothershipQueueStore.getState().queues[history.id]?.map((message) => message.content)
      ).toEqual(['Follow-up after coming back'])
    })

    /**
     * Another tab deletes the chat while this tab's send waits on the lock. The
     * busy refusal then rewrites the chat's history locally; that is not the
     * server returning the chat, so the delete must still hold.
     */
    it('keeps a chat deleted in another tab empty when a pending send there is refused as busy', async () => {
      const history = idleHistory('chat-deleted-in-other-tab')
      mockRequestJson.mockImplementation(() => Promise.resolve({ chat: history }))
      let answerPost: (() => void) | undefined
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === '/api/mothership/chat' && init?.method === 'POST') {
          state.postBodies.push(JSON.parse(String(init.body)))
          return new Promise<Response>((resolve) => {
            answerPost = () =>
              resolve(
                Response.json(
                  { error: 'A response is already in progress for this chat.' },
                  { status: 409 }
                )
              )
          })
        }
        if (String(input).includes('/api/mothership/chat')) {
          return Response.json({ error: 'Chat not found' }, { status: 404 })
        }
        return fetchStub(input, init)
      })
      const { getResult } = renderUseChatInChat(history.id, history)
      await act(async () => {
        void getResult().sendMessage('Sent as another tab deleted the chat')
      })
      await waitFor(() => answerPost !== undefined)

      mockRequestJson.mockImplementation(() => Promise.reject(new Error('Chat not found')))
      handleMothershipChatStatusEvent(
        queryClient,
        'ws-1',
        JSON.stringify({ chatId: history.id, type: 'deleted', timestamp: Date.now() })
      )
      await act(async () => {
        answerPost?.()
        await sleep(300)
      })
      useMothershipQueueStore.getState().enqueue(history.id, { id: 'later', content: 'Later' })

      expect(useMothershipQueueStore.getState().queues[history.id]).toBeUndefined()
      expect(state.postBodies).toHaveLength(1)
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
     * A send can wait several seconds on the server's chat lock behind another
     * tab's turn. Returning to the tab in that window must not abort it: when
     * the refusal arrives, the chat shows that turn running and the message
     * waits in the queue behind it.
     */
    it('keeps a send waiting on the chat lock when the user returns to the tab', async () => {
      const history: MothershipChatHistory = {
        ...idleHistory('chat-lock-wait-return'),
        activeStreamId: 'turn-from-another-tab',
      }
      mockRequestJson.mockImplementation(() => Promise.resolve({ chat: history }))
      let answerPost: (() => void) | undefined
      let answered = false
      const tailsAfterRefusal: string[] = []
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url === '/api/mothership/chat' && init?.method === 'POST') {
          state.postBodies.push(JSON.parse(String(init.body)))
          return new Promise<Response>((resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
              once: true,
            })
            answerPost = () =>
              resolve(
                Response.json(
                  {
                    error: 'A response is already in progress for this chat.',
                    activeStreamId: 'turn-from-another-tab',
                  },
                  { status: 409 }
                )
              )
          })
        }
        if (url.includes('/api/mothership/chat/stream')) {
          if (url.includes('batch=true')) {
            return Response.json({ success: true, events: [], status: 'streaming' })
          }
          if (answered) {
            tailsAfterRefusal.push(
              new URL(url, 'http://localhost').searchParams.get('streamId') ?? ''
            )
          }
          return new Response(new ReadableStream<Uint8Array>(), {
            headers: { 'Content-Type': 'text/event-stream' },
          })
        }
        return fetchStub(input, init)
      })
      const { getResult } = renderUseChatInChat(history.id, {
        ...history,
        activeStreamId: null,
      })
      await act(async () => {
        void getResult().sendMessage('Waiting on the lock')
      })
      await waitFor(() => answerPost !== undefined)

      await act(async () => {
        window.dispatchEvent(new Event('pageshow'))
        await sleep(100)
      })
      await act(async () => {
        answered = true
        answerPost?.()
        await sleep(300)
      })

      const queued = useMothershipQueueStore.getState().queues[history.id] ?? []
      expect(queued.map((message) => message.content)).toEqual(['Waiting on the lock'])
      expect(queued[0].resumeUserMessageId).toBe(state.postBodies[0].userMessageId)
      expect(tailsAfterRefusal).toContain('turn-from-another-tab')
      expect(getResult().isSending).toBe(true)
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
     * A first message from the new-chat surface can be refused as busy with no
     * turn to wait for (Redis down). It must wait out the same growing delay
     * there, not be handed to the surface's own send listener and resent at once.
     */
    it('backs off a busy refusal of a first message on the new-chat surface', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
      try {
        vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
          if (String(input) === '/api/mothership/chat' && init?.method === 'POST') {
            state.postBodies.push(JSON.parse(String(init.body)))
            /** Caps a hot loop so it fails the count below instead of starving the test. */
            if (state.postBodies.length > 20) return new Promise<Response>(() => {})
            return Response.json(
              { error: 'A response is already in progress for this chat.' },
              { status: 409 }
            )
          }
          return fetchStub(input, init)
        })
        const { getResult } = renderHomeLikeSurface()
        await act(async () => {
          void getResult().sendMessage('First message while Redis is down')
          await vi.advanceTimersByTimeAsync(50)
        })
        for (let second = 0; second < 10; second++) {
          await act(async () => vi.advanceTimersByTimeAsync(1_000))
        }

        /** 1s, 2s, 4s, 8s of backoff fit at most 4 attempts in 10s. */
        expect(state.postBodies.length).toBeGreaterThan(1)
        expect(state.postBodies.length).toBeLessThanOrEqual(4)
        expect(new Set(state.postBodies.map((body) => body.userMessageId)).size).toBe(1)
        expect(allQueuedMessages().map((message) => message.content)).toEqual([
          'First message while Redis is down',
        ])
      } finally {
        vi.useRealTimers()
      }
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

    /**
     * A chat this tab saw deleted can be restored from another tab without this
     * tab hearing of it. Once the chat loads, it exists, so a follow-up queued
     * behind its running turn must be kept.
     */
    it('queues a follow-up in a chat that loads after this tab saw it deleted', async () => {
      const history: MothershipChatHistory = {
        ...idleHistory('chat-restored-elsewhere'),
        activeStreamId: 'turn-still-running',
      }
      mockRequestJson.mockImplementation(() => Promise.resolve({ chat: history }))
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes('/api/mothership/chat/stream')) {
          if (String(input).includes('batch=true')) {
            return Response.json({ success: true, events: [], status: 'streaming' })
          }
          return new Response(new ReadableStream<Uint8Array>(), {
            headers: { 'Content-Type': 'text/event-stream' },
          })
        }
        return fetchStub(input, init)
      })
      useMothershipQueueStore.getState().clearChat(history.id)
      /** Loaded from the server, not seeded: only a server read confirms the chat exists. */
      const { getResult } = renderUseChatInChat(history.id)
      await waitFor(() => getResult().isSending)

      await act(async () => {
        await getResult().sendMessage('Follow-up after the restore')
      })

      expect(
        useMothershipQueueStore.getState().queues[history.id]?.map((message) => message.content)
      ).toEqual(['Follow-up after the restore'])
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

    /** The `online` event can fire while no surface for the chat is mounted. */
    it('sends a held message when its chat mounts after the network came back', async () => {
      const history = idleHistory('chat-held-while-away')
      mockRequestJson.mockImplementation(() => Promise.resolve({ chat: history }))
      stubUnreachableSend()
      const first = renderUseChatInChat(history.id, history)
      await act(async () => {
        await first.getResult().sendMessage('Held while I was elsewhere')
      })
      await waitFor(
        () => useMothershipQueueStore.getState().queues[history.id]?.[0]?.retryRequired === true
      )
      first.unmount()

      network.online = true
      renderUseChatInChat(history.id, history)
      await waitFor(() => state.postBodies.length === 2)

      expect(state.postBodies[1].message).toBe('Held while I was elsewhere')
      expect(state.postBodies[1].userMessageId).toBe(state.postBodies[0].userMessageId)
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

  it.each(['active', 'complete', 'cancelled'] as const)(
    'removes a recovered queue entry already accepted by the server (%s)',
    async (status) => {
      useMothershipQueueStore.getState().enqueue('chat-a', {
        id: 'withdrawn-entry',
        content: 'check the trace for this req',
        resumeUserMessageId: 'accepted-request',
        retryRequired: true,
      })
      const { getResult } = renderUseChatInChat('chat-a', {
        id: 'chat-a',
        title: 'Trace inspection',
        activeStreamId: status === 'active' ? 'accepted-request' : null,
        messages: [
          { id: 'accepted-request', role: 'user', content: 'check the trace for this req' },
          ...(status === 'active'
            ? []
            : [
                {
                  id: 'accepted-answer',
                  role: 'assistant' as const,
                  content: '',
                  contentBlocks: [
                    {
                      type: 'complete' as const,
                      status:
                        status === 'cancelled' ? ('cancelled' as const) : ('success' as const),
                    },
                  ],
                },
              ]),
        ],
        resources: [],
      })
      await waitFor(() => getResult().messageQueue.length === 0)
      expect(state.postBodies).toHaveLength(0)
      expect(state.abortBodies).toHaveLength(0)
    }
  )

  it('keeps an unsent correction with matching text queued', async () => {
    useMothershipQueueStore.getState().enqueue('chat-a', {
      id: 'unsent-entry',
      content: 'check the trace for this req',
      retryRequired: true,
      resumeUserMessageId: 'unsent-request',
    })
    const { getResult } = renderUseChatInChat('chat-a', {
      id: 'chat-a',
      title: 'Trace inspection',
      activeStreamId: null,
      messages: [
        { id: 'different-request', role: 'user', content: 'check the trace for this req' },
      ],
      resources: [],
    })
    await act(async () => {})
    expect(getResult().messageQueue.map((entry) => entry.id)).toEqual(['unsent-entry'])
    expect(state.postBodies).toHaveLength(0)
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

  /**
   * The tab finalizes on the `complete` event, which reaches it before the server
   * saves the turn. A transcript read in that gap is the server's in-flight copy;
   * the tab must read again rather than keep it (live ids, the finished stream
   * still listed as running) until something else happens to refetch. That holds
   * when the save is slow, and when a follow-up is queued but not yet sent.
   */
  it.each([
    { label: 'right after the first read', unsavedReads: 1, heldFollowUp: false },
    { label: 'only after a slow save', unsavedReads: 9, heldFollowUp: false },
    { label: 'with a follow-up queued but held', unsavedReads: 1, heldFollowUp: true },
  ])(
    're-reads a transcript fetched before the server saved the finished turn ($label)',
    async ({ unsavedReads, heldFollowUp }) => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      try {
        const chatId = `chat-saved-after-complete-${unsavedReads}-${heldFollowUp}`
        const history: MothershipChatHistory = {
          id: chatId,
          mode: 'agent',
          title: 'Saved late',
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
          if (!completed) return Promise.resolve({ chat: history })
          detailReads++
          if (detailReads <= unsavedReads && streamId) {
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
          }
          return Promise.resolve({
            chat: {
              ...history,
              messages: [
                { id: streamId, role: 'user', content: 'Summarize the run' },
                { id: 'saved-assistant', role: 'assistant', content: 'Done.' },
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
        const { getResult } = renderUseChatInChat(chatId, history)

        await act(async () => {
          void getResult().sendMessage('Summarize the run')
          await vi.advanceTimersByTimeAsync(50)
        })
        expect(stream).toBeDefined()
        if (heldFollowUp) {
          useMothershipQueueStore
            .getState()
            .enqueue(chatId, { id: 'held-follow-up', content: 'And the next one' })
          useMothershipQueueStore.getState().setEditing(chatId, 'held-follow-up')
        }
        const emit = (event: Omit<MothershipStreamV1EventEnvelope, 'v' | 'ts' | 'stream'>) =>
          stream?.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({ v: 1, ts: '', stream: { streamId }, ...event })}\n\n`
            )
          )
        const saved = () =>
          queryClient
            .getQueryData<MothershipChatHistory>(mothershipChatKeys.detail(chatId))
            ?.messages.some((message) => message.id === 'saved-assistant') === true
        await act(async () => {
          emit({ seq: 1, type: 'text', payload: { channel: 'assistant', text: 'Done.' } })
          completed = true
          emit({ seq: 2, type: 'complete', payload: { status: 'complete' } })
          stream?.close()
          await vi.advanceTimersByTimeAsync(50)
        })
        for (let second = 0; second < 90 && !saved(); second++) {
          await act(async () => vi.advanceTimersByTimeAsync(1_000))
        }

        expect(saved()).toBe(true)
        expect(
          queryClient.getQueryData<MothershipChatHistory>(mothershipChatKeys.detail(chatId))
            ?.activeStreamId
        ).toBeNull()
        expect(detailReads).toBe(unsavedReads + 1)
        expect(getResult().isSending).toBe(false)
      } finally {
        vi.useRealTimers()
      }
    }
  )

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
})
