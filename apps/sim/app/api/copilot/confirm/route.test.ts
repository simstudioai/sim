import { copilotHttpMock, copilotHttpMockFns } from '@sim/testing'
import { encryptionMock, encryptionMockFns } from '@sim/testing/mocks/encryption.mock'
import {
  mothershipAsyncRunsMock,
  mothershipAsyncRunsMockFns,
} from '@sim/testing/mocks/mothership-async-runs.mock'
import { createMockRequest } from '@sim/testing/mocks/request.mock'
import type { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { publishToolConfirmation, getTrustedWorkflowToolExecution } = vi.hoisted(() => ({
  publishToolConfirmation: vi.fn(),
  getTrustedWorkflowToolExecution: vi.fn(),
}))

vi.mock('@/lib/mothership/request/http', () => copilotHttpMock)

vi.mock('@/lib/mothership/async-runs/repository', () => mothershipAsyncRunsMock)

vi.mock('@/lib/mothership/persistence/tool-confirm', () => ({
  publishToolConfirmation,
}))

vi.mock('@/lib/core/security/encryption', () => encryptionMock)

vi.mock('@/lib/workflows/executor/execution-state', () => ({
  getTrustedWorkflowToolExecution,
}))

import { POST } from './route'

const {
  mockGetAsyncToolCall: getAsyncToolCall,
  mockGetRunSegment: getRunSegment,
  mockCompleteAsyncToolCall: completeAsyncToolCall,
  mockCompleteClaimedAsyncToolCall: completeClaimedAsyncToolCall,
  mockCompletePendingAsyncToolCall: completePendingAsyncToolCall,
  mockDetachAsyncToolCall: detachAsyncToolCall,
} = mothershipAsyncRunsMockFns

const encryptSecret = encryptionMockFns.mockEncryptSecret

describe('Copilot Confirm API Route', () => {
  const existingRow = {
    toolCallId: 'tool-call-123',
    runId: 'run-1',
    checkpointId: 'checkpoint-1',
    toolName: 'client_tool',
    args: { foo: 'bar' },
    status: 'running',
    claimedBy: 'workflow:execution-1',
  }

  beforeEach(() => {
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
    completeClaimedAsyncToolCall.mockResolvedValue(existingRow)
    completePendingAsyncToolCall.mockResolvedValue(existingRow)
    detachAsyncToolCall.mockResolvedValue(existingRow)
    encryptSecret.mockResolvedValue({ encrypted: 'sealed-client-result', iv: 'iv' })
    getTrustedWorkflowToolExecution.mockResolvedValue({ status: 'completed' })
  })

  function createMockPostRequest(body: Record<string, unknown>): NextRequest {
    return createMockRequest({
      method: 'POST',
      url: 'http://localhost:3000/api/copilot/confirm',
      body,
    })
  }

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

  it('rejects a native success before the desktop authorization claim', async () => {
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

  it.each([
    ['browser_snapshot', 'error', 'failed'],
    ['browser_snapshot', 'cancelled', 'cancelled'],
    ['terminal', 'error', 'failed'],
    ['terminal', 'cancelled', 'cancelled'],
    ['import_local_files', 'error', 'failed'],
    ['import_local_files', 'cancelled', 'cancelled'],
  ] as const)(
    'accepts a pending %s %s before the desktop authorization claim',
    async (toolName, status, durableStatus) => {
      getAsyncToolCall.mockResolvedValue({
        ...existingRow,
        toolName,
        status: 'pending',
      })

      const response = await POST(
        createMockPostRequest({
          toolCallId: 'tool-call-123',
          status,
          message: 'The desktop action did not start.',
        })
      )

      expect(response.status).toBe(200)
      expect(completePendingAsyncToolCall).toHaveBeenCalledWith({
        toolCallId: 'tool-call-123',
        status: durableStatus,
        result: { __sealedClientToolCompletionV1: 'sealed-client-result' },
        error: status === 'error' ? 'Tool failed' : 'Tool cancelled',
      })
      expect(completeAsyncToolCall).not.toHaveBeenCalled()
      expect(detachAsyncToolCall).not.toHaveBeenCalled()
      expect(publishToolConfirmation).toHaveBeenCalledWith(
        expect.objectContaining({ toolCallId: 'tool-call-123', status })
      )
    }
  )

  it.each([
    ['browser_snapshot', 'error'],
    ['terminal', 'cancelled'],
    ['import_local_files', 'error'],
  ] as const)(
    'rejects a pending %s %s when the native authorization claim wins the race',
    async (toolName, status) => {
      getAsyncToolCall.mockResolvedValue({
        ...existingRow,
        toolName,
        status: 'pending',
      })
      completePendingAsyncToolCall.mockResolvedValueOnce(null)

      const response = await POST(
        createMockPostRequest({
          toolCallId: 'tool-call-123',
          status,
          message: 'The desktop action did not start.',
        })
      )

      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({ error: 'Pending client tool call not found' })
      expect(completePendingAsyncToolCall).toHaveBeenCalledOnce()
      expect(completeClaimedAsyncToolCall).not.toHaveBeenCalled()
      expect(completeAsyncToolCall).not.toHaveBeenCalled()
      expect(detachAsyncToolCall).not.toHaveBeenCalled()
      expect(publishToolConfirmation).not.toHaveBeenCalled()
    }
  )

  it.each([
    ['browser_snapshot', 'desktop-browser'],
    ['terminal', 'desktop-terminal'],
    ['import_local_files', 'desktop-files'],
  ] as const)(
    'settles an indeterminate pending %s result when the exact %s claim wins the race',
    async (toolName, claimOwner) => {
      getAsyncToolCall.mockResolvedValue({
        ...existingRow,
        toolName,
        status: 'pending',
      })
      completePendingAsyncToolCall.mockResolvedValueOnce(null)

      const response = await POST(
        createMockPostRequest({
          toolCallId: 'tool-call-123',
          status: 'error',
          message: 'untrusted page-exit message',
          data: { outcomeUnknown: true, doNotRetry: true, untrusted: 'discard me' },
        })
      )

      expect(response.status).toBe(200)
      expect(completePendingAsyncToolCall).toHaveBeenCalledOnce()
      expect(completeClaimedAsyncToolCall).toHaveBeenCalledWith(
        {
          toolCallId: 'tool-call-123',
          status: 'failed',
          result: { __sealedClientToolCompletionV1: 'sealed-client-result' },
          error: 'Tool failed',
        },
        claimOwner
      )
      expect(encryptSecret).toHaveBeenCalledWith(expect.stringContaining('"outcomeUnknown":true'))
      expect(encryptSecret).toHaveBeenCalledWith(expect.not.stringContaining('discard me'))
      expect(publishToolConfirmation).toHaveBeenCalledOnce()
    }
  )

  it('does not publish when another terminal transition wins indeterminate claim reconciliation', async () => {
    getAsyncToolCall.mockResolvedValue({
      ...existingRow,
      toolName: 'browser_snapshot',
      status: 'pending',
    })
    completePendingAsyncToolCall.mockResolvedValueOnce(null)
    completeClaimedAsyncToolCall.mockResolvedValueOnce(null)

    const response = await POST(
      createMockPostRequest({
        toolCallId: 'tool-call-123',
        status: 'error',
        data: { outcomeUnknown: true, doNotRetry: true },
      })
    )

    expect(response.status).toBe(404)
    expect(completeClaimedAsyncToolCall).toHaveBeenCalledWith(expect.any(Object), 'desktop-browser')
    expect(publishToolConfirmation).not.toHaveBeenCalled()
  })

  it('returns 500 without publishing when exact claim reconciliation fails', async () => {
    getAsyncToolCall.mockResolvedValue({
      ...existingRow,
      toolName: 'browser_snapshot',
      status: 'pending',
    })
    completePendingAsyncToolCall.mockResolvedValueOnce(null)
    completeClaimedAsyncToolCall.mockRejectedValueOnce(new Error('database unavailable'))

    const response = await POST(
      createMockPostRequest({
        toolCallId: 'tool-call-123',
        status: 'error',
        data: { outcomeUnknown: true, doNotRetry: true },
      })
    )

    expect(response.status).toBe(500)
    expect(publishToolConfirmation).not.toHaveBeenCalled()
  })

  it('rejects a workflow confirmation before the server starts the tool call', async () => {
    getAsyncToolCall.mockResolvedValue({
      ...existingRow,
      toolName: 'run_workflow',
      args: { workflowId: 'workflow-1' },
      status: 'pending',
    })

    const response = await POST(
      createMockPostRequest({
        toolCallId: 'tool-call-123',
        executionId: 'forged-execution',
        status: 'success',
      })
    )

    expect(response.status).toBe(404)
    expect(completeAsyncToolCall).not.toHaveBeenCalled()
    expect(detachAsyncToolCall).not.toHaveBeenCalled()
    expect(publishToolConfirmation).not.toHaveBeenCalled()
  })

  it('rejects a workflow success before its bound execution is terminal', async () => {
    getAsyncToolCall.mockResolvedValue({
      ...existingRow,
      toolName: 'run_workflow',
      args: { workflowId: 'workflow-1' },
    })
    getTrustedWorkflowToolExecution.mockResolvedValueOnce(null)

    const response = await POST(
      createMockPostRequest({
        toolCallId: 'tool-call-123',
        executionId: 'execution-1',
        status: 'success',
      })
    )

    expect(response.status).toBe(404)
    expect(completeAsyncToolCall).not.toHaveBeenCalled()
    expect(detachAsyncToolCall).not.toHaveBeenCalled()
    expect(publishToolConfirmation).not.toHaveBeenCalled()
  })

  it.each(['error', 'cancelled'] as const)(
    'accepts a structural %s when the bound execution has no terminal log',
    async (status) => {
      getAsyncToolCall.mockResolvedValue({
        ...existingRow,
        toolName: 'run_workflow',
        args: { workflowId: 'workflow-1' },
      })
      getTrustedWorkflowToolExecution.mockResolvedValueOnce(null)

      const response = await POST(
        createMockPostRequest({
          toolCallId: 'tool-call-123',
          executionId: 'execution-1',
          status,
          message: 'untrusted client detail',
          data: { output: 'untrusted client output' },
        })
      )

      expect(response.status).toBe(200)
      expect(completeAsyncToolCall).toHaveBeenCalledWith({
        toolCallId: 'tool-call-123',
        status: status === 'cancelled' ? 'cancelled' : 'failed',
        result: {
          success: false,
          workflowId: 'workflow-1',
          executionId: 'execution-1',
          ...(status === 'cancelled' ? { reason: 'user_cancelled', cancelledByUser: true } : {}),
        },
        error:
          status === 'cancelled'
            ? 'Workflow execution was cancelled.'
            : 'Workflow execution failed.',
      })
      expect(JSON.stringify(publishToolConfirmation.mock.calls)).not.toContain('untrusted client')
    }
  )

  it('accepts a verified terminal execution created before workflow claims existed', async () => {
    getAsyncToolCall.mockResolvedValue({
      ...existingRow,
      toolName: 'run_workflow',
      args: { workflowId: 'workflow-1' },
      claimedBy: null,
    })
    getTrustedWorkflowToolExecution.mockResolvedValueOnce({
      executionId: 'legacy-execution',
      status: 'completed',
    })

    const response = await POST(
      createMockPostRequest({
        toolCallId: 'tool-call-123',
        executionId: 'legacy-execution',
        status: 'success',
      })
    )

    expect(response.status).toBe(200)
    expect(completeAsyncToolCall).toHaveBeenCalledWith({
      toolCallId: 'tool-call-123',
      status: 'completed',
      result: {
        success: true,
        workflowId: 'workflow-1',
        executionId: 'legacy-execution',
      },
      error: null,
    })
  })

  it('rejects a workflow confirmation claimed by another executor', async () => {
    getAsyncToolCall.mockResolvedValue({
      ...existingRow,
      toolName: 'run_workflow',
      args: { workflowId: 'workflow-1' },
      claimedBy: 'sim-stream',
    })

    const response = await POST(
      createMockPostRequest({
        toolCallId: 'tool-call-123',
        status: 'error',
      })
    )

    expect(response.status).toBe(404)
    expect(getTrustedWorkflowToolExecution).not.toHaveBeenCalled()
    expect(completeAsyncToolCall).not.toHaveBeenCalled()
  })

  it.each(['run_workflow', 'run_block'])(
    'preserves a safe busy reason for an unlaunched %s without trusting client text',
    async (toolName) => {
      getAsyncToolCall.mockResolvedValue({
        ...existingRow,
        toolName,
        args: { workflowId: 'workflow-1' },
        claimedBy: null,
      })
      const response = await POST(
        createMockPostRequest({
          toolCallId: 'tool-call-123',
          status: 'error',
          message: 'untrusted detail',
          data: { code: 'WORKFLOW_EXECUTION_BUSY', error: 'untrusted detail' },
        })
      )
      expect(response.status).toBe(200)
      expect(completeAsyncToolCall).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          result: {
            success: false,
            workflowId: 'workflow-1',
            code: 'WORKFLOW_EXECUTION_BUSY',
            error:
              'Workflow is already executing. Wait for the current execution to finish before running it again.',
          },
        })
      )
      expect(JSON.stringify(publishToolConfirmation.mock.calls)).not.toContain('untrusted detail')
      expect(getTrustedWorkflowToolExecution).not.toHaveBeenCalled()
    }
  )

  it('preserves a canonical preflight failure before an execution is bound', async () => {
    getAsyncToolCall.mockResolvedValue({
      ...existingRow,
      toolName: 'run_workflow',
      args: { workflowId: 'workflow-1', async: true },
      status: 'running',
      claimedBy: null,
    })

    const response = await POST(
      createMockPostRequest({
        toolCallId: 'tool-call-123',
        status: 'error',
        message: 'untrusted client detail',
        data: { code: 'ASYNC_WORKFLOW_DEPLOYMENT_STALE' },
      })
    )

    expect(response.status).toBe(200)
    expect(getTrustedWorkflowToolExecution).not.toHaveBeenCalled()
    expect(completeAsyncToolCall).toHaveBeenCalledWith({
      toolCallId: 'tool-call-123',
      status: 'failed',
      result: {
        success: false,
        workflowId: 'workflow-1',
        code: 'ASYNC_WORKFLOW_DEPLOYMENT_STALE',
        error: 'Async execution requires the current workflow to match its deployed version',
      },
      error: 'Async execution requires the current workflow to match its deployed version',
    })
    expect(JSON.stringify(publishToolConfirmation.mock.calls)).not.toContain(
      'untrusted client detail'
    )
  })

  it('discards an unknown async workflow preflight failure', async () => {
    getAsyncToolCall.mockResolvedValue({
      ...existingRow,
      toolName: 'run_workflow',
      args: { workflowId: 'workflow-1', async: true },
      status: 'running',
      claimedBy: null,
    })

    const response = await POST(
      createMockPostRequest({
        toolCallId: 'tool-call-123',
        status: 'error',
        message: 'untrusted client detail',
        data: { code: 'UNTRUSTED_CLIENT_CODE' },
      })
    )

    expect(response.status).toBe(200)
    expect(completeAsyncToolCall).toHaveBeenCalledWith({
      toolCallId: 'tool-call-123',
      status: 'failed',
      result: { success: false, workflowId: 'workflow-1' },
      error: 'Workflow execution failed.',
    })
    expect(JSON.stringify(publishToolConfirmation.mock.calls)).not.toContain('untrusted')
  })

  it('downgrades an unverifiable success from a stale client to a structural failure', async () => {
    getAsyncToolCall.mockResolvedValue({
      ...existingRow,
      toolName: 'run_workflow',
      args: { workflowId: 'workflow-1' },
      status: 'running',
      claimedBy: null,
    })

    const response = await POST(
      createMockPostRequest({
        toolCallId: 'tool-call-123',
        status: 'success',
        message: 'untrusted success detail',
        data: { output: 'untrusted output' },
      })
    )

    expect(response.status).toBe(200)
    expect(completeAsyncToolCall).toHaveBeenCalledWith({
      toolCallId: 'tool-call-123',
      status: 'failed',
      result: { success: false, workflowId: 'workflow-1' },
      error: 'Workflow execution failed.',
    })
    expect(JSON.stringify(publishToolConfirmation.mock.calls)).not.toContain('untrusted')
  })

  it('preserves an approved cancellation before an execution is bound', async () => {
    getAsyncToolCall.mockResolvedValue({
      ...existingRow,
      toolName: 'run_workflow',
      args: { workflowId: 'workflow-1' },
      status: 'running',
      claimedBy: null,
    })

    const response = await POST(
      createMockPostRequest({
        toolCallId: 'tool-call-123',
        status: 'cancelled',
        message: 'untrusted cancellation detail',
      })
    )

    expect(response.status).toBe(200)
    expect(getTrustedWorkflowToolExecution).not.toHaveBeenCalled()
    expect(completeAsyncToolCall).toHaveBeenCalledWith({
      toolCallId: 'tool-call-123',
      status: 'cancelled',
      result: {
        success: false,
        workflowId: 'workflow-1',
        reason: 'user_cancelled',
        cancelledByUser: true,
      },
      error: 'Workflow execution was cancelled.',
    })
    expect(JSON.stringify(publishToolConfirmation.mock.calls)).not.toContain(
      'untrusted cancellation detail'
    )
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

  it('acknowledges an idempotent terminal workflow retry without publishing again', async () => {
    getAsyncToolCall.mockResolvedValue({
      ...existingRow,
      toolName: 'run_workflow',
      args: { workflowId: 'workflow-1' },
      status: 'completed',
      claimedBy: null,
      result: {
        success: true,
        workflowId: 'workflow-1',
        executionId: 'execution-1',
      },
    })

    const response = await POST(
      createMockPostRequest({
        toolCallId: 'tool-call-123',
        executionId: 'execution-1',
        status: 'success',
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ status: 'success' })
    expect(completeAsyncToolCall).not.toHaveBeenCalled()
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
    getTrustedWorkflowToolExecution.mockResolvedValueOnce({ status: 'failed' })

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

  it('binds output identity to the stored workflow target', async () => {
    getAsyncToolCall.mockResolvedValue({
      ...existingRow,
      toolName: 'run_from_block',
      args: { workflowId: 'stored-workflow' },
      claimedBy: 'workflow:submitted-execution',
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

  it('detaches a background confirmation while its execution request is still binding', async () => {
    getAsyncToolCall.mockResolvedValue({
      ...existingRow,
      toolName: 'run_workflow_until_block',
      args: { workflowId: 'workflow-1' },
      claimedBy: null,
    })

    const response = await POST(
      createMockPostRequest({
        toolCallId: 'tool-call-123',
        executionId: 'unbound-execution',
        status: 'background',
      })
    )

    expect(response.status).toBe(200)
    expect(detachAsyncToolCall).toHaveBeenCalledWith('tool-call-123', {
      preserveClaim: true,
    })
    expect(publishToolConfirmation).toHaveBeenCalledWith({
      toolCallId: 'tool-call-123',
      executionId: 'unbound-execution',
      status: 'background',
      message: 'Workflow execution is continuing in the background.',
      timestamp: expect.any(String),
      data: { workflowId: 'workflow-1', executionId: 'unbound-execution' },
    })
  })

  it('derives workflow outcome from a content-unavailable trusted terminal execution', async () => {
    getAsyncToolCall.mockResolvedValue({
      ...existingRow,
      toolName: 'run_workflow',
      args: { workflowId: 'workflow-1' },
    })
    getTrustedWorkflowToolExecution.mockResolvedValueOnce({
      executionId: 'execution-1',
      workflowId: 'workflow-1',
      status: 'failed',
      contentAvailable: false,
    })

    const response = await POST(
      createMockPostRequest({
        toolCallId: 'tool-call-123',
        executionId: 'execution-1',
        status: 'success',
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
    expect(publishToolConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'error', message: 'Workflow execution failed.' })
    )
    expect(await response.json()).toMatchObject({ status: 'error' })
  })

  it.each(['error', 'cancelled'] as const)(
    'uses a completed server execution instead of the submitted %s status',
    async (submittedStatus) => {
      getAsyncToolCall.mockResolvedValue({
        ...existingRow,
        toolName: 'run_workflow',
        args: { workflowId: 'workflow-1' },
      })
      getTrustedWorkflowToolExecution.mockResolvedValueOnce({
        executionId: 'execution-1',
        status: 'completed',
      })

      const response = await POST(
        createMockPostRequest({
          toolCallId: 'tool-call-123',
          executionId: 'execution-1',
          status: submittedStatus,
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
      expect(await response.json()).toMatchObject({ status: 'success' })
    }
  )

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
