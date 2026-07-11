/**
 * @vitest-environment node
 */

import { propagation, trace } from '@opentelemetry/api'
import { W3CTraceContextPropagator } from '@opentelemetry/core'
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MothershipStreamV1CompletionStatus,
  MothershipStreamV1EventType,
} from '@/lib/copilot/generated/mothership-stream-v1'

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
  releasePendingChatStream,
  fetchGo,
  billingFlags,
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
  releasePendingChatStream: vi.fn(),
  fetchGo: vi.fn(),
  billingFlags: {
    isHosted: false,
    isCopilotBillingAttributionV1Enabled: false,
  },
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

vi.mock('@/lib/copilot/request/lifecycle/run', () => ({
  runCopilotLifecycle,
}))

vi.mock('@/lib/copilot/async-runs/repository', () => ({
  createRunSegment,
  updateRunStatus,
}))

let mockPublisherController: ReadableStreamDefaultController | null = null

vi.mock('@/lib/copilot/request/session', () => ({
  resetBuffer,
  clearFilePreviewSessions,
  scheduleBufferCleanup,
  scheduleFilePreviewSessionCleanup,
  allocateCursor,
  appendEvent,
  cleanupAbortMarker,
  hasAbortMarker,
  releasePendingChatStream,
  registerActiveStream: vi.fn(),
  unregisterActiveStream: vi.fn(),
  startAbortPoller: vi.fn().mockReturnValue(setInterval(() => {}, 999999)),
  isExplicitStopReason: vi.fn().mockReturnValue(false),
  SSE_RESPONSE_HEADERS: {},
  StreamWriter: vi.fn().mockImplementation(
    class {
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
    }
  ),
}))
vi.mock('@/lib/copilot/request/session/sse', () => ({
  SSE_RESPONSE_HEADERS: {},
}))

vi.mock('@sim/db', () => ({
  db: {
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(),
      })),
    })),
  },
}))

vi.mock('@/lib/copilot/chat-status', () => ({
  chatPubSub: null,
}))

vi.mock('@/lib/copilot/request/go/fetch', () => ({
  fetchGo,
}))

vi.mock('@/lib/copilot/server/agent-url', () => ({
  getMothershipBaseURL: vi.fn().mockResolvedValue('https://copilot.test'),
  getMothershipSourceEnvHeaders: vi.fn().mockReturnValue({}),
}))

vi.mock('@/lib/core/config/env-flags', () => ({
  get isHosted() {
    return billingFlags.isHosted
  },
  get isCopilotBillingAttributionV1Enabled() {
    return billingFlags.isCopilotBillingAttributionV1Enabled
  },
}))

import { createSSEStream, requestChatTitle } from './start'

async function drainStream(stream: ReadableStream) {
  const reader = stream.getReader()
  while (true) {
    const { done } = await reader.read()
    if (done) break
  }
}

describe('createSSEStream terminal error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    billingFlags.isHosted = false
    billingFlags.isCopilotBillingAttributionV1Enabled = false
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
    createRunSegment.mockResolvedValue(null)
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
      orchestrateOptions: {},
    })

    await drainStream(stream)

    expect(appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MothershipStreamV1EventType.error,
      })
    )
    expect(scheduleBufferCleanup).toHaveBeenCalledWith('stream-1')
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
      orchestrateOptions: {},
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
      orchestrateOptions: {},
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
      const { traceHeaders } = await import('@/lib/copilot/request/go/propagation')
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
        goRoute: '/api/mothership',
        workflowId: 'workflow-1',
      },
    })

    await drainStream(stream)

    expect(lifecycleTraceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[0-9a-f]$/)
  })
})

describe('requestChatTitle billing protocol', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    billingFlags.isHosted = true
    billingFlags.isCopilotBillingAttributionV1Enabled = true
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

  it('sends explicit legacy-v0 during the Sim-first compatibility stage', async () => {
    billingFlags.isCopilotBillingAttributionV1Enabled = false

    await requestChatTitle({
      message: 'explain billing',
      model: 'claude-opus-4.8',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    })

    const headers = fetchGo.mock.calls[0]?.[1]?.headers as Record<string, string>
    expect(headers['x-sim-billing-protocol']).toBe('legacy-v0')
    expect(headers['x-sim-billing-request-id']).toBeUndefined()
  })
})
