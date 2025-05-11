import { beforeEach, describe, expect, it, Mock, vi } from 'vitest'
import { isHosted } from '@/lib/environment'
import { getAllBlocks } from '@/blocks'
import { getProviderFromModel, transformBlockTool } from '@/providers/utils'
import { SerializedBlock, SerializedWorkflow } from '@/serializer/types'
import { executeTool } from '@/tools'
import { ExecutionContext, StreamingExecution } from '../../types'
import { AgentBlockHandler } from './agent-handler'

process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'

vi.mock('@/lib/environment', () => ({
  isHosted: vi.fn().mockReturnValue(false),
  isProd: vi.fn().mockReturnValue(false),
  isDev: vi.fn().mockReturnValue(true),
  isTest: vi.fn().mockReturnValue(false),
  getCostMultiplier: vi.fn().mockReturnValue(1),
}))

vi.mock('@/providers/utils', () => ({
  getProviderFromModel: vi.fn().mockReturnValue('mock-provider'),
  transformBlockTool: vi.fn(),
  getBaseModelProviders: vi.fn().mockReturnValue({ openai: {}, anthropic: {} }),
}))

vi.mock('@/blocks', () => ({
  getAllBlocks: vi.fn().mockReturnValue([]),
}))

vi.mock('@/tools', () => ({
  executeTool: vi.fn(),
}))

global.fetch = Object.assign(vi.fn(), { preconnect: vi.fn() }) as typeof fetch

const mockGetAllBlocks = getAllBlocks as Mock
const mockExecuteTool = executeTool as Mock
const mockIsHosted = isHosted as unknown as Mock
const mockGetProviderFromModel = getProviderFromModel as Mock
const mockTransformBlockTool = transformBlockTool as Mock
const mockFetch = global.fetch as unknown as Mock

