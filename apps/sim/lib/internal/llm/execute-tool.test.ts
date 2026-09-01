/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const executeOperation = vi.hoisted(() => vi.fn())

vi.mock('@/lib/internal/llm/operations', () => ({
  executeLlmProviderOperation: executeOperation,
}))

import { LlmOperationError } from '@/lib/internal/llm/errors'
import { executeLlmTool } from '@/lib/internal/llm/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

function request(overrides: Partial<InternalToolOperationCall> = {}): InternalToolOperationCall {
  return {
    toolId: 'llm_chat',
    input: {
      provider: 'openai',
      model: 'gpt-4o',
      context: '[{"role":"user","content":"hello"}]',
      workspaceId: 'untrusted-workspace',
      workflowId: 'untrusted-workflow',
    },
    headers: new Headers({ 'x-sim-billing-attribution': 'attribution' }),
    context: {
      ...createExecutionContext({ workflowId: 'workflow-1' }),
      userId: 'user-1',
      workspaceId: 'workspace-1',
    },
    requestId: 'request-1',
    ...overrides,
  }
}

describe('executeLlmTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    executeOperation.mockResolvedValue({ content: 'hello', model: 'gpt-4o' })
  })

  it('binds provider execution to trusted workflow and workspace scope', async () => {
    const controller = new AbortController()
    const executionRequest = request({ signal: controller.signal })
    const response = await executeLlmTool(executionRequest)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ content: 'hello', model: 'gpt-4o' })
    expect(executeOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        stream: false,
      }),
      expect.objectContaining({
        actorUserId: 'user-1',
        headers: executionRequest.headers,
        signal: controller.signal,
      })
    )
  })

  it('preserves classified provider errors', async () => {
    executeOperation.mockRejectedValueOnce(new LlmOperationError(403, { error: 'Forbidden' }))

    const response = await executeLlmTool(request())

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })

  it('propagates cancellation before and after provider work', async () => {
    const before = new AbortController()
    before.abort(new DOMException('cancelled', 'AbortError'))
    await expect(executeLlmTool(request({ signal: before.signal }))).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(executeOperation).not.toHaveBeenCalled()

    const after = new AbortController()
    executeOperation.mockImplementationOnce(async () => {
      after.abort(new DOMException('cancelled', 'AbortError'))
      return { content: 'unused', model: 'gpt-4o' }
    })
    await expect(executeLlmTool(request({ signal: after.signal }))).rejects.toMatchObject({
      name: 'AbortError',
    })
  })
})
