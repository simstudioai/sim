/**
 * @vitest-environment node
 */

import { propagation, trace } from '@opentelemetry/api'
import { W3CTraceContextPropagator } from '@opentelemetry/core'
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RequestTraceV1Outcome } from '@/lib/copilot/generated/request-trace-v1'
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
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(null, {
          status: 200,
        })
      )
    )
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('reports a successful headless trace', async () => {
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
        chatId: 'chat-1',
      })
    )

    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/traces')
    const body = JSON.parse(String(init.body))
    expect(body).toEqual(
      expect.objectContaining({
        simRequestId: 'req-1',
        outcome: RequestTraceV1Outcome.success,
        chatId: 'chat-1',
        usage: {
          inputTokens: 10,
          outputTokens: 5,
        },
        cost: {
          rawTotalCost: 3,
          billedTotalCost: 3,
        },
      })
    )
  })

  it('reports an error trace when the lifecycle result is unsuccessful', async () => {
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
    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(init.body))
    expect(body.outcome).toBe(RequestTraceV1Outcome.error)
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

    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(init.body))
    expect(body.simRequestId).toBe('workflow-request-id')
  })

  it('passes an OTel context to the lifecycle and trace report', async () => {
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
    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    // The outbound trace report now runs inside its own OTel child span, so
    // traceparent has the same trace-id as the lifecycle but a different
    // span-id. Both must stay on the same trace.
    const lifecycleTraceId = lifecycleTraceparent.split('-')[1]
    expect(headers.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[0-9a-f]$/)
    expect(headers.traceparent.split('-')[1]).toBe(lifecycleTraceId)
    expect(headers.traceparent.split('-')[2]).not.toBe(lifecycleTraceparent.split('-')[2])
  })

  it('reports an error trace when the lifecycle throws', async () => {
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

    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(init.body))
    expect(body.outcome).toBe(RequestTraceV1Outcome.error)
  })
})
