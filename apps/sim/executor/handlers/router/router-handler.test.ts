import '@sim/testing/mocks/executor'

import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { generateRouterPrompt, generateRouterV2Prompt } from '@/blocks/blocks/router'
import { BlockType } from '@/executor/constants'
import { RouterBlockHandler } from '@/executor/handlers/router/router-handler'
import type { ExecutionContext } from '@/executor/types'
import { getProviderFromModel } from '@/providers/utils'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'

const mockGenerateRouterPrompt = generateRouterPrompt as Mock
const mockGenerateRouterV2Prompt = generateRouterV2Prompt as Mock
const mockGetProviderFromModel = getProviderFromModel as Mock
const mockFetch = global.fetch as unknown as Mock

describe('RouterBlockHandler', () => {
  let handler: RouterBlockHandler
  let mockBlock: SerializedBlock
  let mockContext: ExecutionContext
  let mockWorkflow: Partial<SerializedWorkflow>
  let mockTargetBlock1: SerializedBlock
  let mockTargetBlock2: SerializedBlock

  beforeEach(() => {
    mockTargetBlock1 = {
      id: 'target-block-1',
      metadata: { id: 'target', name: 'Option A', description: 'Choose A' },
      position: { x: 100, y: 100 },
      config: { tool: 'tool_a', params: { p: 'a' } },
      inputs: {},
      outputs: {},
      enabled: true,
    }
    mockTargetBlock2 = {
      id: 'target-block-2',
      metadata: { id: 'target', name: 'Option B', description: 'Choose B' },
      position: { x: 100, y: 150 },
      config: { tool: 'tool_b', params: { p: 'b' } },
      inputs: {},
      outputs: {},
      enabled: true,
    }
    mockBlock = {
      id: 'router-block-1',
      metadata: { id: BlockType.ROUTER, name: 'Test Router' },
      position: { x: 50, y: 50 },
      config: { tool: BlockType.ROUTER, params: {} },
      inputs: { prompt: 'string', model: 'string' },
      outputs: {},
      enabled: true,
    }
    mockWorkflow = {
      blocks: [mockBlock, mockTargetBlock1, mockTargetBlock2],
      connections: [
        { source: mockBlock.id, target: mockTargetBlock1.id, sourceHandle: 'condition-then1' },
        { source: mockBlock.id, target: mockTargetBlock2.id, sourceHandle: 'condition-else1' },
      ],
    }

    handler = new RouterBlockHandler({})

    mockContext = {
      workflowId: 'test-workflow-id',
      blockStates: new Map(),
      blockLogs: [],
      metadata: { duration: 0 },
      environmentVariables: {},
      decisions: { router: new Map(), condition: new Map() },
      loopExecutions: new Map(),
      completedLoops: new Set(),
      executedBlocks: new Set(),
      activeExecutionPath: new Set(),
      workflow: mockWorkflow as SerializedWorkflow,
    }

    vi.clearAllMocks()

    mockGetProviderFromModel.mockReturnValue('openai')
    mockGenerateRouterPrompt.mockReturnValue('Generated System Prompt')

    mockFetch.mockImplementation(() => {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            content: 'target-block-1',
            model: 'mock-model',
            tokens: { input: 100, output: 5, total: 105 },
            cost: 0.003,
            timing: { total: 300 },
          }),
      })
    })
  })

  it('should handle router blocks', () => {
    expect(handler.canHandle(mockBlock)).toBe(true)
    const nonRouterBlock: SerializedBlock = { ...mockBlock, metadata: { id: 'other' } }
    expect(handler.canHandle(nonRouterBlock)).toBe(false)
  })

  it('should execute router block correctly and select a path', async () => {
    const inputs = {
      prompt: 'Choose the best option.',
      model: 'gpt-4o',
      apiKey: 'test-api-key',
      temperature: 0.1,
    }

    const expectedTargetBlocks = [
      {
        id: 'target-block-1',
        type: 'target',
        title: 'Option A',
        description: 'Choose A',
        subBlocks: {
          p: 'a',
          systemPrompt: '',
        },
        currentState: undefined,
      },
      {
        id: 'target-block-2',
        type: 'target',
        title: 'Option B',
        description: 'Choose B',
        subBlocks: {
          p: 'b',
          systemPrompt: '',
        },
        currentState: undefined,
      },
    ]

    const result = await handler.execute(mockContext, mockBlock, inputs)

    expect(mockGenerateRouterPrompt).toHaveBeenCalledWith(inputs.prompt, expectedTargetBlocks)
    expect(mockGetProviderFromModel).toHaveBeenCalledWith('gpt-4o')
    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        method: 'POST',
        headers: expect.any(Object),
        body: expect.any(String),
      })
    )

    const fetchCallArgs = mockFetch.mock.calls[0]
    const requestBody = JSON.parse(fetchCallArgs[1].body)
    expect(requestBody).toMatchObject({
      provider: 'openai',
      model: 'gpt-4o',
      systemPrompt: 'Generated System Prompt',
      context: JSON.stringify([{ role: 'user', content: 'Choose the best option.' }]),
      temperature: 0.1,
    })

    expect(result).toEqual({
      prompt: 'Choose the best option.',
      model: 'mock-model',
      tokens: { input: 100, output: 5, total: 105 },
      cost: {
        input: 0,
        output: 0,
        total: 0,
      },
      selectedPath: {
        blockId: 'target-block-1',
        blockType: 'target',
        blockTitle: 'Option A',
      },
      selectedRoute: 'target-block-1',
    })
  })

  it('should throw error if target block is missing', async () => {
    const inputs = { prompt: 'Test' }
    mockContext.workflow!.blocks = [mockBlock, mockTargetBlock2]

    await expect(handler.execute(mockContext, mockBlock, inputs)).rejects.toThrow(
      'Target block target-block-1 not found'
    )
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('should throw error if LLM response is not a valid target block ID', async () => {
    const inputs = { prompt: 'Test', apiKey: 'test-api-key' }

    mockFetch.mockImplementationOnce(() => {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            content: 'invalid-block-id',
            model: 'mock-model',
            tokens: {},
            cost: 0,
            timing: {},
          }),
      })
    })

    await expect(handler.execute(mockContext, mockBlock, inputs)).rejects.toThrow(
      'Invalid routing decision: invalid-block-id'
    )
  })

  it('should use default model and temperature if not provided', async () => {
    const inputs = { prompt: 'Choose.', apiKey: 'test-api-key' }

    await handler.execute(mockContext, mockBlock, inputs)

    expect(mockGetProviderFromModel).toHaveBeenCalledWith('claude-sonnet-4-5')

    const fetchCallArgs = mockFetch.mock.calls[0]
    const requestBody = JSON.parse(fetchCallArgs[1].body)
    expect(requestBody).toMatchObject({
      model: 'claude-sonnet-4-5',
      temperature: 0.1,
    })
  })

  it('should handle server error responses', async () => {
    const inputs = { prompt: 'Test error handling.', apiKey: 'test-api-key' }

    mockFetch.mockImplementationOnce(() => {
      return Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Server error' }),
      })
    })

    await expect(handler.execute(mockContext, mockBlock, inputs)).rejects.toThrow('Server error')
  })

  it('should handle Azure OpenAI models with endpoint and API version', async () => {
    const inputs = {
      prompt: 'Choose the best option.',
      model: 'gpt-4o',
      apiKey: 'test-azure-key',
      azureEndpoint: 'https://test.openai.azure.com',
      azureApiVersion: '2024-07-01-preview',
    }

    mockGetProviderFromModel.mockReturnValue('azure-openai')

    await handler.execute(mockContext, mockBlock, inputs)

    const fetchCallArgs = mockFetch.mock.calls[0]
    const requestBody = JSON.parse(fetchCallArgs[1].body)

    expect(requestBody).toMatchObject({
      provider: 'azure-openai',
      model: 'gpt-4o',
      apiKey: 'test-azure-key',
      azureEndpoint: 'https://test.openai.azure.com',
      azureApiVersion: '2024-07-01-preview',
    })
  })

  it('should handle Vertex AI models with OAuth credential', async () => {
    const inputs = {
      prompt: 'Choose the best option.',
      model: 'gemini-2.0-flash-exp',
      vertexCredential: 'test-vertex-credential-id',
      vertexProject: 'test-gcp-project',
      vertexLocation: 'us-central1',
    }

    mockGetProviderFromModel.mockReturnValue('vertex')

    const mockDb = await import('@sim/db')
    const mockAccount = {
      id: 'test-vertex-credential-id',
      accessToken: 'mock-access-token',
      refreshToken: 'mock-refresh-token',
      expiresAt: new Date(Date.now() + 3600000),
    }
    vi.spyOn(mockDb.db.query.account, 'findFirst').mockResolvedValue(mockAccount as any)

    await handler.execute(mockContext, mockBlock, inputs)

    const fetchCallArgs = mockFetch.mock.calls[0]
    const requestBody = JSON.parse(fetchCallArgs[1].body)

    expect(requestBody).toMatchObject({
      provider: 'vertex',
      model: 'gemini-2.0-flash-exp',
      vertexProject: 'test-gcp-project',
      vertexLocation: 'us-central1',
    })
    expect(requestBody.apiKey).toBe('mock-access-token')
  })
})

