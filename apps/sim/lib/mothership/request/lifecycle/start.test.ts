/**
 * @vitest-environment node
 */

import { propagation, trace } from '@opentelemetry/api'
import { W3CTraceContextPropagator } from '@opentelemetry/core'
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base'
import { resetDbChainMock, resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MothershipStreamV1CompletionStatus,
  MothershipStreamV1EventType,
} from '@/lib/mothership/generated/mothership-stream-v1'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const {
  runCopilotLifecycle,
  createRunSegment,
  updateRunStatus,
  resetBuffer,
  clearFilePreviewSessions,
  scheduleBufferCleanup,
  scheduleFilePreviewSessionCleanup,
  allocateCursor,
  appendEvent,
  cleanupAbortMarker,
  hasAbortMarker,
  registerActiveStream,
  releasePendingChatStream,
  unregisterActiveStream,
  fetchGo,
} = vi.hoisted(() => ({
  runCopilotLifecycle: vi.fn(),
  createRunSegment: vi.fn(),
  updateRunStatus: vi.fn(),
  resetBuffer: vi.fn(),
  clearFilePreviewSessions: vi.fn(),
  scheduleBufferCleanup: vi.fn(),
  scheduleFilePreviewSessionCleanup: vi.fn(),
  allocateCursor: vi.fn(),
  appendEvent: vi.fn(),
  cleanupAbortMarker: vi.fn(),
  hasAbortMarker: vi.fn(),
  registerActiveStream: vi.fn(),
  releasePendingChatStream: vi.fn(),
  unregisterActiveStream: vi.fn(),
  fetchGo: vi.fn(),
}))

const BILLING_ATTRIBUTION = {
  actorUserId: 'user-1',
  workspaceId: 'workspace-1',
  billedAccountUserId: 'owner-1',
  organizationId: 'org-1',
  billingEntity: { type: 'organization' as const, id: 'org-1' },
  billingPeriod: {
    start: '2026-07-01T00:00:00.000Z',
    end: '2026-08-01T00:00:00.000Z',
  },
  payerSubscription: null,
}

vi.mock('@/lib/mothership/request/session/abort', () => ({
  getLocalChatStreamLease: (chatId: string, streamId: string) => ({
    key: `copilot:chat-stream-lock:${chatId}`,
    value: `${streamId}\ncontroller`,
  }),
}))
vi.mock('@/lib/mothership/request/session/controller-lease', async (original) => ({
  ...(await original<typeof import('@/lib/mothership/request/session/controller-lease')>()),
  assertChatStreamLease: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/mothership/request/lifecycle/run', () => ({
  runCopilotLifecycle,
}))

vi.mock('@/lib/mothership/async-runs/repository', () => ({
  createRunSegment,
  updateRunStatus,
}))

let mockPublisherController: ReadableStreamDefaultController | null = null

vi.mock('@/lib/mothership/request/session', () => ({
  resetBuffer,
  clearFilePreviewSessions,
  scheduleBufferCleanup,
  scheduleFilePreviewSessionCleanup,
  allocateCursor,
  appendEvent,
  cleanupAbortMarker,
  hasAbortMarker,
  releasePendingChatStream,
  registerActiveStream,
  unregisterActiveStream,
  startAbortPoller: vi.fn().mockReturnValue(setInterval(() => {}, 999999)),
  isExplicitStopReason: (reason: unknown) => reason === 'user_stop:abortActiveStream',
  SSE_RESPONSE_HEADERS: {},
  StreamWriter: class {
    attach = vi.fn().mockImplementation((ctrl: ReadableStreamDefaultController) => {
      mockPublisherController = ctrl
    })
    startKeepalive = vi.fn()
    stopKeepalive = vi.fn()
    flush = vi.fn()
    close = vi.fn().mockImplementation(() => {
      try {
        mockPublisherController?.close()
      } catch {
        // already closed
      }
    })
    markDisconnected = vi.fn()
    publish = vi.fn().mockImplementation(async (event: Record<string, unknown>) => {
      appendEvent(event)
    })
    get clientDisconnected() {
      return false
    }
    get sawComplete() {
      return false
    }
  },
}))
vi.mock('@/lib/mothership/request/session/sse', () => ({
  SSE_RESPONSE_HEADERS: {},
}))

vi.mock('@/lib/mothership/chat-status', () => ({
  chatPubSub: null,
}))

vi.mock('@/lib/mothership/request/go/fetch', () => ({
  fetchGo,
}))

vi.mock('@/lib/mothership/server/agent-url', () => ({
  getMothershipBaseURL: vi.fn().mockResolvedValue('https://copilot.test'),
  getMothershipSourceEnvHeaders: vi.fn().mockReturnValue({}),
}))

import { createSSEStream, requestChatTitle } from './start'

async function drainStream(stream: ReadableStream) {
  const reader = stream.getReader()
  while (true) {
    const { done } = await reader.read()
    if (done) break
  }
}

afterAll(resetEnvFlagsMock)

