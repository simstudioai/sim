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
import { sleep } from '@sim/utils/helpers'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useResourcePanelController } from '@/app/workspace/[workspaceId]/home/hooks/use-resource-panel'

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

vi.mock('@/app/workspace/[workspaceId]/providers/feature-flags-provider', () => ({
  useFeatureFlag: () => false,
}))

vi.mock('next/navigation', () => navigationMocks)
vi.mock('@/lib/auth/auth-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/auth-client')>()),
  useSession: () => ({ data: { user: { id: 'test-viewer' } } }),
}))
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

import { ApiClientError } from '@/lib/api/client/errors'
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
import { createSearchResource } from '@/lib/mothership/resources/search'
import { getChatResourceSelectionId } from '@/lib/mothership/resources/types'
import {
  executeRunToolOnClient,
  isRunToolActiveForId,
  stopRunToolExecutions,
} from '@/lib/mothership/tools/client/run-tool-execution'
import { getQueryClient } from '@/app/_shell/providers/get-query-client'
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
  navigationMocks.usePathname.mockReturnValue(`/workspace/ws-1/chat/${chatId}`)
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
      navigationMocks.usePathname.mockReturnValue(`/workspace/ws-1/chat/${chatId}`)
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
  it('hydrates a saved Plan conversation on a cold mount without posting', async () => {
    const messages = [
      {
        id: 'user-plan',
        role: 'user',
        content: 'Investigate incidents',
        requestMode: 'plan',
        timestamp: '2026-09-23T00:19:00Z',
      },
      {
        id: 'assistant-plan',
        role: 'assistant',
        content: 'Saved investigation',
        requestMode: 'plan',
        timestamp: '2026-09-23T00:36:00Z',
      },
    ]
    mockRequestJson.mockResolvedValue({
      success: true,
      chat: {
        id: 'chat-plan',
        mode: 'plan',
        title: 'Incident triage',
        messages,
        activeStreamId: null,
        resources: [],
      },
    })
    const { getResult } = renderUseChatInChat('chat-plan')
    await waitFor(() => !getResult().isChatHistoryPending)
    expect(getResult().messages.map(({ id, content }) => ({ id, content }))).toEqual(
      messages.map(({ id, content }) => ({ id, content }))
    )
    expect(getResult().error).toBeNull()
    expect(state.postBodies).toHaveLength(0)
  })

  it('exposes a history load failure and clears it after a successful retry', async () => {
    mockRequestJson.mockRejectedValue(new Error('History request failed'))
    const { getResult } = renderUseChatInChat('chat-unavailable')
    await waitFor(() => !getResult().isChatHistoryPending)
    expect(getResult().error).toBe('Failed to load chat history. Refresh to try again.')
    mockRequestJson.mockResolvedValue({
      success: true,
      chat: {
        id: 'chat-unavailable',
        mode: 'plan',
        title: null,
        messages: [],
        activeStreamId: null,
        resources: [],
      },
    })
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: mothershipChatKeys.detail('chat-unavailable') })
    })
    await waitFor(() => getResult().error === null)
    expect(state.postBodies).toHaveLength(0)
  })

  it.each([
    ['agent', 'assistant'],
    ['assistant', 'agent'],
  ] as const)('uses the selected %s harness over persisted %s mode', async (selected, saved) => {
    const { getResult } = renderUseChatInChat(
      'chat-a',
      { id: 'chat-a', title: 'Existing conversation', mode: saved, messages: [], resources: [] },
      undefined,
      undefined,
      selected
    )
    await act(async () => {
      void getResult().sendMessage('Continue here')
    })
    await waitFor(() => state.postBodies.length === 1)
    expect(state.postBodies[0]).toMatchObject({ chatId: 'chat-a', mode: selected })
  })

  it('retains an admitted Home chat through resource URL updates, mode changes and follow-ups', async () => {
    const chatId = '11111111-1111-4111-8111-111111111111'
    const organizationId = '22222222-2222-4222-8222-222222222222'
    window.history.replaceState(null, '', `/o/${organizationId}/home`)
    navigationMocks.usePathname.mockImplementation(() => window.location.pathname)
    const search = createSearchResource({
      query: 'Orion',
      scope: { kind: 'organization', organizationId },
    })
    const history: MothershipChatHistory = {
      id: chatId,
      mode: 'assistant',
      title: 'Orion conversation',
      messages: [],
      resources: [],
      activeStreamId: null,
    }
    mockRequestJson.mockImplementation((contract) => {
      if (contract.path === '/api/mothership/chat/resources') {
        history.resources = [search]
        return Promise.resolve({ success: true })
      }
      return Promise.resolve({ chat: structuredClone(history) })
    })
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/mothership/chat' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body))
        state.postBodies.push(body)
        history.messages.push({
          id: body.userMessageId,
          role: 'user',
          content: body.message,
          requestMode: body.mode,
        })
        return new Response('', {
          headers: { 'Content-Type': 'text/event-stream', 'x-mothership-chat-id': chatId },
        })
      }
      return fetchStub(input, init)
    })
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const root = createRoot(document.createElement('div'))
    mountedRoots.push(root)
    let result: ReturnType<typeof useChat> | undefined
    let mode: 'agent' | 'assistant' = 'assistant'
    function Probe() {
      const controller = useResourcePanelController()
      result = useChat({ organizationId }, undefined, {
        requestMode: mode,
        activeResourceState: controller.activeResourceState,
        onResourceEvent: controller.onResourceEvent,
      })
      return null
    }
    const render = () =>
      root.render(
        <NuqsTestingAdapter
          hasMemory
          onUrlUpdate={({ queryString }) =>
            window.history.replaceState(null, '', `${window.location.pathname}${queryString}`)
          }
        >
          <QueryClientProvider client={queryClient}>
            <Probe />
          </QueryClientProvider>
        </NuqsTestingAdapter>
      )
    const current = () => {
      if (!result) throw new Error('Hook not mounted')
      return result
    }
    await act(async () => render())
    await act(async () => current().sendMessage('Find Orion'))
    await waitFor(() => !current().isSending && current().resolvedChatId === chatId)
    await act(async () => current().addResource(search))
    await waitFor(() => current().resources.length === 1)
    await act(async () => {
      mode = 'agent'
      render()
    })
    await act(async () => current().sendMessage('Follow up in Build'))
    await waitFor(() => !current().isSending)
    await act(async () => {
      mode = 'assistant'
      render()
    })
    await act(async () =>
      current().sendMessage('Inspect this image', [
        { id: 'image', key: 'image-key', filename: 'image.png', media_type: 'image/png', size: 1 },
      ])
    )
    await waitFor(
      () =>
        !current().isSending &&
        current().messages.filter((message) => message.role === 'user').length === 3
    )
    expect(state.postBodies).toHaveLength(3)
    expect(state.postBodies[0]).toMatchObject({ createNewChat: true })
    expect(state.postBodies.slice(1)).toEqual([
      expect.objectContaining({ chatId, createNewChat: false, mode: 'agent' }),
      expect.objectContaining({
        chatId,
        createNewChat: false,
        mode: 'assistant',
        fileAttachments: [expect.objectContaining({ filename: 'image.png' })],
      }),
    ])
    expect(current().resources).toEqual([search])
    expect(window.location.pathname).toBe(`/o/${organizationId}/chat/${chatId}`)
  })

  it('sends and recovers an image-only organization turn', async () => {
    navigationMocks.usePathname.mockReturnValue('/o/org-1/home')
    const { getResult, unmount } = renderUseChat({ organizationId: 'org-1' })
    const attachments = [
      {
        id: 'image-a',
        key: 'image-key',
        filename: 'screenshot.png',
        media_type: 'image/png',
        size: 5,
      },
    ]
    await act(async () => {
      void getResult().sendMessage('', attachments)
    })
    await waitFor(() => state.postBodies.length === 1)
    expect(state.postBodies[0]).toMatchObject({
      organizationId: 'org-1',
      mode: 'assistant',
      message: '',
      fileAttachments: attachments,
    })
    expect(state.postBodies[0]).not.toHaveProperty('workspaceId')
    unmount()
    await waitFor(() => window.localStorage.getItem('sim_mothership_handoff') !== null)
    expect(MothershipHandoffStorage.consume({ organizationId: 'org-1' })).toMatchObject({
      message: '',
      fileAttachments: attachments,
    })
  })

  it('preserves Home agent intent through an org send, queue and unmount recovery', async () => {
    navigationMocks.usePathname.mockReturnValue('/o/org-1/home')
    const { getResult, unmount } = renderUseChat({ organizationId: 'org-1' }, 'agent')
    await act(async () => {
      void getResult().sendMessage('Update the workflow')
    })
    await waitFor(() => state.postBodies.length === 1)
    expect(state.postBodies[0]).toMatchObject({ organizationId: 'org-1', mode: 'agent' })
    expect(state.postBodies[0]).not.toHaveProperty('workspaceId')
    await act(async () => {
      void getResult().sendMessage('Then verify it')
    })
    expect(getResult().messageQueue[0]).toMatchObject({
      content: 'Then verify it',
      requestMode: 'agent',
    })
    unmount()
    await waitFor(() => window.localStorage.getItem('sim_mothership_handoff') !== null)
    expect(MothershipHandoffStorage.consume({ organizationId: 'org-1' })).toMatchObject({
      requestMode: 'agent',
    })
  })

  it('sends and recovers an organization turn without adding workspace scope', async () => {
    navigationMocks.usePathname.mockReturnValue('/o/org-1/home')
    const { getResult, unmount } = renderUseChat({ organizationId: 'org-1' })
    await act(async () => {
      void getResult().sendMessage('Find the policy')
    })
    await waitFor(() => state.postBodies.length === 1)
    expect(state.postBodies[0]).toMatchObject({ organizationId: 'org-1', mode: 'assistant' })
    expect(state.postBodies[0]).not.toHaveProperty('workspaceId')
    unmount()
    await waitFor(() => window.localStorage.getItem('sim_mothership_handoff') !== null)
    expect(MothershipHandoffStorage.consume('org-1')).toBeNull()
    expect(MothershipHandoffStorage.consume({ organizationId: 'org-1' })).toMatchObject({
      message: 'Find the policy',
      resumeUserMessageId: state.postBodies[0].userMessageId,
    })
  })

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchStub)
    navigationMocks.usePathname.mockReturnValue('/workspace/ws-1/home')
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
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it.each(['workspace', 'organization'] as const)(
    'preserves a %s send stopped during preparation and keeps the next send in that chat',
    async (scope) => {
      if (scope === 'organization') navigationMocks.usePathname.mockReturnValue('/o/org-1/home')
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

  it.each([
    { options: undefined, expectedSource: 'drive' },
    { options: { assistantSearch: { source: 'slack' } }, expectedSource: 'slack' },
  ])(
    'preserves queued assistant mode when edited with $options',
    async ({ options, expectedSource }) => {
      useMothershipQueueStore.setState({
        queues: {
          'chat-a': [
            {
              id: 'queued-question',
              content: 'Find the policy',
              requestMode: 'assistant',
              assistantSearch: { source: 'drive' },
            },
          ],
        },
        editing: { 'chat-a': 'queued-question' },
      })
      const { getResult } = renderUseChatInChat('chat-a')

      await act(async () => {
        await getResult().sendMessage('Find the updated policy', undefined, undefined, options)
      })
      await waitFor(() => state.postBodies.length === 1)

      expect(state.postBodies[0]).toMatchObject({
        message: 'Find the updated policy',
        mode: 'assistant',
        assistantSearch: { source: expectedSource },
      })
      expect(useMothershipQueueStore.getState().editing['chat-a']).toBeUndefined()
    }
  )
  it('sends the observed table view for both an open panel and an explicit table mention', async () => {
    const history: MothershipChatHistory = {
      id: 'chat-table-view',
      title: 'Leads',
      messages: [],
      activeStreamId: null,
      resources: [{ type: 'table', id: 'table-1', title: 'Leads', viewId: 'original-view' }],
    }
    const { getResult } = renderUseChatInChat(history.id, history)
    await waitFor(() => getResult().resources.length === 1)
    const currentView = { viewId: 'all-view', filter: null, sort: null }
    await act(async () => {
      getResult().setTableViewContext('table-1', currentView)
      void getResult().sendMessage('Summarize this view', undefined, [
        { kind: 'table', tableId: 'table-1', label: 'Leads' },
      ])
    })
    await waitFor(() => state.postBodies.length === 1)
    expect(state.postBodies[0]).toMatchObject({
      resourceAttachments: [{ id: 'table-1', viewId: 'original-view', currentView }],
      contexts: [{ kind: 'table', tableId: 'table-1', currentView }],
    })
    expect(
      getResult().messages.find((message) => message.role === 'user')?.contexts?.[0]
    ).toMatchObject({ viewId: 'all-view' })
  })

  it.each(['cached', 'delayed'] as const)(
    'preserves the URL-selected resource while %s panels hydrate',
    async (loading) => {
      const history: MothershipChatHistory = {
        id: 'chat-selection',
        mode: 'agent',
        title: 'Resources',
        messages: [],
        activeStreamId: null,
        resources: [
          { type: 'table', id: 'selected-table', title: 'Contacts' },
          { type: 'knowledgebase', id: 'last-resource', title: 'Knowledge' },
        ],
      }
      const pending = Promise.withResolvers<{ chat: MothershipChatHistory }>()
      if (loading === 'delayed') mockRequestJson.mockReturnValue(pending.promise)
      const { getResult } = renderUseChatInChat(
        history.id,
        loading === 'cached' ? history : undefined,
        undefined,
        'selected-table'
      )
      if (loading === 'delayed') await act(async () => pending.resolve({ chat: history }))
      await waitFor(() => getResult().resources.length === 2)
      expect(getResult().activeResourceId).toBe('selected-table')
    }
  )

  it.each([true, false])(
    'restores one evidence tab from a saved search and sources pair when live search is %s',
    async (liveEnterpriseSearch) => {
      const shape = resolveDeploymentShape()
      seedDeploymentShape({
        ...shape,
        features: { ...shape.features, liveEnterpriseSearch },
      })
      const search = createSearchResource({
        query: 'evidence',
        scope: { kind: 'workspace', workspaceId: 'ws-1' },
      })
      const sources = {
        type: 'sources' as const,
        id: 'cited-sources',
        title: 'Sources',
        sources: { messageId: 'answer-1' },
      }
      const history: MothershipChatHistory = {
        id: 'chat-saved-evidence',
        mode: 'assistant',
        title: 'Evidence',
        messages: [],
        activeStreamId: null,
        resources: [search, sources],
      }
      let storedResources = [search, sources]
      mockRequestJson.mockImplementation((contract, input) => {
        if (contract.path === '/api/mothership/chat/resources') {
          if (contract.method === 'DELETE') {
            expect(input.body).toMatchObject({
              chatId: history.id,
              resourceType: 'search',
              resourceId: search.id,
              workspaceId: search.workspaceId,
            })
            storedResources = [sources]
          }
          return Promise.resolve({ success: true })
        }
        return Promise.resolve({ chat: { ...history, resources: storedResources } })
      })
      const { getResult } = renderUseChatInChat(
        history.id,
        history,
        undefined,
        undefined,
        'assistant'
      )
      await waitFor(() => getResult().resources.length === (liveEnterpriseSearch ? 1 : 2))
      expect(getResult().resources).toEqual(liveEnterpriseSearch ? [sources] : [search, sources])
      expect(getResult().activeResourceId).toBe(sources.id)
      if (liveEnterpriseSearch) {
        await waitFor(() => storedResources.length === 1)
      } else {
        expect(storedResources).toHaveLength(2)
      }
    }
  )

  it('preserves an explicitly selected saved Search panel after a citation-free turn', async () => {
    const shape = resolveDeploymentShape()
    seedDeploymentShape({ ...shape, features: { ...shape.features, liveEnterpriseSearch: true } })
    const search = createSearchResource({
      query: 'saved query',
      scope: { kind: 'workspace', workspaceId: 'ws-1' },
    })
    const history: MothershipChatHistory = {
      id: 'saved-search-selection',
      mode: 'assistant',
      title: 'Saved search',
      messages: [],
      activeStreamId: null,
      resources: [search],
    }
    const { getResult } = renderUseChatInChat(
      history.id,
      history,
      undefined,
      getChatResourceSelectionId(search),
      'assistant'
    )
    await waitFor(() => getResult().resources.length === 1)
    expect(getResult().resources).toEqual([search])
    expect(getResult().activeResourceId).toBe(getChatResourceSelectionId(search))
    expect(mockRequestJson.mock.calls.some(([contract]) => contract.method === 'DELETE')).toBe(
      false
    )
  })

  it('discards a recovered interim search without opening a panel after a citation-free turn', async () => {
    const shape = resolveDeploymentShape()
    seedDeploymentShape({ ...shape, features: { ...shape.features, liveEnterpriseSearch: true } })
    const search = createSearchResource({
      query: 'interim query',
      scope: { kind: 'workspace', workspaceId: 'ws-1' },
    })
    const history: MothershipChatHistory = {
      id: 'recovered-interim-search',
      mode: 'assistant',
      title: 'Recovered search',
      messages: [],
      activeStreamId: null,
      resources: [search],
    }
    let storedResources = [search]
    mockRequestJson.mockImplementation((contract) => {
      if (contract.path === '/api/mothership/chat/resources') {
        if (contract.method === 'DELETE') storedResources = []
        return Promise.resolve({ success: true })
      }
      return Promise.resolve({ chat: { ...history, resources: storedResources } })
    })
    const { getResult } = renderUseChatInChat(
      history.id,
      history,
      undefined,
      undefined,
      'assistant'
    )
    await waitFor(() => storedResources.length === 0)
    expect(getResult().resources).toEqual([])
    expect(getResult().activeResourceId).toBeNull()
  })

  it('hydrates changed resource addresses and an empty saved panel list', async () => {
    const history: MothershipChatHistory = {
      id: 'chat-resource-address',
      title: 'Invoices',
      messages: [],
      activeStreamId: null,
      resources: [{ type: 'table', id: 'table-1', title: 'Invoices', viewId: 'all-invoices' }],
    }
    const { getResult } = renderUseChatInChat(history.id, history)
    await waitFor(() => getResult().resources[0]?.viewId === 'all-invoices')
    await act(async () => {
      queryClient.setQueryData(mothershipChatKeys.detail(history.id), {
        ...history,
        resources: [{ ...history.resources[0], viewId: 'overdue-invoices' }],
      })
    })
    await waitFor(() => getResult().resources[0]?.viewId === 'overdue-invoices')
    await act(async () => {
      queryClient.setQueryData(mothershipChatKeys.detail(history.id), { ...history, resources: [] })
    })
    await waitFor(() => getResult().resources.length === 0)
  })

  it.each(['initial', 'refetch'] as const)(
    'keeps Search results when a pre-save %s response arrives after the resource write',
    async (load) => {
      const history: MothershipChatHistory = {
        id: 'chat-search-save',
        mode: 'assistant',
        title: 'Search',
        messages: [],
        activeStreamId: null,
        resources: [],
      }
      const oldHistory = Promise.withResolvers<{ chat: MothershipChatHistory }>()
      const savedResource = Promise.withResolvers<{ success: true }>()
      const search = createSearchResource({
        query: 'Orion',
        scope: { kind: 'workspace', workspaceId: '11111111-1111-4111-8111-111111111111' },
      })
      let historyReads = 0
      mockRequestJson.mockImplementation((contract) => {
        if (contract.path === '/api/mothership/chat/resources') return savedResource.promise
        return ++historyReads === 1
          ? oldHistory.promise
          : Promise.resolve({ chat: { ...history, title: 'Hydrated Search', resources: [search] } })
      })
      const { getResult } = renderUseChatInChat(
        history.id,
        load === 'initial' ? undefined : history
      )
      if (load === 'refetch') {
        await act(async () => {
          void queryClient.refetchQueries({ queryKey: mothershipChatKeys.detail(history.id) })
        })
      }
      await act(async () => getResult().addResource(search))
      expect(getResult().resources).toEqual([search])
      await act(async () => savedResource.resolve({ success: true }))
      await act(async () => oldHistory.resolve({ chat: history }))
      await act(async () => {
        await sleep(20)
      })
      expect(getResult().resources).toEqual([search])
      expect(getResult().isChatHistoryPending).toBe(false)
      expect(
        queryClient.getQueryData<MothershipChatHistory>(mothershipChatKeys.detail(history.id))
          ?.title
      ).toBe('Hydrated Search')
      expect(queryClient.getQueryState(mothershipChatKeys.detail(history.id))?.error).toBeNull()
    }
  )

  it('keeps a closed Search tab absent through an in-flight add and delayed delete', async () => {
    const search = createSearchResource({
      query: 'Orion',
      scope: { kind: 'workspace', workspaceId: '11111111-1111-4111-8111-111111111111' },
    })
    const history: MothershipChatHistory = {
      id: 'chat-close-search',
      mode: 'assistant',
      title: 'Search',
      messages: [],
      activeStreamId: null,
      resources: [],
    }
    const added = Promise.withResolvers<{ success: true }>()
    const deleted = Promise.withResolvers<{ success: true }>()
    const staleRead = Promise.withResolvers<{ chat: MothershipChatHistory }>()
    let deleteStarted = false
    let historyReads = 0
    mockRequestJson.mockImplementation((contract) => {
      if (contract.path === '/api/mothership/chat/resources') {
        if (contract.method === 'DELETE') {
          deleteStarted = true
          return deleted.promise
        }
        return added.promise
      }
      return ++historyReads === 1 ? staleRead.promise : Promise.resolve({ chat: history })
    })
    const { getResult } = renderUseChatInChat(history.id, history)
    await act(async () => getResult().addResource(search))
    await act(async () => getResult().removeResource(search.type, search.id, search.workspaceId))
    expect(getResult().resources).toEqual([])
    await act(async () => added.resolve({ success: true }))
    await waitFor(() => deleteStarted && historyReads === 1)
    await act(async () => staleRead.resolve({ chat: { ...history, resources: [search] } }))
    await act(async () => {
      await sleep(20)
    })
    expect(getResult().resources).toEqual([])
    expect(
      queryClient.getQueryData<MothershipChatHistory>(mothershipChatKeys.detail(history.id))
        ?.resources
    ).toEqual([search])
    expect(queryClient.getQueryState(mothershipChatKeys.detail(history.id))?.error).toBeNull()
    await act(async () => deleted.resolve({ success: true }))
    await act(async () => {
      await sleep(20)
    })
    expect(getResult().resources).toEqual([])
    expect(
      queryClient.getQueryData<MothershipChatHistory>(mothershipChatKeys.detail(history.id))
        ?.resources
    ).toEqual([])
  })

  it('keeps a newer search query while the prior query save refreshes history', async () => {
    const search = createSearchResource({
      query: 'Orion',
      scope: { kind: 'workspace', workspaceId: '11111111-1111-4111-8111-111111111111' },
    })
    const latest = createSearchResource({ ...search.search!, query: 'release blockers' })
    const history: MothershipChatHistory = {
      id: 'chat-search-update',
      mode: 'assistant',
      title: 'Search',
      messages: [],
      activeStreamId: null,
      resources: [],
    }
    const first = Promise.withResolvers<{ success: true }>()
    const second = Promise.withResolvers<{ success: true }>()
    let writes = 0
    let reads = 0
    mockRequestJson.mockImplementation((contract) => {
      if (contract.path === '/api/mothership/chat/resources')
        return ++writes === 1 ? first.promise : second.promise
      return Promise.resolve({ chat: { ...history, resources: [++reads === 1 ? search : latest] } })
    })
    const { getResult } = renderUseChatInChat(history.id, history)
    await act(async () => getResult().addResource(search))
    await act(async () => getResult().addResource(latest))
    await act(async () => first.resolve({ success: true }))
    await waitFor(() => writes === 2 && reads === 1)
    await act(async () => {
      await sleep(20)
    })
    expect(getResult().resources).toEqual([latest])
    await act(async () => second.resolve({ success: true }))
    await act(async () => {
      await sleep(20)
    })
    expect(getResult().resources).toEqual([latest])
    expect(reads).toBeGreaterThanOrEqual(2)
    expect(
      queryClient.getQueryData<MothershipChatHistory>(mothershipChatKeys.detail(history.id))
        ?.resources
    ).toEqual([latest])
    expect(queryClient.getQueryState(mothershipChatKeys.detail(history.id))?.error).toBeNull()
  })

  it.each(['during', 'after'] as const)(
    'preserves a tab reorder when the add-triggered history arrives %s the reorder write',
    async (arrival) => {
      const table = { type: 'table' as const, id: 'table-order', title: 'Contacts' }
      const refreshedTable = { ...table, title: 'Updated contacts' }
      const search = createSearchResource({
        query: 'Orion',
        scope: { kind: 'workspace', workspaceId: '11111111-1111-4111-8111-111111111111' },
      })
      const history: MothershipChatHistory = {
        id: 'chat-resource-reorder',
        mode: 'agent',
        title: 'Search',
        messages: [],
        activeStreamId: null,
        resources: [table],
      }
      const added = Promise.withResolvers<{ success: true }>()
      const reordered = Promise.withResolvers<{ success: true }>()
      const staleRead = Promise.withResolvers<{ chat: MothershipChatHistory }>()
      let reorderStarted = false
      let reads = 0
      mockRequestJson.mockImplementation((contract) => {
        if (contract.path === '/api/mothership/chat/resources') {
          if (contract.method === 'PATCH') {
            reorderStarted = true
            return reordered.promise
          }
          return added.promise
        }
        return ++reads === 1
          ? staleRead.promise
          : Promise.resolve({ chat: { ...history, resources: [search, refreshedTable] } })
      })
      const { getResult } = renderUseChatInChat(history.id, history)
      await act(async () => getResult().addResource(search))
      await act(async () => getResult().reorderResources([search, table]))
      await act(async () => added.resolve({ success: true }))
      await waitFor(() => reorderStarted && reads === 1)
      if (arrival === 'after') {
        await act(async () => reordered.resolve({ success: true }))
        await waitFor(() => reads === 2)
      }
      await act(async () =>
        staleRead.resolve({ chat: { ...history, resources: [refreshedTable, search] } })
      )
      await act(async () => {
        await sleep(20)
      })
      expect(queryClient.getQueryState(mothershipChatKeys.detail(history.id))?.error).toBeNull()

      expect(getResult().resources).toEqual([search, refreshedTable])
      if (arrival === 'during') {
        await act(async () => reordered.resolve({ success: true }))
        await waitFor(() => reads === 2)
      }
      expect(getResult().resources).toEqual([search, refreshedTable])
    }
  )

  it.each(
    [false, true].flatMap((hasOutput) =>
      (['assistant', 'user', 'neither'] as const).map((retained) => ({ hasOutput, retained }))
    )
  )(
    'keeps the live turn through lagging resource history (output: $hasOutput, retained: $retained)',
    async ({ hasOutput, retained }) => {
      state.postBehavior = 'task'
      const history: MothershipChatHistory = {
        id: 'chat-lagging-user',
        mode: 'assistant',
        title: 'Search',
        messages: [],
        activeStreamId: null,
        resources: [],
      }
      const search = createSearchResource({
        query: 'Orion acceptance policy',
        scope: { kind: 'workspace', workspaceId: '11111111-1111-4111-8111-111111111111' },
      })
      const staleHistory = Promise.withResolvers<{ chat: MothershipChatHistory }>()
      let historyReads = 0
      mockRequestJson.mockImplementation((contract) => {
        if (contract.path === '/api/mothership/chat/resources')
          return Promise.resolve({ success: true })
        historyReads++
        return staleHistory.promise
      })
      if (!hasOutput) {
        vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
          if (String(input) === '/api/mothership/chat' && init?.method === 'POST') {
            state.postBodies.push(JSON.parse(String(init.body)))
            return new Response(new ReadableStream<Uint8Array>(), {
              headers: { 'Content-Type': 'text/event-stream', 'x-mothership-chat-id': history.id },
            })
          }
          return fetchStub(input, init)
        })
      }
      const { getResult, navigate } = renderUseChatInChat(history.id, history)
      await act(async () => {
        void getResult().sendMessage('Orion acceptance policy')
      })
      await waitFor(() => state.postBodies.length === 1 && getResult().isSending)
      if (hasOutput) {
        await waitFor(() =>
          getResult().messages.some(
            (message) => message.role === 'assistant' && message.contentBlocks?.length
          )
        )
      }
      const sentUser = queryClient
        .getQueryData<MothershipChatHistory>(mothershipChatKeys.detail(history.id))!
        .messages.find((message) => message.role === 'user')!
      const liveAssistant = queryClient
        .getQueryData<MothershipChatHistory>(mothershipChatKeys.detail(history.id))!
        .messages.find((message) => message.role === 'assistant')!
      await act(async () => getResult().addResource(search))
      await waitFor(() => historyReads > 0)
      const beforeHistoryRefresh = getResult()
      await act(async () =>
        staleHistory.resolve({
          chat: {
            ...history,
            title: 'Hydrated during run',
            activeStreamId: sentUser.id,
            messages:
              retained === 'assistant' ? [liveAssistant] : retained === 'user' ? [sentUser] : [],
            resources: [search],
          },
        })
      )
      await waitFor(
        () =>
          getResult() !== beforeHistoryRefresh &&
          queryClient.getQueryData<MothershipChatHistory>(mothershipChatKeys.detail(history.id))
            ?.title === 'Hydrated during run'
      )
      expect(getResult().messages.map((message) => message.id)).toEqual([
        sentUser.id,
        liveAssistant.id,
      ])
      expect(getResult().messages[0].content).toBe('Orion acceptance policy')
      expect(getResult().isSending).toBe(true)
      expect(getResult().messages[1].content).toBe(liveAssistant.content)
      if (hasOutput) expect(getResult().messages[1].contentBlocks).toHaveLength(1)
      await act(async () =>
        queryClient.setQueryData(mothershipChatKeys.detail(history.id), {
          ...history,
          activeStreamId: sentUser.id,
          messages: [sentUser, liveAssistant],
          resources: [search],
        })
      )
      expect(getResult().messages.filter((message) => message.id === sentUser.id)).toHaveLength(1)
      await act(async () => navigate('chat-other', { ...history, id: 'chat-other', messages: [] }))
      await waitFor(() => getResult().messages.length === 0)
      expect(getResult().messages.some((message) => message.id === sentUser.id)).toBe(false)
    }
  )

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

  it('captures Search levels independently for each queued turn and omits it from Build requests', async () => {
    state.postBehavior = 'task'
    const { getResult } = renderUseChat({ organizationId: 'org-a' }, 'assistant')
    await act(async () => {
      void getResult().sendMessage('Fast search', undefined, undefined, {
        requestMode: 'assistant',
        assistantSearchLevel: 'fast',
      })
    })
    await waitFor(() => state.postBodies.length === 1)
    expect(state.postBodies[0]).toEqual(
      expect.objectContaining({ mode: 'assistant', assistantSearchLevel: 'fast' })
    )
    expect(state.postBodies[0]).not.toHaveProperty('modelSelection')
    expect(state.postBodies[0]).not.toHaveProperty('effort')
    await act(async () => {
      void getResult().sendMessage('Astra search', undefined, undefined, {
        requestMode: 'assistant',
        assistantSearchLevel: 'adaptive',
      })
    })
    await act(async () => {
      void getResult().sendMessage('Next Max search', undefined, undefined, {
        requestMode: 'assistant',
        assistantSearchLevel: 'max',
      })
    })
    expect(allQueuedMessages().map((message) => message.assistantSearchLevel)).toEqual([
      'adaptive',
      'max',
    ])
    await act(async () => {
      void getResult().sendNow(allQueuedMessages()[0].id)
    })
    await waitFor(() => state.postBodies.length === 2)
    expect(state.postBodies[1]).toEqual(
      expect.objectContaining({ mode: 'assistant', message: 'Astra search' })
    )
    expect(state.postBodies[1]).toHaveProperty('assistantSearchLevel', 'adaptive')
    expect(state.postBodies[1]).not.toHaveProperty('modelSelection')
    expect(state.postBodies[1]).not.toHaveProperty('effort')
    await act(async () => {
      void getResult().sendNow(allQueuedMessages()[0].id)
    })
    await waitFor(() => state.postBodies.length === 3)
    expect(state.postBodies[2]).toEqual(
      expect.objectContaining({
        mode: 'assistant',
        assistantSearchLevel: 'max',
        message: 'Next Max search',
      })
    )
    expect(state.postBodies[2]).not.toHaveProperty('modelSelection')
    expect(state.postBodies[2]).not.toHaveProperty('effort')
  })

  it('keeps each queued harness and attachment payload when the composer changes mode mid-stream', async () => {
    state.postBehavior = 'task'
    const { getResult, selectMode } = renderUseChat({ organizationId: 'org-a' }, 'agent')
    await act(async () => {
      void getResult().sendMessage('Current Build response')
    })
    await waitFor(() => state.postBodies.length === 1)
    selectMode('assistant')
    expect(getResult().isSending).toBe(true)
    expect(state.postBodies).toHaveLength(1)
    await act(async () => {
      void getResult().sendMessage('Queued search')
    })
    selectMode('agent')
    const attachments = [
      {
        id: 'file-a',
        key: 'attachment-key',
        filename: 'notes.txt',
        media_type: 'text/plain',
        size: 4,
      },
    ]
    const contexts = [{ kind: 'skill' as const, skillId: 'builtin-research', label: 'research' }]
    await act(async () => {
      void getResult().sendMessage('Queued build', attachments, contexts)
    })
    expect(allQueuedMessages().map((message) => message.requestMode)).toEqual([
      'assistant',
      'agent',
    ])
    selectMode('assistant')
    await act(async () => {
      void getResult().sendNow(allQueuedMessages()[0].id)
    })
    await waitFor(() => state.postBodies.length === 2)
    expect(state.postBodies[1]).toEqual(
      expect.objectContaining({ mode: 'assistant', message: 'Queued search' })
    )
    expect(state.postBodies[1]).not.toHaveProperty('modelSelection')
    await act(async () => {
      void getResult().sendNow(allQueuedMessages()[0].id)
    })
    await waitFor(() => state.postBodies.length === 3)
    expect(state.postBodies[2]).toEqual(
      expect.objectContaining({
        mode: 'agent',
        message: 'Queued build',
        fileAttachments: attachments,
        contexts,
      })
    )
  })

  it('leaves default Search routing entirely server-selected', async () => {
    const { getResult } = renderUseChat({ organizationId: 'org-a' }, 'assistant')
    await act(async () => {
      void getResult().sendMessage('Default Astra search')
    })
    await waitFor(() => state.postBodies.length === 1)
    expect(state.postBodies[0]).not.toHaveProperty('assistantSearchLevel')
    expect(state.postBodies[0]).not.toHaveProperty('modelSelection')
    expect(state.postBodies[0]).not.toHaveProperty('effort')
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

  it('never forwards Search Fast on a Build request', async () => {
    const { getResult } = renderUseChat({ organizationId: 'org-a' }, 'agent')
    await act(async () => {
      void getResult().sendMessage('Build', undefined, undefined, {
        requestMode: 'agent',
        assistantSearchLevel: 'fast',
      })
    })
    await waitFor(() => state.postBodies.length === 1)
    expect(state.postBodies[0]).not.toHaveProperty('assistantSearchLevel')
    expect(state.postBodies[0]).toHaveProperty('modelSelection')
    expect(state.postBodies[0]).toHaveProperty('effort')
  })

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

  it('preserves the visible workflow watch while Stop sends only identifiers', async () => {
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
    expect(state.stopBodies[0]).toEqual({
      chatId: 'chat-a',
      streamId: state.postBodies[0].userMessageId,
    })
    const task = getResult()
      .messages.flatMap((message) => message.contentBlocks ?? [])
      .find((block) => block.type === 'task')?.task
    expect(task?.taskId).toBe('watch-1')
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

  it('restores the last edited table view after switching away and back', async () => {
    const chatId = 'chat-with-table'
    const sharedQueryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const initialHistory: MothershipChatHistory = {
      id: chatId,
      title: 'Table chat',
      messages: [],
      activeStreamId: null,
      resources: [{ type: 'table', id: 'table-1', title: 'Invoices' }],
    }
    sharedQueryClient.setQueryData(mothershipChatKeys.detail(chatId), initialHistory)

    const firstSurface = renderUseChatInChat(chatId, undefined, sharedQueryClient)
    await waitFor(() => firstSurface.getResult().resources.length === 1)

    act(() => {
      firstSurface.getResult().addResource({
        type: 'table',
        id: 'table-1',
        title: 'Invoices',
        viewId: 'view-edited',
      })
    })
    await waitFor(() => firstSurface.getResult().resources[0]?.viewId === 'view-edited')
    firstSurface.unmount()

    const restoredSurface = renderUseChatInChat(chatId, undefined, sharedQueryClient)
    await waitFor(() => restoredSurface.getResult().resources.length === 1)

    expect(restoredSurface.getResult().resources[0]?.viewId).toBe('view-edited')
  })

  it.each(['foreign-workspace', 'unavailable', 'deleted'] as const)(
    'verifies a workflow absent from the chat workspace before removing it: %s',
    async (outcome) => {
      getQueryClient().clear()
      mockRequestJson.mockImplementation(async (contract: AnyApiRouteContract) => {
        if (contract.path === '/api/workflows') return { data: [] }
        if (contract.path === '/api/workflows/[id]') {
          if (outcome === 'foreign-workspace')
            return { data: { id: 'foreign', workspaceId: 'another-workspace' } }
          throw new ApiClientError({
            status: outcome === 'deleted' ? 404 : 503,
            message: 'Unavailable',
            body: {},
          })
        }
        return { chats: [] }
      })
      const surface = renderUseChatInChat('chat-with-foreign-workflow', {
        id: 'chat-with-foreign-workflow',
        title: 'Read another workflow',
        messages: [],
        activeStreamId: null,
        resources: [{ type: 'workflow', id: 'foreign', title: 'Other workspace workflow' }],
      })
      await waitFor(() =>
        mockRequestJson.mock.calls.some(([contract]) => contract.path === '/api/workflows/[id]')
      )
      if (outcome === 'deleted') await waitFor(() => surface.getResult().resources.length === 0)
      else {
        await act(async () => {
          await sleep(20)
        })
        expect(surface.getResult().resources.map((resource) => resource.id)).toEqual(['foreign'])
      }
      getQueryClient().clear()
    }
  )

  it('hydrates a table view change when resource identity and title stay the same', async () => {
    const chatId = 'chat-with-refetched-view'
    const sharedQueryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const initialHistory: MothershipChatHistory = {
      id: chatId,
      title: 'Table chat',
      messages: [],
      activeStreamId: null,
      resources: [{ type: 'table', id: 'table-1', title: 'Invoices' }],
    }
    sharedQueryClient.setQueryData(mothershipChatKeys.detail(chatId), initialHistory)

    const surface = renderUseChatInChat(chatId, undefined, sharedQueryClient)
    await waitFor(() => surface.getResult().resources.length === 1)

    act(() => {
      sharedQueryClient.setQueryData<MothershipChatHistory>(mothershipChatKeys.detail(chatId), {
        ...initialHistory,
        resources: [{ type: 'table', id: 'table-1', title: 'Invoices', viewId: 'view-refetched' }],
      })
    })

    await waitFor(() => surface.getResult().resources[0]?.viewId === 'view-refetched')
    expect(surface.getResult().resources[0]?.viewId).toBe('view-refetched')
  })
})
