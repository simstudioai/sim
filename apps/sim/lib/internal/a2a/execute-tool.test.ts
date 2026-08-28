/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cancelA2ATask: vi.fn(),
  enforceUserRateLimit: vi.fn(),
  getA2AAgentCard: vi.fn(),
  getA2ATask: vi.fn(),
  sendA2AMessage: vi.fn(),
}))

vi.mock('@/lib/core/rate-limiter', () => ({
  enforceUserRateLimit: mocks.enforceUserRateLimit,
}))

vi.mock('@/lib/internal/a2a/operations', () => ({
  cancelA2ATask: mocks.cancelA2ATask,
  getA2AAgentCard: mocks.getA2AAgentCard,
  getA2ATask: mocks.getA2ATask,
  sendA2AMessage: mocks.sendA2AMessage,
}))

import { A2AOperationError } from '@/lib/internal/a2a/errors'
import { executeA2ATool } from '@/lib/internal/a2a/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

function request(overrides: Partial<InternalToolOperationCall> = {}): InternalToolOperationCall {
  return {
    toolId: 'a2a_get_agent_card',
    input: { agentUrl: 'https://agent.example' },
    headers: new Headers(),
    context: {
      ...createExecutionContext({ workflowId: 'workflow-1' }),
      userId: 'user-1',
      workspaceId: 'workspace-1',
    },
    requestId: 'request-1',
    ...overrides,
  }
}

const CASES = [
  ['a2a_get_agent_card', { agentUrl: 'https://agent.example' }, mocks.getA2AAgentCard],
  [
    'a2a_send_message',
    { agentUrl: 'https://agent.example', message: 'Hello' },
    mocks.sendA2AMessage,
  ],
  ['a2a_get_task', { agentUrl: 'https://agent.example', taskId: 'task-1' }, mocks.getA2ATask],
  ['a2a_cancel_task', { agentUrl: 'https://agent.example', taskId: 'task-1' }, mocks.cancelA2ATask],
] as const

describe('executeA2ATool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.enforceUserRateLimit.mockResolvedValue(null)
    for (const operation of [
      mocks.cancelA2ATask,
      mocks.getA2AAgentCard,
      mocks.getA2ATask,
      mocks.sendA2AMessage,
    ]) {
      operation.mockResolvedValue({ success: true, output: {} })
    }
  })

  it.each(CASES)('dispatches %s with trusted context', async (toolId, input, operation) => {
    const controller = new AbortController()
    const headers = new Headers({ 'x-sim-private-model-input-provenance': 'resolved-values-v1' })

    const response = await executeA2ATool(
      request({ toolId, input, headers, signal: controller.signal })
    )

    expect(response.status).toBe(200)
    expect(operation).toHaveBeenCalledWith(input, {
      headers,
      requestId: 'request-1',
      signal: controller.signal,
      userId: 'user-1',
    })
  })

  it('keeps the existing per-user rate limit ahead of validation', async () => {
    mocks.enforceUserRateLimit.mockResolvedValue(
      Response.json({ error: 'Rate limit exceeded' }, { status: 429 })
    )

    const response = await executeA2ATool(request({ input: null }))

    expect(response.status).toBe(429)
    expect(mocks.getA2AAgentCard).not.toHaveBeenCalled()
  })

  it.each([false, 0, null, ['structured', 'data']])(
    'preserves non-object structured JSON data: %j',
    async (data) => {
      const response = await executeA2ATool(
        request({
          toolId: 'a2a_send_message',
          input: { agentUrl: 'https://agent.example', message: 'Hello', data },
        })
      )

      expect(response.status).toBe(200)
      expect(mocks.sendA2AMessage).toHaveBeenCalledWith(
        { agentUrl: 'https://agent.example', message: 'Hello', data },
        expect.any(Object)
      )
    }
  )

  it('preserves operation error statuses', async () => {
    mocks.getA2AAgentCard.mockRejectedValue(new A2AOperationError('unsafe input', 400))

    const response = await executeA2ATool(request())

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ success: false, error: 'unsafe input' })
  })

  it('propagates cancellation before rate-limit or provider work', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(executeA2ATool(request({ signal: controller.signal }))).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(mocks.enforceUserRateLimit).not.toHaveBeenCalled()
    expect(mocks.getA2AAgentCard).not.toHaveBeenCalled()
  })
})
