import '../../__test-utils__/mock-dependencies'

import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { BlockType } from '@/executor/consts'
import { GenericBlockHandler } from '@/executor/handlers/generic/generic-handler'
import type { ExecutionContext } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'
import { executeTool } from '@/tools'
import type { ToolConfig } from '@/tools/types'
import { getTool } from '@/tools/utils'

const mockGetTool = vi.mocked(getTool)
const mockExecuteTool = executeTool as Mock

describe('GenericBlockHandler', () => {
  let handler: GenericBlockHandler
  let mockBlock: SerializedBlock
  let mockContext: ExecutionContext
  let mockTool: ToolConfig

  beforeEach(() => {
    handler = new GenericBlockHandler()

    mockBlock = {
      id: 'generic-block-1',
      metadata: { id: 'custom-type', name: 'Test Generic Block' },
      position: { x: 40, y: 40 },
      config: { tool: 'some_custom_tool', params: { param1: 'value1' } },
      inputs: { param1: 'string' }, // Using ParamType strings
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

    mockTool = {
      id: 'some_custom_tool',
      name: 'Some Custom Tool',
      description: 'Does something custom',
      version: '1.0',
      params: { param1: { type: 'string' } },
      request: {
        url: 'https://example.com/api',
        method: 'POST',
        headers: () => ({ 'Content-Type': 'application/json' }),
        body: (params) => params,
      },
    }

    // Reset mocks using vi
    vi.clearAllMocks()

    // Set up mockGetTool to return mockTool
    mockGetTool.mockImplementation((toolId) => {
      if (toolId === 'some_custom_tool') {
        return mockTool
      }
      return undefined
    })

    // Default mock implementations
    mockExecuteTool.mockResolvedValue({ success: true, output: { customResult: 'OK' } })
  })

  it.concurrent('should always handle any block type', () => {
    const agentBlock: SerializedBlock = { ...mockBlock, metadata: { id: BlockType.AGENT } }
    expect(handler.canHandle(agentBlock)).toBe(true)
    expect(handler.canHandle(mockBlock)).toBe(true)
    const noMetaIdBlock: SerializedBlock = { ...mockBlock, metadata: undefined }
    expect(handler.canHandle(noMetaIdBlock)).toBe(true)
  })

  it.concurrent('should execute generic block by calling its associated tool', async () => {
    const inputs = { param1: 'resolvedValue1' }
    const expectedToolParams = {
      ...inputs,
      _context: { workflowId: mockContext.workflowId },
    }
    const expectedOutput: any = { customResult: 'OK' }

    const result = await handler.execute(mockBlock, inputs, mockContext)

    expect(mockGetTool).toHaveBeenCalledWith('some_custom_tool')
    expect(mockExecuteTool).toHaveBeenCalledWith('some_custom_tool', expectedToolParams)
    expect(result).toEqual(expectedOutput)
  })

  it('should throw error if the associated tool is not found', async () => {
    const inputs = { param1: 'value' }

    // Override mock to return undefined for this test
    mockGetTool.mockImplementation(() => undefined)

    await expect(handler.execute(mockBlock, inputs, mockContext)).rejects.toThrow(
      'Tool not found: some_custom_tool'
    )
    expect(mockExecuteTool).not.toHaveBeenCalled()
  })

  it('should handle tool execution errors correctly', async () => {
    const inputs = { param1: 'value' }
    const errorResult = {
      success: false,
      error: 'Custom tool failed',
      output: { detail: 'error detail' },
    }
    mockExecuteTool.mockResolvedValue(errorResult)

    await expect(handler.execute(mockBlock, inputs, mockContext)).rejects.toThrow(
      'Custom tool failed'
    )

    // Re-execute to check error properties after catching
    try {
      await handler.execute(mockBlock, inputs, mockContext)
    } catch (e: any) {
      expect(e.toolId).toBe('some_custom_tool')
      expect(e.blockName).toBe('Test Generic Block')
      expect(e.output).toEqual({ detail: 'error detail' })
    }

    expect(mockExecuteTool).toHaveBeenCalledTimes(2) // Called twice now
  })

  it.concurrent('should handle tool execution errors with no specific message', async () => {
    const inputs = { param1: 'value' }
    const errorResult = { success: false, output: {} }
    mockExecuteTool.mockResolvedValue(errorResult)

    await expect(handler.execute(mockBlock, inputs, mockContext)).rejects.toThrow(
      'Block execution of Some Custom Tool failed with no error message'
    )
  })

  describe('Knowledge block cost tracking', () => {
    beforeEach(() => {
      // Set up knowledge block mock
      mockBlock = {
        ...mockBlock,
        config: { tool: 'knowledge_search', params: {} },
      }

      mockTool = {
        ...mockTool,
        id: 'knowledge_search',
        name: 'Knowledge Search',
      }

      mockGetTool.mockImplementation((toolId) => {
        if (toolId === 'knowledge_search') {
          return mockTool
        }
        return undefined
      })
    })

    it.concurrent(
      'should extract and restructure cost information from knowledge tools',
      async () => {
        const inputs = { query: 'test query' }
        const mockToolResponse = {
          success: true,
          output: {
            results: [],
            query: 'test query',
            totalResults: 0,
            cost: {
              input: 0.00001042,
              output: 0,
              total: 0.00001042,
              tokens: {
                prompt: 521,
                completion: 0,
                total: 521,
              },
              model: 'text-embedding-3-small',
              pricing: {
                input: 0.02,
                output: 0,
                updatedAt: '2025-07-10',
              },
            },
          },
        }

        mockExecuteTool.mockResolvedValue(mockToolResponse)

        const result = await handler.execute(mockBlock, inputs, mockContext)

        // Verify cost information is restructured correctly for enhanced logging
        expect(result).toEqual({
          results: [],
          query: 'test query',
          totalResults: 0,
          cost: {
            input: 0.00001042,
            output: 0,
            total: 0.00001042,
          },
          tokens: {
            prompt: 521,
            completion: 0,
            total: 521,
          },
          model: 'text-embedding-3-small',
        })
      }
    )

    it.concurrent('should handle knowledge_upload_chunk cost information', async () => {
      // Update to upload_chunk tool
      mockBlock.config.tool = 'knowledge_upload_chunk'
      mockTool.id = 'knowledge_upload_chunk'
      mockTool.name = 'Knowledge Upload Chunk'

      mockGetTool.mockImplementation((toolId) => {
        if (toolId === 'knowledge_upload_chunk') {
          return mockTool
        }
        return undefined
      })

      const inputs = { content: 'test content' }
      const mockToolResponse = {
        success: true,
        output: {
          data: {
            id: 'chunk-123',
            content: 'test content',
            chunkIndex: 0,
          },
          message: 'Successfully uploaded chunk',
          documentId: 'doc-123',
          cost: {
            input: 0.00000521,
            output: 0,
            total: 0.00000521,
            tokens: {
              prompt: 260,
              completion: 0,
              total: 260,
            },
            model: 'text-embedding-3-small',
            pricing: {
              input: 0.02,
              output: 0,
              updatedAt: '2025-07-10',
            },
          },
        },
      }

      mockExecuteTool.mockResolvedValue(mockToolResponse)

      const result = await handler.execute(mockBlock, inputs, mockContext)

      // Verify cost information is restructured correctly
      expect(result).toEqual({
        data: {
          id: 'chunk-123',
          content: 'test content',
          chunkIndex: 0,
        },
        message: 'Successfully uploaded chunk',
        documentId: 'doc-123',
        cost: {
          input: 0.00000521,
          output: 0,
          total: 0.00000521,
        },
        tokens: {
          prompt: 260,
          completion: 0,
          total: 260,
        },
        model: 'text-embedding-3-small',
      })
    })

    it('should pass through output unchanged for knowledge tools without cost info', async () => {
      const inputs = { query: 'test query' }
      const mockToolResponse = {
        success: true,
        output: {
          results: [],
          query: 'test query',
          totalResults: 0,
          // No cost information
        },
      }

      mockExecuteTool.mockResolvedValue(mockToolResponse)

      const result = await handler.execute(mockBlock, inputs, mockContext)

      // Should return original output without cost transformation
      expect(result).toEqual({
        results: [],
        query: 'test query',
        totalResults: 0,
      })
    })

    it.concurrent('should not process cost info for non-knowledge tools', async () => {
      // Set up non-knowledge tool
      mockBlock.config.tool = 'some_other_tool'
      mockTool.id = 'some_other_tool'

      mockGetTool.mockImplementation((toolId) => {
        if (toolId === 'some_other_tool') {
          return mockTool
        }
        return undefined
      })

      const inputs = { param: 'value' }
      const mockToolResponse = {
        success: true,
        output: {
          result: 'success',
          cost: {
            input: 0.001,
            output: 0.002,
            total: 0.003,
            tokens: { prompt: 100, completion: 50, total: 150 },
            model: 'some-model',
          },
        },
      }

      mockExecuteTool.mockResolvedValue(mockToolResponse)

      const result = await handler.execute(mockBlock, inputs, mockContext)

      // Should return original output without cost transformation
      expect(result).toEqual({
        result: 'success',
        cost: {
          input: 0.001,
          output: 0.002,
          total: 0.003,
          tokens: { prompt: 100, completion: 50, total: 150 },
          model: 'some-model',
        },
      })
    })
  })
})