describe('AgentBlockHandler', () => {
  let handler: AgentBlockHandler
  let mockBlock: SerializedBlock
  let mockContext: ExecutionContext
  let originalPromiseAll: any

  beforeEach(() => {
    handler = new AgentBlockHandler()
    vi.clearAllMocks()

    // Save original Promise.all to restore later
    originalPromiseAll = Promise.all

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
      metadata: { startTime: new Date().toISOString(), duration: 0 },
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
    mockIsHosted.mockReturnValue(false) // Default to non-hosted env for tests
    mockGetProviderFromModel.mockReturnValue('mock-provider')

    mockFetch.mockImplementation(() => {
      return Promise.resolve({
        ok: true,
        headers: {
          get: (name: string) => {
            if (name === 'Content-Type') return 'application/json'
            if (name === 'X-Execution-Data') return null
            return null
          },
        },
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

    mockExecuteTool.mockImplementation((toolId, params) => {
      if (toolId === 'function_execute') {
        return Promise.resolve({
          success: true,
          output: { result: 'Executed successfully', params },
        })
      }
      return Promise.resolve({ success: false, error: 'Unknown tool' })
    })
  })

  afterEach(() => {
    // Restore original Promise.all
    Promise.all = originalPromiseAll
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

    it('should preserve executeFunction for custom tools with different usageControl settings', async () => {
      let capturedTools: any[] = []

      Promise.all = vi.fn().mockImplementation((promises: Promise<any>[]) => {
        const result = originalPromiseAll.call(Promise, promises)

        // When result resolves, capture the tools
        result.then((tools: any[]) => {
          if (tools && tools.length) {
            capturedTools = tools.filter((t) => t !== null)
          }
        })

        return result
      })

      mockFetch.mockImplementationOnce(() => {
        return Promise.resolve({
          ok: true,
          headers: {
            get: (name: string) => {
              if (name === 'Content-Type') return 'application/json'
              if (name === 'X-Execution-Data') return null
              return null
            },
          },
          json: () =>
            Promise.resolve({
              content: 'Using tools to respond',
              model: 'mock-model',
              tokens: { prompt: 10, completion: 20, total: 30 },
              toolCalls: [
                {
                  name: 'auto_tool',
                  arguments: { input: 'test input for auto tool' },
                },
                {
                  name: 'force_tool',
                  arguments: { input: 'test input for force tool' },
                },
              ],
              timing: { total: 100 },
            }),
        })
      })

      const inputs = {
        model: 'gpt-4o',
        context: 'Test custom tools with different usageControl settings',
        apiKey: 'test-api-key',
        tools: [
          {
            type: 'custom-tool',
            title: 'Auto Tool',
            code: 'return { result: "auto tool executed", input }',
            timeout: 1000,
            schema: {
              function: {
                name: 'auto_tool',
                description: 'Custom tool with auto usage control',
                parameters: {
                  type: 'object',
                  properties: {
                    input: { type: 'string' },
                  },
                },
              },
            },
            usageControl: 'auto',
          },
          {
            type: 'custom-tool',
            title: 'Force Tool',
            code: 'return { result: "force tool executed", input }',
            timeout: 1000,
            schema: {
              function: {
                name: 'force_tool',
                description: 'Custom tool with forced usage control',
                parameters: {
                  type: 'object',
                  properties: {
                    input: { type: 'string' },
                  },
                },
              },
            },
            usageControl: 'force',
          },
          {
            type: 'custom-tool',
            title: 'None Tool',
            code: 'return { result: "none tool executed", input }',
            timeout: 1000,
            schema: {
              function: {
                name: 'none_tool',
                description: 'Custom tool that should be filtered out',
                parameters: {
                  type: 'object',
                  properties: {
                    input: { type: 'string' },
                  },
                },
              },
            },
            usageControl: 'none', // This tool should be filtered out
          },
        ],
      }

      mockGetProviderFromModel.mockReturnValue('openai')

      await handler.execute(mockBlock, inputs, mockContext)

      expect(Promise.all).toHaveBeenCalled()

      expect(capturedTools.length).toBe(2)

      const autoTool = capturedTools.find((t) => t.name === 'auto_tool')
      const forceTool = capturedTools.find((t) => t.name === 'force_tool')
      const noneTool = capturedTools.find((t) => t.name === 'none_tool')

      expect(autoTool).toBeDefined()
      expect(forceTool).toBeDefined()
      expect(noneTool).toBeUndefined()

      expect(autoTool.usageControl).toBe('auto')
      expect(forceTool.usageControl).toBe('force')

      expect(typeof autoTool.executeFunction).toBe('function')
      expect(typeof forceTool.executeFunction).toBe('function')

      const autoResult = await autoTool.executeFunction({ input: 'test input' })
      expect(mockExecuteTool).toHaveBeenCalledWith(
        'function_execute',
        expect.objectContaining({
          code: 'return { result: "auto tool executed", input }',
          input: 'test input',
        })
      )

      const forceResult = await forceTool.executeFunction({ input: 'another test' })
      expect(mockExecuteTool).toHaveBeenCalledWith(
        'function_execute',
        expect.objectContaining({
          code: 'return { result: "force tool executed", input }',
          input: 'another test',
        })
      )

      const fetchCall = mockFetch.mock.calls[0]
      const requestBody = JSON.parse(fetchCall[1].body)

      expect(requestBody.tools.length).toBe(2)
    })

    it('should filter out tools with usageControl set to "none"', async () => {
      const inputs = {
        model: 'gpt-4o',
        context: 'Use the tools provided.',
        apiKey: 'test-api-key',
        tools: [
          {
            id: 'tool_1',
            title: 'Tool 1',
            type: 'tool-type-1',
            operation: 'operation1',
            usageControl: 'auto', // default setting
          },
          {
            id: 'tool_2',
            title: 'Tool 2',
            type: 'tool-type-2',
            operation: 'operation2',
            usageControl: 'none', // should be filtered out
          },
          {
            id: 'tool_3',
            title: 'Tool 3',
            type: 'tool-type-3',
            operation: 'operation3',
            usageControl: 'force', // should be included
          },
        ],
      }

      mockGetProviderFromModel.mockReturnValue('openai')

      await handler.execute(mockBlock, inputs, mockContext)

      const fetchCall = mockFetch.mock.calls[0]
      const requestBody = JSON.parse(fetchCall[1].body)

      expect(requestBody.tools.length).toBe(2)

      const toolIds = requestBody.tools.map((t: any) => t.id)
      expect(toolIds).toContain('transformed_tool_1')
      expect(toolIds).toContain('transformed_tool_3')
      expect(toolIds).not.toContain('transformed_tool_2')
    })

    it('should include usageControl property in transformed tools', async () => {
      const inputs = {
        model: 'gpt-4o',
        context: 'Use the tools with different usage controls.',
        apiKey: 'test-api-key',
        tools: [
          {
            id: 'tool_1',
            title: 'Tool 1',
            type: 'tool-type-1',
            operation: 'operation1',
            usageControl: 'auto',
          },
          {
            id: 'tool_2',
            title: 'Tool 2',
            type: 'tool-type-2',
            operation: 'operation2',
            usageControl: 'force',
          },
        ],
      }

      mockTransformBlockTool.mockImplementation((tool: any) => ({
        id: `transformed_${tool.id}`,
        name: `${tool.id}_${tool.operation}`,
        description: 'Transformed tool',
        parameters: { type: 'object', properties: {} },
      }))

      mockGetProviderFromModel.mockReturnValue('openai')

      await handler.execute(mockBlock, inputs, mockContext)

      const fetchCall = mockFetch.mock.calls[0]
      const requestBody = JSON.parse(fetchCall[1].body)

      expect(requestBody.tools[0].usageControl).toBe('auto')
      expect(requestBody.tools[1].usageControl).toBe('force')
    })

    it('should handle custom tools with usageControl properties', async () => {
      const inputs = {
        model: 'gpt-4o',
        context: 'Use the custom tools.',
        apiKey: 'test-api-key',
        tools: [
          {
            type: 'custom-tool',
            title: 'Custom Tool - Auto',
            schema: {
              function: {
                name: 'custom_tool_auto',
                description: 'A custom tool with auto usage control',
                parameters: {
                  type: 'object',
                  properties: { input: { type: 'string' } },
                },
              },
            },
            usageControl: 'auto',
          },
          {
            type: 'custom-tool',
            title: 'Custom Tool - Force',
            schema: {
              function: {
                name: 'custom_tool_force',
                description: 'A custom tool with forced usage',
                parameters: {
                  type: 'object',
                  properties: { input: { type: 'string' } },
                },
              },
            },
            usageControl: 'force',
          },
          {
            type: 'custom-tool',
            title: 'Custom Tool - None',
            schema: {
              function: {
                name: 'custom_tool_none',
                description: 'A custom tool that should not be used',
                parameters: {
                  type: 'object',
                  properties: { input: { type: 'string' } },
                },
              },
            },
            usageControl: 'none', // Should be filtered out
          },
        ],
      }

      mockGetProviderFromModel.mockReturnValue('openai')

      await handler.execute(mockBlock, inputs, mockContext)

      const fetchCall = mockFetch.mock.calls[0]
      const requestBody = JSON.parse(fetchCall[1].body)

      expect(requestBody.tools.length).toBe(2)

      const toolNames = requestBody.tools.map((t: any) => t.name)
      expect(toolNames).toContain('custom_tool_auto')
      expect(toolNames).toContain('custom_tool_force')
      expect(toolNames).not.toContain('custom_tool_none')

      const autoTool = requestBody.tools.find((t: any) => t.name === 'custom_tool_auto')
      const forceTool = requestBody.tools.find((t: any) => t.name === 'custom_tool_force')

      expect(autoTool.usageControl).toBe('auto')
      expect(forceTool.usageControl).toBe('force')
    })

    it('should not require API key for gpt-4o on hosted version', async () => {
      mockIsHosted.mockReturnValue(true)

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
        tools: undefined,
        temperature: 0.7,
        maxTokens: 100,
        apiKey: undefined, // No API key, server will add it
        responseFormat: undefined,
      }

      await handler.execute(mockBlock, inputs, mockContext)

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

      await handler.execute(mockBlock, inputs, mockContext)

      expect(mockFetch).toHaveBeenCalledWith(expect.any(String), expect.any(Object))
    })

    it('should handle responseFormat with valid JSON', async () => {
      mockFetch.mockImplementationOnce(() => {
        return Promise.resolve({
          ok: true,
          headers: {
            get: (name: string) => {
              if (name === 'Content-Type') return 'application/json'
              if (name === 'X-Execution-Data') return null
              return null
            },
          },
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
      mockFetch.mockImplementationOnce(() => {
        return Promise.resolve({
          ok: true,
          headers: {
            get: (name: string) => {
              if (name === 'Content-Type') return 'application/json'
              if (name === 'X-Execution-Data') return null
              return null
            },
          },
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

    it('should handle streaming responses with text/event-stream content type', async () => {
      const mockStreamBody = {
        getReader: vi.fn().mockReturnValue({
          read: vi.fn().mockResolvedValue({ done: true, value: undefined }),
        }),
      }

      mockFetch.mockImplementationOnce(() => {
        return Promise.resolve({
          ok: true,
          headers: {
            get: (name: string) => {
              if (name === 'Content-Type') return 'text/event-stream'
              if (name === 'X-Execution-Data') return null
              return null
            },
          },
          body: mockStreamBody,
        })
      })

      const inputs = {
        model: 'gpt-4o',
        context: 'Stream this response.',
        apiKey: 'test-api-key',
        stream: true,
      }

      mockContext.stream = true
      mockContext.selectedOutputIds = [mockBlock.id]

      const result = await handler.execute(mockBlock, inputs, mockContext)

      expect(result).toHaveProperty('stream')
      expect(result).toHaveProperty('execution')

      expect((result as StreamingExecution).execution).toHaveProperty('success', true)
      expect((result as StreamingExecution).execution).toHaveProperty('output')
      expect((result as StreamingExecution).execution.output).toHaveProperty('response')
      expect((result as StreamingExecution).execution).toHaveProperty('logs')
    })

    it('should handle streaming responses with execution data in header', async () => {
      const mockStreamBody = {
        getReader: vi.fn().mockReturnValue({
          read: vi.fn().mockResolvedValue({ done: true, value: undefined }),
        }),
      }

      const mockExecutionData = {
        success: true,
        output: {
          response: {
            content: '',
            model: 'mock-model',
            tokens: { prompt: 10, completion: 20, total: 30 },
          },
        },
        logs: [
          {
            blockId: 'some-id',
            blockType: 'agent',
            startedAt: new Date().toISOString(),
            endedAt: new Date().toISOString(),
            durationMs: 100,
            success: true,
          },
        ],
        metadata: {
          startTime: new Date().toISOString(),
          duration: 100,
        },
      }

      mockFetch.mockImplementationOnce(() => {
        return Promise.resolve({
          ok: true,
          headers: {
            get: (name: string) => {
              if (name === 'Content-Type') return 'text/event-stream'
              if (name === 'X-Execution-Data') return JSON.stringify(mockExecutionData)
              return null
            },
          },
          body: mockStreamBody,
        })
      })

      const inputs = {
        model: 'gpt-4o',
        context: 'Stream this response with execution data.',
        apiKey: 'test-api-key',
        stream: true,
      }

      mockContext.stream = true
      mockContext.selectedOutputIds = [mockBlock.id]

      const result = await handler.execute(mockBlock, inputs, mockContext)

      expect(result).toHaveProperty('stream')
      expect(result).toHaveProperty('execution')

      expect((result as StreamingExecution).execution.success).toBe(true)
      expect((result as StreamingExecution).execution.output.response.model).toBe('mock-model')
      const logs = (result as StreamingExecution).execution.logs
      expect(logs?.length).toBe(1)
      if (logs && logs.length > 0 && logs[0]) {
        expect(logs[0].blockType).toBe('agent')
      }
    })

    it('should handle combined stream+execution responses', async () => {
      const mockStreamObj = new ReadableStream({
        start(controller) {
          controller.close()
        },
      })

      mockFetch.mockImplementationOnce(() => {
        return Promise.resolve({
          ok: true,
          headers: {
            get: (name: string) => (name === 'Content-Type' ? 'application/json' : null),
          },
          json: () =>
            Promise.resolve({
              stream: {}, // Serialized stream placeholder
              execution: {
                success: true,
                output: {
                  response: {
                    content: 'Test streaming content',
                    model: 'gpt-4o',
                    tokens: { prompt: 10, completion: 5, total: 15 },
                  },
                },
                logs: [],
                metadata: {
                  startTime: new Date().toISOString(),
                  duration: 150,
                },
              },
            }),
        })
      })

      const inputs = {
        model: 'gpt-4o',
        context: 'Return a combined response.',
        apiKey: 'test-api-key',
        stream: true,
      }

      mockContext.stream = true
      mockContext.selectedOutputIds = [mockBlock.id]

      const result = await handler.execute(mockBlock, inputs, mockContext)

      expect(result).toHaveProperty('stream')
      expect(result).toHaveProperty('execution')

      expect((result as StreamingExecution).execution.success).toBe(true)
      expect((result as StreamingExecution).execution.output.response.content).toBe(
        'Test streaming content'
      )
      expect((result as StreamingExecution).execution.output.response.model).toBe('gpt-4o')
    })
  })
})
