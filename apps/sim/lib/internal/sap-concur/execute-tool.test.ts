/**
 * @vitest-environment node
 */
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

import { executeSapConcurTool, SAP_CONCUR_TOOL_IDS } from '@/lib/internal/sap-concur/execute-tool'
import { SapConcurOperationError } from '@/lib/internal/sap-concur/operations'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'
import * as sapConcurTools from '@/tools/sap_concur'

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
  vi.clearAllMocks()
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
  it('publishes exactly the 70 canonical SAP Concur IDs', () => {
    const declaredIds = Object.values(sapConcurTools).map((tool) => tool.id)
    expect(SAP_CONCUR_TOOL_IDS).toHaveLength(70)
    expect(new Set(SAP_CONCUR_TOOL_IDS).size).toBe(70)
    expect([...SAP_CONCUR_TOOL_IDS].sort()).toEqual(declaredIds.sort())
  })

  it('validates and dispatches API operations with the trusted cancellation signal', async () => {
    const controller = new AbortController()
    const response = await executeSapConcurTool(call({ signal: controller.signal }))

    expect(response.status).toBe(200)
    expect(response.headers.get('retry-after')).toBe('5')
    expect(await response.json()).toEqual({
      success: true,
      output: { status: 200, data: { id: 'budget-1' } },
    })
    expect(mockExecuteApi).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'client-id',
        datacenter: 'us.api.concursolutions.com',
        grantType: 'client_credentials',
        path: '/budget/v4/budgets/budget-1',
      }),
      {
        requestId: 'request-1',
        signal: controller.signal,
        userId: 'user-1',
      }
    )
  })

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

  it('dispatches protected uploads without losing their provider response headers', async () => {
    const response = await executeSapConcurTool(
      call({
        toolId: 'sap_concur_upload_receipt_image',
        input: {
          clientId: 'client-id',
          clientSecret: 'client-secret',
          operation: 'upload_receipt_image',
          userId: 'concur-user-1',
          receipt: { key: 'workspace-file-key', name: 'receipt.pdf', size: 10 },
        },
      })
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toContain('/receipts/receipt-1')
    expect(mockExecuteUpload).toHaveBeenCalledOnce()
  })

  it('preserves provider status, body, and retry headers', async () => {
    mockExecuteApi.mockRejectedValueOnce(
      new SapConcurOperationError(
        429,
        { success: false, error: 'Rate limited', status: 429 },
        { 'retry-after': '30' }
      )
    )

    const response = await executeSapConcurTool(call())

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('30')
    expect(await response.json()).toEqual({
      success: false,
      error: 'Rate limited',
      status: 429,
    })
  })

  it('rejects invalid operation input before provider work', async () => {
    const response = await executeSapConcurTool(call({ input: { clientId: 'client-id' } }))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      success: false,
      error: 'Invalid input: expected string, received undefined',
    })
    expect(mockExecuteApi).not.toHaveBeenCalled()
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

  it('rejects IDs outside the canonical family', async () => {
    const response = await executeSapConcurTool(call({ toolId: 'sap_concur_not_real' }))

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      success: false,
      error: 'Unsupported SAP Concur tool: sap_concur_not_real',
    })
    expect(mockExecuteApi).not.toHaveBeenCalled()
  })

  it('aborts before validation or provider dispatch', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('Cancelled', 'AbortError'))

    await expect(executeSapConcurTool(call({ signal: controller.signal }))).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(mockExecuteApi).not.toHaveBeenCalled()
  })

  it('does not convert an abort after provider dispatch into a tool error', async () => {
    const controller = new AbortController()
    mockExecuteApi.mockImplementationOnce(async () => {
      controller.abort(new DOMException('Cancelled', 'AbortError'))
      return {
        body: { success: true, output: { status: 200, data: null } },
        headers: {},
      }
    })

    await expect(executeSapConcurTool(call({ signal: controller.signal }))).rejects.toMatchObject({
      name: 'AbortError',
    })
  })
})