describe('createSSEStream terminal error handling', () => {
  afterAll(() => {
    resetDbChainMock()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    setEnvFlags({ isHosted: false })
    fetchGo.mockResolvedValue(
      new Response(JSON.stringify({ title: 'Test title' }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      })
    )
    trace.setGlobalTracerProvider(new BasicTracerProvider())
    propagation.setGlobalPropagator(new W3CTraceContextPropagator())
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ title: 'Test title' }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        })
      )
    )
    resetBuffer.mockResolvedValue(undefined)
    clearFilePreviewSessions.mockResolvedValue(undefined)
    scheduleBufferCleanup.mockResolvedValue(undefined)
    scheduleFilePreviewSessionCleanup.mockResolvedValue(undefined)
    allocateCursor
      .mockResolvedValueOnce({ seq: 1, cursor: '1' })
      .mockResolvedValueOnce({ seq: 2, cursor: '2' })
      .mockResolvedValueOnce({ seq: 3, cursor: '3' })
    appendEvent.mockImplementation(async (event: unknown) => event)
    cleanupAbortMarker.mockResolvedValue(undefined)
    hasAbortMarker.mockResolvedValue(false)
    releasePendingChatStream.mockResolvedValue(undefined)
    createRunSegment.mockResolvedValue({ status: 'active' })
    updateRunStatus.mockResolvedValue(null)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('writes a terminal error event before close when orchestration returns success=false', async () => {
    runCopilotLifecycle.mockResolvedValue({
      success: false,
      error: 'resume failed',
      content: '',
      contentBlocks: [],
      toolCalls: [],
    })

    const stream = createSSEStream({
      requestPayload: { message: 'hello' },
      userId: 'user-1',
      streamId: 'stream-1',
      executionId: 'exec-1',
      runId: 'run-1',
      currentChat: null,
      isNewChat: false,
      message: 'hello',
      titleModel: 'gpt-5.4',
      requestId: 'req-1',
      orchestrateOptions: { userId: 'user-1' },
    })

    await drainStream(stream)

    expect(appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MothershipStreamV1EventType.error,
      })
    )
    await vi.waitFor(() => expect(scheduleBufferCleanup).toHaveBeenCalledWith('stream-1'))
  })

  it('finishes a pre-admission Stop as cancelled without calling the agent or title model', async () => {
    createRunSegment.mockResolvedValueOnce({ status: 'cancelled' })
    await drainStream(
      createSSEStream({
        requestPayload: { message: 'hello' },
        userId: 'user-1',
        streamId: 'stream-1',
        executionId: 'exec-1',
        runId: 'run-1',
        chatId: 'chat-1',
        workspaceId: 'workspace-1',
        currentChat: null,
        isNewChat: true,
        message: 'hello',
        titleModel: 'gpt-5.4',
        requestId: 'req-1',
        orchestrateOptions: { userId: 'user-1' },
      })
    )
    expect(runCopilotLifecycle).not.toHaveBeenCalled()
    expect(fetchGo).not.toHaveBeenCalled()
    expect(appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'complete',
        payload: expect.objectContaining({ status: 'cancelled' }),
      })
    )
    expect(appendEvent).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
    expect(unregisterActiveStream).toHaveBeenCalledWith('stream-1', expect.any(AbortController))
    expect(releasePendingChatStream).toHaveBeenCalledWith(
      'chat-1',
      'stream-1',
      expect.objectContaining({ value: 'stream-1\ncontroller' })
    )
    await vi.waitFor(() => expect(scheduleBufferCleanup).toHaveBeenCalledWith('stream-1'))
  })

  it('writes the thrown terminal error event before close for replay durability', async () => {
    runCopilotLifecycle.mockRejectedValue(new Error('kaboom'))

    const stream = createSSEStream({
      requestPayload: { message: 'hello' },
      userId: 'user-1',
      streamId: 'stream-1',
      executionId: 'exec-1',
      runId: 'run-1',
      currentChat: null,
      isNewChat: false,
      message: 'hello',
      titleModel: 'gpt-5.4',
      requestId: 'req-1',
      orchestrateOptions: { userId: 'user-1' },
    })

    await drainStream(stream)

    expect(appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MothershipStreamV1EventType.error,
      })
    )
    expect(scheduleBufferCleanup).toHaveBeenCalledWith('stream-1')
  })

  it('publishes a cancelled completion (not an error) when the orchestrator reports cancelled without abortSignal aborted', async () => {
    runCopilotLifecycle.mockResolvedValue({
      success: false,
      cancelled: true,
      content: '',
      contentBlocks: [],
      toolCalls: [],
    })

    const stream = createSSEStream({
      requestPayload: { message: 'hello' },
      userId: 'user-1',
      streamId: 'stream-1',
      executionId: 'exec-1',
      runId: 'run-1',
      currentChat: null,
      isNewChat: false,
      message: 'hello',
      titleModel: 'gpt-5.4',
      requestId: 'req-cancelled',
      orchestrateOptions: { userId: 'user-1' },
    })

    await drainStream(stream)

    expect(appendEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: MothershipStreamV1EventType.error,
      })
    )
    expect(appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MothershipStreamV1EventType.complete,
        payload: expect.objectContaining({
          status: MothershipStreamV1CompletionStatus.cancelled,
        }),
      })
    )
  })

  it('passes an OTel context into the streaming lifecycle', async () => {
    let lifecycleTraceparent = ''
    runCopilotLifecycle.mockImplementation(async (_payload, options) => {
      const { traceHeaders } = await import('@/lib/mothership/request/go/propagation')
      lifecycleTraceparent = traceHeaders({}, options.otelContext).traceparent ?? ''
      return {
        success: true,
        content: 'OK',
        contentBlocks: [],
        toolCalls: [],
      }
    })

    const stream = createSSEStream({
      requestPayload: { message: 'hello' },
      userId: 'user-1',
      streamId: 'stream-1',
      executionId: 'exec-1',
      runId: 'run-1',
      currentChat: null,
      isNewChat: false,
      message: 'hello',
      titleModel: 'gpt-5.4',
      requestId: 'req-otel',
      orchestrateOptions: {
        userId: 'user-1',
        goRoute: '/api/mothership',
        workflowId: 'workflow-1',
      },
    })

    await drainStream(stream)

    expect(lifecycleTraceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[0-9a-f]$/)
  })

  it('releases the stream registration and pollers when preview initialization fails before the lifecycle starts', async () => {
    clearFilePreviewSessions.mockRejectedValue(new Error('redis down'))

    const stream = createSSEStream({
      requestPayload: { message: 'hello' },
      userId: 'user-1',
      streamId: 'stream-leak',
      executionId: 'exec-leak',
      runId: 'run-leak',
      chatId: 'chat-leak',
      currentChat: null,
      isNewChat: false,
      message: 'hello',
      titleModel: 'gpt-5.4',
      requestId: 'req-leak',
      orchestrateOptions: { userId: 'user-1' },
    })

    await expect(drainStream(stream)).rejects.toThrow('redis down')

    expect(runCopilotLifecycle).not.toHaveBeenCalled()
    expect(registerActiveStream).toHaveBeenCalledWith('stream-leak', expect.any(AbortController))
    expect(unregisterActiveStream).toHaveBeenCalledWith('stream-leak', expect.any(AbortController))
    expect(releasePendingChatStream).toHaveBeenCalledWith(
      'chat-leak',
      'stream-leak',
      expect.objectContaining({ value: 'stream-leak\ncontroller' })
    )
  })

  it('does not scan manually authored title input against unrelated active secrets', async () => {
    runCopilotLifecycle.mockResolvedValue({
      success: true,
      content: 'OK',
      contentBlocks: [],
      toolCalls: [],
    })
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'secret-value', encryptedValue: 'ciphertext' },
    ])
    registry.recordResolved('TOKEN', 'secret-value')

    const stream = createSSEStream({
      requestPayload: { message: 'hello secret-value' },
      userId: 'user-1',
      streamId: 'stream-title',
      executionId: 'exec-title',
      runId: 'run-title',
      chatId: 'chat-title',
      currentChat: null,
      isNewChat: true,
      message: 'hello secret-value',
      titleModel: 'gpt-5.4',
      requestId: 'req-title',
      orchestrateOptions: {
        userId: 'user-1',
        executionContext: {
          userId: 'user-1',
          workflowId: 'workflow-1',
          resolvedSecretTraceRegistry: registry,
        },
      },
    })

    await drainStream(stream)
    await vi.waitFor(() => expect(fetchGo).toHaveBeenCalled())
    const [, request] = fetchGo.mock.calls.at(-1) ?? []
    expect(JSON.parse(request.body)).toEqual(
      expect.objectContaining({ message: 'hello secret-value' })
    )
  })
})

