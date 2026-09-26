import { propagation, trace } from '@opentelemetry/api'
import { W3CTraceContextPropagator } from '@opentelemetry/core'
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base'
import { dbChainMockFns, resetDbChainMock, resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import {
  billingAttributionMock,
  billingAttributionMockFns,
} from '@sim/testing/mocks/billing-attribution.mock'
import {
  mothershipAgentUrlMock,
  mothershipAgentUrlMockFns,
} from '@sim/testing/mocks/mothership-agent-url.mock'
import {
  mothershipAsyncRunsMock,
  mothershipAsyncRunsMockFns,
} from '@sim/testing/mocks/mothership-async-runs.mock'
import { mothershipChatStatusMock } from '@sim/testing/mocks/mothership-chat-status.mock'
import {
  mothershipGoFetchMock,
  mothershipGoFetchMockFns,
} from '@sim/testing/mocks/mothership-go-fetch.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { publishChatStatusChanged } from '@/lib/mothership/chat-status'
import {
  MothershipStreamV1CompletionStatus,
  MothershipStreamV1EventType,
} from '@/lib/mothership/generated/mothership-stream-v1'
import { TitleRequest } from '@/lib/mothership/generated/protocol'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const {
  runCopilotLifecycle,
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
  buildChatTitleContext,
} = vi.hoisted(() => ({
  runCopilotLifecycle: vi.fn(),
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
  buildChatTitleContext: vi.fn().mockResolvedValue(undefined),
}))

const BILLING_ATTRIBUTION = {
  actorUserId: 'user-1',
  workspaceId: '22222222-2222-4222-8222-222222222222',
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

vi.mock('@/lib/billing/core/billing-attribution', () => billingAttributionMock)

vi.mock('@/lib/mothership/chat/title-context', () => ({ buildChatTitleContext }))

vi.mock('@/lib/mothership/request/lifecycle/run', () => ({
  runCopilotLifecycle,
}))

vi.mock('@/lib/mothership/async-runs/repository', () => mothershipAsyncRunsMock)

let mockDisconnected = false
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
    markDisconnected = vi.fn(() => {
      mockDisconnected = true
    })
    publish = vi.fn().mockImplementation(async (event: Record<string, unknown>) => {
      appendEvent(event)
    })
    get clientDisconnected() {
      return mockDisconnected
    }
    get sawComplete() {
      return false
    }
  },
}))
vi.mock('@/lib/mothership/request/session/sse', () => ({
  SSE_RESPONSE_HEADERS: {},
}))

vi.mock('@/lib/mothership/chat-status', () => mothershipChatStatusMock)

vi.mock('@/lib/mothership/request/go/fetch', () => mothershipGoFetchMock)

vi.mock('@/lib/mothership/server/agent-url', () => mothershipAgentUrlMock)

import { createSSEStream, requestChatTitle } from './start'

const { mockCreateRunSegment: createRunSegment, mockUpdateRunStatus: updateRunStatus } =
  mothershipAsyncRunsMockFns
const recordRunBillingAdmission = mothershipAsyncRunsMockFns.mockRecordRunBillingAdmission
const fetchGo = mothershipGoFetchMockFns.mockFetchGo
mothershipAgentUrlMockFns.mockGetMothershipBaseURL.mockResolvedValue('https://copilot.test')

