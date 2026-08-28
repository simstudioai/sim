/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const executeOperation = vi.hoisted(() => vi.fn())

vi.mock('@/lib/internal/guardrails/operations', () => ({
  executeGuardrailsValidation: executeOperation,
}))

import { GuardrailsOperationError } from '@/lib/internal/guardrails/errors'
import { executeGuardrailsTool } from '@/lib/internal/guardrails/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

function request(overrides: Partial<InternalToolOperationCall> = {}): InternalToolOperationCall {
  return {
    toolId: 'guardrails_validate',
    input: {
      input: 'claim',
      validationType: 'hallucination',
      knowledgeBaseId: 'knowledge-1',
      model: 'gpt-4o',
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

describe('executeGuardrailsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    executeOperation.mockResolvedValue({
      success: true,
      output: { passed: true, validationType: 'hallucination', input: 'claim' },
    })
  })

  it('binds hallucination validation to trusted workflow scope', async () => {
    const controller = new AbortController()
    const executionRequest = request({ signal: controller.signal })
    const response = await executeGuardrailsTool(executionRequest)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      output: { passed: true },
    })
    expect(executeOperation).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: 'workflow-1' }),
      expect.objectContaining({
        actorUserId: 'user-1',
        headers: executionRequest.headers,
        signal: controller.signal,
      })
    )
  })

  it('preserves classified admission errors', async () => {
    executeOperation.mockRejectedValueOnce(
      new GuardrailsOperationError(402, { error: 'Usage limit exceeded' })
    )

    const response = await executeGuardrailsTool(request())

    expect(response.status).toBe(402)
    await expect(response.json()).resolves.toEqual({ error: 'Usage limit exceeded' })
  })

  it('propagates cancellation before and after guardrail work', async () => {
    const before = new AbortController()
    before.abort(new DOMException('cancelled', 'AbortError'))
    await expect(executeGuardrailsTool(request({ signal: before.signal }))).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(executeOperation).not.toHaveBeenCalled()

    const after = new AbortController()
    executeOperation.mockImplementationOnce(async () => {
      after.abort(new DOMException('cancelled', 'AbortError'))
      return { success: true, output: { passed: true } }
    })
    await expect(executeGuardrailsTool(request({ signal: after.signal }))).rejects.toMatchObject({
      name: 'AbortError',
    })
  })
})