describe('requestChatTitle billing protocol', () => {
  afterAll(() => {
    resetDbChainMock()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    setEnvFlags({ isHosted: true })
    fetchGo.mockResolvedValue(
      new Response(JSON.stringify({ title: 'Billing Protocol' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
  })

  it('freezes and forwards a dedicated attributed identity before title work', async () => {
    const title = await requestChatTitle({
      message: 'explain billing',
      model: 'claude-opus-4.8',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      billingAttribution: BILLING_ATTRIBUTION,
    })

    expect(title).toBe('Billing Protocol')
    const headers = fetchGo.mock.calls[0]?.[1]?.headers as Record<string, string>
    const billingRequestId = headers['x-sim-billing-request-id']
    expect(billingRequestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )
    expect(headers).toMatchObject({
      'x-sim-billing-protocol': 'attribution-v1',
      'x-sim-billing-request-id': billingRequestId,
    })
    expect(JSON.parse(decodeURIComponent(headers['x-sim-billing-attribution']))).toEqual(
      BILLING_ATTRIBUTION
    )
  })

  it('fails before hosted title egress without a billing workspace', async () => {
    await expect(
      requestChatTitle({
        message: 'explain billing',
        model: 'claude-opus-4.8',
        userId: 'user-1',
      })
    ).resolves.toBeNull()
    expect(fetchGo).not.toHaveBeenCalled()
  })
})