const checkTitleUsage = billingAttributionMockFns.mockCheckAttributedUsageLimits
checkTitleUsage.mockResolvedValue({ isExceeded: false })

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
    mockDisconnected = false
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

  it('durably records the exact billing admission under the current controller before dispatch', async () => {
    const chatId = '11111111-1111-4111-8111-111111111111'
    const streamId = '22222222-2222-4222-8222-222222222222'
    const admission = {
      billingRequestId: '33333333-3333-4333-8333-333333333333',
      serializedAttribution: 'original-payer',
      headers: {},
    }
    recordRunBillingAdmission.mockResolvedValue({ status: 'active' })
    runCopilotLifecycle.mockImplementation(async (_payload, options) => {
      await options.onBillingAdmission(admission)
      expect(recordRunBillingAdmission).toHaveBeenCalledWith(
        'run-1',
        {
          billingRequestId: admission.billingRequestId,
          serializedAttribution: admission.serializedAttribution,
        },
        `${streamId}\ncontroller`
      )
      return { success: true, content: '', contentBlocks: [], toolCalls: [] }
    })
    await drainStream(
      createSSEStream({
        requestPayload: {
          message: 'hello',
          userId: 'user-1',
          messageId: streamId,
          chatId,
          workspaceId: '44444444-4444-4444-8444-444444444444',
        },
        userId: 'user-1',
        chatId,
        streamId,
        executionId: 'exec-1',
        runId: 'run-1',
        currentChat: null,
        message: 'hello',
        titleModel: 'gpt-5.4',
        requestId: 'req-1',
        orchestrateOptions: { userId: 'user-1', interactive: true },
      })
    )
    expect(runCopilotLifecycle).toHaveBeenCalledOnce()
  })

  it.each(['returned', 'thrown'])(
    'retains an error verdict after a detached sink (%s failure)',
    async (kind) => {
      let settle!: () => void
      const pending = new Promise<void>((resolve) => {
        settle = resolve
      })
      runCopilotLifecycle.mockImplementation(async () => {
        await pending
        if (kind === 'thrown') throw new Error('worker unavailable')
        return {
          success: false,
          error: 'worker unavailable',
          content: '',
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
        message: 'hello',
        titleModel: '',
        requestId: 'req-1',
        orchestrateOptions: { userId: 'user-1' },
      })
      await vi.waitFor(() => expect(runCopilotLifecycle).toHaveBeenCalledOnce())
      await stream.cancel()
      settle()
      await vi.waitFor(() =>
        expect(updateRunStatus).toHaveBeenCalledWith(
          'run-1',
          'error',
          expect.any(Object),
          undefined
        )
      )
      expect(appendEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'complete',
          payload: expect.objectContaining({ status: 'error' }),
        })
      )
    }
  )

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

  it.each([true, false])(
    'persists and announces a generated title only when the conditional write wins (%s)',
    async (stamped) => {
      const chatId = '11111111-1111-4111-8111-111111111111'
      const workspaceId = '22222222-2222-4222-8222-222222222222'
      dbChainMockFns.returning.mockResolvedValue(stamped ? [{ id: chatId }] : [])
      fetchGo.mockImplementation(async (_url, request) => {
        TitleRequest.parse(JSON.parse(request.body))
        return Response.json({ title: 'Workflow planning' })
      })
      let finish!: () => void
      const pending = new Promise<void>((resolve) => {
        finish = resolve
      })
      runCopilotLifecycle.mockImplementation(async () => {
        await pending
        return { success: true, content: 'Done', contentBlocks: [], toolCalls: [] }
      })
      const stream = createSSEStream({
        requestPayload: { message: 'Plan a workflow' },
        userId: 'user-1',
        workspaceId,
        chatId,
        streamId: 'stream-title',
        executionId: 'exec-title',
        runId: 'run-title',
        currentChat: null,
        message: 'Plan a workflow',
        titleModel: 'gpt-5.4',
        requestId: 'req-title',
        orchestrateOptions: { userId: 'user-1' },
      })
      try {
        await vi.waitFor(() =>
          expect(dbChainMockFns.set).toHaveBeenCalledWith({ title: 'Workflow planning' })
        )
        if (stamped) {
          await vi.waitFor(() =>
            expect(publishChatStatusChanged).toHaveBeenCalledWith(
              { workspaceId, organizationId: undefined, userId: 'user-1' },
              { chatId, type: 'renamed' }
            )
          )
          expect(appendEvent).toHaveBeenCalledWith(
            expect.objectContaining({
              type: 'session',
              payload: { kind: 'title', title: 'Workflow planning' },
            })
          )
        } else {
          expect(publishChatStatusChanged).not.toHaveBeenCalled()
          expect(appendEvent).not.toHaveBeenCalledWith(
            expect.objectContaining({ payload: expect.objectContaining({ kind: 'title' }) })
          )
        }
      } finally {
        finish()
        await drainStream(stream)
      }
    }
  )

  it('starts the agent while title metadata is pending and forwards recovered inventory', async () => {
    let resolveContext!: (value: string) => void
    buildChatTitleContext.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolveContext = resolve
        })
    )
    fetchGo.mockResolvedValueOnce(Response.json({ title: 'Finance planning' }))
    const recoveredInventory = { workflows: [{ name: 'Invoice approval' }] }
    const stream = createSSEStream({
      requestPayload: { message: 'Plan', inventory: recoveredInventory },
      userId: 'user-1',
      workspaceId: '22222222-2222-4222-8222-222222222222',
      chatId: '11111111-1111-4111-8111-111111111111',
      streamId: 'stream-title',
      executionId: 'exec-title',
      runId: 'run-title',
      currentChat: null,
      message: 'Plan',
      titleModel: 'gpt-5.4',
      requestId: 'req-title',
      orchestrateOptions: { userId: 'user-1' },
    })
    await vi.waitFor(() => expect(buildChatTitleContext).toHaveBeenCalled())
    expect(runCopilotLifecycle).toHaveBeenCalled()
    expect(fetchGo).not.toHaveBeenCalled()
    expect(buildChatTitleContext).toHaveBeenCalledWith(
      expect.objectContaining({ inventory: recoveredInventory })
    )
    resolveContext('{"workspaceName":"Finance"}')
    await vi.waitFor(() => expect(fetchGo).toHaveBeenCalled())
    expect(JSON.parse(fetchGo.mock.calls[0][1].body).context).toBe('{"workspaceName":"Finance"}')
    await drainStream(stream)
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
        chatId: '11111111-1111-4111-8111-111111111111',
        workspaceId: '22222222-2222-4222-8222-222222222222',
        currentChat: null,
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
      '11111111-1111-4111-8111-111111111111',
      'stream-1',
      expect.objectContaining({ value: 'stream-1\ncontroller' })
    )
    await vi.waitFor(() => expect(scheduleBufferCleanup).toHaveBeenCalledWith('stream-1'))
  })

  it('names an untitled chat on the next accepted turn after an initial Stop, then leaves its title alone', async () => {
    const chatId = '11111111-1111-4111-8111-111111111111'
    const params = {
      requestPayload: { message: 'Plan a workflow' },
      userId: 'user-1',
      chatId,
      workspaceId: '22222222-2222-4222-8222-222222222222',
      streamId: 'cancelled-first',
      executionId: 'first-execution',
      runId: 'first-run',
      currentChat: null,
      message: 'Plan a workflow',
      titleModel: 'gpt-5.4',
      requestId: 'request',
      orchestrateOptions: { userId: 'user-1' },
    }
    createRunSegment.mockResolvedValueOnce({ status: 'cancelled' })
    await drainStream(createSSEStream(params))
    expect(fetchGo).not.toHaveBeenCalled()
    expect(runCopilotLifecycle).not.toHaveBeenCalled()

    dbChainMockFns.returning.mockResolvedValue([{ id: chatId }])
    fetchGo.mockImplementation(async (_url, request) => {
      TitleRequest.parse(JSON.parse(request.body))
      return Response.json({ title: 'Workflow planning' })
    })
    runCopilotLifecycle.mockResolvedValue({
      success: true,
      content: 'Done',
      contentBlocks: [],
      toolCalls: [],
    })
    await drainStream(
      createSSEStream({
        ...params,
        streamId: 'accepted-second',
        executionId: 'second-execution',
        runId: 'second-run',
        currentChat: { title: null },
      })
    )
    await vi.waitFor(() =>
      expect(publishChatStatusChanged).toHaveBeenCalledWith(
        { workspaceId: params.workspaceId, organizationId: undefined, userId: 'user-1' },
        { chatId, type: 'renamed' }
      )
    )
    expect(dbChainMockFns.set).toHaveBeenCalledWith({ title: 'Workflow planning' })
    expect(fetchGo).toHaveBeenCalledTimes(1)

    await drainStream(
      createSSEStream({
        ...params,
        streamId: 'accepted-third',
        executionId: 'third-execution',
        runId: 'third-run',
        currentChat: { title: 'Workflow planning' },
      })
    )
    expect(fetchGo).toHaveBeenCalledTimes(1)
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
      chatId: '11111111-1111-4111-8111-111111111111',
      currentChat: null,
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
    mockDisconnected = false
    resetDbChainMock()
    setEnvFlags({ isHosted: true })
    fetchGo.mockImplementation(async (_url, request) => {
      const parsed = TitleRequest.safeParse(JSON.parse(request.body))
      return new Response(
        JSON.stringify(
          parsed.success ? { title: 'Billing Protocol' } : { error: 'Invalid title request' }
        ),
        {
          status: parsed.success ? 200 : 400,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    })
  })

  it('refuses title model egress when its canonical payer has no headroom', async () => {
    checkTitleUsage.mockResolvedValueOnce({ isExceeded: true })
    const title = await requestChatTitle({
      message: 'explain billing',
      model: 'claude-opus-4.8',
      userId: 'user-1',
      workspaceId: BILLING_ATTRIBUTION.workspaceId,
      billingAttribution: BILLING_ATTRIBUTION,
    })
    expect(checkTitleUsage).toHaveBeenCalledWith(BILLING_ATTRIBUTION)
    expect(title).toBeNull()
    expect(fetchGo).not.toHaveBeenCalled()
  })

  it('freezes and forwards a dedicated attributed identity before title work', async () => {
    const signal = new AbortController().signal
    const title = await requestChatTitle({
      message: 'explain billing',
      model: 'claude-opus-4.8',
      userId: 'user-1',
      workspaceId: '22222222-2222-4222-8222-222222222222',
      billingAttribution: BILLING_ATTRIBUTION,
      signal,
    })

    expect(fetchGo.mock.calls[0]?.[1]?.signal).toBe(signal)
    expect(title).toBe('Billing Protocol')
    expect(fetchGo.mock.calls[0]?.[1]?.attributes).toBeUndefined()
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

  it('forwards the exact organization and private chat for title billing admission', async () => {
    const attribution = { ...BILLING_ATTRIBUTION, workspaceId: null }
    await expect(
      requestChatTitle({
        message: 'search connected sources',
        model: 'claude-opus-4.8',
        userId: 'user-1',
        organizationId: 'org-1',
        chatId: '11111111-1111-4111-8111-111111111111',
        billingAttribution: attribution,
      })
    ).resolves.toBe('Billing Protocol')
    const options = fetchGo.mock.calls[0]?.[1]
    expect(JSON.parse(options.body)).toEqual(
      expect.objectContaining({
        organizationId: 'org-1',
        chatId: '11111111-1111-4111-8111-111111111111',
      })
    )
    expect(JSON.parse(options.body)).not.toHaveProperty('workspaceId')
    expect(JSON.parse(decodeURIComponent(options.headers['x-sim-billing-attribution']))).toEqual(
      attribution
    )
  })

  it('does not send organization title work without a canonical private chat', async () => {
    await expect(
      requestChatTitle({
        message: 'search connected sources',
        model: 'claude-opus-4.8',
        userId: 'user-1',
        organizationId: 'org-1',
        billingAttribution: { ...BILLING_ATTRIBUTION, workspaceId: null },
      })
    ).resolves.toBeNull()
    expect(fetchGo).not.toHaveBeenCalled()
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
