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

import { act, type ReactNode, StrictMode, useEffect, useState } from 'react'
import { authClientMock, authClientMockFns } from '@sim/testing/mocks/auth-client.mock'
import { nextNavigationMock, nextNavigationMockFns } from '@sim/testing/mocks/next-navigation.mock'
import { sleep } from '@sim/utils/helpers'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequestJson, mockExecuteWorkflow } = vi.hoisted(() => ({
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
import type { MothershipStreamV1EventEnvelope } from '@/lib/mothership/generated/mothership-stream-v1'
import { getChatResourceSelectionId } from '@/lib/mothership/resources/types'
import { collectCitedMessageSources } from '@/app/workspace/[workspaceId]/home/components/message-content/message-sources'
import {
  readQueuedSendHandoffState,
  writeQueuedSendHandoffState,
} from '@/app/workspace/[workspaceId]/home/hooks/send-handoff'
import { useChat } from '@/app/workspace/[workspaceId]/home/hooks/use-chat'
import { type MothershipChatHistory, mothershipChatKeys } from '@/hooks/queries/mothership-chats'
import { useExecutionStore } from '@/stores/execution/store'
import { useMothershipQueueStore } from '@/stores/mothership-queue/store'

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
  postBodies: Array<{ message: string; userMessageId?: string; chatId?: string }>
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
    resetDeploymentShape()
  })

  it.each([false, true])(
    'keeps Search citations in the answer without replacing user panels (existing search: %s)',
    async (hasSearchPanel) => {
      const shape = resolveDeploymentShape()
      seedDeploymentShape({
        ...shape,
        features: { ...shape.features, liveEnterpriseSearch: true },
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
    seedDeploymentShape({ ...shape, features: { ...shape.features, liveEnterpriseSearch: true } })
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
})
