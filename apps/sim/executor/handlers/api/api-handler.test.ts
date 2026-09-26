import '@sim/testing/mocks/executor'

import { inputValidationMock, inputValidationMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { BlockType } from '@/executor/constants'
import { ApiBlockHandler } from '@/executor/handlers/api/api-handler'
import type { ExecutionContext } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'
import { executeTool } from '@/tools'
import type { ToolConfig } from '@/tools/types'
import { getTool } from '@/tools/utils'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

const mockGetTool = vi.mocked(getTool)
const mockExecuteTool = executeTool as Mock
const mockValidateUrlWithDNS = inputValidationMockFns.mockValidateUrlWithDNS

describe('ApiBlockHandler', () => {
  let handler: ApiBlockHandler
  let mockBlock: SerializedBlock
  let mockContext: ExecutionContext
  let mockApiTool: ToolConfig

  beforeEach(() => {
    handler = new ApiBlockHandler()
    mockBlock = {
      id: 'api-block-1',
      metadata: { id: BlockType.API, name: 'Test API Block' },
      position: { x: 10, y: 10 },
      config: { tool: 'http_request', params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
    }
    mockContext = {
      workflowId: 'test-workflow-id',
      blockStates: new Map(),
      blockLogs: [],
      metadata: { duration: 0 },
      environmentVariables: {},
      decisions: { router: new Map(), condition: new Map() },
      loopExecutions: new Map(),
      executedBlocks: new Set(),
      activeExecutionPath: new Set(),
      completedLoops: new Set(),
    }
    mockApiTool = {
      id: 'http_request',
      name: 'HTTP Request Tool',
      description: 'Makes an HTTP request',
      version: '1.0',
      params: {
        url: { type: 'string', required: true },
        method: { type: 'string', default: 'GET' },
        headers: { type: 'object' },
        body: { type: 'any' },
      },
      request: {
        url: 'https://example.com/api',
        method: 'POST',
        headers: () => ({ 'Content-Type': 'application/json' }),
        body: (params) => params,
      },
    }

    mockValidateUrlWithDNS.mockResolvedValue({
      isValid: true,
      resolvedIP: '93.184.216.34',
      originalHostname: 'example.com',
    })

    // Set up mockGetTool to return the mockApiTool
    mockGetTool.mockImplementation((toolId) => {
      if (toolId === 'http_request') {
        return mockApiTool
      }
      return undefined
    })

    // Default mock implementations
    mockExecuteTool.mockResolvedValue({ success: true, output: { data: 'Success' } })
  })

  it('strips quotes a block reference left around the URL', async () => {
    await handler.execute(mockContext, mockBlock, { url: '"https://api.example.com/data"' })

    expect(mockExecuteTool).toHaveBeenCalledWith(
      'http_request',
      expect.objectContaining({ url: 'https://api.example.com/data' }),
      expect.anything()
    )
  })

  it('should parse JSON string body correctly', async () => {
    const inputs = {
      url: 'https://example.com/api',
      body: '  { "key": "value", "nested": { "num": 1 } }  ', // With extra whitespace
    }
    const expectedParsedBody = { key: 'value', nested: { num: 1 } }

    await handler.execute(mockContext, mockBlock, inputs)

    expect(mockExecuteTool).toHaveBeenCalledWith(
      'http_request',
      expect.objectContaining({ body: expectedParsedBody }),
      { executionContext: mockContext }
    )
  })

  it('should handle API errors correctly and format message', async () => {
    const inputs = {
      url: 'https://example.com/notfound',
      method: 'GET',
    }
    const errorOutput = { status: 404, statusText: 'Not Found' }
    mockExecuteTool.mockResolvedValue({
      success: false,
      output: errorOutput,
      error: 'Resource not found',
    })

    await expect(handler.execute(mockContext, mockBlock, inputs)).rejects.toThrow(
      'HTTP Request failed: URL: https://example.com/notfound | Method: GET | Error: Resource not found | Status: 404 | Status text: Not Found - The requested resource was not found'
    )
    expect(mockExecuteTool).toHaveBeenCalled()
  })
})
