import '../../__test-utils__/mock-dependencies'
import { beforeEach, describe, expect, it, Mock, vi } from 'vitest'
import { isHostedVersion } from '@/lib/utils'
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
const mockIsHostedVersion = isHostedVersion as Mock

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
      completedLoops: new Set(),
      executedBlocks: new Set(),
      activeExecutionPath: new Set(),
    }

    // Reset mocks before each test using vi
    vi.clearAllMocks()

    // Default mock implementations (using vi)
    mockIsHostedVersion.mockReturnValue(false) // Default to non-hosted env for tests
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
        apiKey: 'test-api-key', // Add API key for non-hosted env
      }

      mockGetProviderFromModel.mockReturnValue('openai')

      const expectedProviderRequest = {
        model: 'gpt-4o',
        systemPrompt: 'You are a helpful assistant.',
        context: 'User query: Hello!',
        tools: undefined, // No tools in this basic case
        temperature: 0.7,
        maxTokens: 100,
        apiKey: 'test-api-key',
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

    it('should not require API key for gpt-4o on hosted version', async () => {
      // Mock hosted environment
      mockIsHostedVersion.mockReturnValue(true)

      const inputs = {
        model: 'gpt-4o',
        systemPrompt: 'You are a helpful assistant.',
        context: 'User query: Hello!',
        temperature: 0.7,
        maxTokens: 100,
        // No API key provided
      }

      mockGetProviderFromModel.mockReturnValue('openai')

      const expectedProviderRequest = {
        model: 'gpt-4o',
        systemPrompt: 'You are a helpful assistant.',
        context: 'User query: Hello!',
        tools: undefined,
        temperature: 0.7,
        maxTokens: 100,
        apiKey: undefined,
        responseFormat: undefined,
      }

      const result = await handler.execute(mockBlock, inputs, mockContext)

      expect(mockIsHostedVersion).toHaveBeenCalled()
      expect(mockExecuteProviderRequest).toHaveBeenCalledWith('openai', expectedProviderRequest)
      expect(result).toHaveProperty('response.content')
    })

    it('should execute with standard block tools', async () => {
      const inputs = {
        model: 'gpt-4o',
        context: 'Analyze this data.',
        apiKey: 'test-api-key', // Add API key for non-hosted env
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
        apiKey: 'test-api-key',
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
        apiKey: 'test-api-key', // Add API key for non-hosted env
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
                  properties: {
                    input: { type: 'string' },
                  },
                },
              },
            },
          },
          {
            type: 'custom-tool',
            title: 'Custom Code Tool',
            code: 'return { result: input * 2 }',
            timeout: 1000,
            schema: {
              function: {
                name: 'custom_code_tool',
                description: 'A tool with code execution',
                parameters: {
                  type: 'object',
                  properties: {
                    input: { type: 'number' },
                  },
                },
              },
            },
          },
        ],
      }

      mockGetProviderFromModel.mockReturnValue('openai')

      // Process the tools to see what they'll be transformed into
      await handler.execute(mockBlock, inputs, mockContext)

      // Verify that mockExecuteProviderRequest was called
      expect(mockExecuteProviderRequest).toHaveBeenCalledWith(
        'openai',
        expect.objectContaining({
          model: 'gpt-4o',
          context: 'Use the custom tools.',
          apiKey: 'test-api-key',
          tools: expect.arrayContaining([
            expect.objectContaining({
              id: 'custom_Custom Schema Tool',
              name: 'custom_schema_tool',
              description: 'A tool defined only by schema',
            }),
            expect.objectContaining({
              id: 'custom_Custom Code Tool',
              name: 'custom_code_tool',
              description: 'A tool with code execution',
              executeFunction: expect.any(Function),
            }),
          ]),
        })
      )
    })

    it('should handle responseFormat with valid JSON', async () => {
      const inputs = {
        model: 'gpt-4o',
        context: 'Format this output.',
        apiKey: 'test-api-key', // Add API key for non-hosted env
        responseFormat: JSON.stringify({
          type: 'object',
          properties: {
            result: { type: 'string' },
            score: { type: 'number' },
          },
          required: ['result'],
        }),
      }

      // Mock a JSON response from provider
      mockExecuteProviderRequest.mockResolvedValue({
        content: '{"result": "Success", "score": 0.95}',
        model: 'mock-model',
        tokens: { prompt: 10, completion: 20, total: 30 },
        timing: { total: 100 },
      })

      mockGetProviderFromModel.mockReturnValue('openai')

      const result = await handler.execute(mockBlock, inputs, mockContext)

      // Cast the result to an object with response property for the test
      const typedResult = result as { response: any }
      expect(typedResult.response).toHaveProperty('result', 'Success')
      expect(typedResult.response).toHaveProperty('score', 0.95)
      expect(typedResult.response).toHaveProperty('tokens')
      expect(typedResult.response).toHaveProperty('providerTiming')
    })

    it('should handle responseFormat when it is an empty string', async () => {
      const inputs = {
        model: 'gpt-4o',
        context: 'No format needed.',
        apiKey: 'test-api-key', // Add API key for non-hosted env
        responseFormat: '',
      }

      mockGetProviderFromModel.mockReturnValue('openai')

      const result = await handler.execute(mockBlock, inputs, mockContext)

      // Cast the result to an object with response property for the test
      const typedResult = result as { response: any }
      expect(typedResult.response).toHaveProperty('content', 'Mocked response content')
      expect(typedResult.response).toHaveProperty('model', 'mock-model')
    })

    it('should throw an error for invalid JSON in responseFormat', async () => {
      const inputs = {
        model: 'gpt-4o',
        context: 'Format this output.',
        apiKey: 'test-api-key',
        responseFormat: '{invalid-json',
      }

      await expect(handler.execute(mockBlock, inputs, mockContext)).rejects.toThrow(
        'Invalid response'
      )
    })

    it('should handle errors from the provider request', async () => {
      const inputs = {
        model: 'gpt-4o',
        context: 'This will fail.',
        apiKey: 'test-api-key', // Add API key for non-hosted env
      }

      mockGetProviderFromModel.mockReturnValue('openai')
      mockExecuteProviderRequest.mockRejectedValue(new Error('Provider API Error'))

      await expect(handler.execute(mockBlock, inputs, mockContext)).rejects.toThrow(
        'Provider API Error'
      )
    })
  })
})
