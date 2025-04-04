import '../../__test-utils__/mock-dependencies'
import { beforeEach, describe, expect, it, Mock, vi } from 'vitest'
import { getAllBlocks } from '@/blocks'
import { executeProviderRequest } from '@/providers'
import { getProviderFromModel, transformBlockTool } from '@/providers/utils'
import { SerializedBlock } from '@/serializer/types'
import { executeTool, getTool } from '@/tools'
import { ExecutionContext } from '../../types'
import { AgentBlockHandler } from './agent-handler'

const mockExecuteProviderRequest = executeProviderRequest as Mock
const mockGetProviderFromModel = getProviderFromModel as Mock
const mockTransformBlockTool = transformBlockTool as Mock
const mockExecuteTool = executeTool as Mock
const mockGetTool = getTool as Mock
const mockGetAllBlocks = getAllBlocks as Mock

describe('AgentBlockHandler', () => {
  let handler: AgentBlockHandler
  let mockBlock: SerializedBlock
  let mockContext: ExecutionContext

  beforeEach(() => {
    handler = new AgentBlockHandler()
    mockBlock = {
      id: 'agent-block-1',
      metadata: { id: 'agent' },
      position: { x: 0, y: 0 },
      config: { tool: 'mock-tool', params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
    }
    mockContext = {
      workflowId: 'test-workflow-id',
      blockStates: new Map(),
      blockLogs: [],
      metadata: {},
      environmentVariables: { TEST_ENV: 'test' },
      decisions: { router: new Map(), condition: new Map() },
      loopIterations: new Map(),
      loopItems: new Map(),
      executedBlocks: new Set(),
      activeExecutionPath: new Set(),
    }

    // Reset mocks before each test using vi
    vi.clearAllMocks()

    // Default mock implementations (using vi)
    mockGetProviderFromModel.mockReturnValue('mock-provider')
    mockExecuteProviderRequest.mockResolvedValue({
      content: 'Mocked response content',
      model: 'mock-model',
      tokens: { prompt: 10, completion: 20, total: 30 },
      toolCalls: [],
      cost: 0.001,
      timing: { total: 100 },
    })
    mockTransformBlockTool.mockImplementation((tool: any) => ({
      id: tool.id || `block_${tool.title}`,
      name: tool.schema?.function?.name || tool.title,
      description: tool.schema?.function?.description || '',
      parameters: tool.schema?.function?.parameters || {},
    }))
    mockGetAllBlocks.mockReturnValue([])
    mockGetTool.mockReturnValue(undefined)
  })

  describe('canHandle', () => {
    it('should return true for blocks with metadata id "agent"', () => {
      expect(handler.canHandle(mockBlock)).toBe(true)
    })

    it('should return false for blocks without metadata id "agent"', () => {
      const nonAgentBlock: SerializedBlock = {
        ...mockBlock,
        metadata: { id: 'other-block' },
      }
      expect(handler.canHandle(nonAgentBlock)).toBe(false)
    })

    it('should return false for blocks without metadata', () => {
      const noMetadataBlock: SerializedBlock = {
        ...mockBlock,
        metadata: undefined,
      }
      expect(handler.canHandle(noMetadataBlock)).toBe(false)
    })
  })

  describe('execute', () => {
    it('should execute a basic agent block request', async () => {
      const inputs = {
        model: 'gpt-4o',
        systemPrompt: 'You are a helpful assistant.',
        context: 'User query: Hello!',
        temperature: 0.7,
        maxTokens: 100,
      }

      mockGetProviderFromModel.mockReturnValue('openai')

      const expectedProviderRequest = {
        model: 'gpt-4o',
        systemPrompt: 'You are a helpful assistant.',
        context: 'User query: Hello!',
        tools: undefined, // No tools in this basic case
        temperature: 0.7,
        maxTokens: 100,
        apiKey: undefined,
        responseFormat: undefined,
      }

      const expectedOutput = {
        response: {
          content: 'Mocked response content',
          model: 'mock-model',
          tokens: { prompt: 10, completion: 20, total: 30 },
          toolCalls: { list: [], count: 0 },
          providerTiming: { total: 100 },
          cost: 0.001,
        },
      }

      const result = await handler.execute(mockBlock, inputs, mockContext)

      expect(mockGetProviderFromModel).toHaveBeenCalledWith('gpt-4o')
      expect(mockExecuteProviderRequest).toHaveBeenCalledWith('openai', expectedProviderRequest)
      expect(result).toEqual(expectedOutput)
    })

    it('should execute with standard block tools', async () => {
      const inputs = {
        model: 'gpt-4o',
        context: 'Analyze this data.',
        tools: [
          {
            id: 'block_tool_1',
            title: 'Data Analysis Tool',
            operation: 'analyze',
            // Assume transformBlockTool resolves this based on blocks/tools
          },
        ],
      }

      const mockToolDetails = {
        id: 'block_tool_1',
        name: 'data_analysis_analyze',
        description: 'Analyzes data',
        parameters: { type: 'object', properties: { input: { type: 'string' } } },
      }

      mockTransformBlockTool.mockReturnValue(mockToolDetails)
      mockGetProviderFromModel.mockReturnValue('openai')

      const expectedProviderRequest = {
        model: 'gpt-4o',
        systemPrompt: undefined,
        context: 'Analyze this data.',
        tools: [mockToolDetails],
        temperature: undefined,
        maxTokens: undefined,
        apiKey: undefined,
        responseFormat: undefined,
      }

      const expectedOutput = {
        response: {
          content: 'Mocked response content',
          model: 'mock-model',
          tokens: { prompt: 10, completion: 20, total: 30 },
          toolCalls: { list: [], count: 0 }, // Assuming no tool calls in this mock response
          providerTiming: { total: 100 },
          cost: 0.001,
        },
      }

      const result = await handler.execute(mockBlock, inputs, mockContext)

      expect(mockTransformBlockTool).toHaveBeenCalledWith(
        inputs.tools[0],
        expect.objectContaining({ selectedOperation: 'analyze' })
      )
      expect(mockExecuteProviderRequest).toHaveBeenCalledWith('openai', expectedProviderRequest)
      expect(result).toEqual(expectedOutput)
    })

    it('should execute with custom tools (schema only and with code)', async () => {
      const inputs = {
        model: 'gpt-4o',
        context: 'Use the custom tools.',
        tools: [
          {
            type: 'custom-tool',
            title: 'Custom Schema Tool',
            schema: {
              function: {
                name: 'custom_schema_tool',
                description: 'A tool defined only by schema',
                parameters: {
                  type: 'object',
                  properties: { query: { type: 'string' } },
                },
              },
            },
          },
          {
            type: 'custom-tool',
            title: 'Custom Code Tool',
            // Use `input` directly, assuming function_execute makes params available
            // Use template literal to construct the code string
            code: `return { success: true, message: "Executed code with input: " + JSON.stringify(input) };`,
            schema: {
              function: {
                name: 'custom_code_tool',
                description: 'A tool with executable code',
                parameters: {
                  type: 'object',
                  properties: { input: { type: 'string' } },
                  required: ['input'],
                },
              },
            },
            timeout: 3000,
          },
        ],
      }

      const expectedFormattedTools = [
        {
          id: 'custom_Custom Schema Tool',
          name: 'custom_schema_tool',
          description: 'A tool defined only by schema',
          params: {},
          parameters: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: [],
          },
        },
        expect.objectContaining({
          id: 'custom_Custom Code Tool',
          name: 'custom_code_tool',
          description: 'A tool with executable code',
          parameters: {
            type: 'object',
            properties: { input: { type: 'string' } },
            required: ['input'],
          },
          executeFunction: expect.any(Function),
        }),
      ]

      mockExecuteTool.mockResolvedValue({
        success: true,
        output: { success: true, message: 'Executed code with input: test_input' },
      })

      mockGetProviderFromModel.mockReturnValue('openai')

      const expectedProviderRequest = {
        model: 'gpt-4o',
        systemPrompt: undefined,
        context: 'Use the custom tools.',
        tools: expectedFormattedTools,
        temperature: undefined,
        maxTokens: undefined,
        apiKey: undefined,
        responseFormat: undefined,
      }

      const expectedOutput = {
        response: {
          content: 'Mocked response content',
          model: 'mock-model',
          tokens: { prompt: 10, completion: 20, total: 30 },
          toolCalls: { list: [], count: 0 },
          providerTiming: { total: 100 },
          cost: 0.001,
        },
      }

      const result = await handler.execute(mockBlock, inputs, mockContext)

      expect(mockExecuteProviderRequest).toHaveBeenCalledWith('openai', expectedProviderRequest)
      expect(result).toEqual(expectedOutput)

      const codeToolDefinition = expectedProviderRequest.tools[1] as any // Cast for test
      if (codeToolDefinition && typeof codeToolDefinition.executeFunction === 'function') {
        const executionResult = await codeToolDefinition.executeFunction({ input: 'test_input' })
        expect(mockExecuteTool).toHaveBeenCalledWith('function_execute', {
          code: inputs.tools[1].code,
          input: 'test_input',
          timeout: 3000,
        })
        expect(executionResult).toEqual({
          success: true,
          message: 'Executed code with input: test_input',
        })
      }
    })

    it('should handle responseFormat with valid JSON', async () => {
      const inputs = {
        model: 'gpt-4o',
        context: 'Get structured data.',
        responseFormat: JSON.stringify({
          type: 'object',
          properties: { name: { type: 'string' }, age: { type: 'number' } },
        }),
      }

      const mockProviderResponse = {
        content: JSON.stringify({ name: 'Alice', age: 30 }),
        model: 'mock-model',
        tokens: { prompt: 10, completion: 5, total: 15 },
        toolCalls: [],
        cost: 0.0005,
        timing: { total: 50 },
      }
      mockExecuteProviderRequest.mockResolvedValue(mockProviderResponse)
      mockGetProviderFromModel.mockReturnValue('openai')

      const expectedProviderRequest = {
        model: 'gpt-4o',
        systemPrompt: undefined,
        context: 'Get structured data.',
        tools: undefined,
        temperature: undefined,
        maxTokens: undefined,
        apiKey: undefined,
        responseFormat: {
          name: 'response_schema',
          schema: {
            type: 'object',
            properties: { name: { type: 'string' }, age: { type: 'number' } },
          },
          strict: true,
        },
      }

      const expectedOutput = {
        response: {
          name: 'Alice',
          age: 30,
          tokens: { prompt: 10, completion: 5, total: 15 },
          toolCalls: { list: [], count: 0 },
          providerTiming: { total: 50 },
          cost: 0.0005,
        },
      }

      const result = await handler.execute(mockBlock, inputs, mockContext)

      expect(mockExecuteProviderRequest).toHaveBeenCalledWith('openai', expectedProviderRequest)
      expect(result).toEqual(expectedOutput)
    })

    it('should handle responseFormat when it is an empty string', async () => {
      const inputs = {
        model: 'gpt-4o',
        context: 'Simple request.',
        responseFormat: '', // Empty string should be ignored
      }

      const mockProviderResponse = {
        content: 'Simple text response',
        model: 'mock-model',
        tokens: { prompt: 5, completion: 10, total: 15 },
        toolCalls: [],
        cost: 0.0001,
        timing: { total: 40 },
      }
      mockExecuteProviderRequest.mockResolvedValue(mockProviderResponse)
      mockGetProviderFromModel.mockReturnValue('openai')

      const expectedProviderRequest = {
        model: 'gpt-4o',
        systemPrompt: undefined,
        context: 'Simple request.',
        tools: undefined,
        temperature: undefined,
        maxTokens: undefined,
        apiKey: undefined,
        responseFormat: undefined, // Should be undefined
      }

      const expectedOutput = {
        response: {
          content: 'Simple text response',
          model: 'mock-model',
          tokens: { prompt: 5, completion: 10, total: 15 },
          toolCalls: { list: [], count: 0 },
          providerTiming: { total: 40 },
          cost: 0.0001,
        },
      }

      const result = await handler.execute(mockBlock, inputs, mockContext)

      expect(mockExecuteProviderRequest).toHaveBeenCalledWith('openai', expectedProviderRequest)
      expect(result).toEqual(expectedOutput)
    })

    it('should throw an error for invalid JSON in responseFormat', async () => {
      const inputs = {
        model: 'gpt-4o',
        context: 'Request with invalid format.',
        responseFormat: '{ "invalid json ', // Malformed JSON string
      }

      mockGetProviderFromModel.mockReturnValue('openai')

      await expect(handler.execute(mockBlock, inputs, mockContext)).rejects.toThrow(
        /^Invalid response format: .*/ // Match any specific JSON error
      )

      expect(mockExecuteProviderRequest).not.toHaveBeenCalled()
    })

    it('should handle errors from the provider request', async () => {
      const inputs = {
        model: 'gpt-4o',
        context: 'Request that will fail.',
      }

      const providerError = new Error('Provider API Error')
      mockExecuteProviderRequest.mockRejectedValue(providerError)
      mockGetProviderFromModel.mockReturnValue('openai')

      await expect(handler.execute(mockBlock, inputs, mockContext)).rejects.toThrow(
        'Provider API Error'
      )

      expect(mockExecuteProviderRequest).toHaveBeenCalled()
    })
  })
})
