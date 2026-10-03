import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const executeOperation = vi.hoisted(() => vi.fn())

vi.mock('@/lib/internal/guardrails/operations', () => ({
  executeGuardrailsValidation: executeOperation,
}))

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
})
