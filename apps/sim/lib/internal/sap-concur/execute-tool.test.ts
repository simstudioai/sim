import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockExecuteApi, mockExecuteUpload } = vi.hoisted(() => ({
  mockExecuteApi: vi.fn(),
  mockExecuteUpload: vi.fn(),
}))

vi.mock('@/lib/internal/sap-concur/operations', () => {
  class SapConcurOperationError extends Error {
    constructor(
      readonly status: number,
      readonly body: { success: false; error: string; status?: number },
      readonly headers: HeadersInit = {}
    ) {
      super(body.error)
      this.name = 'SapConcurOperationError'
    }
  }
  return {
    executeSapConcurApiOperation: mockExecuteApi,
    executeSapConcurUploadOperation: mockExecuteUpload,
    SapConcurOperationError,
  }
})

vi.mock('@/lib/api/server/validation', () => ({
  DEFAULT_MAX_JSON_BODY_BYTES: 1024,
}))

import { executeSapConcurTool } from '@/lib/internal/sap-concur/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

function call(overrides: Partial<InternalToolOperationCall> = {}): InternalToolOperationCall {
  return {
    toolId: 'sap_concur_get_budget',
    input: {
      clientId: 'client-id',
      clientSecret: 'client-secret',
      path: '/budget/v4/budgets/budget-1',
      method: 'GET',
    },
    headers: new Headers(),
    context: {
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
    },
    requestId: 'request-1',
    ...overrides,
  }
}

beforeEach(() => {
  mockExecuteApi.mockResolvedValue({
    body: { success: true, output: { status: 200, data: { id: 'budget-1' } } },
    headers: { 'retry-after': '5' },
  })
  mockExecuteUpload.mockResolvedValue({
    body: { success: true, output: { status: 201, data: { id: 'receipt-1' } } },
    headers: { location: 'https://us.api.concursolutions.com/receipts/receipt-1' },
  })
})

describe('executeSapConcurTool', () => {
  it('requires trusted user identity before dispatching a protected upload', async () => {
    const response = await executeSapConcurTool(
      call({
        toolId: 'sap_concur_upload_receipt_image',
        context: { workflowId: 'workflow-1', workspaceId: 'workspace-1' },
        input: {
          clientId: 'client-id',
          clientSecret: 'client-secret',
          operation: 'upload_receipt_image',
          userId: 'concur-user-1',
          receipt: { key: 'workspace-file-key', name: 'receipt.pdf', size: 10 },
        },
      })
    )

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({
      success: false,
      error: 'Authentication required',
    })
    expect(mockExecuteUpload).not.toHaveBeenCalled()
  })

  it('rejects oversized operation input before schema traversal or provider work', async () => {
    const response = await executeSapConcurTool(
      call({
        input: {
          clientId: 'client-id',
          clientSecret: 'client-secret',
          path: '/budget/v4/budgets/budget-1',
          body: 'x'.repeat(1024),
        },
      })
    )

    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({
      success: false,
      error: 'Request body exceeds the maximum allowed size of 1024 bytes',
    })
    expect(mockExecuteApi).not.toHaveBeenCalled()
  })
})
