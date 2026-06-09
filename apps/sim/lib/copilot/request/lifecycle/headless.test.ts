/**
 * @vitest-environment node
 */

import { propagation, trace } from '@opentelemetry/api'
import { W3CTraceContextPropagator } from '@opentelemetry/core'
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrchestratorResult } from '@/lib/copilot/request/types'

const { runCopilotLifecycle } = vi.hoisted(() => ({
  runCopilotLifecycle: vi.fn(),
}))

vi.mock('@/lib/copilot/request/lifecycle/run', () => ({
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

  it('runs the lifecycle and returns its result', async () => {
    runCopilotLifecycle.mockResolvedValueOnce(
      createLifecycleResult({
        usage: { prompt: 10, completion: 5 },
        cost: { input: 1, output: 2, total: 3 },
      })
    )

    const result = await runHeadlessCopilotLifecycle(
      {
        message: 'hello',
        messageId: 'req-1',
      },
      {
        userId: 'user-1',
        chatId: 'chat-1',
        workflowId: 'workflow-1',
        goRoute: '/api/mothership/execute',
        interactive: false,
      }
    )

    expect(result.success).toBe(true)
    expect(runCopilotLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'req-1' }),
      expect.objectContaining({
        simRequestId: 'req-1',
        trace: expect.any(Object),
        otelContext: expect.any(Object),
        chatId: 'chat-1',
      })
    )
  })

  it('returns an unsuccessful result from the lifecycle', async () => {
    runCopilotLifecycle.mockResolvedValueOnce(
      createLifecycleResult({
        success: false,
        error: 'failed',
      })
    )

    const result = await runHeadlessCopilotLifecycle(
      {
        message: 'hello',
        messageId: 'req-2',
      },
      {
        userId: 'user-1',
        chatId: 'chat-1',
        workflowId: 'workflow-1',
        goRoute: '/api/mothership/execute',
        interactive: false,
      }
    )

    expect(result.success).toBe(false)
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
      const { traceHeaders } = await import('@/lib/copilot/request/go/propagation')
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

  it('rethrows when the lifecycle throws', async () => {
    runCopilotLifecycle.mockRejectedValueOnce(new Error('kaboom'))

    await expect(
      runHeadlessCopilotLifecycle(
        {
          message: 'hello',
          messageId: 'req-3',
        },
        {
          userId: 'user-1',
          chatId: 'chat-1',
          workflowId: 'workflow-1',
          goRoute: '/api/mothership/execute',
          interactive: false,
        }
      )
    ).rejects.toThrow('kaboom')
  })
})
