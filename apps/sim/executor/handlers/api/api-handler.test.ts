import '../../__test-utils__/mock-dependencies'

import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { BlockType } from '@/executor/consts'
import { ApiBlockHandler } from '@/executor/handlers/api/api-handler'
import type { ExecutionContext } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'
import { executeTool } from '@/tools'
import type { ToolConfig } from '@/tools/types'
import { getTool } from '@/tools/utils'

const mockGetTool = vi.mocked(getTool)
const mockExecuteTool = executeTool as Mock

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
      loopIterations: new Map(),
      loopItems: new Map(),
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

    // Reset mocks using vi
    vi.clearAllMocks()

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

  it('should handle api blocks', () => {
    expect(handler.canHandle(mockBlock)).toBe(true)
    const nonApiBlock: SerializedBlock = {
      ...mockBlock,
      metadata: { id: 'other-block' },
    }
    expect(handler.canHandle(nonApiBlock)).toBe(false)
  })

  it('should execute api block correctly with valid inputs', async () => {
    const inputs = {
      url: 'https://example.com/api',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'value' }),
    }

    const expectedOutput = { data: 'Success' }

    mockExecuteTool.mockResolvedValue({ success: true, output: { data: 'Success' } })

    const result = await handler.execute(mockBlock, inputs, mockContext)

    expect(mockGetTool).toHaveBeenCalledWith('http_request')
    expect(mockExecuteTool).toHaveBeenCalledWith('http_request', {
      ...inputs,
      body: { key: 'value' }, // Expect parsed body
      _context: { workflowId: 'test-workflow-id' },
    })
    expect(result).toEqual(expectedOutput)
  })

  it('should handle missing URL gracefully (empty success response)', async () => {
    const inputs = {
      url: '', // Empty URL
      method: 'GET',
    }

    const expectedOutput = { data: null, status: 200, headers: {} }

    const result = await handler.execute(mockBlock, inputs, mockContext)

    expect(mockGetTool).toHaveBeenCalledWith('http_request')
    expect(mockExecuteTool).not.toHaveBeenCalled()
    expect(result).toEqual(expectedOutput)
  })

  it('should throw error for invalid URL format (no protocol)', async () => {
    const inputs = { url: 'example.com/api' }

    await expect(handler.execute(mockBlock, inputs, mockContext)).rejects.toThrow(
      'Invalid URL: "example.com/api" - URL must include protocol (try "https://example.com/api")'
    )
    expect(mockExecuteTool).not.toHaveBeenCalled()
  })

  it('should throw error for generally invalid URL format', async () => {
    const inputs = { url: 'htp:/invalid-url' }

    await expect(handler.execute(mockBlock, inputs, mockContext)).rejects.toThrow(
      /^Invalid URL: "htp:\/invalid-url" - URL must include protocol/
    )
    expect(mockExecuteTool).not.toHaveBeenCalled()
  })

  it('should parse JSON string body correctly', async () => {
    const inputs = {
      url: 'https://example.com/api',
      body: '  { "key": "value", "nested": { "num": 1 } }  ', // With extra whitespace
    }
    const expectedParsedBody = { key: 'value', nested: { num: 1 } }

    await handler.execute(mockBlock, inputs, mockContext)

    expect(mockExecuteTool).toHaveBeenCalledWith(
      'http_request',
      expect.objectContaining({ body: expectedParsedBody })
    )
  })

  it('should keep non-JSON string body as string', async () => {
    const inputs = {
      url: 'https://example.com/api',
      body: 'This is plain text',
    }

    await handler.execute(mockBlock, inputs, mockContext)

    expect(mockExecuteTool).toHaveBeenCalledWith(
      'http_request',
      expect.objectContaining({ body: 'This is plain text' })
    )
  })

  it('should handle null body by converting to undefined', async () => {
    const inputs = {
      url: 'https://example.com/api',
      body: null,
    }

    await handler.execute(mockBlock, inputs, mockContext)

    expect(mockExecuteTool).toHaveBeenCalledWith(
      'http_request',
      expect.objectContaining({ body: undefined })
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

    await expect(handler.execute(mockBlock, inputs, mockContext)).rejects.toThrow(
      'HTTP Request failed: URL: https://example.com/notfound | Method: GET | Error: Resource not found | Status: 404 | Status text: Not Found - The requested resource was not found'
    )
    expect(mockExecuteTool).toHaveBeenCalled()
  })

  it('should throw error if tool is not found', async () => {
    const inputs = { url: 'https://example.com' }

    // Override mock to return undefined for this test
    mockGetTool.mockImplementation(() => undefined)

    await expect(handler.execute(mockBlock, inputs, mockContext)).rejects.toThrow(
      'Tool not found: http_request'
    )
    expect(mockExecuteTool).not.toHaveBeenCalled()
  })

  it('should handle CORS error suggestion', async () => {
    const inputs = { url: 'https://example.com/cors-issue' }
    mockExecuteTool.mockResolvedValue({
      success: false,
      error: 'Request failed due to CORS policy',
    })

    await expect(handler.execute(mockBlock, inputs, mockContext)).rejects.toThrow(
      /CORS policy prevented the request, try using a proxy or server-side request/
    )
  })

  it('should handle generic fetch error suggestion', async () => {
    const inputs = { url: 'https://unreachable.local' }
    mockExecuteTool.mockResolvedValue({ success: false, error: 'Failed to fetch' })

    await expect(handler.execute(mockBlock, inputs, mockContext)).rejects.toThrow(
      /Network error, check if the URL is accessible and if you have internet connectivity/
    )
  })
})
