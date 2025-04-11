import '../../__test-utils__/mock-dependencies'
import { beforeEach, describe, expect, it, Mock, vi } from 'vitest'
import { isHostedVersion } from '@/lib/utils'
import { getAllBlocks } from '@/blocks'
import { getProviderFromModel, transformBlockTool } from '@/providers/utils'
import { SerializedBlock, SerializedWorkflow } from '@/serializer/types'
import { executeTool, getTool } from '@/tools'
import { ExecutionContext } from '../../types'
import { AgentBlockHandler } from './agent-handler'

const mockFetch = global.fetch as Mock
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
    vi.clearAllMocks()
    mockBlock = {
      id: 'test-agent-block',
      metadata: { id: 'agent', name: 'Test Agent' },
      type: 'agent',
      position: { x: 0, y: 0 },
      config: {
        tool: 'mock-tool',
        params: {},
      },
      inputs: {},
      outputs: {},
      enabled: true,
    } as SerializedBlock
    mockContext = {
      workflowId: 'test-workflow',
      blockStates: new Map(),
      blockLogs: [],
      metadata: { startTime: new Date().toISOString() },
      environmentVariables: {},
      decisions: { router: new Map(), condition: new Map() },
      loopIterations: new Map(),
      loopItems: new Map(),
      completedLoops: new Set(),
      executedBlocks: new Set(),
      activeExecutionPath: new Set(),
      workflow: {
        blocks: [],
        connections: [],
        version: '1.0.0',
        loops: {},
      } as SerializedWorkflow,
    }
    mockIsHostedVersion.mockReturnValue(false) // Default to non-hosted env for tests
    mockGetProviderFromModel.mockReturnValue('mock-provider')

    // Set up fetch mock to return a successful response
    mockFetch.mockImplementation(() => {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            content: 'Mocked response content',
            model: 'mock-model',
            tokens: { prompt: 10, completion: 20, total: 30 },
            toolCalls: [],
            cost: 0.001,
            timing: { total: 100 },
          }),
      })
    })

    mockTransformBlockTool.mockImplementation((tool: any) => ({
      id: `transformed_${tool.id}`,
      name: `${tool.id}_${tool.operation}`,
      description: 'Transformed tool',
      parameters: { type: 'object', properties: {} },
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
      expect(mockFetch).toHaveBeenCalledWith(expect.any(String), expect.any(Object))
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
        // No API key provided - this will be handled server-side
      }

      mockGetProviderFromModel.mockReturnValue('openai')

      const expectedProviderRequest = {
        model: 'gpt-4o',
        systemPrompt: 'You are a helpful assistant.',
        context: 'User query: Hello!',
        tools: undefined,
        temperature: 0.7,
        maxTokens: 100,
        apiKey: undefined, // No API key, server will add it
        responseFormat: undefined,
      }

      // Execute should work even without API key
      await handler.execute(mockBlock, inputs, mockContext)

      // Verify the proxy was called with the right parameters
      expect(mockFetch).toHaveBeenCalledWith(expect.any(String), expect.any(Object))
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
      expect(mockFetch).toHaveBeenCalledWith(expect.any(String), expect.any(Object))
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
      expect(mockFetch).toHaveBeenCalledWith(expect.any(String), expect.any(Object))
    })

    it('should handle responseFormat with valid JSON', async () => {
      // Create a special mock for this test only
      mockFetch.mockImplementationOnce(() => {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              content: '{"result": "Success", "score": 0.95}',
              model: 'mock-model',
              tokens: { prompt: 10, completion: 20, total: 30 },
              timing: { total: 100 },
            }),
        })
      })

      const inputs = {
        model: 'gpt-4o',
        context: 'Test context',
        apiKey: 'test-api-key',
        responseFormat:
          '{"type":"object","properties":{"result":{"type":"string"},"score":{"type":"number"}}}',
      }

      const result = await handler.execute(mockBlock, inputs, mockContext)

      expect(result).toEqual({
        response: {
          result: 'Success',
          score: 0.95,
          tokens: { prompt: 10, completion: 20, total: 30 },
          providerTiming: { total: 100 },
        },
      })
    })

    it('should handle responseFormat when it is an empty string', async () => {
      // Create a special mock for this test only
      mockFetch.mockImplementationOnce(() => {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              content: 'Regular text response',
              model: 'mock-model',
              tokens: { prompt: 10, completion: 20, total: 30 },
              timing: { total: 100 },
            }),
        })
      })

      const inputs = {
        model: 'gpt-4o',
        context: 'Test context',
        apiKey: 'test-api-key',
        responseFormat: '', // Empty string
      }

      const result = await handler.execute(mockBlock, inputs, mockContext)

      expect(result).toEqual({
        response: {
          content: 'Regular text response',
          model: 'mock-model',
          tokens: { prompt: 10, completion: 20, total: 30 },
          toolCalls: { list: [], count: 0 },
          providerTiming: { total: 100 },
        },
      })
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
      mockFetch.mockRejectedValue(new Error('Provider API Error'))

      await expect(handler.execute(mockBlock, inputs, mockContext)).rejects.toThrow(
        'Provider API Error'
      )
    })
  })
})
