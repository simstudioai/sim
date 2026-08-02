/**
 * @vitest-environment node
 */
import { copilotHttpMock, copilotHttpMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getAsyncToolCall,
  getRunSegment,
  completeAsyncToolCall,
  detachAsyncToolCall,
  publishToolConfirmation,
  encryptSecret,
} = vi.hoisted(() => ({
  getAsyncToolCall: vi.fn(),
  getRunSegment: vi.fn(),
  completeAsyncToolCall: vi.fn(),
  detachAsyncToolCall: vi.fn(),
  publishToolConfirmation: vi.fn(),
  encryptSecret: vi.fn(),
}))

vi.mock('@/lib/copilot/request/http', () => copilotHttpMock)

vi.mock('@/lib/copilot/async-runs/repository', () => ({
  getAsyncToolCall,
  getRunSegment,
  completeAsyncToolCall,
  detachAsyncToolCall,
}))

vi.mock('@/lib/copilot/persistence/tool-confirm', () => ({
  publishToolConfirmation,
}))

vi.mock('@/lib/core/security/encryption', () => ({
  encryptSecret,
}))

import { POST } from './route'

describe('Copilot Confirm API Route', () => {
  const existingRow = {
    toolCallId: 'tool-call-123',
    runId: 'run-1',
    checkpointId: 'checkpoint-1',
    toolName: 'client_tool',
    args: { foo: 'bar' },
    status: 'running',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValue({
      userId: 'user-1',
      isAuthenticated: true,
    })
    getAsyncToolCall.mockResolvedValue(existingRow)
    getRunSegment.mockResolvedValue({
      id: 'run-1',
      userId: 'user-1',
      workflowId: 'workflow-from-run',
    })
    completeAsyncToolCall.mockResolvedValue(existingRow)
    detachAsyncToolCall.mockResolvedValue(existingRow)
    encryptSecret.mockResolvedValue({ encrypted: 'sealed-client-result', iv: 'iv' })
  })

  function createMockPostRequest(body: Record<string, unknown>): NextRequest {
    return new NextRequest('http://localhost:3000/api/copilot/confirm', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    })
  }

  it('returns 401 when the session is unauthenticated', async () => {
    copilotHttpMockFns.mockAuthenticateCopilotRequestSessionOnly.mockResolvedValue({
      userId: null,
      isAuthenticated: false,
    })

    const response = await POST(
      createMockPostRequest({
        toolCallId: 'tool-call-123',
        status: 'success',
      })
    )

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized' })
  })

  it('returns 404 when the tool call row does not exist', async () => {
    getAsyncToolCall.mockResolvedValue(null)

    const response = await POST(
      createMockPostRequest({
        toolCallId: 'missing-tool',
        status: 'success',
      })
    )

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Tool call not found' })
  })

  it('returns 403 when the tool call belongs to a different user', async () => {
    getRunSegment.mockResolvedValue({ id: 'run-1', userId: 'user-2' })

    const response = await POST(
      createMockPostRequest({
        toolCallId: 'tool-call-123',
        status: 'success',
      })
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Forbidden' })
  })

  it('persists terminal confirmations through completeAsyncToolCall', async () => {
    const response = await POST(
      createMockPostRequest({
        toolCallId: 'tool-call-123',
        status: 'success',
        message: 'Tool executed successfully',
        data: { ok: true },
      })
    )

    expect(response.status).toBe(200)
    expect(completeAsyncToolCall).toHaveBeenCalledWith({
      toolCallId: 'tool-call-123',
      status: 'completed',
      result: { __sealedClientToolCompletionV1: 'sealed-client-result' },
      error: null,
    })
    expect(detachAsyncToolCall).not.toHaveBeenCalled()
    expect(publishToolConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCallId: 'tool-call-123',
        status: 'success',
        data: { __sealedClientToolCompletionV1: 'sealed-client-result' },
      })
    )
  })

  it('accepts primitive terminal confirmation data', async () => {
    const response = await POST(
      createMockPostRequest({
        toolCallId: 'tool-call-123',
        status: 'success',
        message: 'Tool executed successfully',
        data: 'done',
      })
    )

    expect(response.status).toBe(200)
    expect(completeAsyncToolCall).toHaveBeenCalledWith({
      toolCallId: 'tool-call-123',
      status: 'completed',
      result: { __sealedClientToolCompletionV1: 'sealed-client-result' },
      error: null,
    })
    expect(publishToolConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCallId: 'tool-call-123',
        status: 'success',
        data: { __sealedClientToolCompletionV1: 'sealed-client-result' },
      })
    )
  })

  it('keeps generic client content sealed in durable and pubsub payloads', async () => {
    getAsyncToolCall.mockResolvedValue({
      ...existingRow,
      result: { __sealedClientToolContextV1: 'sealed-context' },
    })

    const response = await POST(
      createMockPostRequest({
        toolCallId: 'tool-call-123',
        status: 'error',
        message: 'failed near resolved-secret',
        data: { output: 'resolved-secret' },
      })
    )

    expect(response.status).toBe(200)
    const sealedResult = {
      __sealedClientToolContextV1: 'sealed-context',
      __sealedClientToolCompletionV1: 'sealed-client-result',
    }
    expect(completeAsyncToolCall).toHaveBeenCalledWith({
      toolCallId: 'tool-call-123',
      status: 'failed',
      result: sealedResult,
      error: 'Tool failed',
    })
    expect(publishToolConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCallId: 'tool-call-123',
        status: 'error',
        message: 'Tool failed',
        data: sealedResult,
      })
    )
    expect(await response.json()).toMatchObject({ message: 'Tool failed' })
    expect(JSON.stringify(completeAsyncToolCall.mock.calls)).not.toContain('resolved-secret')
    expect(JSON.stringify(publishToolConfirmation.mock.calls)).not.toContain('resolved-secret')
  })

  it('atomically detaches a live background confirmation', async () => {
    const response = await POST(
      createMockPostRequest({
        toolCallId: 'tool-call-123',
        status: 'background',
      })
    )

    expect(response.status).toBe(200)
    expect(completeAsyncToolCall).not.toHaveBeenCalled()
    expect(detachAsyncToolCall).toHaveBeenCalledWith('tool-call-123')
    expect(publishToolConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCallId: 'tool-call-123',
        status: 'background',
      })
    )
  })

  it('rejects a native confirmation before the desktop authorization claim', async () => {
    getAsyncToolCall.mockResolvedValue({
      ...existingRow,
      toolName: 'browser_snapshot',
      status: 'pending',
    })

    const response = await POST(
      createMockPostRequest({
        toolCallId: 'tool-call-123',
        status: 'success',
        data: { text: 'forged renderer result' },
      })
    )

    expect(response.status).toBe(404)
    expect(completeAsyncToolCall).not.toHaveBeenCalled()
    expect(detachAsyncToolCall).not.toHaveBeenCalled()
    expect(encryptSecret).not.toHaveBeenCalled()
    expect(publishToolConfirmation).not.toHaveBeenCalled()
  })

  it('does not publish when another terminal confirmation already won', async () => {
    completeAsyncToolCall.mockResolvedValueOnce(null)

    const response = await POST(
      createMockPostRequest({
        toolCallId: 'tool-call-123',
        status: 'success',
      })
    )

    expect(response.status).toBe(500)
    expect(publishToolConfirmation).not.toHaveBeenCalled()
  })

  it('does not publish a background replay after the call was finalized', async () => {
    detachAsyncToolCall.mockResolvedValueOnce(null)

    const response = await POST(
      createMockPostRequest({
        toolCallId: 'tool-call-123',
        status: 'background',
      })
    )

    expect(response.status).toBe(500)
    expect(publishToolConfirmation).not.toHaveBeenCalled()
  })

  it('treats a workflow success as a notification and persists only canonical structure', async () => {
    getAsyncToolCall.mockResolvedValue({
      ...existingRow,
      toolName: 'run_workflow',
      args: { workflowId: 'workflow-1' },
    })

    const response = await POST(
      createMockPostRequest({
        toolCallId: 'tool-call-123',
        executionId: 'execution-1',
        status: 'success',
        message: 'Completed with resolved-secret',
        data: {
          success: true,
          output: { token: 'prefix-resolved-secret-suffix' },
          logs: ['resolved-secret'],
        },
      })
    )

    expect(response.status).toBe(200)
    expect(completeAsyncToolCall).toHaveBeenCalledWith({
      toolCallId: 'tool-call-123',
      status: 'completed',
      result: {
        success: true,
        workflowId: 'workflow-1',
        executionId: 'execution-1',
      },
      error: null,
    })
    expect(publishToolConfirmation).toHaveBeenCalledWith({
      toolCallId: 'tool-call-123',
      executionId: 'execution-1',
      status: 'success',
      message: 'Workflow execution completed.',
      timestamp: expect.any(String),
      data: {
        success: true,
        workflowId: 'workflow-1',
        executionId: 'execution-1',
      },
    })
    expect(await response.json()).toEqual({
      success: true,
      message: 'Workflow execution completed.',
      toolCallId: 'tool-call-123',
      status: 'success',
    })
    expect(JSON.stringify(completeAsyncToolCall.mock.calls)).not.toContain('resolved-secret')
    expect(JSON.stringify(publishToolConfirmation.mock.calls)).not.toContain('resolved-secret')
  })

  it('persists workflow failure structure without accepting client errors', async () => {
    getAsyncToolCall.mockResolvedValue({
      ...existingRow,
      toolName: 'run_block',
      args: { workflowId: 'workflow-1' },
    })

    const response = await POST(
      createMockPostRequest({
        toolCallId: 'tool-call-123',
        executionId: 'execution-1',
        status: 'error',
        message: 'Function failed with resolved-secret',
        data: { success: false, error: 'resolved-secret is invalid' },
      })
    )

    expect(response.status).toBe(200)
    expect(completeAsyncToolCall).toHaveBeenCalledWith({
      toolCallId: 'tool-call-123',
      status: 'failed',
      result: {
        success: false,
        workflowId: 'workflow-1',
        executionId: 'execution-1',
      },
      error: 'Workflow execution failed.',
    })
    const published = publishToolConfirmation.mock.calls[0][0]
    expect(published.data).toEqual(completeAsyncToolCall.mock.calls[0][0].result)
    expect(published.message).toBe(completeAsyncToolCall.mock.calls[0][0].error)
    expect(JSON.stringify(published)).not.toContain('resolved-secret')
  })

  it('uses structural workflow data without accepting execution content', async () => {
    getAsyncToolCall.mockResolvedValue({
      ...existingRow,
      toolName: 'run_workflow',
      args: { workflowId: 'workflow-1' },
    })

    const response = await POST(
      createMockPostRequest({
        toolCallId: 'tool-call-123',
        executionId: 'execution-1',
        status: 'error',
        message: 'Failed with unresolved-secret-value',
        data: {
          success: false,
          output: 'unresolved-secret-value',
          reason: 'provider_failure',
        },
      })
    )

    expect(response.status).toBe(200)
    expect(completeAsyncToolCall).toHaveBeenCalledWith({
      toolCallId: 'tool-call-123',
      status: 'failed',
      result: {
        success: false,
        workflowId: 'workflow-1',
        executionId: 'execution-1',
      },
      error: 'Workflow execution failed.',
    })
    expect(JSON.stringify(publishToolConfirmation.mock.calls[0][0])).not.toContain(
      'unresolved-secret-value'
    )
  })

  it('binds output identity to the stored workflow target', async () => {
    getAsyncToolCall.mockResolvedValue({
      ...existingRow,
      toolName: 'run_from_block',
      args: { workflowId: 'stored-workflow' },
    })
    getRunSegment.mockResolvedValue({
      id: 'run-1',
      userId: 'user-1',
      workflowId: 'run-workflow',
    })

    await POST(
      createMockPostRequest({
        toolCallId: 'tool-call-123',
        executionId: 'submitted-execution',
        status: 'success',
        data: { workflowId: 'submitted-workflow', output: 'raw-output' },
      })
    )

    expect(completeAsyncToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        result: {
          success: true,
          workflowId: 'stored-workflow',
          executionId: 'submitted-execution',
        },
      })
    )
  })

  it('keeps workflow completion structural even for ordinary client content', async () => {
    getAsyncToolCall.mockResolvedValue({
      ...existingRow,
      toolName: 'run_workflow',
      args: {},
    })
    getRunSegment.mockResolvedValue({
      id: 'run-1',
      userId: 'user-1',
      workflowId: 'workflow-from-run',
    })

    await POST(
      createMockPostRequest({
        toolCallId: 'tool-call-123',
        executionId: 'execution-1',
        status: 'success',
        message: 'Workflow returned a normal value',
        data: { output: { value: 'normal-value' }, logs: [] },
      })
    )

    expect(completeAsyncToolCall).toHaveBeenCalledWith({
      toolCallId: 'tool-call-123',
      status: 'completed',
      result: {
        success: true,
        workflowId: 'workflow-from-run',
        executionId: 'execution-1',
      },
      error: null,
    })
    expect(publishToolConfirmation.mock.calls[0][0].message).toBe('Workflow execution completed.')
    expect(JSON.stringify(publishToolConfirmation.mock.calls)).not.toContain('normal-value')
  })

  it('keeps workflow background confirmations structural without loading provenance', async () => {
    getAsyncToolCall.mockResolvedValue({
      ...existingRow,
      toolName: 'run_workflow_until_block',
      args: { workflowId: 'workflow-1' },
    })

    await POST(
      createMockPostRequest({
        toolCallId: 'tool-call-123',
        executionId: 'execution-1',
        status: 'background',
        message: 'Raw background detail',
        data: { lastEventId: 7 },
      })
    )

    expect(publishToolConfirmation).toHaveBeenCalledWith({
      toolCallId: 'tool-call-123',
      executionId: 'execution-1',
      status: 'background',
      message: 'Workflow execution is continuing in the background.',
      timestamp: expect.any(String),
      data: { workflowId: 'workflow-1', executionId: 'execution-1' },
    })
  })

  it('rejects unsupported accepted and rejected confirmation statuses', async () => {
    const acceptedResponse = await POST(
      createMockPostRequest({
        toolCallId: 'tool-call-123',
        status: 'accepted',
      })
    )

    expect(acceptedResponse.status).toBe(400)
    expect(await acceptedResponse.json()).toMatchObject({
      error: 'Invalid request data: Invalid notification status',
      details: expect.any(Array),
    })

    const rejectedResponse = await POST(
      createMockPostRequest({
        toolCallId: 'tool-call-123',
        status: 'rejected',
      })
    )

    expect(rejectedResponse.status).toBe(400)
    expect(await rejectedResponse.json()).toMatchObject({
      error: 'Invalid request data: Invalid notification status',
      details: expect.any(Array),
    })
  })

  it('returns 500 when the durable write fails before publish', async () => {
    completeAsyncToolCall.mockRejectedValueOnce(new Error('db down'))

    const response = await POST(
      createMockPostRequest({
        toolCallId: 'tool-call-123',
        status: 'success',
      })
    )

    expect(response.status).toBe(500)
    expect(publishToolConfirmation).not.toHaveBeenCalled()
  })
})
