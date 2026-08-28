/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockOperations = vi.hoisted(() => ({
  executeTextractParse: vi.fn(),
  executeTextractAnalyzeExpense: vi.fn(),
  executeTextractAnalyzeId: vi.fn(),
}))

vi.mock('@/lib/internal/textract/operations', () => mockOperations)

import { executeTextractTool } from '@/lib/internal/textract/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const CONNECTION = {
  accessKeyId: 'access-key',
  secretAccessKey: 'secret-key',
  region: 'us-east-1',
}

function createRequest(
  overrides: Partial<InternalToolOperationCall> = {}
): InternalToolOperationCall {
  return {
    toolId: 'textract_parser',
    input: {
      ...CONNECTION,
      processingMode: 'sync',
      filePath: 'https://example.com/document.png',
    },
    headers: new Headers({ 'content-type': 'application/json' }),
    context: {
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      metadata: {},
    },
    requestId: 'request-1',
    ...overrides,
  }
}

const TOOL_CASES = [
  {
    toolId: 'textract_parser',
    input: {
      ...CONNECTION,
      processingMode: 'sync',
      filePath: 'https://example.com/document.png',
    },
    operation: mockOperations.executeTextractParse,
  },
  {
    toolId: 'textract_parser_v2',
    input: {
      ...CONNECTION,
      processingMode: 'sync',
      filePath: 'https://example.com/document.png',
    },
    operation: mockOperations.executeTextractParse,
  },
  {
    toolId: 'textract_analyze_expense',
    input: {
      ...CONNECTION,
      processingMode: 'sync',
      filePath: 'https://example.com/receipt.png',
    },
    operation: mockOperations.executeTextractAnalyzeExpense,
  },
  {
    toolId: 'textract_analyze_id',
    input: { ...CONNECTION, filePath: 'https://example.com/id.png' },
    operation: mockOperations.executeTextractAnalyzeId,
  },
] as const

describe('executeTextractTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(TOOL_CASES)('validates and dispatches $toolId', async ({ toolId, input, operation }) => {
    const controller = new AbortController()
    const headers = new Headers({ 'content-type': 'application/json' })
    operation.mockResolvedValue(Response.json({ success: true, output: { toolId } }))

    const response = await executeTextractTool(
      createRequest({
        toolId,
        input,
        headers,
        signal: controller.signal,
      })
    )

    expect(response.status).toBe(200)
    expect(operation).toHaveBeenCalledWith(input, {
      headers,
      userId: 'user-1',
      requestId: 'request-1',
      signal: controller.signal,
    })
  })

  it('returns the route-compatible validation envelope before provider work', async () => {
    const response = await executeTextractTool(
      createRequest({ input: { ...CONNECTION, processingMode: 'sync' } })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      details: expect.any(Array),
    })
    expect(mockOperations.executeTextractParse).not.toHaveBeenCalled()
  })

  it('fails closed without a trusted execution user', async () => {
    const response = await executeTextractTool(
      createRequest({
        context: {
          workflowId: 'workflow-1',
          workspaceId: 'workspace-1',
          metadata: {},
        },
      })
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ success: false, error: 'Unauthorized' })
    expect(mockOperations.executeTextractParse).not.toHaveBeenCalled()
  })

  it('propagates cancellation without starting provider work', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(
      executeTextractTool(createRequest({ signal: controller.signal }))
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mockOperations.executeTextractParse).not.toHaveBeenCalled()
  })
})