describe('RouterBlockHandler V2', () => {
  let handler: RouterBlockHandler
  let mockRouterV2Block: SerializedBlock
  let mockContext: ExecutionContext
  let mockWorkflow: Partial<SerializedWorkflow>
  let mockTargetBlock1: SerializedBlock
  let mockTargetBlock2: SerializedBlock

  beforeEach(() => {
    mockTargetBlock1 = {
      id: 'target-block-1',
      metadata: { id: 'agent', name: 'Support Agent' },
      position: { x: 100, y: 100 },
      config: { tool: 'agent', params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
    }
    mockTargetBlock2 = {
      id: 'target-block-2',
      metadata: { id: 'agent', name: 'Sales Agent' },
      position: { x: 100, y: 150 },
      config: { tool: 'agent', params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
    }
    mockRouterV2Block = {
      id: 'router-v2-block-1',
      metadata: { id: BlockType.ROUTER_V2, name: 'Test Router V2' },
      position: { x: 50, y: 50 },
      config: { tool: BlockType.ROUTER_V2, params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
    }
    mockWorkflow = {
      blocks: [mockRouterV2Block, mockTargetBlock1, mockTargetBlock2],
      connections: [
        {
          source: mockRouterV2Block.id,
          target: mockTargetBlock1.id,
          sourceHandle: 'router-route-support',
        },
        {
          source: mockRouterV2Block.id,
          target: mockTargetBlock2.id,
          sourceHandle: 'router-route-sales',
        },
      ],
    }

    handler = new RouterBlockHandler({})

    mockContext = {
      workflowId: 'test-workflow-id',
      blockStates: new Map(),
      blockLogs: [],
      metadata: { duration: 0 },
      environmentVariables: {},
      decisions: { router: new Map(), condition: new Map() },
      loopExecutions: new Map(),
      completedLoops: new Set(),
      executedBlocks: new Set(),
      activeExecutionPath: new Set(),
      workflow: mockWorkflow as SerializedWorkflow,
    }

    vi.clearAllMocks()

    mockGetProviderFromModel.mockReturnValue('openai')
    mockGenerateRouterV2Prompt.mockReturnValue('Generated V2 System Prompt')
  })

  it('should handle router_v2 blocks', () => {
    expect(handler.canHandle(mockRouterV2Block)).toBe(true)
  })

  it('should execute router V2 and return reasoning', async () => {
    const inputs = {
      context: 'I need help with a billing issue',
      model: 'gpt-4o',
      apiKey: 'test-api-key',
      routes: JSON.stringify([
        { id: 'route-support', title: 'Support', value: 'Customer support inquiries' },
        { id: 'route-sales', title: 'Sales', value: 'Sales and pricing questions' },
      ]),
    }

    mockFetch.mockImplementationOnce(() => {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            content: JSON.stringify({
              route: 'route-support',
              reasoning: 'The user mentioned a billing issue which is a customer support matter.',
            }),
            model: 'gpt-4o',
            tokens: { input: 150, output: 25, total: 175 },
          }),
      })
    })

    const result = await handler.execute(mockContext, mockRouterV2Block, inputs)

    expect(result).toMatchObject({
      context: 'I need help with a billing issue',
      model: 'gpt-4o',
      selectedRoute: 'route-support',
      reasoning: 'The user mentioned a billing issue which is a customer support matter.',
      selectedPath: {
        blockId: 'target-block-1',
        blockType: 'agent',
        blockTitle: 'Support Agent',
      },
    })
  })

  it('should include responseFormat in provider request', async () => {
    const inputs = {
      context: 'Test context',
      model: 'gpt-4o',
      apiKey: 'test-api-key',
      routes: JSON.stringify([{ id: 'route-1', title: 'Route 1', value: 'Description 1' }]),
    }

    mockFetch.mockImplementationOnce(() => {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            content: JSON.stringify({ route: 'route-1', reasoning: 'Test reasoning' }),
            model: 'gpt-4o',
            tokens: { input: 100, output: 20, total: 120 },
          }),
      })
    })

    await handler.execute(mockContext, mockRouterV2Block, inputs)

    const fetchCallArgs = mockFetch.mock.calls[0]
    const requestBody = JSON.parse(fetchCallArgs[1].body)

    expect(requestBody.responseFormat).toEqual({
      name: 'router_response',
      schema: {
        type: 'object',
        properties: {
          route: {
            type: 'string',
            description: 'The selected route ID or NO_MATCH',
          },
          reasoning: {
            type: 'string',
            description: 'Brief explanation of why this route was chosen',
          },
        },
        required: ['route', 'reasoning'],
        additionalProperties: false,
      },
      strict: true,
    })
  })

  it('should handle NO_MATCH response with reasoning', async () => {
    const inputs = {
      context: 'Random unrelated query',
      model: 'gpt-4o',
      apiKey: 'test-api-key',
      routes: JSON.stringify([{ id: 'route-1', title: 'Route 1', value: 'Specific topic' }]),
    }

    mockFetch.mockImplementationOnce(() => {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            content: JSON.stringify({
              route: 'NO_MATCH',
              reasoning: 'The query does not relate to any available route.',
            }),
            model: 'gpt-4o',
            tokens: { input: 100, output: 20, total: 120 },
          }),
      })
    })

    await expect(handler.execute(mockContext, mockRouterV2Block, inputs)).rejects.toThrow(
      'Router could not determine a matching route: The query does not relate to any available route.'
    )
  })

  it('should throw error for invalid route ID in response', async () => {
    const inputs = {
      context: 'Test context',
      model: 'gpt-4o',
      apiKey: 'test-api-key',
      routes: JSON.stringify([{ id: 'route-1', title: 'Route 1', value: 'Description' }]),
    }

    mockFetch.mockImplementationOnce(() => {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            content: JSON.stringify({ route: 'invalid-route', reasoning: 'Some reasoning' }),
            model: 'gpt-4o',
            tokens: { input: 100, output: 20, total: 120 },
          }),
      })
    })

    await expect(handler.execute(mockContext, mockRouterV2Block, inputs)).rejects.toThrow(
      /Router could not determine a valid route/
    )
  })

  it('should handle routes passed as array instead of JSON string', async () => {
    const inputs = {
      context: 'Test context',
      model: 'gpt-4o',
      apiKey: 'test-api-key',
      routes: [{ id: 'route-1', title: 'Route 1', value: 'Description' }],
    }

    mockFetch.mockImplementationOnce(() => {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            content: JSON.stringify({ route: 'route-1', reasoning: 'Matched route 1' }),
            model: 'gpt-4o',
            tokens: { input: 100, output: 20, total: 120 },
          }),
      })
    })

    const result = await handler.execute(mockContext, mockRouterV2Block, inputs)

    expect(result.selectedRoute).toBe('route-1')
    expect(result.reasoning).toBe('Matched route 1')
  })

  it('should throw error when no routes are defined', async () => {
    const inputs = {
      context: 'Test context',
      model: 'gpt-4o',
      apiKey: 'test-api-key',
      routes: '[]',
    }

    await expect(handler.execute(mockContext, mockRouterV2Block, inputs)).rejects.toThrow(
      'No routes defined for router'
    )
  })

  it('should handle fallback when JSON parsing fails', async () => {
    const inputs = {
      context: 'Test context',
      model: 'gpt-4o',
      apiKey: 'test-api-key',
      routes: JSON.stringify([{ id: 'route-1', title: 'Route 1', value: 'Description' }]),
    }

    mockFetch.mockImplementationOnce(() => {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            content: 'route-1',
            model: 'gpt-4o',
            tokens: { input: 100, output: 5, total: 105 },
          }),
      })
    })

    const result = await handler.execute(mockContext, mockRouterV2Block, inputs)

    expect(result.selectedRoute).toBe('route-1')
    expect(result.reasoning).toBe('')
  })
})
