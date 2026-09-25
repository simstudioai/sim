import { propagation, trace } from '@opentelemetry/api'
import { W3CTraceContextPropagator } from '@opentelemetry/core'
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrchestratorResult } from '@/lib/mothership/request/types'

const { runCopilotLifecycle } = vi.hoisted(() => ({
  runCopilotLifecycle: vi.fn(),
}))

vi.mock('@/lib/mothership/request/lifecycle/run', () => ({
  runCopilotLifecycle,
}))

import { runHeadlessCopilotLifecycle } from './headless'

function createLifecycleResult(overrides?: Partial<OrchestratorResult>): OrchestratorResult {
  return {
    success: true,
    content: 'done',
    contentBlocks: [],
    toolCalls: [],
    chatId: 'chat-1',
    ...overrides,
  }
}

describe('runHeadlessCopilotLifecycle', () => {
  beforeEach(() => {
    trace.setGlobalTracerProvider(new BasicTracerProvider())
    propagation.setGlobalPropagator(new W3CTraceContextPropagator())
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('forces the server-owned headless classification', async () => {
    runCopilotLifecycle.mockResolvedValueOnce(createLifecycleResult())

    await runHeadlessCopilotLifecycle(
      { message: 'hello', messageId: 'req-classification' },
      {
        userId: 'user-1',
        workflowId: 'workflow-1',
        interactive: true,
      }
    )

    expect(runCopilotLifecycle).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ interactive: false })
    )
  })

  it('prefers an explicit simRequestId over the payload messageId', async () => {
    runCopilotLifecycle.mockResolvedValueOnce(createLifecycleResult())

    await runHeadlessCopilotLifecycle(
      {
        message: 'hello',
        messageId: 'message-req-id',
      },
      {
        userId: 'user-1',
        chatId: 'chat-1',
        workflowId: 'workflow-1',
        simRequestId: 'workflow-request-id',
        goRoute: '/api/mothership/execute',
        interactive: false,
      }
    )

    expect(runCopilotLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'message-req-id' }),
      expect.objectContaining({
        simRequestId: 'workflow-request-id',
      })
    )
  })

  it('threads a valid OTel context into the lifecycle', async () => {
    let lifecycleTraceparent = ''
    runCopilotLifecycle.mockImplementationOnce(async (_payload, options) => {
      const { traceHeaders } = await import('@/lib/mothership/request/go/propagation')
      lifecycleTraceparent = traceHeaders({}, options.otelContext).traceparent ?? ''
      return createLifecycleResult()
    })

    await runHeadlessCopilotLifecycle(
      {
        message: 'hello',
        messageId: 'req-otel',
      },
      {
        userId: 'user-1',
        chatId: 'chat-1',
        workflowId: 'workflow-1',
        goRoute: '/api/mothership/execute',
        interactive: false,
      }
    )

    expect(lifecycleTraceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[0-9a-f]$/)
  })
})
